import type { Household, HousingUnit, World } from "./types.js";
import { currentUtility, pushLog, utilityWithHome } from "./household.js";

/**
 * Each household samples a bounded set of vacant units (not the whole map —
 * this is bounded rationality, not global optimization) and relocates if the
 * best one clears its move-friction threshold. Homeless households take the
 * best available candidate outright, since any home beats none.
 *
 * Households are processed in a per-tick shuffled order so scarce housing
 * isn't always won by the same low-id households; the shuffle itself draws
 * from the seeded RNG so the whole phase stays deterministic.
 */
export function householdResidentialSearch(world: World): void {
  const order = world.rng.shuffle(Array.from(world.households.values()));

  const vacantIds = new Set<string>();
  for (const unit of world.housingUnits.values()) {
    if (unit.occupantId === null) vacantIds.add(unit.id);
  }

  for (const household of order) {
    if (vacantIds.size === 0) {
      if (!household.homeUnitId) household.ticksHomeless++;
      continue;
    }

    const candidateIds = world.rng.sample(Array.from(vacantIds), household.searchSampleSize);
    const candidates = candidateIds.map((id) => world.housingUnits.get(id)!);

    let best: HousingUnit | null = null;
    let bestUtility = -Infinity;
    for (const unit of candidates) {
      const u = utilityWithHome(world, household, unit);
      if (u > bestUtility) {
        bestUtility = u;
        best = unit;
      }
    }
    if (!best) continue;

    if (!household.homeUnitId) {
      moveHouseholdIn(world, household, best, bestUtility);
      vacantIds.delete(best.id);
      continue;
    }

    const oldUtility = currentUtility(world, household);
    if (bestUtility - oldUtility > household.moveThreshold) {
      const oldUnitId = household.homeUnitId!;
      relocateHousehold(world, household, best, oldUtility, bestUtility);
      vacantIds.delete(best.id);
      vacantIds.add(oldUnitId);
    }
  }
}

function moveHouseholdIn(world: World, household: Household, unit: HousingUnit, newUtility: number): void {
  unit.occupantId = household.id;
  unit.vacantSinceTick = null;
  household.homeUnitId = unit.id;
  household.ticksHomeless = 0;
  pushLog(world, household, { type: "found_home", rent: unit.rent, utility: newUtility });
}

function relocateHousehold(world: World, household: Household, newUnit: HousingUnit, oldUtility: number, newUtility: number): void {
  const oldUnit = world.housingUnits.get(household.homeUnitId!)!;
  const oldRent = oldUnit.rent;

  oldUnit.occupantId = null;
  oldUnit.vacantSinceTick = world.tick;

  newUnit.occupantId = household.id;
  newUnit.vacantSinceTick = null;
  household.homeUnitId = newUnit.id;
  household.ticksHomeless = 0;

  const pricedOut = oldUtility < 0 && newUnit.rent < oldRent;
  pushLog(
    world,
    household,
    pricedOut
      ? { type: "priced_out", oldRent, newRent: newUnit.rent, oldUtility, newUtility, income: household.income }
      : { type: "better_deal", oldRent, newRent: newUnit.rent, oldUtility, newUtility },
  );
}
