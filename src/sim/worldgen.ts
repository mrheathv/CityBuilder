import { createRng } from "./rng.js";
import { defaultParams } from "./params.js";
import { distance } from "./geometry.js";
import { pushLog } from "./household.js";
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

      // Commercial clusters toward the center (a "downtown"); residential is
      // roughly uniform; whatever's left is empty/vacant land.
      const pCommercial = 0.32 * (1 - dNorm);
      const pResidential = 0.42;
      const roll = rng.next();

      const use = roll < pCommercial ? "commercial" : roll < pCommercial + pResidential ? "residential" : "empty";

      const amenity = rng.next() * 5; // static baseline geography quality, never changes

      const tile: Tile = {
        id,
        x,
        y,
        use,
        amenity,
        investedAmenity: 0,
        landValue: 0,
        landValueBreakdown: { jobAccess: 0, amenity, congestion: 0 },
        housingUnitIds: [],
        businessId: null,
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

  // Housing units on residential tiles.
  for (const tile of tiles) {
    if (tile.use !== "residential") continue;
    const numUnits = rng.int(2, 5);
    for (let i = 0; i < numUnits; i++) {
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
    nextHouseholdSeq: 0,
    player: { treasury: params.initialTreasury, taxRate: params.initialTaxRate, lastTaxRevenue: 0, lastUpkeepCost: 0 },
    game: { status: "playing", reason: null, ticksInsolvent: 0 },
    history: [],
  };

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
    const openSlot = findClosestVacantJobSlot(world, homeTile.x, homeTile.y);
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

function findClosestVacantJobSlot(world: World, x: number, y: number): JobSlot | null {
  let best: JobSlot | null = null;
  let bestD = Infinity;
  for (const business of world.businesses.values()) {
    const tile = world.tilesById.get(business.tileId)!;
    const d = distance(x, y, tile.x, tile.y);
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
