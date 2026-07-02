import type { Tile, World } from "../sim/types.js";
import { LAND_USE_COLORS, LAND_USE_LABELS, LandUseCategory, SELECTION_OUTLINE_COLOR, sequentialColor } from "./colorScales.js";

export type OverlayMode = "landValue" | "occupancy" | "congestion" | "landUse";

export const OVERLAY_LABELS: Record<OverlayMode, string> = {
  landValue: "Land value",
  occupancy: "Population (occupied units)",
  congestion: "Congestion",
  landUse: "Land use",
};

export interface RenderOptions {
  tileSize: number;
  overlay: OverlayMode;
  /** Tile id to draw the selection outline around, if any (already resolved from a household/business selection to its tile). */
  highlightTileId: string | null;
}

export type LegendInfo =
  | { kind: "sequential"; label: string; min: number; max: number }
  | { kind: "categorical"; label: string; entries: { label: string; color: string }[] };

function occupiedUnitCount(world: World, tile: Tile): number {
  if (tile.use !== "residential") return 0;
  let count = 0;
  for (const unitId of tile.housingUnitIds) {
    if (world.housingUnits.get(unitId)!.occupantId !== null) count++;
  }
  return count;
}

function landUseCategory(tile: Tile): LandUseCategory {
  if (tile.use === "empty") return "empty";
  if (tile.use === "residential") return "residential";
  return tile.businessId ? "jobCenter" : "commercialZoned";
}

function quantitativeValue(world: World, tile: Tile, overlay: Exclude<OverlayMode, "landUse">): number {
  switch (overlay) {
    case "landValue":
      return tile.landValue;
    case "occupancy":
      return occupiedUnitCount(world, tile);
    case "congestion":
      return tile.landValueBreakdown.congestion;
  }
}

/**
 * Draws exactly one variable per call — no layering. Returns the legend info
 * used to render this frame, computed from the same min/max and category
 * colors used for the tiles, so the legend can never drift from what's drawn.
 */
export function drawWorld(ctx: CanvasRenderingContext2D, world: World, opts: RenderOptions): LegendInfo {
  const { tileSize, overlay, highlightTileId } = opts;

  let legend: LegendInfo;

  if (overlay === "landUse") {
    for (const tile of world.tiles) {
      ctx.fillStyle = LAND_USE_COLORS[landUseCategory(tile)];
      ctx.fillRect(tile.x * tileSize, tile.y * tileSize, tileSize, tileSize);
    }
    legend = {
      kind: "categorical",
      label: OVERLAY_LABELS[overlay],
      entries: (Object.keys(LAND_USE_COLORS) as LandUseCategory[]).map((cat) => ({
        label: LAND_USE_LABELS[cat],
        color: LAND_USE_COLORS[cat],
      })),
    };
  } else {
    const values = world.tiles.map((t) => quantitativeValue(world, t, overlay));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;

    world.tiles.forEach((tile, i) => {
      const t = (values[i]! - min) / span;
      ctx.fillStyle = sequentialColor(t);
      ctx.fillRect(tile.x * tileSize, tile.y * tileSize, tileSize, tileSize);
    });

    legend = { kind: "sequential", label: OVERLAY_LABELS[overlay], min, max };
  }

  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  for (const tile of world.tiles) {
    ctx.strokeRect(tile.x * tileSize + 0.5, tile.y * tileSize + 0.5, tileSize - 1, tileSize - 1);
  }

  if (highlightTileId) {
    const tile = world.tilesById.get(highlightTileId);
    if (tile) {
      ctx.strokeStyle = SELECTION_OUTLINE_COLOR;
      ctx.lineWidth = 3;
      ctx.strokeRect(tile.x * tileSize + 1.5, tile.y * tileSize + 1.5, tileSize - 3, tileSize - 3);
    }
  }

  return legend;
}
