import { describe, expect, it } from "vitest";
import { defaultParams } from "../src/sim/params.js";
import { createRng } from "../src/sim/rng.js";
import { createEmptyNetworkCache, recomputeNetwork, maybeRecomputeNetwork, networkDistanceToBusiness, nearestJobCenter, edgeKey } from "../src/sim/roadNetwork.js";
import { tileIndex } from "../src/sim/geometry.js";
import type { Business, Household, HousingUnit, JobSlot, SimParams, Tile, TileUse, World } from "../src/sim/types.js";

/**
 * Builds a small, fully-controlled World from a text grid: '.' empty, 'R'
 * road, 'H' residential (2 units, both vacant unless populated by the
 * caller), 'C' commercial (no business unless the caller adds one). Every
 * cell becomes a real Tile satisfying the full type, so tests read like the
 * map they're describing instead of a wall of field initializers.
 */
function makeGridWorld(rows: string[], overrides: Partial<SimParams> = {}): World {
  const params: SimParams = { ...defaultParams, ...overrides };
  const height = rows.length;
  const width = rows[0]!.length;
  const tiles: Tile[] = [];
  const tilesById = new Map<string, Tile>();
  const housingUnits = new Map<string, HousingUnit>();

  const useFor: Record<string, TileUse> = { ".": "empty", R: "road", H: "residential", C: "commercial" };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y]![x]!;
      const use = useFor[ch] ?? "empty";
      const id = `t-${x}-${y}`;
      const tile: Tile = {
        id,
        x,
        y,
        use,
        baselineAmenity: 0,
        amenity: 0,
        landValue: 0,
        landValueBreakdown: { jobAccess: 0, amenity: 0, congestion: 0 },
        housingUnitIds: [],
        businessId: null,
        amenityObjectId: null,
        developmentLevel: use === "residential" ? 1 : 0,
        growthStreak: 0,
        decayStreak: 0,
        lastDevelopmentChange: null,
      };
      if (use === "residential") {
        for (let i = 0; i < 2; i++) {
          const unitId = `hu-${id}-${i}`;
          housingUnits.set(unitId, { id: unitId, tileId: id, rent: 5, occupantId: null, vacantSinceTick: 0 });
          tile.housingUnitIds.push(unitId);
        }
      }
      tiles.push(tile);
      tilesById.set(id, tile);
    }
  }

  const world: World = {
    tick: 0,
    seed: 1,
    width,
    height,
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
    network: createEmptyNetworkCache(width * height),
    accessibilityDirty: false,
    player: { treasury: params.initialTreasury, taxRate: params.initialTaxRate, lastTaxRevenue: 0, lastUpkeepCost: 0 },
    game: { status: "playing", reason: null, ticksInsolvent: 0 },
    history: [],
  };
  return world;
}

/** Adds a business with one job slot at (x, y), which must already be a "commercial" tile. */
function addBusiness(world: World, x: number, y: number, wage: number): Business {
  const tile = world.tilesById.get(`t-${x}-${y}`)!;
  const businessId = `biz-${tile.id}`;
  const jobId = `js-${businessId}-0`;
  const job: JobSlot = { id: jobId, businessId, wage, occupantId: null, vacantSinceTick: 0 };
  world.jobSlots.set(jobId, job);
  const business: Business = { id: businessId, tileId: tile.id, jobSlotIds: [jobId] };
  world.businesses.set(businessId, business);
  tile.businessId = businessId;
  return business;
}

/** Employs a synthetic household living at (hx, hy) into `job`, occupying the first housing unit there. */
function employHouseholdAt(world: World, hx: number, hy: number, job: JobSlot): Household {
  const homeTile = world.tilesById.get(`t-${hx}-${hy}`)!;
  const unitId = homeTile.housingUnitIds[0]!;
  const unit = world.housingUnits.get(unitId)!;
  const id = `h-${world.nextHouseholdSeq++}`;
  const household: Household = {
    id,
    income: job.wage,
    homeUnitId: unitId,
    jobSlotId: job.id,
    savings: 0,
    moveThreshold: 3,
    searchSampleSize: 8,
    ticksUnemployed: 0,
    ticksHomeless: 0,
    log: [],
  };
  unit.occupantId = id;
  unit.vacantSinceTick = null;
  job.occupantId = id;
  job.vacantSinceTick = null;
  world.households.set(id, household);
  return household;
}

describe("recomputeNetwork: connectivity", () => {
  it("gives zero job access to a tile with no adjacent road at all", () => {
    // H is fully isolated (no road anywhere near it); C-R is a connected business.
    const world = makeGridWorld(["H..C", "....", "....", "...."]);
    addBusiness(world, 3, 0, 20);
    recomputeNetwork(world);

    const isolated = world.tilesById.get("t-0-0")!;
    const i = tileIndex(world.width, isolated.x, isolated.y);
    expect(world.network.jobAccessByTile[i]).toBe(0);
    expect(world.network.connectedByTile[i]).toBe(0);
  });

  it("gives positive job access to a tile connected to a business via roads", () => {
    const world = makeGridWorld(["HRRRC", ".....", ".....", "....."]);
    addBusiness(world, 4, 0, 20);
    recomputeNetwork(world);

    const home = world.tilesById.get("t-0-0")!;
    const i = tileIndex(world.width, home.x, home.y);
    expect(world.network.jobAccessByTile[i]).toBeGreaterThan(0);
    expect(world.network.connectedByTile[i]).toBe(1);
  });

  it("does NOT connect two adjacent non-road tiles to each other (strict adjacency)", () => {
    // H and C are directly adjacent with no road tile at all touching either of them.
    const world = makeGridWorld(["HC..", "....", "....", "...."]);
    addBusiness(world, 1, 0, 20);
    recomputeNetwork(world);

    const home = world.tilesById.get("t-0-0")!;
    const i = tileIndex(world.width, home.x, home.y);
    expect(world.network.jobAccessByTile[i]).toBe(0);
    expect(world.network.connectedByTile[i]).toBe(0);
  });

  it("network distance follows the actual road path, not straight-line distance", () => {
    // The road detours down and across, so the true network distance from H to C
    // is much longer than the Manhattan distance between their coordinates (3).
    const world = makeGridWorld(["H..C", "R..R", "RRRR", "...."]);
    addBusiness(world, 3, 0, 20);
    recomputeNetwork(world);

    const home = world.tilesById.get("t-0-0")!;
    const business = Array.from(world.businesses.values())[0]!;
    const d = networkDistanceToBusiness(world, home, business.id);
    expect(d).toBeGreaterThan(3); // straight-line would be 3; the detour costs more
    expect(Number.isFinite(d)).toBe(true);
  });

  it("nearestJobCenter reports null for a tile disconnected from every business", () => {
    const world = makeGridWorld(["H...", "....", "....", "...C"]);
    addBusiness(world, 3, 3, 20);
    recomputeNetwork(world);

    const home = world.tilesById.get("t-0-0")!;
    expect(nearestJobCenter(world, home)).toBeNull();
  });
});

describe("recomputeNetwork: edge congestion", () => {
  it("accumulates commuter counts only on the edges households actually traverse", () => {
    const world = makeGridWorld(["HRRRC", ".....", "H....", "....."]);
    const business = addBusiness(world, 4, 0, 20);
    const job = world.jobSlots.get(business.jobSlotIds[0]!)!;
    employHouseholdAt(world, 0, 0, job);
    recomputeNetwork(world);

    // The only road tiles are t-1-0, t-2-0, t-3-0 — the household's entire commute.
    const i0 = tileIndex(world.width, 0, 0);
    const i1 = tileIndex(world.width, 1, 0);
    const i2 = tileIndex(world.width, 2, 0);
    const i3 = tileIndex(world.width, 3, 0);
    const i4 = tileIndex(world.width, 4, 0);

    expect(world.network.edgeCongestion.get(edgeKey(i0, i1))).toBe(1);
    expect(world.network.edgeCongestion.get(edgeKey(i1, i2))).toBe(1);
    expect(world.network.edgeCongestion.get(edgeKey(i2, i3))).toBe(1);
    expect(world.network.edgeCongestion.get(edgeKey(i3, i4))).toBe(1);

    // A household living at (0,2), which has no road connection at all, contributes nothing.
    expect(world.network.edgeCongestion.size).toBe(4);
  });

  it("congestion on an edge raises its effective travel cost on the next recompute, and shows up as a per-tile land-value drag", () => {
    const world = makeGridWorld(["HRRRC", ".....", ".....", "....."], { congestionWeightPerCommuter: 1, congestionLandValueWeight: 1 });
    const business = addBusiness(world, 4, 0, 20);
    const job = world.jobSlots.get(business.jobSlotIds[0]!)!;
    recomputeNetwork(world);
    const home = world.tilesById.get("t-0-0")!;
    const uncongestedDistance = networkDistanceToBusiness(world, home, business.id);

    employHouseholdAt(world, 0, 0, job);
    recomputeNetwork(world); // routes the new commuter, but weights THIS run by last cycle's (zero) congestion
    recomputeNetwork(world); // now routes using the congestion the previous call just recorded

    const congestedDistance = networkDistanceToBusiness(world, home, business.id);
    expect(congestedDistance).toBeGreaterThan(uncongestedDistance);

    const roadTileNextToHome = tileIndex(world.width, 1, 0);
    expect(world.network.congestionByTile[roadTileNextToHome]).toBeGreaterThan(0);
  });
});

describe("maybeRecomputeNetwork: cadence and dirty flag", () => {
  it("recomputes on ticks that are a multiple of the interval, and skips others", () => {
    const world = makeGridWorld(["HRC.", "....", "....", "...."], { accessibilityRecomputeIntervalTicks: 5 });
    addBusiness(world, 2, 0, 20);

    world.tick = 5;
    maybeRecomputeNetwork(world);
    expect(world.network.lastRecomputeTick).toBe(5);

    world.tick = 6;
    maybeRecomputeNetwork(world);
    expect(world.network.lastRecomputeTick).toBe(5); // unchanged, 6 is not due

    world.tick = 10;
    maybeRecomputeNetwork(world);
    expect(world.network.lastRecomputeTick).toBe(10);
  });

  it("recomputes immediately when accessibilityDirty is set, regardless of cadence", () => {
    const world = makeGridWorld(["HRC.", "....", "....", "...."], { accessibilityRecomputeIntervalTicks: 5 });
    addBusiness(world, 2, 0, 20);

    world.tick = 3; // not due on cadence alone
    world.accessibilityDirty = true;
    maybeRecomputeNetwork(world);

    expect(world.network.lastRecomputeTick).toBe(3);
    expect(world.accessibilityDirty).toBe(false); // cleared after use
  });
});
