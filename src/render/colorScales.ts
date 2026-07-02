function parseHex(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  const c = Math.max(0, Math.min(1, t));
  const r = Math.round(a.r + (b.r - a.r) * c);
  const g = Math.round(a.g + (b.g - a.g) * c);
  const bl = Math.round(a.b + (b.b - a.b) * c);
  return `rgb(${r}, ${g}, ${bl})`;
}

/**
 * One sequential ramp shared by every quantitative overlay (land value,
 * occupancy, congestion): pale -> deep amber. Once you learn "light = low,
 * dark = high" it applies everywhere you switch to, instead of a different
 * color language per mode.
 */
export const SEQUENTIAL_LOW = "#f5ecd9";
export const SEQUENTIAL_HIGH = "#9c3b12";

export function sequentialColor(t: number): string {
  return lerpColor(SEQUENTIAL_LOW, SEQUENTIAL_HIGH, t);
}

export type LandUseCategory = "empty" | "residential" | "commercialZoned" | "jobCenter";

export const LAND_USE_COLORS: Record<LandUseCategory, string> = {
  empty: "#d8d8d0",
  residential: "#4f9d5c",
  commercialZoned: "#a9c6e8",
  jobCenter: "#1f4e8c",
};

export const LAND_USE_LABELS: Record<LandUseCategory, string> = {
  empty: "Empty",
  residential: "Residential",
  commercialZoned: "Commercial (zoned)",
  jobCenter: "Job center",
};

export const SELECTION_OUTLINE_COLOR = "#ffe400";
