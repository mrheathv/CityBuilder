import { tileIndex } from "../sim/geometry.js";
import type { Tile, World } from "../sim/types.js";
import { LAND_USE_COLORS, LAND_USE_LABELS, LandUseCategory, ROAD_CATEGORY_COLORS } from "./colorScales.js";

/**
 * Pure "what does this tile's value mean" math — no canvas, no PixiJS, no DOM.
 * Shared by whichever rendering layer is in front (Canvas2D today, PixiJS
 * tomorrow) so overlay semantics can never drift between renderer swaps.
 */

export type OverlayMode = "landValue" | "occupancy" | "congestion" | "landUse" | "density" | "roads";

export const OVERLAY_LABELS: Record<OverlayMode, string> = {
  landValue: "Land value",
  occupancy: "Population (occupied units)",
  congestion: "Congestion",
  landUse: "Land use",
  density: "Density (development level)",
  roads: "Roads",
};

export type RoadCategory = "notRoad" | "connected" | "isolated";

export const ROAD_CATEGORY_LABELS: Record<RoadCategory, string> = {
  notRoad: "Not a road",
  connected: "Connected",
  isolated: "Isolated (no path to any job center)",
};

/** Overlays whose legend/coloring is a fixed set of categories rather than a continuous scale. */
export type CategoricalOverlayMode = "landUse" | "roads";

export type LegendInfo =
  | { kind: "sequential"; label: string; min: number; max: number }
  | { kind: "categorical"; label: string; entries: { label: string; color: string }[] };

export function occupiedUnitCount(world: World, tile: Tile): number {
  if (tile.use !== "residential") return 0;
  let count = 0;
  for (const unitId of tile.housingUnitIds) {
    if (world.housingUnits.get(unitId)!.occupantId !== null) count++;
  }
  return count;
}

export function landUseCategory(tile: Tile): LandUseCategory {
  if (tile.use === "empty") return "empty";
  if (tile.use === "residential") return "residential";
  if (tile.use === "road") return "road";
  if (tile.use === "park") return "park";
  return tile.businessId ? "jobCenter" : "commercialZoned";
}

/** notRoad for anything that isn't a road tile; otherwise connected/isolated per the last network recompute — never re-derived here, always read from the cache. */
export function roadCategory(world: World, tile: Tile): RoadCategory {
  if (tile.use !== "road") return "notRoad";
  const i = tileIndex(world.width, tile.x, tile.y);
  return world.network.connectedByTile[i] === 1 ? "connected" : "isolated";
}

export function quantitativeValue(world: World, tile: Tile, overlay: Exclude<OverlayMode, CategoricalOverlayMode>): number {
  switch (overlay) {
    case "landValue":
      return tile.landValue;
    case "occupancy":
      return occupiedUnitCount(world, tile);
    case "congestion":
      return tile.landValueBreakdown.congestion;
    case "density":
      return tile.developmentLevel;
  }
}

export function categoricalLegend(overlay: CategoricalOverlayMode): LegendInfo {
  if (overlay === "roads") {
    return {
      kind: "categorical",
      label: OVERLAY_LABELS.roads,
      entries: (Object.keys(ROAD_CATEGORY_COLORS) as RoadCategory[]).map((cat) => ({
        label: ROAD_CATEGORY_LABELS[cat],
        color: ROAD_CATEGORY_COLORS[cat],
      })),
    };
  }
  return {
    kind: "categorical",
    label: OVERLAY_LABELS[overlay],
    entries: (Object.keys(LAND_USE_COLORS) as LandUseCategory[]).map((cat) => ({
      label: LAND_USE_LABELS[cat],
      color: LAND_USE_COLORS[cat],
    })),
  };
}
