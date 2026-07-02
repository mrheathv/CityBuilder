import { businessHiring } from "./businessHiring.js";
import { settleFinances } from "./finances.js";
import { householdJobSearch } from "./jobSearch.js";
import { computeLandValues } from "./landValue.js";
import { updateRents } from "./rent.js";
import { householdResidentialSearch } from "./residentialSearch.js";
import { spawnAndAttrition } from "./spawnAttrition.js";
import { applyIncomeTax, collectTaxes } from "./tax.js";
import type { World } from "./types.js";

/**
 * One tick. Each phase reads a fully-settled state left by the previous
 * phase — no interleaved reads/writes within a phase — which is what keeps
 * this order-independent-within-itself and therefore deterministic.
 */
export function tick(world: World): void {
  spawnAndAttrition(world);
  applyIncomeTax(world);
  computeLandValues(world);
  updateRents(world);
  householdResidentialSearch(world);
  householdJobSearch(world);
  businessHiring(world);
  settleFinances(world);
  collectTaxes(world);
  world.tick += 1;
}

export function runTicks(world: World, n: number): void {
  for (let i = 0; i < n; i++) tick(world);
}
