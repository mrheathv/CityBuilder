import { distance } from "./geometry.js";
import type { World } from "./types.js";

/**
 * Recomputes every tile's land value from scratch, purely as a function of
 * the world state at the *end* of the previous tick. Never set directly.
 *
 * landValue = amenity (static) + jobAccess (distance-decayed access to posted
 * job capacity) - congestion (local residential density drag).
 *
 * jobAccess counts *posted* job capacity (filled or not) — access to
 * opportunity, not just currently-filled jobs. Counting only filled jobs
 * would create a chicken-and-egg deadlock: an empty commercial area could
 * never attract residents because no one works there yet, and no one could
 * work there because no residents live within reach.
 */
export function computeLandValues(world: World): void {
  const { tiles, businesses, jobSlots, housingUnits, tilesById, params } = world;

  const jobSources: { x: number; y: number; totalWage: number }[] = [];
  for (const business of businesses.values()) {
    const tile = tilesById.get(business.tileId)!;
    let totalWage = 0;
    for (const jobId of business.jobSlotIds) {
      totalWage += jobSlots.get(jobId)!.wage;
    }
    jobSources.push({ x: tile.x, y: tile.y, totalWage });
  }

  const occupiedHomes: { x: number; y: number }[] = [];
  for (const tile of tiles) {
    if (tile.use !== "residential") continue;
    for (const unitId of tile.housingUnitIds) {
      if (housingUnits.get(unitId)!.occupantId !== null) {
        occupiedHomes.push({ x: tile.x, y: tile.y });
      }
    }
  }

  for (const tile of tiles) {
    let jobAccess = 0;
    for (const src of jobSources) {
      const d = distance(tile.x, tile.y, src.x, src.y);
      jobAccess += src.totalWage * Math.exp(-params.jobAccessDecay * d);
    }
    jobAccess *= 0.1;

    let congestion = 0;
    for (const home of occupiedHomes) {
      if (distance(tile.x, tile.y, home.x, home.y) <= params.congestionRadius) {
        congestion += 1;
      }
    }
    congestion *= params.congestionWeight * 0.1;

    tile.landValueBreakdown = { jobAccess, amenity: tile.amenity, congestion };
    tile.landValue = tile.amenity + jobAccess - congestion;
  }
}
