import { distance } from "./geometry.js";
import type { HousingUnit, Tile, World } from "./types.js";

/**
 * Emergent building density: a residential tile grows or decays one
 * developmentLevel at a time, purely from conditions this tick already
 * settled (land value, occupancy, local vacancy) — never player-placed. Same
 * boundary as every other agent-driven field: this module only ever adds or
 * removes *vacant* housing capacity and bumps developmentLevel; it never
 * touches occupantId, and never forces anyone out of a home.
 *
 * Growth and decay each require ALL of their conditions to hold
 * simultaneously, and require them to hold for `growthSustainTicks` /
 * `decaySustainTicks` consecutive ticks in a row — any single tick where a
 * condition breaks resets that tile's streak to 0. That's what makes this
 * "sticky and slow": a tile can't flicker between levels from one good or
 * bad tick, and growthLandValueThreshold is kept well above
 * decayLandValueThreshold (hysteresis) so a mid-value tile just holds its
 * level in the gap between them instead of oscillating.
 */
export function developmentGrowth(world: World): void {
  for (const tile of world.tiles) {
    if (tile.use !== "residential") continue;

    const capacity = tile.housingUnitIds.length;
    const occupied = occupiedCount(world, tile);
    const occupancyRate = capacity > 0 ? occupied / capacity : 0;
    const localVacancy = localVacancyRate(world, tile);
    const inDemand = localVacancy < world.params.targetVacancyRate;

    const maxLevel = world.params.developmentCapacity.length - 1;
    const canGrow = tile.developmentLevel < maxLevel;
    const canDecay = tile.developmentLevel > 1;

    const growthConditionsMet =
      canGrow && tile.landValue >= world.params.growthLandValueThreshold && occupancyRate >= world.params.growthOccupancyThreshold && inDemand;

    const decayConditionsMet = canDecay && tile.landValue <= world.params.decayLandValueThreshold && occupancyRate <= world.params.decayVacancyThreshold;

    if (growthConditionsMet) {
      tile.growthStreak += 1;
      tile.decayStreak = 0;
    } else if (decayConditionsMet) {
      tile.decayStreak += 1;
      tile.growthStreak = 0;
    } else {
      tile.growthStreak = 0;
      tile.decayStreak = 0;
    }

    if (tile.growthStreak >= world.params.growthSustainTicks) {
      growTile(world, tile, occupancyRate, localVacancy);
    } else if (tile.decayStreak >= world.params.decaySustainTicks) {
      decayTile(world, tile, occupancyRate);
    }
  }
}

function occupiedCount(world: World, tile: Tile): number {
  let n = 0;
  for (const unitId of tile.housingUnitIds) {
    if (world.housingUnits.get(unitId)!.occupantId !== null) n++;
  }
  return n;
}

/**
 * Same "vacancy among nearby residential units" concept rent.ts uses for
 * demand pressure, recomputed independently here rather than imported —
 * this module only ever reads settled state, it doesn't reach into rent.ts's
 * internals, and duplicating one small loop is cheaper to reason about than
 * coupling two otherwise-independent tick phases.
 */
function localVacancyRate(world: World, tile: Tile): number {
  let total = 0;
  let vacant = 0;
  for (const other of world.tiles) {
    if (other.use !== "residential") continue;
    if (distance(tile.x, tile.y, other.x, other.y) > world.params.rentDemandRadius) continue;
    for (const unitId of other.housingUnitIds) {
      total++;
      if (world.housingUnits.get(unitId)!.occupantId === null) vacant++;
    }
  }
  return total > 0 ? vacant / total : world.params.targetVacancyRate;
}

function growTile(world: World, tile: Tile, occupancyRate: number, localVacancy: number): void {
  const fromLevel = tile.developmentLevel;
  const toLevel = fromLevel + 1;
  const newCapacity = world.params.developmentCapacity[toLevel]!;
  const unitsToAdd = Math.max(0, newCapacity - tile.housingUnitIds.length);

  for (let i = 0; i < unitsToAdd; i++) {
    const unitId = `hu-${tile.id}-L${toLevel}-${world.tick}-${i}`;
    const unit: HousingUnit = {
      id: unitId,
      tileId: tile.id,
      rent: tile.landValue * world.params.rentMultiplier,
      occupantId: null,
      vacantSinceTick: world.tick,
    };
    world.housingUnits.set(unitId, unit);
    tile.housingUnitIds.push(unitId);
  }

  tile.developmentLevel = toLevel;
  tile.growthStreak = 0;
  tile.lastDevelopmentChange = {
    tick: world.tick,
    direction: "grew",
    fromLevel,
    toLevel,
    reason:
      `Land value ${tile.landValue.toFixed(1)} stayed >= ${world.params.growthLandValueThreshold} for ${world.params.growthSustainTicks} ticks ` +
      `with ${(occupancyRate * 100).toFixed(0)}% occupancy and strong demand (nearby vacancy ${(localVacancy * 100).toFixed(0)}% < target ${(
        world.params.targetVacancyRate * 100
      ).toFixed(0)}%) — added ${unitsToAdd} unit(s), now level ${toLevel} (${newCapacity} capacity).`,
  };
}

function decayTile(world: World, tile: Tile, occupancyRate: number): void {
  const fromLevel = tile.developmentLevel;
  const toLevel = fromLevel - 1;
  const newCapacity = world.params.developmentCapacity[toLevel]!;
  const unitsToRemove = Math.max(0, tile.housingUnitIds.length - newCapacity);

  // Only ever remove vacant units — never evict an occupant. Persistent
  // vacancy is a decay precondition, so there's normally plenty of vacant
  // capacity to remove; if not (edge case), remove what's actually vacant
  // and let the level drop anyway. The unit array is the real capacity —
  // the table is only a guide for how many units a growth/decay event
  // creates or removes, not a hard ceiling enforced elsewhere.
  let removed = 0;
  const kept: string[] = [];
  for (const unitId of tile.housingUnitIds) {
    const unit = world.housingUnits.get(unitId)!;
    if (removed < unitsToRemove && unit.occupantId === null) {
      world.housingUnits.delete(unitId);
      removed++;
    } else {
      kept.push(unitId);
    }
  }
  tile.housingUnitIds = kept;

  tile.developmentLevel = toLevel;
  tile.decayStreak = 0;
  tile.lastDevelopmentChange = {
    tick: world.tick,
    direction: "decayed",
    fromLevel,
    toLevel,
    reason:
      `Land value ${tile.landValue.toFixed(1)} stayed <= ${world.params.decayLandValueThreshold} for ${world.params.decaySustainTicks} ticks ` +
      `with persistent vacancy (only ${(occupancyRate * 100).toFixed(0)}% occupied) — removed ${removed} vacant unit(s), now level ${toLevel} (${newCapacity} capacity).`,
  };
}
