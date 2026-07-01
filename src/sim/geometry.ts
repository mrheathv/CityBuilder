/** Manhattan (grid-block) distance — matches a city grid where you move tile to tile, not as the crow flies. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
