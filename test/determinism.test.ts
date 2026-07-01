import { describe, expect, it } from "vitest";
import { createWorld } from "../src/sim/worldgen.js";
import { runTicks } from "../src/sim/tick.js";

/** Strips RNG/functions and Maps down to plain, order-stable JSON for comparison. */
function serialize(world: ReturnType<typeof createWorld>) {
  return JSON.stringify({
    tick: world.tick,
    tiles: world.tiles.map((t) => ({ id: t.id, use: t.use, landValue: t.landValue })),
    housingUnits: Array.from(world.housingUnits.values()).map((u) => ({ id: u.id, rent: u.rent, occupantId: u.occupantId })),
    jobSlots: Array.from(world.jobSlots.values()).map((j) => ({ id: j.id, occupantId: j.occupantId })),
    households: Array.from(world.households.entries()).map(([id, h]) => ({
      id,
      homeUnitId: h.homeUnitId,
      jobSlotId: h.jobSlotId,
      savings: h.savings,
      income: h.income,
    })),
  });
}

describe("determinism", () => {
  it("same seed + same tick count produces byte-identical state, every time", () => {
    const worldA = createWorld({ seed: 2024, width: 14, height: 14 });
    const worldB = createWorld({ seed: 2024, width: 14, height: 14 });

    runTicks(worldA, 60);
    runTicks(worldB, 60);

    expect(serialize(worldA)).toEqual(serialize(worldB));
  });

  it("a different seed diverges", () => {
    const worldA = createWorld({ seed: 1, width: 14, height: 14 });
    const worldB = createWorld({ seed: 2, width: 14, height: 14 });

    runTicks(worldA, 30);
    runTicks(worldB, 30);

    expect(serialize(worldA)).not.toEqual(serialize(worldB));
  });

  it("running to tick 60 in one call equals running to 30 then 30 more", () => {
    const worldA = createWorld({ seed: 555, width: 12, height: 12 });
    const worldB = createWorld({ seed: 555, width: 12, height: 12 });

    runTicks(worldA, 60);
    runTicks(worldB, 30);
    runTicks(worldB, 30);

    expect(serialize(worldA)).toEqual(serialize(worldB));
  });
});
