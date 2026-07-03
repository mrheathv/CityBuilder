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

export type LandUseCategory = "empty" | "residential" | "commercialZoned" | "jobCenter";

/**
 * Categorical palette for the 3 real land-use identities, checked with the
 * dataviz skill's validate_palette.js against this app's dark surface
 * (#1c1c1c): lightness band, chroma floor, CVD separation (worst adjacent
 * ΔE 21.5 under tritanopia, well past the ≥12 target), and contrast vs.
 * surface all passed. "Empty" is a deliberate neutral gray outside that
 * validated set — it's a "nothing built here" state, not a fourth identity
 * competing for hue budget.
 */
export const LAND_USE_COLORS: Record<LandUseCategory, string> = {
  empty: "#d8d8d0",
  residential: "#008300",
  commercialZoned: "#3987e5",
  jobCenter: "#9085e9",
};

export const LAND_USE_LABELS: Record<LandUseCategory, string> = {
  empty: "Empty",
  residential: "Residential",
  commercialZoned: "Commercial (zoned)",
  jobCenter: "Job center",
};

export const SELECTION_OUTLINE_COLOR = "#ffe400";
