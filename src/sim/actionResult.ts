/** Shared result shape for every player-facing action (zoning, roads, job centers, parks, tax rate). */
export type ActionResult = { ok: true } | { ok: false; reason: string };
