import { createRng } from "./rng.js";
import { defaultParams } from "./params.js";
import { distance } from "./geometry.js";
import { pushLog } from "./household.js";
import { createEmptyNetworkCache, networkDistanceToBusiness, recomputeNetwork } from "./roadNetwork.js";
import type {
  Business,
  Household,
  HousingUnit,
  JobSlot,
  SimParams,
  Tile,
  World,
} from "./types.js";

export interface WorldGenOptions {
  seed: number;
  width: number;
  height: number;
  params?: Partial<SimParams>;
  /** Fraction of housing capacity occupied at t=0. */
  initialOccupancyRate?: number;
  /** Fraction of initial households that start with a job. */
  initialEmploymentRate?: number;
}

/**
 * Grid-boulevard spacing: every 4th row and column is a road, carved out
 * before the random zoning roll runs on whatever's left. Without this, a
 * fresh city would have zero road tiles and therefore zero job access
 * anywhere (the strict "a building needs an adjacent road" rule applies to
 * world-gen too) — this guarantees a connected starting network with real
 * 3x3 interior blocks left to zone.
 */
const ROAD_GRID_SPACING = 4;

/** Builds a fresh World from a seed. All placement decisions draw from the seeded RNG only. */
export function createWorld(opts: WorldGenOptions): World {
  const { seed, width, height } = opts;
  const params: SimParams = { ...defaultParams, ...opts.params };
  const initialOccupancyRate = opts.initialOccupancyRate ?? 0.55;
  const initialEmploymentRate = opts.initialEmploymentRate ?? 0.7;
  const rng = createRng(seed);

  const tiles: Tile[] = [];
  const tilesById = new Map<string, Tile>();
  const housingUnits = new Map<string, HousingUnit>();
  const jobSlots = new Map<string, JobSlot>();
  const businesses = new Map<string, Business>();
  const households = new Map<string, Household>();

  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxD = distance(0, 0, cx, cy) || 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = `t-${x}-${y}`;
      const dNorm = distance(x, y, cx, cy) / maxD; // 0 at center, 1 at corners
      const isRoad = x % ROAD_GRID_SPACING === 0 || y % ROAD_GRID_SPACING === 0;

      let use: Tile["use"];
      if (isRoad) {
        use = "road";
      } else {
        // Commercial clusters toward the center (a "downtown"); residential is
        // roughly uniform; whatever's left is empty/vacant land.
        const pCommercial = 0.32 * (1 - dNorm);
        const pResidential = 0.42;
        const roll = rng.next();
        use = roll < pCommercial ? "commercial" : roll < pCommercial + pResidential ? "residential" : "empty";
      }

      const baselineAmenity = rng.next() * 5; // static geography quality, never changes

      const tile: Tile = {
        id,
        x,
        y,
        use,
        baselineAmenity,
        amenity: baselineAmenity,
        landValue: 0,
        landValueBreakdown: { jobAccess: 0, amenity: baselineAmenity, congestion: 0 },
        housingUnitIds: [],
        businessId: null,
        amenityObjectId: null,
        developmentLevel: 0,
        growthStreak: 0,
        decayStreak: 0,
        lastDevelopmentChange: null,
      };
      tiles.push(tile);
      tilesById.set(id, tile);
    }
  }

  // Businesses + job slots on commercial tiles.
  for (const tile of tiles) {
    if (tile.use !== "commercial") continue;
    const businessId = `biz-${tile.id}`;
    const numJobs = rng.int(2, 6);
    const wage = rng.int(8, 20);
    const jobSlotIds: string[] = [];
    for (let i = 0; i < numJobs; i++) {
      const jobId = `js-${businessId}-${i}`;
      jobSlots.set(jobId, {
        id: jobId,
        businessId,
        wage,
        occupantId: null,
        vacantSinceTick: 0,
      });
      jobSlotIds.push(jobId);
    }
    businesses.set(businessId, { id: businessId, tileId: tile.id, jobSlotIds });
    tile.businessId = businessId;
  }

  // Housing units on residential tiles. Initial developmentLevel is 1 (house)
  // or 2 (low-rise) — never higher; levels 3-4 are only ever earned through
  // sustained growth (src/sim/development.ts), so a freshly generated city
  // never opens with towers already standing. Denser starting tiles cluster
  // toward downtown (same dNorm used for commercial placement above), giving
  // the Density overlay something to show from tick 0 instead of a flat grid.
  for (const tile of tiles) {
    if (tile.use !== "residential") continue;
    const dNorm = distance(tile.x, tile.y, cx, cy) / maxD;
    const pLevel2 = Math.max(0.35, 0.65 - 0.3 * dNorm);
    const level = rng.next() < pLevel2 ? 2 : 1;
    const capacity = params.developmentCapacity[level]!;
    tile.developmentLevel = level;
    for (let i = 0; i < capacity; i++) {
      const unitId = `hu-${tile.id}-${i}`;
      housingUnits.set(unitId, {
        id: unitId,
        tileId: tile.id,
        rent: 5,
        occupantId: null,
        vacantSinceTick: 0,
      });
      tile.housingUnitIds.push(unitId);
    }
  }

  const world: World = {
    tick: 0,
    seed,
    width,
    height,
    rng,
    params,
    tiles,
    tilesById,
    housingUnits,
    jobSlots,
    businesses,
    households,
    amenities: new Map(),
    nextHouseholdSeq: 0,
    network: createEmptyNetworkCache(width * height),
    accessibilityDirty: true,
    player: { treasury: params.initialTreasury, taxRate: params.initialTaxRate, lastTaxRevenue: 0, lastUpkeepCost: 0 },
    game: { status: "playing", reason: null, ticksInsolvent: 0 },
    history: [],
  };

  // Populate the network cache once, before seeding any households, so the
  // initial employment pass below can route people to jobs they can actually
  // reach by road instead of by straight-line distance — the same rule the
  // rest of the sim lives by from tick 0 onward.
  recomputeNetwork(world);

  // Seed initial households into a fraction of housing capacity, then give a
  // fraction of them a nearby job. Order is shuffled via the seeded RNG so
  // placement isn't an artifact of array order.
  const allUnitIds = rng.shuffle(Array.from(housingUnits.keys()));
  const numToSeed = Math.round(allUnitIds.length * initialOccupancyRate);

  for (let i = 0; i < numToSeed; i++) {
    const unitId = allUnitIds[i]!;
    const unit = housingUnits.get(unitId)!;
    const household = spawnHousehold(world);
    household.homeUnitId = unitId;
    unit.occupantId = household.id;
    unit.vacantSinceTick = null;
    pushLog(world, household, { type: "initial_placement", rent: unit.rent });
  }

  const seededHouseholds = rng.shuffle(Array.from(households.values()));
  const numToEmploy = Math.round(seededHouseholds.length * initialEmploymentRate);
  const homeTileOf = (h: Household) => tilesById.get(housingUnits.get(h.homeUnitId!)!.tileId)!;

  for (let i = 0; i < numToEmploy; i++) {
    const household = seededHouseholds[i]!;
    const homeTile = homeTileOf(household);
    const openSlot = findClosestVacantJobSlot(world, homeTile);
    if (!openSlot) continue;
    openSlot.occupantId = household.id;
    openSlot.vacantSinceTick = null;
    household.jobSlotId = openSlot.id;
    household.income = openSlot.wage;
    pushLog(world, household, { type: "found_job", wage: openSlot.wage });
  }

  return world;
}

function spawnHousehold(world: World): Household {
  const id = `h-${world.nextHouseholdSeq++}`;
  const household: Household = {
    id,
    income: 0,
    homeUnitId: null,
    jobSlotId: null,
    savings: 20,
    moveThreshold: world.params.baseMoveThreshold + world.rng.int(-1, 1),
    searchSampleSize: world.params.maxSearchCandidates,
    ticksUnemployed: 0,
    ticksHomeless: 0,
    log: [],
  };
  world.households.set(id, household);
  return household;
}

/** Nearest vacant job slot BY NETWORK DISTANCE — a business unreachable by road never gets picked, same rule the rest of the sim lives by. */
function findClosestVacantJobSlot(world: World, homeTile: Tile): JobSlot | null {
  let best: JobSlot | null = null;
  let bestD = Infinity;
  for (const business of world.businesses.values()) {
    const d = networkDistanceToBusiness(world, homeTile, business.id);
    if (d >= bestD) continue;
    for (const jobId of business.jobSlotIds) {
      const job = world.jobSlots.get(jobId)!;
      if (job.occupantId === null && d < bestD) {
        best = job;
        bestD = d;
      }
    }
  }
  return best;
}

export { spawnHousehold, findClosestVacantJobSlot };
