import type { Tile, World } from "../sim/types.js";

export interface RenderOptions {
  tileSize: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  const c = clamp(t, 0, 1);
  const r = Math.round(a.r + (b.r - a.r) * c);
  const g = Math.round(a.g + (b.g - a.g) * c);
  const bl = Math.round(a.b + (b.b - a.b) * c);
  return `rgb(${r}, ${g}, ${bl})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Cheap-to-expensive: green (affordable) through yellow to deep red (pricing people out). */
const RENT_COLD = "#bfe6b0";
const RENT_HOT = "#8f2020";
const EMPTY_COLOR = "#d8d8d0";
const COMMERCIAL_COLD = "#c9c0f0";
const COMMERCIAL_HOT = "#3a2f8f";

/** A rent level past which a tile reads as "maximally expensive" in the color scale — tune to taste, not load-bearing. */
const RENT_COLOR_SCALE = 80;

function colorForTile(world: World, tile: Tile): string {
  if (tile.use === "empty") return EMPTY_COLOR;

  if (tile.use === "commercial") {
    const business = tile.businessId ? world.businesses.get(tile.businessId) : null;
    if (!business) return COMMERCIAL_COLD;
    const total = business.jobSlotIds.length;
    const filled = business.jobSlotIds.filter((id) => world.jobSlots.get(id)!.occupantId !== null).length;
    return lerpColor(COMMERCIAL_COLD, COMMERCIAL_HOT, total > 0 ? filled / total : 0);
  }

  const units = tile.housingUnitIds.map((id) => world.housingUnits.get(id)!);
  if (units.length === 0) return EMPTY_COLOR;
  const avgRent = units.reduce((s, u) => s + u.rent, 0) / units.length;
  const anyOccupied = units.some((u) => u.occupantId !== null);
  const base = lerpColor(RENT_COLD, RENT_HOT, clamp(avgRent / RENT_COLOR_SCALE, 0, 1));
  return anyOccupied ? base : lerpColor(base, "#ffffff", 0.45);
}

export function drawWorld(ctx: CanvasRenderingContext2D, world: World, opts: RenderOptions): void {
  const { tileSize } = opts;
  for (const tile of world.tiles) {
    ctx.fillStyle = colorForTile(world, tile);
    ctx.fillRect(tile.x * tileSize, tile.y * tileSize, tileSize, tileSize);
  }
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  for (const tile of world.tiles) {
    ctx.strokeRect(tile.x * tileSize + 0.5, tile.y * tileSize + 0.5, tileSize - 1, tileSize - 1);
  }
}
