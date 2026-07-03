import type { Rng } from "./rng.js";

export type TileUse = "empty" | "residential" | "commercial";

export interface LandValueBreakdown {
  jobAccess: number;
  amenity: number;
  congestion: number;
}

/** Why a residential tile's developmentLevel last changed — always derived from the real numbers that triggered it, never hand-authored. */
export interface DevelopmentChange {
  tick: number;
  direction: "grew" | "decayed";
  fromLevel: number;
  toLevel: number;
  reason: string;
}

export interface Tile {
  id: string;
  x: number;
  y: number;
  use: TileUse;
  /** Static baseline set once at world-gen (e.g. proximity to a park/geography feature), plus any player amenity investment. */
  amenity: number;
  /** Cumulative amenity added by investInAmenity specifically (a subset of `amenity`) — tracked separately so upkeep bills only the player-funded portion, never the world-gen baseline. */
  investedAmenity: number;
  /** Emergent, recomputed every tick from current world state. Never set directly. */
  landValue: number;
  landValueBreakdown: LandValueBreakdown;
  /** Populated only when use === 'residential'. */
  housingUnitIds: string[];
  /** Populated only when use === 'commercial'. */
  businessId: string | null;
  /**
   * Building density, meaningful only when use === 'residential': 0 for
   * non-residential tiles, 1 (house) to 4 (tower) otherwise. Housing-unit
   * capacity at each level comes from params.developmentCapacity. Never set
   * directly except by world-gen (initial level), zoneResidential (always
   * starts at 1), and src/sim/development.ts's sustained-conditions
   * growth/decay — the same "emergent, not player-placed" boundary as every
   * other agent-driven field.
   */
  developmentLevel: number;
  /** Consecutive ticks the grow conditions have all held simultaneously; resets to 0 the instant any one breaks. Sustained-condition streak, not a single good tick. */
  growthStreak: number;
  /** Consecutive ticks the decay conditions have all held; resets to 0 the instant any one breaks. */
  decayStreak: number;
  /** Null until the first growth/decay event. */
  lastDevelopmentChange: DevelopmentChange | null;
}

export interface HousingUnit {
  id: string;
  tileId: string;
  rent: number;
  occupantId: string | null;
  vacantSinceTick: number | null;
}

export interface JobSlot {
  id: string;
  businessId: string;
  wage: number;
  occupantId: string | null;
  vacantSinceTick: number | null;
}

export interface Business {
  id: string;
  tileId: string;
  jobSlotIds: string[];
}

export type MoveReason =
  | { type: "initial_placement"; rent: number }
  | { type: "found_home"; rent: number; utility: number }
  | {
      type: "priced_out";
      oldRent: number;
      newRent: number;
      oldUtility: number;
      newUtility: number;
      income: number;
    }
  | {
      type: "better_deal";
      oldRent: number;
      newRent: number;
      oldUtility: number;
      newUtility: number;
    };

export type JobChangeReason =
  | { type: "found_job"; wage: number }
  | { type: "hired"; wage: number; commuteDistance: number }
  | {
      type: "switched_job";
      oldWage: number;
      newWage: number;
      oldUtility: number;
      newUtility: number;
    };

export type HouseholdReason = MoveReason | JobChangeReason;

export interface DecisionLogEntry {
  tick: number;
  /** Human-readable one-line "why", always derived from `reason` — never hand-authored separately. */
  summary: string;
  reason: HouseholdReason;
}

export interface Household {
  id: string;
  /** Wage income per tick from current job; 0 if unemployed. */
  income: number;
  homeUnitId: string | null;
  jobSlotId: string | null;
  /** Ledger: += income - rent - commuteCost every tick. Not gated on (no eviction/bankruptcy in v1). */
  savings: number;
  /** Minimum utility gain required to bother relocating (moving friction). */
  moveThreshold: number;
  /** Bounded rationality: how many candidate units/jobs this household samples per search, not the whole map. */
  searchSampleSize: number;
  ticksUnemployed: number;
  ticksHomeless: number;
  /** Capped ring buffer, most recent last. */
  log: DecisionLogEntry[];
}

export interface SimParams {
  /** Cost per unit of Chebyshev distance between home and job, per tick. */
  commuteCostPerDistance: number;
  /** Exponential decay rate for job access contribution vs. distance. */
  jobAccessDecay: number;
  /** Radius (tiles) over which residential density contributes to a tile's congestion. */
  congestionRadius: number;
  /** Weight applied to local housing density when computing congestion drag on land value. */
  congestionWeight: number;
  /** Smoothing factor (0-1) for rent easing toward its target each tick. */
  rentAdjustSpeed: number;
  /** Scales land value into a nominal rent target. */
  rentMultiplier: number;
  /** Extra fractional rent discount applied per tick a unit sits vacant. */
  vacancyRentDecay: number;
  /** Radius (tiles) over which local vacancy rate is measured for rent demand pressure. */
  rentDemandRadius: number;
  /** Local vacancy rate considered a "healthy," neutral market (no upward/downward pressure). */
  targetVacancyRate: number;
  /** How strongly a local vacancy rate below/above target pushes rent target up/down. */
  demandPressureWeight: number;
  /** Minimum utility gain (over current) required for a household to bother relocating. */
  baseMoveThreshold: number;
  /** Expected number of new households attempting to enter per tick (Poisson-ish via RNG). */
  immigrationRatePerTick: number;
  /** How many candidate units/jobs a household samples per search instead of scanning everything. */
  maxSearchCandidates: number;
  /** Ticks a household can stay homeless or unemployed before giving up and leaving the sim. */
  maxTicksBeforeLeaving: number;
  /** Max entries kept in a household's decision log. */
  maxLogEntries: number;

  /** Player treasury at world creation. */
  initialTreasury: number;
  /** Player tax rate at world creation (fraction of wage income). */
  initialTaxRate: number;
  /** Cost to zone one empty tile residential or commercial. */
  zoneCost: number;
  /** Cost to build a job center on an already-zoned, business-less commercial tile. */
  buildJobCenterCost: number;
  /** Job slots created by a new job center. */
  jobCenterJobSlots: number;
  /** Wage paid by every slot at a new job center. */
  jobCenterWage: number;
  /** Cost per amenity investment action. */
  amenityInvestmentCost: number;
  /** Flat amenity increase applied to every tile within amenityInvestmentRadius. */
  amenityInvestmentAmount: number;
  /** Radius (tiles) an amenity investment reaches, flat (no falloff). */
  amenityInvestmentRadius: number;

  /**
   * Residential property tax is taxRate * landValue * (occupiedUnits / this).
   * A tile with exactly this many occupied units pays one full landValue
   * (the same amount a single occupied tile always paid before density
   * existed); denser tiles scale up from there, sparser tiles scale down.
   */
  residentialTaxUnitsPerLandValue: number;
  /** Charged every tick for every existing job center (business), regardless of who built it or whether its jobs are filled — city infrastructure costs money to keep running. */
  jobCenterUpkeepPerTick: number;
  /** Charged every tick per point of player-invested amenity (tile.investedAmenity), not the static world-gen baseline. */
  amenityUpkeepPerPoint: number;

  /** Households the player must reach to win. */
  populationGoal: number;
  /** Ticks allowed to reach populationGoal before it's a loss (ran out of time). */
  goalDeadlineTicks: number;
  /** Consecutive ticks treasury must stay negative before it's a bankruptcy loss. */
  bankruptcyGraceTicks: number;

  /**
   * Housing-unit capacity by developmentLevel. Index 0 is unused (developmentLevel
   * 0 means "not residential"); indices 1-4 are house / low-rise / mid-rise / tower.
   */
  developmentCapacity: number[];
  /** A residential tile must stay at or above this land value, every tick, to accumulate growthStreak. */
  growthLandValueThreshold: number;
  /** Consecutive ticks the grow conditions must all hold before a tile grows one level. */
  growthSustainTicks: number;
  /** Fraction of current-level capacity that must be occupied (>=) for growth to progress — "near-fully occupied." */
  growthOccupancyThreshold: number;
  /** A residential tile must stay at or below this land value, every tick, to accumulate decayStreak. Kept well below growthLandValueThreshold (hysteresis) so a tile can't flicker between levels. */
  decayLandValueThreshold: number;
  /** Consecutive ticks the decay conditions must all hold before a tile drops one level. */
  decaySustainTicks: number;
  /** Occupancy fraction at or below which counts as "persistent vacancy" for decay. */
  decayVacancyThreshold: number;
}

/** Player-facing city government state. Only ever touched by the player-action layer or the tax/upkeep phases, never by agent decision logic. */
export interface PlayerState {
  treasury: number;
  taxRate: number;
  /** Property tax collected this tick, kept for the HUD/leading-indicator and bankruptcy diagnostics. */
  lastTaxRevenue: number;
  /** Upkeep charged this tick, same purpose. */
  lastUpkeepCost: number;
}

export type GameStatus = "playing" | "won" | "lost";

export interface GameState {
  status: GameStatus;
  /** Human-readable, derived entirely from real numbers (never a canned string) once status !== "playing". */
  reason: string | null;
  /** Consecutive ticks treasury has stayed negative; resets to 0 the moment it isn't. */
  ticksInsolvent: number;
}

export interface HistoryPoint {
  tick: number;
  population: number;
  treasury: number;
}

export interface World {
  tick: number;
  seed: number;
  width: number;
  height: number;
  rng: Rng;
  params: SimParams;
  tiles: Tile[];
  tilesById: Map<string, Tile>;
  housingUnits: Map<string, HousingUnit>;
  jobSlots: Map<string, JobSlot>;
  businesses: Map<string, Business>;
  households: Map<string, Household>;
  nextHouseholdSeq: number;
  player: PlayerState;
  game: GameState;
  /** Rolling window of recent ticks for trend/leading-indicator display, capped at HISTORY_LENGTH. */
  history: HistoryPoint[];
}
