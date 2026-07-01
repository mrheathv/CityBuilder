import { describe, expect, it } from "vitest";
import { createWorld } from "../src/sim/worldgen.js";
import { computeLandValues } from "../src/sim/landValue.js";

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  return cov / Math.sqrt(varX * varY);
}

describe("computeLandValues", () => {
  it("gives tiles closer to their nearest business a higher jobAccess component", () => {
    const world = createWorld({ seed: 3, width: 16, height: 16 });
    computeLandValues(world);

    const businessTiles = Array.from(world.businesses.values()).map((b) => world.tilesById.get(b.tileId)!);
    const distToNearestBusiness = (t: { x: number; y: number }) =>
      Math.min(...businessTiles.map((b) => Math.abs(t.x - b.x) + Math.abs(t.y - b.y)));

    const dists = world.tiles.map(distToNearestBusiness);
    const accesses = world.tiles.map((t) => t.landValueBreakdown.jobAccess);
    expect(pearsonCorrelation(dists, accesses)).toBeLessThan(-0.4);
  });

  it("landValue is always exactly amenity + jobAccess - congestion (never set directly)", () => {
    const world = createWorld({ seed: 4, width: 12, height: 12 });
    computeLandValues(world);
    for (const tile of world.tiles) {
      const { jobAccess, amenity, congestion } = tile.landValueBreakdown;
      expect(tile.landValue).toBeCloseTo(amenity + jobAccess - congestion, 9);
    }
  });

  it("congestion rises as more nearby units become occupied", () => {
    const world = createWorld({ seed: 5, width: 16, height: 16, initialOccupancyRate: 0 });
    computeLandValues(world);
    const before = world.tiles.find((t) => t.use === "residential")!.landValueBreakdown.congestion;

    // Occupy every housing unit to maximize local density everywhere.
    let i = 0;
    for (const unit of world.housingUnits.values()) {
      unit.occupantId = `synthetic-${i++}`;
    }
    computeLandValues(world);
    const after = world.tiles.find((t) => t.use === "residential")!.landValueBreakdown.congestion;

    expect(after).toBeGreaterThan(before);
  });
});
