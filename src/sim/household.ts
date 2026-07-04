import { networkDistanceToBusiness } from "./roadNetwork.js";
import type { DecisionLogEntry, Household, HouseholdReason, HousingUnit, JobSlot, Tile, World } from "./types.js";

export function homeTileOf(world: World, household: Household): Tile | null {
  if (!household.homeUnitId) return null;
  const unit = world.housingUnits.get(household.homeUnitId);
  if (!unit) return null;
  return world.tilesById.get(unit.tileId) ?? null;
}

export function jobTileOf(world: World, household: Household): Tile | null {
  if (!household.jobSlotId) return null;
  const job = world.jobSlots.get(household.jobSlotId);
  if (!job) return null;
  const business = world.businesses.get(job.businessId);
  if (!business) return null;
  return world.tilesById.get(business.tileId) ?? null;
}

/**
 * Network distance (through the road graph, cached by roadNetwork.ts), not
 * straight-line — jobTile is always a business's own tile in every real call
 * site, so its businessId indexes straight into the cached distance table.
 * A disconnected home returns Infinity, which utility math naturally treats
 * as "never worth it" without any special-casing (-Infinity utility loses
 * every comparison against a finite alternative).
 */
export function commuteCost(world: World, homeTile: Tile | null, jobTile: Tile | null): number {
  if (!homeTile || !jobTile || !jobTile.businessId) return 0;
  const networkDistance = networkDistanceToBusiness(world, homeTile, jobTile.businessId);
  return world.params.commuteCostPerDistance * networkDistance;
}

/** Net utility of a household's current situation: income - rent - commute cost. */
export function currentUtility(world: World, household: Household): number {
  const homeTile = homeTileOf(world, household);
  const jobTile = jobTileOf(world, household);
  const rent = household.homeUnitId ? world.housingUnits.get(household.homeUnitId)!.rent : 0;
  return household.income - rent - commuteCost(world, homeTile, jobTile);
}

/** Hypothetical utility if this household lived in `unit` instead, keeping its current job. */
export function utilityWithHome(world: World, household: Household, unit: HousingUnit): number {
  const homeTile = world.tilesById.get(unit.tileId)!;
  const jobTile = jobTileOf(world, household);
  return household.income - unit.rent - commuteCost(world, homeTile, jobTile);
}

/** Hypothetical utility if this household worked `job` instead, keeping its current home. */
export function utilityWithJob(world: World, household: Household, job: JobSlot): number {
  const homeTile = homeTileOf(world, household);
  const business = world.businesses.get(job.businessId)!;
  const jobTile = world.tilesById.get(business.tileId)!;
  return job.wage - (household.homeUnitId ? world.housingUnits.get(household.homeUnitId)!.rent : 0) - commuteCost(world, homeTile, jobTile);
}

function describeReason(reason: HouseholdReason): string {
  switch (reason.type) {
    case "initial_placement":
      return `Placed at world creation into a unit at rent ${reason.rent.toFixed(1)}.`;
    case "found_home":
      return `Found a home: moved into a vacant unit at rent ${reason.rent.toFixed(1)} (utility ${reason.utility.toFixed(1)}).`;
    case "priced_out":
      return `Priced out: rent at old home had risen to ${reason.oldRent.toFixed(1)} against income ${reason.income.toFixed(1)}, moved to a cheaper unit at ${reason.newRent.toFixed(1)}.`;
    case "better_deal":
      return `Found a better deal: utility improved from ${reason.oldUtility.toFixed(1)} to ${reason.newUtility.toFixed(1)} (rent ${reason.oldRent.toFixed(1)} to ${reason.newRent.toFixed(1)}).`;
    case "found_job":
      return `Found a job paying ${reason.wage.toFixed(1)}/tick.`;
    case "hired":
      return `Hired by a nearby business paying ${reason.wage.toFixed(1)}/tick (commute distance ${reason.commuteDistance}).`;
    case "switched_job":
      return `Switched jobs: utility improved from ${reason.oldUtility.toFixed(1)} to ${reason.newUtility.toFixed(1)} (wage ${reason.oldWage.toFixed(1)} to ${reason.newWage.toFixed(1)}).`;
  }
}

/** Every household decision is logged through here, so the summary text can never drift from the structured reason. */
export function pushLog(world: World, household: Household, reason: HouseholdReason): void {
  const entry: DecisionLogEntry = { tick: world.tick, summary: describeReason(reason), reason };
  household.log.push(entry);
  if (household.log.length > world.params.maxLogEntries) {
    household.log.shift();
  }
}
