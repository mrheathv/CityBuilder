/** Manhattan (grid-block) distance — matches a city grid where you move tile to tile, not as the crow flies. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** Flat array index for a tile's (x, y) in a `width`-wide grid — the indexing scheme every per-tile typed array (network distance, congestion, etc.) shares. */
export function tileIndex(width: number, x: number, y: number): number {
  return y * width + x;
}
