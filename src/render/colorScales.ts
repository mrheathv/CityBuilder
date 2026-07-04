import { interpolateViridis } from "d3-scale-chromatic";

/**
 * One perceptually-uniform sequential ramp (Viridis) shared by every
 * quantitative overlay (land value, occupancy, congestion). Viridis is
 * monotonically increasing in perceived lightness and stays distinguishable
 * under the common color-vision deficiencies, so "light = low, dark = high"
 * reads correctly in every overlay you switch to, not just for typical
 * vision.
 */
export function sequentialColor(t: number): string {
  return interpolateViridis(Math.max(0, Math.min(1, t)));
}

/**
 * CSS gradient sampling the real interpolator at `steps` stops. Viridis is
 * not a straight line between its endpoint colors (it bends through blue and
 * green on the way from dark purple to yellow), so a naive 2-stop CSS
 * gradient between sequentialColor(0) and sequentialColor(1) would visibly
 * disagree with the tiles. Sampling the same function the tiles use keeps
 * the legend bar and the grid identical by construction.
 */
export function sequentialGradientCss(steps = 12): string {
  const stops: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stops.push(`${sequentialColor(t)} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export type LandUseCategory = "empty" | "residential" | "commercialZoned" | "jobCenter" | "park" | "road";

/**
 * Categorical palette checked with the dataviz skill's validate_palette.js
 * against this app's dark surface (#1c1c1c): lightness band, chroma floor,
 * CVD separation, and contrast vs. surface. "park" (#1f9e6d) was added and
 * validated alongside the original three real-identity colors with no new
 * failures. "empty" and "road" are deliberate neutral grays outside that
 * validated set, the same way "empty" always was — infrastructure and
 * "nothing built here" aren't zoning identities competing for hue budget,
 * they're just distinguished by lightness (light = nothing, dark = road).
 */
export const LAND_USE_COLORS: Record<LandUseCategory, string> = {
  empty: "#d8d8d0",
  residential: "#008300",
  commercialZoned: "#3987e5",
  jobCenter: "#9085e9",
  park: "#1f9e6d",
  road: "#5a5a54",
};

export const LAND_USE_LABELS: Record<LandUseCategory, string> = {
  empty: "Empty",
  residential: "Residential",
  commercialZoned: "Commercial (zoned)",
  jobCenter: "Job center",
  park: "Park",
  road: "Road",
};

export const SELECTION_OUTLINE_COLOR = "#ffe400";

/**
 * Roads overlay: "connected" reuses the same asphalt gray as the land-use
 * overlay's road color (still just "a road," not a new identity); "isolated"
 * is a real warning color, validated standalone against the dark surface —
 * a road tile with no path to any job center is a mistake worth flagging,
 * not a passive state like "empty."
 */
export const ROAD_CATEGORY_COLORS = {
  notRoad: "#d8d8d0",
  connected: "#5a5a54",
  isolated: "#e0574a",
} as const;

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Parses either "#rrggbb" (our categorical palette) or "rgb(r, g, b)" (d3-scale-chromatic's output) into components. */
export function parseCssColor(css: string): RgbColor {
  if (css.startsWith("#")) {
    const n = parseInt(css.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const match = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!match) throw new Error(`Unrecognized color format: ${css}`);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
}

export function rgbToHexInt(c: RgbColor): number {
  return (Math.round(c.r) << 16) | (Math.round(c.g) << 8) | Math.round(c.b);
}
