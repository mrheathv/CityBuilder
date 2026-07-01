import { commuteCost, homeTileOf, jobTileOf } from "./household.js";
import type { World } from "./types.js";

/** Ledger update: savings += income - rent - commute, every household, every tick. */
export function settleFinances(world: World): void {
  for (const household of world.households.values()) {
    const rent = household.homeUnitId ? world.housingUnits.get(household.homeUnitId)!.rent : 0;
    const commute = commuteCost(world, homeTileOf(world, household), jobTileOf(world, household));
    household.savings += household.income - rent - commute;
  }
}
