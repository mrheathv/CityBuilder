import type { Household, JobSlot, World } from "./types.js";
import { currentUtility, pushLog, utilityWithJob } from "./household.js";

/**
 * Mirror of householdResidentialSearch for the labor side: households sample
 * a bounded set of vacant job slots and switch (or take one, if unemployed)
 * when it clears their move-friction threshold.
 */
export function householdJobSearch(world: World): void {
  const order = world.rng.shuffle(Array.from(world.households.values()));

  const vacantIds = new Set<string>();
  for (const job of world.jobSlots.values()) {
    if (job.occupantId === null) vacantIds.add(job.id);
  }

  for (const household of order) {
    if (vacantIds.size === 0) {
      if (!household.jobSlotId) household.ticksUnemployed++;
      continue;
    }

    const candidateIds = world.rng.sample(Array.from(vacantIds), household.searchSampleSize);
    const candidates = candidateIds.map((id) => world.jobSlots.get(id)!);

    let best: JobSlot | null = null;
    let bestUtility = -Infinity;
    for (const job of candidates) {
      const u = utilityWithJob(world, household, job);
      if (u > bestUtility) {
        bestUtility = u;
        best = job;
      }
    }
    if (!best) continue;

    if (!household.jobSlotId) {
      hireIntoJob(world, household, best);
      vacantIds.delete(best.id);
      household.ticksUnemployed = 0;
      continue;
    }

    const oldUtility = currentUtility(world, household);
    if (bestUtility - oldUtility > household.moveThreshold) {
      const oldJobId = household.jobSlotId!;
      switchJob(world, household, best, oldUtility, bestUtility);
      vacantIds.delete(best.id);
      vacantIds.add(oldJobId);
    }
  }
}

function hireIntoJob(world: World, household: Household, job: JobSlot): void {
  job.occupantId = household.id;
  job.vacantSinceTick = null;
  household.jobSlotId = job.id;
  household.income = job.wage;
  pushLog(world, household, { type: "found_job", wage: job.wage });
}

function switchJob(world: World, household: Household, newJob: JobSlot, oldUtility: number, newUtility: number): void {
  const oldJob = world.jobSlots.get(household.jobSlotId!)!;
  const oldWage = oldJob.wage;

  oldJob.occupantId = null;
  oldJob.vacantSinceTick = world.tick;

  newJob.occupantId = household.id;
  newJob.vacantSinceTick = null;
  household.jobSlotId = newJob.id;
  household.income = newJob.wage;

  pushLog(world, household, { type: "switched_job", oldWage, newWage: newJob.wage, oldUtility, newUtility });
}
