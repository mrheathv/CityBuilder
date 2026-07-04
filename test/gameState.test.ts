import { describe, expect, it } from "vitest";
import { createWorld } from "../src/sim/worldgen.js";
import { tick, runTicks } from "../src/sim/tick.js";
import { buildAmenity, computeAmenityField } from "../src/sim/amenity.js";
import { HISTORY_LENGTH } from "../src/sim/gameState.js";

describe("upkeep", () => {
  it("charges jobCenterUpkeepPerTick for every existing business, filled or not", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    tick(world);
    const roadCount = world.tiles.filter((t) => t.use === "road").length;
    const expected = world.businesses.size * world.params.jobCenterUpkeepPerTick + roadCount * world.params.roadUpkeepPerTick;
    expect(world.player.lastUpkeepCost).toBeCloseTo(expected, 6);
  });

  it("charges parkUpkeepPerTick for every existing park", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    const emptyTile = world.tiles.find((t) => t.use === "empty")!;
    tick(world);
    const before = world.player.lastUpkeepCost;

    expect(buildAmenity(world, emptyTile.id).ok).toBe(true);
    tick(world);

    const roadCount = world.tiles.filter((t) => t.use === "road").length;
    const expected = world.businesses.size * world.params.jobCenterUpkeepPerTick + roadCount * world.params.roadUpkeepPerTick + world.params.parkUpkeepPerTick;
    expect(world.player.lastUpkeepCost).toBeCloseTo(expected, 6);
    expect(world.player.lastUpkeepCost).toBeGreaterThan(before);
  });

  it("buildAmenity places a park that raises amenity within its radius via computeAmenityField, distinct from the static baseline", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    const centerTile = world.tiles.find((t) => t.use === "empty")!;
    const before = centerTile.amenity;

    expect(buildAmenity(world, centerTile.id).ok).toBe(true);
    computeAmenityField(world);

    expect(centerTile.amenity).toBeCloseTo(before + world.params.parkStrength, 6);
  });
});

describe("game state: winning", () => {
  it("wins the instant population reaches the goal, with a reason derived from real numbers", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    world.params.populationGoal = world.households.size; // goal already met before any tick runs

    tick(world);

    expect(world.game.status).toBe("won");
    expect(world.game.reason).toContain(`tick ${world.tick}`);
    expect(world.game.reason).toContain(String(world.params.populationGoal));
  });
});

describe("game state: bankruptcy", () => {
  it("stays in play while treasury is negative for fewer than bankruptcyGraceTicks", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    world.params.bankruptcyGraceTicks = 5;
    world.player.treasury = -100000; // deeply negative, won't recover on its own within a few ticks

    runTicks(world, 4);

    expect(world.game.status).toBe("playing");
    expect(world.game.ticksInsolvent).toBe(4);
  });

  it("loses to bankruptcy once treasury has been negative for bankruptcyGraceTicks consecutive ticks", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    world.params.bankruptcyGraceTicks = 5;
    world.player.treasury = -100000;

    runTicks(world, 5);

    expect(world.game.status).toBe("lost");
    expect(world.game.reason).toContain("Bankrupt");
    expect(world.game.reason).toContain(`tick ${world.tick}`);
  });

  it("resets ticksInsolvent to 0 as soon as treasury recovers to non-negative", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    world.params.bankruptcyGraceTicks = 5;
    world.player.treasury = -100000;

    runTicks(world, 3);
    expect(world.game.ticksInsolvent).toBe(3);

    world.player.treasury = 100000; // recovers
    tick(world);

    expect(world.game.ticksInsolvent).toBe(0);
    expect(world.game.status).toBe("playing");
  });
});

describe("game state: timeout", () => {
  it("loses once goalDeadlineTicks is reached without hitting the population goal", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    world.params.goalDeadlineTicks = 3;
    // populationGoal stays at its (much higher) default, unreachable in 3 ticks.

    runTicks(world, 3);

    expect(world.game.status).toBe("lost");
    expect(world.game.reason).toContain("Time's up");
    expect(world.game.reason).toContain(`tick ${world.tick}`);
  });
});

describe("game state: freezes time once resolved", () => {
  it("tick() is a permanent no-op once the game is won or lost", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    world.params.populationGoal = world.households.size;
    tick(world);
    expect(world.game.status).toBe("won");

    const frozenTick = world.tick;
    const frozenTreasury = world.player.treasury;
    const frozenPopulation = world.households.size;

    runTicks(world, 20);

    expect(world.tick).toBe(frozenTick);
    expect(world.player.treasury).toBe(frozenTreasury);
    expect(world.households.size).toBe(frozenPopulation);
  });
});

describe("history", () => {
  it("records one point per tick, capped at HISTORY_LENGTH", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    runTicks(world, 5);
    expect(world.history).toHaveLength(5);
    expect(world.history[world.history.length - 1]!.tick).toBe(world.tick);

    runTicks(world, HISTORY_LENGTH + 10);
    expect(world.history).toHaveLength(HISTORY_LENGTH);
    expect(world.history[0]!.tick).toBe(world.tick - HISTORY_LENGTH + 1);
  });
});
