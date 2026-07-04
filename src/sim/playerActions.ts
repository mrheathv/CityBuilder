import type { Business, HousingUnit, JobSlot, World } from "./types.js";
import type { ActionResult } from "./actionResult.js";

export type { ActionResult } from "./actionResult.js";

/**
 * Every function in this file (plus buildAmenity/removeAmenity in amenity.ts)
 * is the *entire* surface the player touches. None of them ever set
 * occupantId, homeUnitId, or jobSlotId — they only create empty capacity
 * (units/jobs), change what a tile is zoned/built as, or move money.
 * Whether anyone ever moves into what gets built here — or routes over a
 * road that gets built here — is decided exclusively by the existing agent
 * search/relocation logic and the road-network recompute on the next tick.
 */

/** Shared by amenity.ts too — the one place "can the player afford this, and if so deduct it" is decided. */
export function spend(world: World, cost: number): ActionResult | null {
  if (world.player.treasury < cost) {
    return { ok: false, reason: `insufficient treasury: need ${cost}, have ${world.player.treasury.toFixed(0)}` };
  }
  world.player.treasury -= cost;
  return null;
}

export function zoneResidential(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "empty") return { ok: false, reason: "tile is not empty" };

  const insufficientFunds = spend(world, world.params.zoneCost);
  if (insufficientFunds) return insufficientFunds;

  tile.use = "residential";
  tile.developmentLevel = 1;
  tile.growthStreak = 0;
  tile.decayStreak = 0;
  tile.lastDevelopmentChange = null;
  const capacity = world.params.developmentCapacity[1]!;
  for (let i = 0; i < capacity; i++) {
    const unit: HousingUnit = {
      id: `hu-${tile.id}-${i}`,
      tileId: tile.id,
      rent: tile.landValue * world.params.rentMultiplier,
      occupantId: null,
      vacantSinceTick: world.tick,
    };
    world.housingUnits.set(unit.id, unit);
    tile.housingUnitIds.push(unit.id);
  }
  return { ok: true };
}

export function zoneCommercial(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "empty") return { ok: false, reason: "tile is not empty" };

  const insufficientFunds = spend(world, world.params.zoneCost);
  if (insufficientFunds) return insufficientFunds;

  tile.use = "commercial";
  return { ok: true };
}

export function buildJobCenter(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "commercial") return { ok: false, reason: "tile is not zoned commercial" };
  if (tile.businessId) return { ok: false, reason: "tile already has a job center" };

  const insufficientFunds = spend(world, world.params.buildJobCenterCost);
  if (insufficientFunds) return insufficientFunds;

  const businessId = `biz-${tile.id}`;
  const jobSlotIds: string[] = [];
  for (let i = 0; i < world.params.jobCenterJobSlots; i++) {
    const jobId = `js-${businessId}-${i}`;
    const job: JobSlot = { id: jobId, businessId, wage: world.params.jobCenterWage, occupantId: null, vacantSinceTick: world.tick };
    world.jobSlots.set(jobId, job);
    jobSlotIds.push(jobId);
  }
  const business: Business = { id: businessId, tileId: tile.id, jobSlotIds };
  world.businesses.set(businessId, business);
  tile.businessId = businessId;
  world.accessibilityDirty = true; // a new job source changes the network's access field
  return { ok: true };
}

/** Bulldoze a job center. Only allowed once every job slot is vacant — you can't demolish an active employer out from under its workers. */
export function removeJobCenter(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (!tile.businessId) return { ok: false, reason: "no job center on this tile" };

  const business = world.businesses.get(tile.businessId)!;
  const filled = business.jobSlotIds.filter((id) => world.jobSlots.get(id)!.occupantId !== null).length;
  if (filled > 0) return { ok: false, reason: `cannot remove: ${filled} job(s) still filled` };

  for (const jobId of business.jobSlotIds) world.jobSlots.delete(jobId);
  world.businesses.delete(business.id);
  tile.businessId = null;
  world.accessibilityDirty = true;
  return { ok: true };
}

/** Unzone a tile back to empty. Only allowed once it holds no occupied units and no job center — you can't bulldoze someone's home or an active business. */
export function unzoneTile(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use === "empty") return { ok: false, reason: "tile is already empty" };
  if (tile.use === "road" || tile.use === "park") return { ok: false, reason: "use removeRoad/removeAmenity for this tile" };

  if (tile.use === "commercial" && tile.businessId) {
    return { ok: false, reason: "remove the job center first" };
  }

  if (tile.use === "residential") {
    const occupied = tile.housingUnitIds.filter((id) => world.housingUnits.get(id)!.occupantId !== null).length;
    if (occupied > 0) return { ok: false, reason: `cannot unzone: ${occupied} unit(s) still occupied` };
    for (const unitId of tile.housingUnitIds) world.housingUnits.delete(unitId);
    tile.housingUnitIds = [];
    tile.developmentLevel = 0;
    tile.growthStreak = 0;
    tile.decayStreak = 0;
    tile.lastDevelopmentChange = null;
  }

  tile.use = "empty";
  return { ok: true };
}

export function buildRoad(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "empty") return { ok: false, reason: "tile is not empty" };

  const insufficientFunds = spend(world, world.params.roadBuildCost);
  if (insufficientFunds) return insufficientFunds;

  tile.use = "road";
  world.accessibilityDirty = true; // the network topology just changed
  return { ok: true };
}

/** Always allowed — a road has no occupants to protect. Removing one that strands connected tiles just shows up as lower access next recompute, exactly like any other emergent consequence. */
export function removeRoad(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "road") return { ok: false, reason: "no road on this tile" };

  tile.use = "empty";
  world.accessibilityDirty = true;
  return { ok: true };
}

/** No cost — a policy choice, not a purchase. Clamped to a sane range so income tax can never go negative or exceed 100%. */
export function setTaxRate(world: World, rate: number): ActionResult {
  world.player.taxRate = Math.max(0, Math.min(1, rate));
  return { ok: true };
}
