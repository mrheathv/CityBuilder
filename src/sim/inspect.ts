import { commuteCost, currentUtility, homeTileOf, jobTileOf } from "./household.js";
import type { DevelopmentChange, World } from "./types.js";

export interface HouseholdInspection {
  id: string;
  income: number;
  savings: number;
  homeTile: { x: number; y: number } | null;
  rent: number | null;
  jobTile: { x: number; y: number } | null;
  wage: number | null;
  commuteCost: number;
  utility: number;
  ticksUnemployed: number;
  ticksHomeless: number;
  recentDecisions: { tick: number; summary: string }[];
}

/** Everything needed to answer "why is this household in this state?" in one call. */
export function inspectHousehold(world: World, householdId: string): HouseholdInspection | null {
  const household = world.households.get(householdId);
  if (!household) return null;

  const homeTile = homeTileOf(world, household);
  const jobTile = jobTileOf(world, household);
  const rent = household.homeUnitId ? world.housingUnits.get(household.homeUnitId)!.rent : null;
  const wage = household.jobSlotId ? world.jobSlots.get(household.jobSlotId)!.wage : null;

  return {
    id: household.id,
    income: household.income,
    savings: household.savings,
    homeTile: homeTile ? { x: homeTile.x, y: homeTile.y } : null,
    rent,
    jobTile: jobTile ? { x: jobTile.x, y: jobTile.y } : null,
    wage,
    commuteCost: commuteCost(world, homeTile, jobTile),
    utility: currentUtility(world, household),
    ticksUnemployed: household.ticksUnemployed,
    ticksHomeless: household.ticksHomeless,
    recentDecisions: household.log.map((entry) => ({ tick: entry.tick, summary: entry.summary })),
  };
}

export interface TileInspection {
  id: string;
  x: number;
  y: number;
  use: string;
  landValue: number;
  landValueBreakdown: { jobAccess: number; amenity: number; congestion: number };
  /** Portion of landValueBreakdown.amenity that's player-funded (and therefore costs upkeep), vs. the world-gen baseline. */
  investedAmenity: number;
  units: { id: string; rent: number; occupantHouseholdId: string | null }[];
  businessId: string | null;
  /** 0 for non-residential tiles; 1 (house) to 4 (tower) otherwise. */
  developmentLevel: number;
  /** Current housing-unit capacity at this tile's developmentLevel (housingUnitIds.length, the actual source of truth). */
  developmentCapacity: number;
  /** Consecutive ticks the grow/decay conditions have held so far — how close this tile is to its next change. */
  growthStreak: number;
  decayStreak: number;
  /** Null until the first growth/decay event ever happens on this tile. */
  lastDevelopmentChange: DevelopmentChange | null;
}

/** Everything needed to answer "why does this tile have this land value / who lives or works here?" */
export function inspectTile(world: World, tileId: string): TileInspection | null {
  const tile = world.tilesById.get(tileId);
  if (!tile) return null;

  const units = tile.housingUnitIds.map((unitId) => {
    const unit = world.housingUnits.get(unitId)!;
    return { id: unit.id, rent: unit.rent, occupantHouseholdId: unit.occupantId };
  });

  return {
    id: tile.id,
    x: tile.x,
    y: tile.y,
    use: tile.use,
    landValue: tile.landValue,
    landValueBreakdown: tile.landValueBreakdown,
    investedAmenity: tile.investedAmenity,
    units,
    businessId: tile.businessId,
    developmentLevel: tile.developmentLevel,
    developmentCapacity: tile.housingUnitIds.length,
    growthStreak: tile.growthStreak,
    decayStreak: tile.decayStreak,
    lastDevelopmentChange: tile.lastDevelopmentChange,
  };
}

export interface BusinessInspection {
  id: string;
  tile: { x: number; y: number };
  jobs: { id: string; wage: number; occupantHouseholdId: string | null }[];
}

/** Everything needed to answer "who works here, and how many jobs are still open?" */
export function inspectBusiness(world: World, businessId: string): BusinessInspection | null {
  const business = world.businesses.get(businessId);
  if (!business) return null;
  const tile = world.tilesById.get(business.tileId)!;
  const jobs = business.jobSlotIds.map((jobId) => {
    const job = world.jobSlots.get(jobId)!;
    return { id: job.id, wage: job.wage, occupantHouseholdId: job.occupantId };
  });
  return { id: business.id, tile: { x: tile.x, y: tile.y }, jobs };
}
