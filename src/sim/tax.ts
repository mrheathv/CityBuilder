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
 * Property tax: residential tiles are taxed taxRate * landValue *
 * (occupiedUnits / residentialTaxUnitsPerLandValue) — a tower with 20
 * occupied units genuinely pays several times what one occupied house pays,
 * so density directly funds the city, without special-casing anything.
 * Deliberately assessed on landValue (recomputed fresh every tick) rather
 * than each unit's actual rent: rent eases toward its target over several
 * ticks (rentAdjustSpeed), so taxing rent directly would make revenue lag
 * land value by design — assessed-value tax shouldn't lag the market the way
 * a rent roll would. Commercial tiles stay a flat taxRate * land value once
 * any job is filled (job-center capacity isn't part of the density
 * mechanic, only residential is). Vacant/unbuilt land and vacant units
 * contribute nothing. Reads land value and occupancy as settled by this
 * tick's earlier phases.
 */
export function collectTaxes(world: World): void {
  let revenue = 0;
  for (const tile of world.tiles) {
    if (tile.use === "residential") {
      let occupied = 0;
      for (const unitId of tile.housingUnitIds) {
        if (world.housingUnits.get(unitId)!.occupantId !== null) occupied++;
      }
      revenue += (occupied / world.params.residentialTaxUnitsPerLandValue) * tile.landValue;
    } else if (tile.use === "commercial" && tile.businessId) {
      const business = world.businesses.get(tile.businessId)!;
      const isActive = business.jobSlotIds.some((id) => world.jobSlots.get(id)!.occupantId !== null);
      if (isActive) revenue += tile.landValue;
    }
  }
  revenue *= world.player.taxRate;
  world.player.lastTaxRevenue = revenue;
  world.player.treasury += revenue;
}

/**
 * The spending side of the challenge: every existing job center costs upkeep
 * regardless of who built it (worldgen's or the player's) or whether its
 * jobs are filled — a city inherits maintenance costs along with its
 * businesses. Every existing park and every existing road tile cost upkeep
 * too (world-gen's own boulevard grid included) — this is what makes
 * unchecked expansion of ANY kind actually risky: more job centers, parks,
 * and road tiles all mean more guaranteed spending every tick, whether or
 * not tax revenue keeps pace.
 */
export function applyUpkeep(world: World): void {
  const jobCenterUpkeep = world.businesses.size * world.params.jobCenterUpkeepPerTick;
  const parkUpkeep = world.amenities.size * world.params.parkUpkeepPerTick;

  let roadTileCount = 0;
  for (const tile of world.tiles) {
    if (tile.use === "road") roadTileCount++;
  }
  const roadUpkeep = roadTileCount * world.params.roadUpkeepPerTick;

  const totalUpkeep = jobCenterUpkeep + parkUpkeep + roadUpkeep;
  world.player.lastUpkeepCost = totalUpkeep;
  world.player.treasury -= totalUpkeep;
}
