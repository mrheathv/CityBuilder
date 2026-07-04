import type { SimParams } from "./types.js";

export const defaultParams: SimParams = {
  // ===========================================================================
  // CHALLENGE GAME TUNABLES — tune these to make the game easier/harder.
  // Difficulty comes entirely from these economic knobs interacting with the
  // existing sim (tax base, congestion, gentrification) — there is no RNG
  // disaster mechanic. See the commit message / conversation for the
  // reasoning behind these specific values.
  // ===========================================================================

  /** Player treasury at world creation. Low on purpose — the game opens tight, not with a cushion. */
  initialTreasury: 300,
  /** Player tax rate at world creation (fraction of wage income). */
  initialTaxRate: 0.1,
  /** Cost to zone one empty tile residential or commercial. */
  zoneCost: 60,
  /** Cost to build a job center on an already-zoned, business-less commercial tile. */
  buildJobCenterCost: 220,
  /** Cost to place one park. */
  parkBuildCost: 150,
  /** Cost to build one road tile. Deliberately much cheaper per-tile than zoneCost — a real network takes dozens of tiles, not a handful of one-off actions. */
  roadBuildCost: 15,
  /**
   * Residential property tax base: taxRate * landValue * (occupied / this).
   * Tuned empirically (scripted passive/reactive playthroughs) against
   * jobCenterUpkeepPerTick below — low enough that a neglected or blindly-
   * expanding city can still genuinely go bankrupt, high enough that a
   * reasonably attentive one comfortably doesn't. Lower this to make tax
   * revenue (and therefore density) matter less; raise it to make an
   * undermanaged city's finances more forgiving.
   */
  residentialTaxUnitsPerLandValue: 2.5,
  /**
   * Charged every tick for every existing job center (business), regardless
   * of who built it or whether its jobs are filled. Lower than it was before
   * roads existed (was 5.5): roads now eat a real chunk of the map (world-
   * gen's boulevard grid alone is ~44% of tiles), so fewer tiles are ever
   * zonable/buildable at all — the same per-business cost would otherwise
   * bankrupt a passive city in ~25 ticks purely from a smaller tax base,
   * before the player could plausibly react. Tuned empirically alongside
   * jobAccessDecay below via scripted playthroughs.
   */
  jobCenterUpkeepPerTick: 3.5,
  /** Charged every tick for every existing park. */
  parkUpkeepPerTick: 4,
  /** Charged every tick per existing road tile. Kept small on purpose: world-gen's own boulevard grid seeds ~100+ road tiles, so even a small per-tile cost adds up to real money — this is the ongoing price of the network the player draws on top of it. */
  roadUpkeepPerTick: 0.08,

  /** Households the player must reach to win. */
  populationGoal: 320,
  /** Ticks allowed to reach populationGoal before it's a loss (ran out of time). */
  goalDeadlineTicks: 500,
  /** Consecutive ticks treasury must stay negative before it's a bankruptcy loss — enough runway to notice and correct course, not so much the number stops meaning anything. */
  bankruptcyGraceTicks: 20,

  // ===========================================================================
  // EMERGENT DENSITY TUNABLES — building growth/decay driven by land value.
  // See src/sim/development.ts. Growth and decay each need their own land
  // value threshold, sustain window, and occupancy condition; growThreshold
  // is kept well above decayThreshold (hysteresis) so a tile sitting in
  // between just holds its level instead of flickering.
  // ===========================================================================

  /** Housing-unit capacity per developmentLevel. Index 0 unused; 1=house, 2=low-rise, 3=mid-rise, 4=tower. */
  developmentCapacity: [0, 2, 5, 10, 20],
  /**
   * Raised from 18 (pre-road) to 28: network-routed job access reaches
   * higher absolute values than straight-line distance ever did for a
   * well-connected, close-in tile (there's no shortcut through backyards
   * anymore, but a tile right on a low-traffic road next to downtown pays
   * off more than the old formula gave it credit for). Left at the old
   * value, essentially every connected tile cleared it immediately and
   * density exploded well before the population goal meant anything.
   */
  growthLandValueThreshold: 28,
  /** Same order of magnitude as bankruptcyGraceTicks (20) — a deliberately long window so a tile needs real, sustained demand, not a lucky streak, before it grows. */
  growthSustainTicks: 20,
  /** "Near-fully occupied" — one or two vacant units out of a small building still counts as full pressure. */
  growthOccupancyThreshold: 0.85,
  /** Raised from 8 to 12 alongside growthLandValueThreshold, keeping the same proportional hysteresis gap now that the land-value scale sits higher overall. */
  decayLandValueThreshold: 12,
  /** Matches growthSustainTicks — decay is exactly as sticky as growth, so a tile can't be talked into giving up a level by one bad patch. */
  decaySustainTicks: 20,
  /** Well above targetVacancyRate (0.2) — this isn't "a bit soft," it's a building most of the city has abandoned. */
  decayVacancyThreshold: 0.5,

  // ===========================================================================
  // ROAD NETWORK TUNABLES — see src/sim/roadNetwork.ts.
  // ===========================================================================

  /** Every 5 ticks (2.5 real seconds at 1x): frequent enough to feel responsive, ~5x cheaper than every tick. Road/job-center/park edits force an immediate recompute regardless — this only governs the steady background refresh. */
  accessibilityRecomputeIntervalTicks: 5,
  /** 10 commuters roughly doubles an edge's effective travel cost (1 + 0.1*10 = 2) for the next recompute's routing — congested roads visibly get "longer," pushing new routes to spread out instead of everyone stacking onto the same shortcut. */
  congestionWeightPerCommuter: 0.1,
  /** A tile right next to a 20-commuter edge takes a landValue hit of 2 (0.1*20) — a real but not overwhelming drag, comparable in scale to a couple of amenity points. */
  congestionLandValueWeight: 0.1,

  // ===========================================================================
  // Sim physics — land value, rent, agent search behavior. Not part of the
  // difficulty tuning above; changing these changes how the underlying city
  // behaves, not just how hard the challenge is.
  // ===========================================================================

  commuteCostPerDistance: 2,
  /**
   * Lowered from 0.35 (pre-road, straight-line distance) to 0.2: network
   * distance along an actual road path is structurally longer than the
   * straight-line distance the old formula used (you can't cut through
   * blocks), so the same decay rate would crush job access almost
   * everywhere. 0.2 was found empirically (scripted playthroughs) to
   * restore a comparable overall land-value scale to before, without
   * flattening it so much that every connected tile looks equally good.
   */
  jobAccessDecay: 0.2,
  rentAdjustSpeed: 0.25,
  rentMultiplier: 0.9,
  vacancyRentDecay: 0.06,
  rentDemandRadius: 4,
  targetVacancyRate: 0.2,
  demandPressureWeight: 1.5,
  baseMoveThreshold: 3,
  immigrationRatePerTick: 1.5,
  maxSearchCandidates: 8,
  maxTicksBeforeLeaving: 12,
  maxLogEntries: 10,

  jobCenterJobSlots: 4,
  jobCenterWage: 14,
  parkStrength: 3,
  parkRadius: 2,
};
