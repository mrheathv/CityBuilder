import { describe, expect, it } from "vitest";
import { defaultParams } from "../src/sim/params.js";
import { createRng } from "../src/sim/rng.js";
import { updateRents } from "../src/sim/rent.js";
import { createEmptyNetworkCache } from "../src/sim/roadNetwork.js";
import type { HousingUnit, Tile, World } from "../src/sim/types.js";

/**
 * Hand-built world: two independent residential clusters far enough apart
 * (25 tiles, rentDemandRadius=4) that their local vacancy rates can't leak
 * into each other. Cluster A (tiles 0-4) is fully occupied (scarce);
 * cluster B (tiles 20-24) has only one occupied unit, the rest vacant
 * (slack). Both clusters share the same land value, so any rent difference
 * is purely the vacancy-driven demand pressure this test targets.
 */
function makeTwoClusterWorld(): { world: World; unitA: HousingUnit; unitB: HousingUnit } {
  const params = { ...defaultParams };
  const tiles: Tile[] = [];
  const tilesById = new Map<string, Tile>();
  const housingUnits = new Map<string, HousingUnit>();

  function addTile(x: number): Tile {
    const id = `t-${x}-0`;
    const tile: Tile = {
      id,
      x,
      y: 0,
      use: "residential",
      baselineAmenity: 0,
      amenity: 0,
      landValue: 10,
      landValueBreakdown: { jobAccess: 10, amenity: 0, congestion: 0 },
      housingUnitIds: [],
      businessId: null,
      amenityObjectId: null,
      developmentLevel: 1,
      growthStreak: 0,
      decayStreak: 0,
      lastDevelopmentChange: null,
    };
    tiles.push(tile);
    tilesById.set(id, tile);
    return tile;
  }

  function addUnit(tile: Tile, occupied: boolean): HousingUnit {
    const id = `hu-${tile.id}-${tile.housingUnitIds.length}`;
    const unit: HousingUnit = {
      id,
      tileId: tile.id,
      rent: 5,
      occupantId: occupied ? "synthetic" : null,
      vacantSinceTick: occupied ? null : 0,
    };
    housingUnits.set(id, unit);
    tile.housingUnitIds.push(id);
    return unit;
  }

  let unitA!: HousingUnit;
  for (let x = 0; x <= 4; x++) {
    const t = addTile(x);
    for (let i = 0; i < 3; i++) {
      const u = addUnit(t, true);
      if (x === 2 && i === 0) unitA = u;
    }
  }

  let unitB!: HousingUnit;
  for (let x = 20; x <= 24; x++) {
    const t = addTile(x);
    for (let i = 0; i < 3; i++) {
      const occupied = x === 22 && i === 0;
      const u = addUnit(t, occupied);
      if (occupied) unitB = u;
    }
  }

  const world: World = {
    tick: 0,
    seed: 1,
    width: 25,
    height: 1,
    rng: createRng(1),
    params,
    tiles,
    tilesById,
    housingUnits,
    jobSlots: new Map(),
    businesses: new Map(),
    households: new Map(),
    amenities: new Map(),
    nextHouseholdSeq: 0,
    network: createEmptyNetworkCache(25),
    accessibilityDirty: false,
    player: { treasury: params.initialTreasury, taxRate: params.initialTaxRate, lastTaxRevenue: 0, lastUpkeepCost: 0 },
    game: { status: "playing", reason: null, ticksInsolvent: 0 },
    history: [],
  };

  return { world, unitA, unitB };
}

describe("updateRents", () => {
  it("settles an occupied unit in a low-vacancy neighborhood at a higher rent than an equally-valuable occupied unit in a high-vacancy neighborhood", () => {
    const { world, unitA, unitB } = makeTwoClusterWorld();
    for (let i = 0; i < 50; i++) updateRents(world);
    expect(unitA.rent).toBeGreaterThan(unitB.rent);
  });

  it("pulls a vacant unit's rent down over time", () => {
    const { world } = makeTwoClusterWorld();
    const vacantUnit = Array.from(world.housingUnits.values()).find((u) => u.occupantId === null)!;
    const rents: number[] = [];
    for (let i = 0; i < 30; i++) {
      updateRents(world);
      rents.push(vacantUnit.rent);
    }
    expect(rents[rents.length - 1]).toBeLessThan(rents[0]!);
  });

  it("never lets rent go negative", () => {
    const { world } = makeTwoClusterWorld();
    for (let i = 0; i < 50; i++) {
      updateRents(world);
      for (const unit of world.housingUnits.values()) {
        expect(unit.rent).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
