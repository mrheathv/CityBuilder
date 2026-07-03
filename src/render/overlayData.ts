import type { Tile, World } from "../sim/types.js";
import { LAND_USE_COLORS, LAND_USE_LABELS, LandUseCategory } from "./colorScales.js";

/**
 * Pure "what does this tile's value mean" math — no canvas, no PixiJS, no DOM.
 * Shared by whichever rendering layer is in front (Canvas2D today, PixiJS
 * tomorrow) so overlay semantics can never drift between renderer swaps.
 */

export type OverlayMode = "landValue" | "occupancy" | "congestion" | "landUse";

export const OVERLAY_LABELS: Record<OverlayMode, string> = {
  landValue: "Land value",
  occupancy: "Population (occupied units)",
  congestion: "Congestion",
  landUse: "Land use",
};

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
  return tile.businessId ? "jobCenter" : "commercialZoned";
}

export function quantitativeValue(world: World, tile: Tile, overlay: Exclude<OverlayMode, "landUse">): number {
  switch (overlay) {
    case "landValue":
      return tile.landValue;
    case "occupancy":
      return occupiedUnitCount(world, tile);
    case "congestion":
      return tile.landValueBreakdown.congestion;
  }
}

export function categoricalLegend(overlay: OverlayMode): LegendInfo {
  return {
    kind: "categorical",
    label: OVERLAY_LABELS[overlay],
    entries: (Object.keys(LAND_USE_COLORS) as LandUseCategory[]).map((cat) => ({
      label: LAND_USE_LABELS[cat],
      color: LAND_USE_COLORS[cat],
    })),
  };
}
