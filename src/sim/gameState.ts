import type { World } from "./types.js";

/** How many recent ticks are kept for trend/leading-indicator display. */
export const HISTORY_LENGTH = 30;

/** Appends this tick's population/treasury snapshot, capped to HISTORY_LENGTH so trend lookups (e.g. "10 ticks ago") always have bounded, recent data. */
export function recordHistory(world: World): void {
  world.history.push({ tick: world.tick, population: world.households.size, treasury: world.player.treasury });
  if (world.history.length > HISTORY_LENGTH) world.history.shift();
}

/**
 * Win: reach the population goal. Lose: bankruptcy (treasury negative for
 * bankruptcyGraceTicks straight) or running out of time before reaching the
 * goal. Every reason string is built entirely from real, current numbers —
 * never a canned message — so it's exactly as inspectable as everything
 * else in the sim. Once status !== "playing" this is a no-op forever;
 * tick() itself checks status first and returns before anything (including
 * this function) runs again.
 */
export function checkGameState(world: World): void {
  if (world.game.status !== "playing") return;

  if (world.player.treasury < 0) {
    world.game.ticksInsolvent += 1;
  } else {
    world.game.ticksInsolvent = 0;
  }

  if (world.households.size >= world.params.populationGoal) {
    world.game.status = "won";
    world.game.reason = `Reached ${world.households.size} households at tick ${world.tick} (goal was ${world.params.populationGoal}).`;
    return;
  }

  if (world.game.ticksInsolvent >= world.params.bankruptcyGraceTicks) {
    world.game.status = "lost";
    world.game.reason =
      `Bankrupt at tick ${world.tick}: upkeep ($${world.player.lastUpkeepCost.toFixed(0)}/tick) has outrun tax revenue ` +
      `($${world.player.lastTaxRevenue.toFixed(0)}/tick) for ${world.game.ticksInsolvent} consecutive ticks, leaving treasury at ` +
      `$${world.player.treasury.toFixed(0)} (tax rate ${(world.player.taxRate * 100).toFixed(0)}%).`;
    return;
  }

  if (world.tick >= world.params.goalDeadlineTicks) {
    world.game.status = "lost";
    world.game.reason = `Time's up at tick ${world.tick}: reached ${world.households.size} of the ${world.params.populationGoal} population goal.`;
    return;
  }
}
