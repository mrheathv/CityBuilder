import { describe, expect, it } from "vitest";
import { defaultParams } from "../src/sim/params.js";
import { createRng } from "../src/sim/rng.js";
import { developmentGrowth } from "../src/sim/development.js";
import { createEmptyNetworkCache } from "../src/sim/roadNetwork.js";
import type { HousingUnit, SimParams, Tile, World } from "../src/sim/types.js";

/**
 * One isolated residential tile so developmentGrowth's "local vacancy rate"
 * calculation (which scans every residential tile within rentDemandRadius)
 * is fully controlled by this tile alone — no neighbors to leak signal in.
 */
function makeSingleTileWorld(level: 1 | 2 | 3 | 4, occupiedCount: number, overrides: Partial<SimParams> = {}): { world: World; tile: Tile } {
  const params: SimParams = { ...defaultParams, ...overrides };
  const capacity = params.developmentCapacity[level]!;
  if (occupiedCount > capacity) throw new Error("occupiedCount exceeds capacity");

  const tile: Tile = {
    id: "t-0-0",
    x: 0,
    y: 0,
    use: "residential",
    baselineAmenity: 0,
    amenity: 0,
    landValue: 0,
    landValueBreakdown: { jobAccess: 0, amenity: 0, congestion: 0 },
    housingUnitIds: [],
    businessId: null,
    amenityObjectId: null,
    developmentLevel: level,
    growthStreak: 0,
    decayStreak: 0,
    lastDevelopmentChange: null,
  };

  const housingUnits = new Map<string, HousingUnit>();
  for (let i = 0; i < capacity; i++) {
    const id = `hu-${tile.id}-${i}`;
    housingUnits.set(id, {
      id,
      tileId: tile.id,
      rent: 5,
      occupantId: i < occupiedCount ? `synthetic-${i}` : null,
      vacantSinceTick: i < occupiedCount ? null : 0,
    });
    tile.housingUnitIds.push(id);
  }

  const world: World = {
    tick: 0,
    seed: 1,
    width: 1,
    height: 1,
    rng: createRng(1),
    params,
    tiles: [tile],
    tilesById: new Map([[tile.id, tile]]),
    housingUnits,
    jobSlots: new Map(),
    businesses: new Map(),
    households: new Map(),
    amenities: new Map(),
    nextHouseholdSeq: 0,
    network: createEmptyNetworkCache(1),
    accessibilityDirty: false,
    player: { treasury: params.initialTreasury, taxRate: params.initialTaxRate, lastTaxRevenue: 0, lastUpkeepCost: 0 },
    game: { status: "playing", reason: null, ticksInsolvent: 0 },
    history: [],
  };

  return { world, tile };
}

describe("developmentGrowth: growth", () => {
  it("does not grow before growthSustainTicks consecutive qualifying ticks", () => {
    const { world, tile } = makeSingleTileWorld(1, 2); // fully occupied house, 2/2
    tile.landValue = world.params.growthLandValueThreshold;

    for (let i = 0; i < world.params.growthSustainTicks - 1; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.developmentLevel).toBe(1);
    expect(tile.growthStreak).toBe(world.params.growthSustainTicks - 1);
  });

  it("grows exactly one level after growthSustainTicks consecutive qualifying ticks, adding vacant capacity from the table", () => {
    const { world, tile } = makeSingleTileWorld(1, 2);
    tile.landValue = world.params.growthLandValueThreshold;

    for (let i = 0; i < world.params.growthSustainTicks; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.developmentLevel).toBe(2);
    expect(tile.housingUnitIds.length).toBe(world.params.developmentCapacity[2]);
    expect(tile.growthStreak).toBe(0);
    // Original 2 units (still occupied) must still be present, untouched.
    const occupiedStill = tile.housingUnitIds.filter((id) => world.housingUnits.get(id)!.occupantId !== null);
    expect(occupiedStill).toHaveLength(2);
    // New capacity is vacant, not auto-filled — growth only creates capacity.
    const vacantNew = tile.housingUnitIds.filter((id) => world.housingUnits.get(id)!.occupantId === null);
    expect(vacantNew).toHaveLength(world.params.developmentCapacity[2]! - 2);
  });

  it("records a data-derived lastDevelopmentChange reason when it grows", () => {
    const { world, tile } = makeSingleTileWorld(1, 2);
    tile.landValue = world.params.growthLandValueThreshold;

    for (let i = 0; i < world.params.growthSustainTicks; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.lastDevelopmentChange).not.toBeNull();
    expect(tile.lastDevelopmentChange!.direction).toBe("grew");
    expect(tile.lastDevelopmentChange!.fromLevel).toBe(1);
    expect(tile.lastDevelopmentChange!.toLevel).toBe(2);
    expect(tile.lastDevelopmentChange!.tick).toBe(world.params.growthSustainTicks - 1);
    expect(tile.lastDevelopmentChange!.reason).toContain(String(world.params.growthLandValueThreshold));
  });

  it("a single tick that breaks a growth condition resets the streak to 0 (sticky, not flicker)", () => {
    const { world, tile } = makeSingleTileWorld(1, 2);
    tile.landValue = world.params.growthLandValueThreshold;

    for (let i = 0; i < world.params.growthSustainTicks - 1; i++) {
      world.tick = i;
      developmentGrowth(world);
    }
    expect(tile.growthStreak).toBe(world.params.growthSustainTicks - 1);

    // One bad tick: land value dips below threshold.
    world.tick = world.params.growthSustainTicks - 1;
    tile.landValue = world.params.growthLandValueThreshold - 1;
    developmentGrowth(world);
    expect(tile.growthStreak).toBe(0);
    expect(tile.developmentLevel).toBe(1);

    // Restoring the condition requires the full window again, not just one more tick.
    world.tick += 1;
    tile.landValue = world.params.growthLandValueThreshold;
    developmentGrowth(world);
    expect(tile.developmentLevel).toBe(1);
    expect(tile.growthStreak).toBe(1);
  });

  it("does not grow past the top of developmentCapacity even with qualifying conditions forever", () => {
    const maxLevel = defaultParams.developmentCapacity.length - 1;
    const capacity = defaultParams.developmentCapacity[maxLevel]! as 4; // satisfies the 1|2|3|4 union at the call site below
    const { world, tile } = makeSingleTileWorld(maxLevel as 1 | 2 | 3 | 4, capacity);
    tile.landValue = world.params.growthLandValueThreshold;

    for (let i = 0; i < world.params.growthSustainTicks * 3; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.developmentLevel).toBe(maxLevel);
  });

  it("does not grow below the occupancy threshold, even at high land value", () => {
    const { world, tile } = makeSingleTileWorld(1, 1); // 1/2 occupied = 50%, below the 85% bar
    tile.landValue = world.params.growthLandValueThreshold;

    for (let i = 0; i < world.params.growthSustainTicks; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.developmentLevel).toBe(1);
    expect(tile.growthStreak).toBe(0);
  });

  it("does not grow without area demand, even when the tile itself is fully occupied", () => {
    // Two tiles within rentDemandRadius of each other: the target tile is
    // fully occupied (clears growthOccupancyThreshold on its own), but its
    // neighbor is almost entirely vacant, dragging the *local* vacancy rate
    // above target — the area isn't actually in demand, just this one tile.
    const params: SimParams = { ...defaultParams };
    const target: Tile = {
      id: "t-0-0",
      x: 0,
      y: 0,
      use: "residential",
      baselineAmenity: 0,
      amenity: 0,
      landValue: params.growthLandValueThreshold,
      landValueBreakdown: { jobAccess: 0, amenity: 0, congestion: 0 },
      housingUnitIds: [],
      businessId: null,
      amenityObjectId: null,
      developmentLevel: 1,
      growthStreak: 0,
      decayStreak: 0,
      lastDevelopmentChange: null,
    };
    const neighbor: Tile = { ...target, id: "t-1-0", x: 1, y: 0, housingUnitIds: [] };

    const housingUnits = new Map<string, HousingUnit>();
    for (let i = 0; i < params.developmentCapacity[1]!; i++) {
      const id = `hu-${target.id}-${i}`;
      housingUnits.set(id, { id, tileId: target.id, rent: 5, occupantId: `synthetic-${i}`, vacantSinceTick: null });
      target.housingUnitIds.push(id);
    }
    // A big, mostly-vacant neighbor building swamps the local vacancy rate.
    for (let i = 0; i < params.developmentCapacity[4]!; i++) {
      const id = `hu-${neighbor.id}-${i}`;
      const occupied = i === 0;
      housingUnits.set(id, { id, tileId: neighbor.id, rent: 5, occupantId: occupied ? "synthetic-n" : null, vacantSinceTick: occupied ? null : 0 });
      neighbor.housingUnitIds.push(id);
    }
    neighbor.developmentLevel = 4;

    const world: World = {
      tick: 0,
      seed: 1,
      width: 2,
      height: 1,
      rng: createRng(1),
      params,
      tiles: [target, neighbor],
      tilesById: new Map([
        [target.id, target],
        [neighbor.id, neighbor],
      ]),
      housingUnits,
      jobSlots: new Map(),
      businesses: new Map(),
      households: new Map(),
      amenities: new Map(),
      nextHouseholdSeq: 0,
      network: createEmptyNetworkCache(2),
      accessibilityDirty: false,
      player: { treasury: params.initialTreasury, taxRate: params.initialTaxRate, lastTaxRevenue: 0, lastUpkeepCost: 0 },
      game: { status: "playing", reason: null, ticksInsolvent: 0 },
      history: [],
    };

    for (let i = 0; i < params.growthSustainTicks; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(target.developmentLevel).toBe(1);
    expect(target.growthStreak).toBe(0);
  });
});

describe("developmentGrowth: decay", () => {
  it("does not decay before decaySustainTicks consecutive qualifying ticks", () => {
    const { world, tile } = makeSingleTileWorld(2, 1); // level 2 (capacity 5), only 1 occupied -> 20% occupancy
    tile.landValue = world.params.decayLandValueThreshold;

    for (let i = 0; i < world.params.decaySustainTicks - 1; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.developmentLevel).toBe(2);
    expect(tile.decayStreak).toBe(world.params.decaySustainTicks - 1);
  });

  it("decays exactly one level after decaySustainTicks consecutive qualifying ticks, removing only vacant units", () => {
    const { world, tile } = makeSingleTileWorld(2, 2); // capacity 5, 2 occupied -> 40% occupancy (<= 0.5 threshold)
    tile.landValue = world.params.decayLandValueThreshold;
    const occupiedIdsBefore = tile.housingUnitIds.filter((id) => world.housingUnits.get(id)!.occupantId !== null);

    for (let i = 0; i < world.params.decaySustainTicks; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.developmentLevel).toBe(1);
    expect(tile.housingUnitIds.length).toBe(world.params.developmentCapacity[1]);
    expect(tile.decayStreak).toBe(0);
    // Every occupied unit from before must still exist, untouched — decay never evicts.
    for (const id of occupiedIdsBefore) {
      expect(tile.housingUnitIds).toContain(id);
      expect(world.housingUnits.get(id)!.occupantId).not.toBeNull();
    }
  });

  it("records a data-derived lastDevelopmentChange reason when it decays", () => {
    const { world, tile } = makeSingleTileWorld(2, 2);
    tile.landValue = world.params.decayLandValueThreshold;

    for (let i = 0; i < world.params.decaySustainTicks; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.lastDevelopmentChange).not.toBeNull();
    expect(tile.lastDevelopmentChange!.direction).toBe("decayed");
    expect(tile.lastDevelopmentChange!.fromLevel).toBe(2);
    expect(tile.lastDevelopmentChange!.toLevel).toBe(1);
  });

  it("never decays below level 1", () => {
    const { world, tile } = makeSingleTileWorld(1, 0); // empty house, worst case
    tile.landValue = world.params.decayLandValueThreshold;

    for (let i = 0; i < world.params.decaySustainTicks * 3; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.developmentLevel).toBe(1);
  });

  it("a single tick that breaks a decay condition resets the streak to 0", () => {
    const { world, tile } = makeSingleTileWorld(2, 2);
    tile.landValue = world.params.decayLandValueThreshold;

    for (let i = 0; i < world.params.decaySustainTicks - 1; i++) {
      world.tick = i;
      developmentGrowth(world);
    }
    expect(tile.decayStreak).toBe(world.params.decaySustainTicks - 1);

    world.tick = world.params.decaySustainTicks - 1;
    tile.landValue = world.params.decayLandValueThreshold + 1; // still very low, but no longer <= threshold
    developmentGrowth(world);
    expect(tile.decayStreak).toBe(0);
    expect(tile.developmentLevel).toBe(2);
  });
});

describe("developmentGrowth: hysteresis", () => {
  it("a tile in the gap between decayLandValueThreshold and growthLandValueThreshold never accumulates either streak", () => {
    const { world, tile } = makeSingleTileWorld(2, 3); // 60% occupied: qualifies for neither growth's 85% nor decay's 50% occupancy bar anyway
    const midValue = (world.params.growthLandValueThreshold + world.params.decayLandValueThreshold) / 2;
    tile.landValue = midValue;

    for (let i = 0; i < world.params.growthSustainTicks + world.params.decaySustainTicks; i++) {
      world.tick = i;
      developmentGrowth(world);
    }

    expect(tile.developmentLevel).toBe(2);
    expect(tile.growthStreak).toBe(0);
    expect(tile.decayStreak).toBe(0);
  });

  it("growthLandValueThreshold is strictly greater than decayLandValueThreshold, guaranteeing a non-empty hysteresis gap", () => {
    expect(defaultParams.growthLandValueThreshold).toBeGreaterThan(defaultParams.decayLandValueThreshold);
  });
});
