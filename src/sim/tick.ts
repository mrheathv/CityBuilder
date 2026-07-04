import { computeAmenityField } from "./amenity.js";
import { businessHiring } from "./businessHiring.js";
import { developmentGrowth } from "./development.js";
import { settleFinances } from "./finances.js";
import { checkGameState, recordHistory } from "./gameState.js";
import { householdJobSearch } from "./jobSearch.js";
import { computeLandValues } from "./landValue.js";
import { updateRents } from "./rent.js";
import { householdResidentialSearch } from "./residentialSearch.js";
import { maybeRecomputeNetwork } from "./roadNetwork.js";
import { spawnAndAttrition } from "./spawnAttrition.js";
import { applyIncomeTax, applyUpkeep, collectTaxes } from "./tax.js";
import type { World } from "./types.js";

/**
 * One tick. Each phase reads a fully-settled state left by the previous
 * phase — no interleaved reads/writes within a phase — which is what keeps
 * this order-independent-within-itself and therefore deterministic.
 *
 * maybeRecomputeNetwork is the one phase that doesn't always do anything:
 * it only rebuilds the road-network routing (job access, edge congestion)
 * on its periodic cadence or when a road/job-center/park edit just made it
 * stale (world.accessibilityDirty). Every other tick, computeLandValues just
 * reads whatever it cached last time — see src/sim/roadNetwork.ts.
 *
 * Once the game has been won or lost, this is a permanent no-op (including
 * the tick counter itself) — time stops the instant the outcome is decided,
 * so nothing downstream needs to guard against ticks happening past the end.
 */
export function tick(world: World): void {
  if (world.game.status !== "playing") return;

  spawnAndAttrition(world);
  applyIncomeTax(world);
  maybeRecomputeNetwork(world);
  computeAmenityField(world);
  computeLandValues(world);
  updateRents(world);
  householdResidentialSearch(world);
  developmentGrowth(world);
  householdJobSearch(world);
  businessHiring(world);
  settleFinances(world);
  collectTaxes(world);
  applyUpkeep(world);
  world.tick += 1;
  recordHistory(world);
  checkGameState(world);
}

export function runTicks(world: World, n: number): void {
  for (let i = 0; i < n; i++) tick(world);
}
