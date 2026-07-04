import { Application, BlurFilter, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { World } from "../sim/types.js";
import { categoricalLegend, landUseCategory, OVERLAY_LABELS, quantitativeValue, roadCategory } from "./overlayData.js";
import type { LegendInfo, OverlayMode } from "./overlayData.js";
import { LAND_USE_COLORS, parseCssColor, rgbToHexInt, ROAD_CATEGORY_COLORS, sequentialColor, SELECTION_OUTLINE_COLOR } from "./colorScales.js";
import type { RgbColor } from "./colorScales.js";

/**
 * WebGL (PixiJS) tile grid. Reads World state and draws it — never mutates
 * anything on World, a Tile, or any other sim object. All simulation logic
 * (land value, rent, agent decisions, road routing) lives entirely in
 * src/sim and is untouched by anything in this file.
 */

export interface TileGridOptions {
  tileSize: number;
}

export interface TileGrid {
  app: Application;
  update(world: World, overlay: OverlayMode, highlightTileId: string | null, nowMs: number): LegendInfo;
  destroy(): void;
}

/** Displayed color moves this fraction of the remaining distance to its target every frame — a value change reads as a brief animation instead of a snap. */
const COLOR_EASE_PER_FRAME = 0.18;

/** Land value percentile above which a tile joins job centers in getting the "hot" pulse, recomputed every frame since the threshold shifts as the market moves. */
const HIGH_LAND_VALUE_PERCENTILE = 0.9;

const GLOW_RADIUS_FACTOR = 0.75;
const GLOW_COLOR = 0xffdd88;
const GLOW_MIN_ALPHA = 0.12;
const GLOW_MAX_ALPHA = 0.3;
const GLOW_PULSE_HZ = 1.6;

/**
 * Flat "nested square" density glyph shown on the land-use overlay only —
 * developmentLevel rings drawn at fixed sizes (not rescaled per tile), so
 * the same ring always means the same level everywhere on the grid: a
 * level-2 tile always draws exactly the two smallest rings, a level-4 tower
 * draws all four out to the largest. Deliberately flat outlines, no
 * perspective or extrusion.
 */
const DENSITY_GLYPH_MIN_HALF_FACTOR = 0.1;
const DENSITY_GLYPH_MAX_HALF_FACTOR = 0.32;
const DENSITY_GLYPH_COLOR = 0xffffff;
const DENSITY_GLYPH_ALPHA = 0.85;

/** Park radius-of-effect ring, shown alongside the density glyphs — flat outline, not a filled area, so it doesn't compete with the tile colors underneath it. */
const PARK_RING_COLOR = 0xffffff;
const PARK_RING_ALPHA = 0.5;

/** Congestion overlay: edges with commuters get a colored line on top of the tile tinting, scaled by that edge's share of the worst congestion this cycle. */
const CONGESTION_EDGE_MIN_WIDTH = 1.5;
const CONGESTION_EDGE_MAX_WIDTH = 6;

interface TileVisual {
  x: number;
  y: number;
  sprite: Sprite;
  current: RgbColor;
  glow: Graphics | null;
  /** Per-tile phase offset so glowing tiles don't all pulse in lockstep. */
  glowPhase: number;
}

function easeToward(current: RgbColor, target: RgbColor): void {
  current.r += (target.r - current.r) * COLOR_EASE_PER_FRAME;
  current.g += (target.g - current.g) * COLOR_EASE_PER_FRAME;
  current.b += (target.b - current.b) * COLOR_EASE_PER_FRAME;
}

export async function createTileGrid(canvas: HTMLCanvasElement, world: World, options: TileGridOptions): Promise<TileGrid> {
  const { tileSize } = options;
  const width = world.width * tileSize;
  const height = world.height * tileSize;

  const app = new Application();
  await app.init({
    canvas,
    width,
    height,
    background: "#1c1c1c",
    antialias: false,
    resolution: 1,
    autoDensity: false,
  });

  const tileLayer = new Container();
  const gridLinesLayer = new Graphics();
  const glowLayer = new Container();
  const densityGlyphLayer = new Graphics();
  const congestionEdgeLayer = new Graphics();
  const selectionOutline = new Graphics();
  glowLayer.filters = [new BlurFilter({ strength: 6 })];

  app.stage.addChild(tileLayer, gridLinesLayer, glowLayer, densityGlyphLayer, congestionEdgeLayer, selectionOutline);

  const visuals: TileVisual[] = world.tiles.map((tile) => {
    const sprite = new Sprite(Texture.WHITE);
    sprite.x = tile.x * tileSize;
    sprite.y = tile.y * tileSize;
    sprite.width = tileSize;
    sprite.height = tileSize;
    sprite.tint = 0x000000;
    tileLayer.addChild(sprite);
    return { x: tile.x, y: tile.y, sprite, current: { r: 0, g: 0, b: 0 }, glow: null, glowPhase: Math.random() * Math.PI * 2 };
  });

  // Grid lines are static geometry (tile positions never change) — drawn once, not redrawn per frame.
  for (const tile of world.tiles) {
    gridLinesLayer.rect(tile.x * tileSize + 0.5, tile.y * tileSize + 0.5, tileSize - 1, tileSize - 1).stroke({ width: 1, color: 0x000000, alpha: 0.18 });
  }

  function updateGlow(currentWorld: World, nowMs: number): void {
    const sortedLandValues = currentWorld.tiles.map((t) => t.landValue).sort((a, b) => a - b);
    const thresholdIndex = Math.floor(sortedLandValues.length * HIGH_LAND_VALUE_PERCENTILE);
    const highValueThreshold = sortedLandValues[thresholdIndex] ?? Infinity;

    currentWorld.tiles.forEach((tile, i) => {
      const v = visuals[i]!;
      const qualifies = tile.businessId !== null || tile.landValue >= highValueThreshold;

      if (!qualifies) {
        if (v.glow) v.glow.visible = false;
        return;
      }

      if (!v.glow) {
        const cx = v.x * tileSize + tileSize / 2;
        const cy = v.y * tileSize + tileSize / 2;
        const g = new Graphics().circle(cx, cy, tileSize * GLOW_RADIUS_FACTOR).fill({ color: GLOW_COLOR });
        glowLayer.addChild(g);
        v.glow = g;
      }
      v.glow.visible = true;
      const phase = (nowMs / 1000) * GLOW_PULSE_HZ * Math.PI * 2 + v.glowPhase;
      v.glow.alpha = GLOW_MIN_ALPHA + (GLOW_MAX_ALPHA - GLOW_MIN_ALPHA) * (0.5 + 0.5 * Math.sin(phase));
    });
  }

  function updateDensityGlyphs(currentWorld: World): void {
    densityGlyphLayer.clear();
    const maxLevel = currentWorld.params.developmentCapacity.length - 1;
    for (const tile of currentWorld.tiles) {
      if (tile.developmentLevel <= 0) continue;
      const cx = tile.x * tileSize + tileSize / 2;
      const cy = tile.y * tileSize + tileSize / 2;
      for (let level = 1; level <= tile.developmentLevel; level++) {
        const frac = maxLevel > 1 ? (level - 1) / (maxLevel - 1) : 0;
        const half = tileSize * (DENSITY_GLYPH_MIN_HALF_FACTOR + (DENSITY_GLYPH_MAX_HALF_FACTOR - DENSITY_GLYPH_MIN_HALF_FACTOR) * frac);
        densityGlyphLayer.rect(cx - half, cy - half, half * 2, half * 2).stroke({ width: 1.25, color: DENSITY_GLYPH_COLOR, alpha: DENSITY_GLYPH_ALPHA });
      }
    }
    for (const park of currentWorld.amenities.values()) {
      const tile = currentWorld.tilesById.get(park.tileId);
      if (!tile) continue;
      const cx = tile.x * tileSize + tileSize / 2;
      const cy = tile.y * tileSize + tileSize / 2;
      densityGlyphLayer.circle(cx, cy, park.radius * tileSize).stroke({ width: 1.25, color: PARK_RING_COLOR, alpha: PARK_RING_ALPHA });
    }
  }

  /** Colored road segments — the actual traffic jams, not just a per-tile average. Only meaningful on the congestion overlay. */
  function updateCongestionEdges(currentWorld: World): void {
    congestionEdgeLayer.clear();
    const counts = Array.from(currentWorld.network.edgeCongestion.values());
    if (counts.length === 0) return;
    const maxCount = Math.max(...counts);
    if (maxCount <= 0) return;

    for (const [key, count] of currentWorld.network.edgeCongestion) {
      if (count <= 0) continue;
      const [aStr, bStr] = key.split("|");
      const a = Number(aStr);
      const b = Number(bStr);
      const ax = a % currentWorld.width;
      const ay = Math.floor(a / currentWorld.width);
      const bx = b % currentWorld.width;
      const by = Math.floor(b / currentWorld.width);

      const t = count / maxCount;
      const color = parseCssColor(sequentialColor(t));
      const edgeWidth = CONGESTION_EDGE_MIN_WIDTH + (CONGESTION_EDGE_MAX_WIDTH - CONGESTION_EDGE_MIN_WIDTH) * t;

      congestionEdgeLayer
        .moveTo(ax * tileSize + tileSize / 2, ay * tileSize + tileSize / 2)
        .lineTo(bx * tileSize + tileSize / 2, by * tileSize + tileSize / 2)
        .stroke({ width: edgeWidth, color: rgbToHexInt(color), alpha: 0.9 });
    }
  }

  function updateSelection(currentWorld: World, highlightTileId: string | null): void {
    selectionOutline.clear();
    if (!highlightTileId) return;
    const tile = currentWorld.tilesById.get(highlightTileId);
    if (!tile) return;
    selectionOutline
      .rect(tile.x * tileSize + 1.5, tile.y * tileSize + 1.5, tileSize - 3, tileSize - 3)
      .stroke({ width: 3, color: SELECTION_OUTLINE_COLOR });
  }

  function update(currentWorld: World, overlay: OverlayMode, highlightTileId: string | null, nowMs: number): LegendInfo {
    let legend: LegendInfo;

    if (overlay === "landUse" || overlay === "roads") {
      currentWorld.tiles.forEach((tile, i) => {
        const v = visuals[i]!;
        const target = overlay === "landUse" ? parseCssColor(LAND_USE_COLORS[landUseCategory(tile)]) : parseCssColor(ROAD_CATEGORY_COLORS[roadCategory(currentWorld, tile)]);
        easeToward(v.current, target);
        v.sprite.tint = rgbToHexInt(v.current);
      });
      legend = categoricalLegend(overlay);
      if (overlay === "landUse") {
        updateDensityGlyphs(currentWorld);
      } else {
        densityGlyphLayer.clear();
      }
      congestionEdgeLayer.clear();
    } else {
      densityGlyphLayer.clear();
      const values = currentWorld.tiles.map((t) => quantitativeValue(currentWorld, t, overlay));
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;

      currentWorld.tiles.forEach((tile, i) => {
        const v = visuals[i]!;
        const t = (values[i]! - min) / span;
        const target = parseCssColor(sequentialColor(t));
        easeToward(v.current, target);
        v.sprite.tint = rgbToHexInt(v.current);
      });

      legend = { kind: "sequential", label: OVERLAY_LABELS[overlay], min, max };

      if (overlay === "congestion") {
        updateCongestionEdges(currentWorld);
      } else {
        congestionEdgeLayer.clear();
      }
    }

    updateGlow(currentWorld, nowMs);
    updateSelection(currentWorld, highlightTileId);

    return legend;
  }

  return {
    app,
    update,
    destroy: () => app.destroy(true, { children: true }),
  };
}
