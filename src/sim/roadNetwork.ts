import { tileIndex } from "./geometry.js";
import type { NetworkCache, Tile, World } from "./types.js";

/**
 * All accessibility now routes through this module: a tile's job access is
 * reachability of job centers THROUGH the player-built road network, not
 * straight-line distance. Recomputing this is the one expensive step in the
 * tick pipeline (one Dijkstra run per business), so it's cached here and
 * only rebuilt periodically (maybeRecomputeNetwork) rather than every tick —
 * see params.accessibilityRecomputeIntervalTicks.
 */

const INFINITY = Number.POSITIVE_INFINITY;

/** Canonical, direction-independent key for an edge between two tile indices. */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function createEmptyNetworkCache(numTiles: number): NetworkCache {
  return {
    lastRecomputeTick: -1,
    businessDistance: new Map(),
    businessPredecessor: new Map(),
    jobAccessByTile: new Float64Array(numTiles),
    congestionByTile: new Float64Array(numTiles),
    edgeCongestion: new Map(),
    connectedByTile: new Uint8Array(numTiles),
  };
}

function buildTilesByIndex(world: World): Tile[] {
  const arr: Tile[] = new Array(world.width * world.height);
  for (const tile of world.tiles) {
    arr[tileIndex(world.width, tile.x, tile.y)] = tile;
  }
  return arr;
}

/**
 * Strict adjacency: an edge exists between two orthogonally-adjacent tiles
 * only if at least one of them is a road tile. Two buildings sitting right
 * next to each other with no road between them are NOT connected — the
 * player's drawn skeleton is what actually links the city, not proximity.
 */
function buildAdjacency(world: World, tilesByIndex: Tile[]): number[][] {
  const { width, height } = world;
  const numTiles = width * height;
  const neighbors: number[][] = Array.from({ length: numTiles }, () => []);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = tileIndex(width, x, y);
      const tile = tilesByIndex[i]!;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const j = tileIndex(width, nx, ny);
        const neighborTile = tilesByIndex[j]!;
        if (tile.use === "road" || neighborTile.use === "road") {
          neighbors[i]!.push(j);
          neighbors[j]!.push(i);
        }
      }
    }
  }
  return neighbors;
}

/**
 * Plain O(V^2 + E) Dijkstra — no priority queue. At this grid scale (a few
 * hundred tiles) that's a few tens of thousands of operations per run, and
 * we run it once per business (a few dozen), so a heap would be needless
 * complexity for no measurable benefit here.
 */
function dijkstra(numTiles: number, source: number, neighbors: number[][], edgeWeight: (i: number, j: number) => number): { dist: Float64Array; prev: Int32Array } {
  const dist = new Float64Array(numTiles).fill(INFINITY);
  const prev = new Int32Array(numTiles).fill(-1);
  dist[source] = 0;

  const visited = new Uint8Array(numTiles);
  for (let iter = 0; iter < numTiles; iter++) {
    let u = -1;
    let best = INFINITY;
    for (let k = 0; k < numTiles; k++) {
      if (!visited[k] && dist[k]! < best) {
        best = dist[k]!;
        u = k;
      }
    }
    if (u === -1) break; // everything remaining is unreachable
    visited[u] = 1;
    for (const v of neighbors[u]!) {
      if (visited[v]) continue;
      const alt = dist[u]! + edgeWeight(u, v);
      if (alt < dist[v]!) {
        dist[v] = alt;
        prev[v] = u;
      }
    }
  }
  return { dist, prev };
}

/**
 * Unconditional full rebuild: adjacency graph from current road tiles, one
 * Dijkstra per business (giving that business's network distance to every
 * tile plus a predecessor chain for path reconstruction), job access summed
 * exactly like the old distance-based formula but with network distance,
 * and edge congestion from actually routing every employed household along
 * its business's cached shortest path. Always replaces every cache field
 * together — never a partial update.
 */
export function recomputeNetwork(world: World): void {
  const { width, height, businesses, jobSlots } = world;
  const numTiles = width * height;
  const tilesByIndex = buildTilesByIndex(world);
  const neighbors = buildAdjacency(world, tilesByIndex);

  // This cycle's routing is weighted by LAST cycle's congestion — congested
  // edges get "longer," so routes drift away from them over successive
  // recomputes instead of every commuter piling onto the same shortcut.
  const prevEdgeCongestion = world.network.edgeCongestion;
  const edgeWeight = (i: number, j: number): number => 1 + world.params.congestionWeightPerCommuter * (prevEdgeCongestion.get(edgeKey(i, j)) ?? 0);

  const businessDistance = new Map<string, Float64Array>();
  const businessPredecessor = new Map<string, Int32Array>();
  const businessSourceIndex = new Map<string, number>();

  for (const business of businesses.values()) {
    const tile = world.tilesById.get(business.tileId)!;
    const source = tileIndex(width, tile.x, tile.y);
    const { dist, prev } = dijkstra(numTiles, source, neighbors, edgeWeight);
    businessDistance.set(business.id, dist);
    businessPredecessor.set(business.id, prev);
    businessSourceIndex.set(business.id, source);
  }

  const jobAccessByTile = new Float64Array(numTiles);
  const connectedByTile = new Uint8Array(numTiles);
  for (const business of businesses.values()) {
    let totalWage = 0;
    for (const jobId of business.jobSlotIds) totalWage += jobSlots.get(jobId)!.wage;
    const dist = businessDistance.get(business.id)!;
    for (let i = 0; i < numTiles; i++) {
      const d = dist[i]!;
      if (d === INFINITY) continue;
      jobAccessByTile[i]! += totalWage * Math.exp(-world.params.jobAccessDecay * d);
      connectedByTile[i] = 1;
    }
  }
  for (let i = 0; i < numTiles; i++) jobAccessByTile[i]! *= 0.1; // same scaling constant landValue.ts always used

  // Route every currently-employed household along its business's cached
  // shortest path, counting commuters per edge — this is what "congestion
  // accumulates on the specific road segments they travel" means concretely.
  const edgeCongestion = new Map<string, number>();
  for (const household of world.households.values()) {
    if (!household.jobSlotId || !household.homeUnitId) continue;
    const job = jobSlots.get(household.jobSlotId)!;
    const homeUnit = world.housingUnits.get(household.homeUnitId)!;
    const homeTile = world.tilesById.get(homeUnit.tileId)!;
    const dist = businessDistance.get(job.businessId);
    const prev = businessPredecessor.get(job.businessId);
    const sourceIndex = businessSourceIndex.get(job.businessId);
    if (!dist || !prev || sourceIndex === undefined) continue;

    let cur = tileIndex(width, homeTile.x, homeTile.y);
    if (dist[cur] === INFINITY) continue; // no path to walk

    let steps = 0;
    while (cur !== sourceIndex && steps < numTiles) {
      const next = prev[cur]!;
      if (next === -1) break;
      const key = edgeKey(cur, next);
      edgeCongestion.set(key, (edgeCongestion.get(key) ?? 0) + 1);
      cur = next;
      steps++;
    }
  }

  // Per-tile "congestion at my doorstep": the worst directly-adjacent edge,
  // not a diffuse radius — a real traffic jam right outside is what should
  // drag land value down, not density three tiles away.
  const congestionByTile = new Float64Array(numTiles);
  for (let i = 0; i < numTiles; i++) {
    let worst = 0;
    for (const j of neighbors[i]!) {
      const c = edgeCongestion.get(edgeKey(i, j)) ?? 0;
      if (c > worst) worst = c;
    }
    congestionByTile[i] = worst * world.params.congestionLandValueWeight;
  }

  world.network = {
    lastRecomputeTick: world.tick,
    businessDistance,
    businessPredecessor,
    jobAccessByTile,
    congestionByTile,
    edgeCongestion,
    connectedByTile,
  };
}

/**
 * Cadence-gated wrapper: recomputes on the periodic interval OR immediately
 * if accessibilityDirty (set by buildRoad/removeRoad/buildJobCenter/
 * removeJobCenter), whichever comes first. Purely a function of world.tick
 * and the dirty flag, so it stays deterministic regardless of playback
 * speed — this is the only thing tick.ts should call during normal play.
 */
export function maybeRecomputeNetwork(world: World): void {
  const due = world.tick % world.params.accessibilityRecomputeIntervalTicks === 0;
  if (world.accessibilityDirty || due) {
    recomputeNetwork(world);
    world.accessibilityDirty = false;
  }
}

/** Network distance from `tile` to the business at `businessId`, per the last recompute. Infinity if disconnected. */
export function networkDistanceToBusiness(world: World, tile: Tile, businessId: string): number {
  const dist = world.network.businessDistance.get(businessId);
  if (!dist) return INFINITY;
  return dist[tileIndex(world.width, tile.x, tile.y)] ?? INFINITY;
}

/** The closest business `tile` can reach through the network, and how far — for inspect's "why" explanation. Null if disconnected from every business. */
export function nearestJobCenter(world: World, tile: Tile): { businessId: string; networkDistance: number } | null {
  const i = tileIndex(world.width, tile.x, tile.y);
  let best: { businessId: string; networkDistance: number } | null = null;
  for (const [businessId, dist] of world.network.businessDistance) {
    const d = dist[i]!;
    if (d === INFINITY) continue;
    if (!best || d < best.networkDistance) best = { businessId, networkDistance: d };
  }
  return best;
}

export { edgeKey };
