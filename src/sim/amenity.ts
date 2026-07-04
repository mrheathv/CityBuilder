import { distance } from "./geometry.js";
import { spend } from "./playerActions.js";
import type { ActionResult } from "./actionResult.js";
import type { AmenityObject, World } from "./types.js";

/**
 * Amenity is emergent from placed park objects, the same "field, not a
 * direct edit" boundary as land value and job access: baselineAmenity
 * (fixed at world-gen) plus a flat contribution from every park within
 * reach, recomputed fresh every tick. Placing/removing a park never touches
 * tile.amenity directly — only baselineAmenity and the park list change,
 * and this function is what turns that into the number land value reads.
 */
export function computeAmenityField(world: World): void {
  for (const tile of world.tiles) {
    tile.amenity = tile.baselineAmenity;
  }
  for (const park of world.amenities.values()) {
    const center = world.tilesById.get(park.tileId)!;
    for (const tile of world.tiles) {
      if (distance(center.x, center.y, tile.x, tile.y) <= park.radius) {
        tile.amenity += park.strength;
      }
    }
  }
}

let nextAmenitySeq = 0;

export function buildAmenity(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "empty") return { ok: false, reason: "tile is not empty" };

  const insufficientFunds = spend(world, world.params.parkBuildCost);
  if (insufficientFunds) return insufficientFunds;

  const id = `park-${tileId}-${nextAmenitySeq++}`;
  const park: AmenityObject = { id, tileId, strength: world.params.parkStrength, radius: world.params.parkRadius };
  world.amenities.set(id, park);
  tile.use = "park";
  tile.amenityObjectId = id;
  return { ok: true };
}

/** Bulldoze a park. Always allowed — a park has no occupants to protect. */
export function removeAmenity(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "park" || !tile.amenityObjectId) return { ok: false, reason: "no park on this tile" };

  world.amenities.delete(tile.amenityObjectId);
  tile.amenityObjectId = null;
  tile.use = "empty";
  return { ok: true };
}
