import { homeTileOf, pushLog } from "./household.js";
import { networkDistanceToBusiness } from "./roadNetwork.js";
import type { Household, World } from "./types.js";

/**
 * The other half of the labor market: after households have searched for
 * jobs themselves, businesses with slots still open actively reach out to
 * unemployed households within reach and hire the closest-commute candidate
 * from a bounded sample. If no one nearby is unemployed, the slot just stays
 * open — a business genuinely can fail to find workers within reach.
 */
export function businessHiring(world: World): void {
  const businessOrder = world.rng.shuffle(Array.from(world.businesses.values()));

  const unemployedIds = new Set<string>();
  for (const household of world.households.values()) {
    if (household.jobSlotId === null) unemployedIds.add(household.id);
  }

  for (const business of businessOrder) {
    for (const jobId of business.jobSlotIds) {
      const job = world.jobSlots.get(jobId)!;
      if (job.occupantId !== null) continue;
      if (unemployedIds.size === 0) continue;

      const candidateIds = world.rng.sample(Array.from(unemployedIds), world.params.maxSearchCandidates);
      let best: Household | null = null;
      let bestDistance = Infinity;
      for (const id of candidateIds) {
        const candidate = world.households.get(id)!;
        const homeTile = homeTileOf(world, candidate);
        const d = homeTile ? networkDistanceToBusiness(world, homeTile, business.id) : 0;
        if (d < bestDistance) {
          bestDistance = d;
          best = candidate;
        }
      }
      if (!best) continue;

      job.occupantId = best.id;
      job.vacantSinceTick = null;
      best.jobSlotId = job.id;
      best.income = job.wage;
      best.ticksUnemployed = 0;
      unemployedIds.delete(best.id);
      pushLog(world, best, { type: "hired", wage: job.wage, commuteDistance: bestDistance });
    }
  }
}
