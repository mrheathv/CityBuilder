import type { World } from "./types.js";

/**
 * Rewrites every household's income as after-tax wage, every tick, so it
 * always reflects the *current* tax rate even for households hired long ago.
 * This only changes the number that flows into currentUtility/utilityWithHome
 * (both already read household.income) — it does not touch the search or
 * relocation algorithm itself. A household priced out by a tax hike takes the
 * exact same code path as one priced out by a rent hike.
 *
 * Deliberately does NOT affect job-switching comparisons: utilityWithJob
 * compares raw posted wages, so tax answers "can I still afford to live
 * here," not "which job posting looks better."
 */
export function applyIncomeTax(world: World): void {
  const { taxRate } = world.player;
  for (const household of world.households.values()) {
    if (!household.jobSlotId) {
      household.income = 0;
      continue;
    }
    const job = world.jobSlots.get(household.jobSlotId)!;
    household.income = job.wage * (1 - taxRate);
  }
}

/**
 * Property tax: taxRate * land value, summed over tiles that are actually in
 * use (an occupied home or a business with at least one filled job) —
 * vacant/unbuilt land contributes nothing. Reads land value and occupancy as
 * settled by this tick's earlier phases.
 */
export function collectTaxes(world: World): void {
  let taxableLandValue = 0;
  for (const tile of world.tiles) {
    if (tile.use === "residential") {
      const isActive = tile.housingUnitIds.some((id) => world.housingUnits.get(id)!.occupantId !== null);
      if (isActive) taxableLandValue += tile.landValue;
    } else if (tile.use === "commercial" && tile.businessId) {
      const business = world.businesses.get(tile.businessId)!;
      const isActive = business.jobSlotIds.some((id) => world.jobSlots.get(id)!.occupantId !== null);
      if (isActive) taxableLandValue += tile.landValue;
    }
  }
  const revenue = world.player.taxRate * taxableLandValue;
  world.player.lastTaxRevenue = revenue;
  world.player.treasury += revenue;
}

/**
 * The spending side of the challenge: every existing job center costs upkeep
 * regardless of who built it (worldgen's or the player's) or whether its jobs
 * are filled — a city inherits maintenance costs along with its businesses.
 * Every point of player-invested amenity (tile.investedAmenity, never the
 * world-gen baseline) costs upkeep too. This is what makes unchecked
 * expansion actually risky: more job centers and parks mean more guaranteed
 * spending every tick, whether or not tax revenue keeps pace.
 */
export function applyUpkeep(world: World): void {
  const jobCenterUpkeep = world.businesses.size * world.params.jobCenterUpkeepPerTick;

  let investedAmenityTotal = 0;
  for (const tile of world.tiles) investedAmenityTotal += tile.investedAmenity;
  const amenityUpkeep = investedAmenityTotal * world.params.amenityUpkeepPerPoint;

  const totalUpkeep = jobCenterUpkeep + amenityUpkeep;
  world.player.lastUpkeepCost = totalUpkeep;
  world.player.treasury -= totalUpkeep;
}
