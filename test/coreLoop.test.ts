import { describe, expect, it } from "vitest";
import { createWorld } from "../src/sim/worldgen.js";
import { runTicks, tick } from "../src/sim/tick.js";
import { inspectHousehold, inspectTile } from "../src/sim/inspect.js";

describe("core loop: households <-> jobs <-> land value", () => {
  it("produces land value variation across the map purely from emergent computation", () => {
    const world = createWorld({ seed: 42, width: 18, height: 18 });
    runTicks(world, 40);
    const values = world.tiles.map((t) => t.landValue);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(1);
  });

  it("rent varies across housing units in response to demand, not a single flat number", () => {
    const world = createWorld({ seed: 42, width: 18, height: 18 });
    runTicks(world, 40);
    const rents = Array.from(world.housingUnits.values()).map((u) => u.rent);
    const distinct = new Set(rents.map((r) => r.toFixed(2)));
    expect(distinct.size).toBeGreaterThan(3);
  });

  it("under sustained immigration pressure against near-full housing, households relocate and some are explicitly priced out", () => {
    const world = createWorld({ seed: 7, width: 16, height: 16, initialOccupancyRate: 0.9 });
    world.params.immigrationRatePerTick = 3;

    let relocations = 0;
    let pricedOut = 0;
    for (let i = 0; i < 80; i++) {
      tick(world);
      const thisTick = world.tick - 1;
      for (const household of world.households.values()) {
        const last = household.log[household.log.length - 1];
        if (!last || last.tick !== thisTick) continue;
        if (last.reason.type === "better_deal" || last.reason.type === "priced_out") relocations++;
        if (last.reason.type === "priced_out") pricedOut++;
      }
    }

    expect(relocations).toBeGreaterThan(0);
    expect(pricedOut).toBeGreaterThan(0);
  });

  it("some households are displaced out of the simulation entirely under sustained scarcity, and new ones replace them", () => {
    const world = createWorld({ seed: 11, width: 10, height: 10, initialOccupancyRate: 0.95 });
    world.params.immigrationRatePerTick = 4;
    world.params.maxTicksBeforeLeaving = 5;

    const initialIds = new Set(world.households.keys());
    runTicks(world, 60);

    const stillPresent = Array.from(initialIds).filter((id) => world.households.has(id)).length;

    expect(stillPresent).toBeLessThan(initialIds.size);
    expect(world.households.size).toBeGreaterThan(0);
  });

  it("every household is fully inspectable, with a human-readable reason behind its current situation", () => {
    const world = createWorld({ seed: 21, width: 14, height: 14 });
    runTicks(world, 30);

    const [firstId] = world.households.keys();
    const inspection = inspectHousehold(world, firstId!);

    expect(inspection).not.toBeNull();
    expect(inspection!.recentDecisions.length).toBeGreaterThan(0);
    for (const decision of inspection!.recentDecisions) {
      expect(decision.summary.length).toBeGreaterThan(0);
    }
  });

  it("a household that relocated has a log entry whose reason type and numbers actually explain the move", () => {
    const world = createWorld({ seed: 7, width: 16, height: 16, initialOccupancyRate: 0.9 });
    world.params.immigrationRatePerTick = 3;

    let movedHouseholdId: string | null = null;
    for (let i = 0; i < 80 && !movedHouseholdId; i++) {
      tick(world);
      for (const [id, household] of world.households) {
        const last = household.log[household.log.length - 1];
        if (last && last.tick === world.tick - 1 && last.reason.type === "priced_out") {
          movedHouseholdId = id;
          break;
        }
      }
    }

    expect(movedHouseholdId).not.toBeNull();
    const inspection = inspectHousehold(world, movedHouseholdId!)!;
    const reasonEntry = inspection.recentDecisions.find((d) => d.summary.startsWith("Priced out"));
    expect(reasonEntry).toBeDefined();

    const household = world.households.get(movedHouseholdId!)!;
    const pricedOutEntry = household.log.find((e) => e.reason.type === "priced_out")!;
    const reason = pricedOutEntry.reason as Extract<typeof pricedOutEntry.reason, { type: "priced_out" }>;
    expect(reason.newRent).toBeLessThan(reason.oldRent);
  });

  it("a tile's land value breaks down into its exact, inspectable components", () => {
    const world = createWorld({ seed: 21, width: 14, height: 14 });
    runTicks(world, 10);
    const tile = world.tiles.find((t) => t.use === "residential")!;
    const inspection = inspectTile(world, tile.id)!;
    expect(inspection.landValue).toBeCloseTo(
      inspection.landValueBreakdown.amenity + inspection.landValueBreakdown.jobAccess - inspection.landValueBreakdown.congestion,
      9,
    );
  });
});
