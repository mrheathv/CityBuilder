import { describe, expect, it } from "vitest";
import { createWorld } from "../src/sim/worldgen.js";
import { computeLandValues } from "../src/sim/landValue.js";
import { networkDistanceToBusiness } from "../src/sim/roadNetwork.js";
import { tileIndex } from "../src/sim/geometry.js";

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
  it("gives tiles with shorter network distance to their nearest business a higher jobAccess component", () => {
    const world = createWorld({ seed: 3, width: 16, height: 16 });
    computeLandValues(world);

    const businessIds = Array.from(world.businesses.keys());
    const dists: number[] = [];
    const accesses: number[] = [];
    for (const tile of world.tiles) {
      const i = tileIndex(world.width, tile.x, tile.y);
      if (world.network.connectedByTile[i] !== 1) continue; // disconnected tiles are a different regime, not just "far"
      const d = Math.min(...businessIds.map((id) => networkDistanceToBusiness(world, tile, id)));
      dists.push(d);
      accesses.push(tile.landValueBreakdown.jobAccess);
    }

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

  it("congestion in the breakdown is read straight from the cached network congestion field, not recomputed by computeLandValues itself", () => {
    // How congestion actually accumulates from routed commuters is roadNetwork.test.ts's
    // job (recomputeNetwork's edge-congestion tests); this only checks that
    // computeLandValues wires the cache through correctly.
    const world = createWorld({ seed: 5, width: 12, height: 12 });
    const tile = world.tiles.find((t) => t.use === "residential")!;
    const i = tileIndex(world.width, tile.x, tile.y);

    world.network.congestionByTile[i] = 7.5; // simulate a congested doorstep
    computeLandValues(world);

    expect(tile.landValueBreakdown.congestion).toBeCloseTo(7.5, 9);
    expect(tile.landValue).toBeCloseTo(tile.amenity + tile.landValueBreakdown.jobAccess - 7.5, 9);
  });
});
