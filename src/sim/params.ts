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
  /** Cost per amenity investment action. */
  amenityInvestmentCost: 150,
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
  /** Charged every tick for every existing job center (business), regardless of who built it or whether its jobs are filled — city infrastructure costs money to keep running. */
  jobCenterUpkeepPerTick: 5.5,
  /** Charged every tick per point of player-invested amenity (not the world-gen baseline) — parks and plazas need upkeep too. One investment spreads amenityInvestmentAmount across every tile within amenityInvestmentRadius (13 tiles at radius 2), so this is deliberately much smaller per-point than it looks: 13 x 3 x 0.15 ≈ 5.8/tick per investment, on par with one job center. */
  amenityUpkeepPerPoint: 0.15,

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
  /** Observed land value in a mid-size city typically spans ~2-40; 18 sits around the "good, not just the single hottest tile" band — enough tiles qualify that growth reads as a spreading district, not one lucky square. */
  growthLandValueThreshold: 18,
  /** Same order of magnitude as bankruptcyGraceTicks (20) — a deliberately long window so a tile needs real, sustained demand, not a lucky streak, before it grows. */
  growthSustainTicks: 20,
  /** "Near-fully occupied" — one or two vacant units out of a small building still counts as full pressure. */
  growthOccupancyThreshold: 0.85,
  /** Well below growthLandValueThreshold (gap of 10) — the hysteresis band a mid-value tile can sit in without growing OR decaying. */
  decayLandValueThreshold: 8,
  /** Matches growthSustainTicks — decay is exactly as sticky as growth, so a tile can't be talked into giving up a level by one bad patch. */
  decaySustainTicks: 20,
  /** Well above targetVacancyRate (0.2) — this isn't "a bit soft," it's a building most of the city has abandoned. */
  decayVacancyThreshold: 0.5,

  // ===========================================================================
  // Sim physics — land value, rent, agent search behavior. Not part of the
  // difficulty tuning above; changing these changes how the underlying city
  // behaves, not just how hard the challenge is.
  // ===========================================================================

  commuteCostPerDistance: 2,
  jobAccessDecay: 0.35,
  congestionRadius: 3,
  congestionWeight: 0.8,
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
  amenityInvestmentAmount: 3,
  amenityInvestmentRadius: 2,
};
