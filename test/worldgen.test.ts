import { describe, expect, it } from "vitest";
import { createWorld } from "../src/sim/worldgen.js";

describe("createWorld", () => {
  it("creates the requested grid dimensions with unique, coordinate-consistent tiles", () => {
    const world = createWorld({ seed: 1, width: 10, height: 8 });
    expect(world.tiles).toHaveLength(80);
    const ids = new Set(world.tiles.map((t) => t.id));
    expect(ids.size).toBe(80);
    for (const tile of world.tiles) {
      expect(world.tilesById.get(tile.id)).toBe(tile);
    }
  });

  it("gives every business's job slots a consistent back-reference and every residential tile its housing units", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    for (const business of world.businesses.values()) {
      const tile = world.tilesById.get(business.tileId)!;
      expect(tile.use).toBe("commercial");
      expect(tile.businessId).toBe(business.id);
      for (const jobId of business.jobSlotIds) {
        expect(world.jobSlots.get(jobId)!.businessId).toBe(business.id);
      }
    }
    for (const tile of world.tiles) {
      if (tile.use !== "residential") continue;
      for (const unitId of tile.housingUnitIds) {
        expect(world.housingUnits.get(unitId)!.tileId).toBe(tile.id);
      }
    }
  });

  it("seeds initial households into occupied units and some of them into jobs", () => {
    const world = createWorld({ seed: 1, width: 12, height: 12 });
    expect(world.households.size).toBeGreaterThan(0);
    let employed = 0;
    for (const household of world.households.values()) {
      expect(household.homeUnitId).not.toBeNull();
      const unit = world.housingUnits.get(household.homeUnitId!)!;
      expect(unit.occupantId).toBe(household.id);
      if (household.jobSlotId) {
        employed++;
        expect(world.jobSlots.get(household.jobSlotId)!.occupantId).toBe(household.id);
      }
    }
    expect(employed).toBeGreaterThan(0);
  });

  it("is deterministic: identical options produce an identical world", () => {
    const a = createWorld({ seed: 99, width: 10, height: 10 });
    const b = createWorld({ seed: 99, width: 10, height: 10 });
    expect(a.tiles.map((t) => t.use)).toEqual(b.tiles.map((t) => t.use));
    expect(a.households.size).toBe(b.households.size);
    expect(Array.from(a.businesses.values())).toEqual(Array.from(b.businesses.values()));
  });
});
