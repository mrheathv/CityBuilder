import { spawnHousehold } from "./worldgen.js";
import type { World } from "./types.js";

/**
 * Immigration pressure and displacement out of the sim. New households arrive
 * (Poisson-ish via the seeded RNG) seeking housing and work; households that
 * have gone too long without either give up and leave entirely. This is what
 * turns "scarce housing gets expensive" into "original residents get priced
 * out of the city," not just priced into a different tile.
 */
export function spawnAndAttrition(world: World): void {
  const { params, rng } = world;

  const whole = Math.floor(params.immigrationRatePerTick);
  const frac = params.immigrationRatePerTick - whole;
  const numNew = whole + (rng.chance(frac) ? 1 : 0);
  for (let i = 0; i < numNew; i++) {
    spawnHousehold(world);
  }

  for (const household of Array.from(world.households.values())) {
    const stuck = household.ticksHomeless > params.maxTicksBeforeLeaving || household.ticksUnemployed > params.maxTicksBeforeLeaving;
    if (stuck) removeHousehold(world, household.id);
  }
}

function removeHousehold(world: World, householdId: string): void {
  const household = world.households.get(householdId);
  if (!household) return;

  if (household.homeUnitId) {
    const unit = world.housingUnits.get(household.homeUnitId);
    if (unit) {
      unit.occupantId = null;
      unit.vacantSinceTick = world.tick;
    }
  }
  if (household.jobSlotId) {
    const job = world.jobSlots.get(household.jobSlotId);
    if (job) {
      job.occupantId = null;
      job.vacantSinceTick = world.tick;
    }
  }
  world.households.delete(householdId);
}
