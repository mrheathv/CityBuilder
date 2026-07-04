import { tileIndex } from "./geometry.js";
import type { World } from "./types.js";

/**
 * Recomputes every tile's land value from scratch, purely as a function of
 * settled state. Never set directly.
 *
 * landValue = amenity (emergent from placed parks) + jobAccess (network-
 * routed access to posted job capacity) - congestion (worst adjacent road
 * edge's commuter load).
 *
 * jobAccess and congestion are both read from world.network, the cache
 * roadNetwork.ts's recomputeNetwork builds — this function itself does no
 * routing and runs every tick cheaply, even on ticks where the expensive
 * network rebuild didn't happen (see maybeRecomputeNetwork's cadence).
 * Amenity is recomputed fresh every tick by computeAmenityField, called
 * just before this in the tick pipeline.
 *
 * jobAccess counts *posted* job capacity (filled or not) — access to
 * opportunity, not just currently-filled jobs. Counting only filled jobs
 * would create a chicken-and-egg deadlock: an empty commercial area could
 * never attract residents because no one works there yet, and no one could
 * work there because no residents live within reach.
 */
export function computeLandValues(world: World): void {
  const { tiles, width, network } = world;

  for (const tile of tiles) {
    const i = tileIndex(width, tile.x, tile.y);
    const jobAccess = network.jobAccessByTile[i] ?? 0;
    const congestion = network.congestionByTile[i] ?? 0;

    tile.landValueBreakdown = { jobAccess, amenity: tile.amenity, congestion };
    tile.landValue = tile.amenity + jobAccess - congestion;
  }
}
