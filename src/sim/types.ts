import type { Rng } from "./rng.js";

export type TileUse = "empty" | "residential" | "commercial";

export interface LandValueBreakdown {
  jobAccess: number;
  amenity: number;
  congestion: number;
}

export interface Tile {
  id: string;
  x: number;
  y: number;
  use: TileUse;
  /** Static baseline set once at world-gen (e.g. proximity to a park/geography feature). Never changes. */
  amenity: number;
  /** Emergent, recomputed every tick from current world state. Never set directly. */
  landValue: number;
  landValueBreakdown: LandValueBreakdown;
  /** Populated only when use === 'residential'. */
  housingUnitIds: string[];
  /** Populated only when use === 'commercial'. */
  businessId: string | null;
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
  /** Housing units created immediately when a tile is zoned residential. */
  unitsPerResidentialZone: number;
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
}

/** Player-facing city government state. Only ever touched by the player-action layer, never by agent decision logic. */
export interface PlayerState {
  treasury: number;
  taxRate: number;
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
}
