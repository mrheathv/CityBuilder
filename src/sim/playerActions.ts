import { distance } from "./geometry.js";
import type { Business, HousingUnit, JobSlot, World } from "./types.js";

export type ActionResult = { ok: true } | { ok: false; reason: string };

/**
 * Every function in this file is the *entire* surface the player touches.
 * None of them ever set occupantId, homeUnitId, or jobSlotId — they only
 * create empty capacity (units/jobs), change what a tile is zoned for, bump
 * a tile's amenity, or move money. Whether anyone ever moves into what gets
 * built here is decided exclusively by the existing agent search/relocation
 * logic on the next tick.
 */

function spend(world: World, cost: number): ActionResult | null {
  if (world.player.treasury < cost) {
    return { ok: false, reason: `insufficient treasury: need ${cost}, have ${world.player.treasury.toFixed(0)}` };
  }
  world.player.treasury -= cost;
  return null;
}

export function zoneResidential(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "empty") return { ok: false, reason: "tile is not empty" };

  const insufficientFunds = spend(world, world.params.zoneCost);
  if (insufficientFunds) return insufficientFunds;

  tile.use = "residential";
  for (let i = 0; i < world.params.unitsPerResidentialZone; i++) {
    const unit: HousingUnit = {
      id: `hu-${tile.id}-${i}`,
      tileId: tile.id,
      rent: tile.landValue * world.params.rentMultiplier,
      occupantId: null,
      vacantSinceTick: world.tick,
    };
    world.housingUnits.set(unit.id, unit);
    tile.housingUnitIds.push(unit.id);
  }
  return { ok: true };
}

export function zoneCommercial(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "empty") return { ok: false, reason: "tile is not empty" };

  const insufficientFunds = spend(world, world.params.zoneCost);
  if (insufficientFunds) return insufficientFunds;

  tile.use = "commercial";
  return { ok: true };
}

export function buildJobCenter(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use !== "commercial") return { ok: false, reason: "tile is not zoned commercial" };
  if (tile.businessId) return { ok: false, reason: "tile already has a job center" };

  const insufficientFunds = spend(world, world.params.buildJobCenterCost);
  if (insufficientFunds) return insufficientFunds;

  const businessId = `biz-${tile.id}`;
  const jobSlotIds: string[] = [];
  for (let i = 0; i < world.params.jobCenterJobSlots; i++) {
    const jobId = `js-${businessId}-${i}`;
    const job: JobSlot = { id: jobId, businessId, wage: world.params.jobCenterWage, occupantId: null, vacantSinceTick: world.tick };
    world.jobSlots.set(jobId, job);
    jobSlotIds.push(jobId);
  }
  const business: Business = { id: businessId, tileId: tile.id, jobSlotIds };
  world.businesses.set(businessId, business);
  tile.businessId = businessId;
  return { ok: true };
}

/** Bulldoze a job center. Only allowed once every job slot is vacant — you can't demolish an active employer out from under its workers. */
export function removeJobCenter(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (!tile.businessId) return { ok: false, reason: "no job center on this tile" };

  const business = world.businesses.get(tile.businessId)!;
  const filled = business.jobSlotIds.filter((id) => world.jobSlots.get(id)!.occupantId !== null).length;
  if (filled > 0) return { ok: false, reason: `cannot remove: ${filled} job(s) still filled` };

  for (const jobId of business.jobSlotIds) world.jobSlots.delete(jobId);
  world.businesses.delete(business.id);
  tile.businessId = null;
  return { ok: true };
}

/** Unzone a tile back to empty. Only allowed once it holds no occupied units and no job center — you can't bulldoze someone's home or an active business. */
export function unzoneTile(world: World, tileId: string): ActionResult {
  const tile = world.tilesById.get(tileId);
  if (!tile) return { ok: false, reason: "tile not found" };
  if (tile.use === "empty") return { ok: false, reason: "tile is already empty" };

  if (tile.use === "commercial" && tile.businessId) {
    return { ok: false, reason: "remove the job center first" };
  }

  if (tile.use === "residential") {
    const occupied = tile.housingUnitIds.filter((id) => world.housingUnits.get(id)!.occupantId !== null).length;
    if (occupied > 0) return { ok: false, reason: `cannot unzone: ${occupied} unit(s) still occupied` };
    for (const unitId of tile.housingUnitIds) world.housingUnits.delete(unitId);
    tile.housingUnitIds = [];
  }

  tile.use = "empty";
  return { ok: true };
}

export function investInAmenity(world: World, tileId: string): ActionResult {
  const center = world.tilesById.get(tileId);
  if (!center) return { ok: false, reason: "tile not found" };

  const insufficientFunds = spend(world, world.params.amenityInvestmentCost);
  if (insufficientFunds) return insufficientFunds;

  for (const tile of world.tiles) {
    if (distance(center.x, center.y, tile.x, tile.y) <= world.params.amenityInvestmentRadius) {
      tile.amenity += world.params.amenityInvestmentAmount;
    }
  }
  return { ok: true };
}

/** No cost — a policy choice, not a purchase. Clamped to a sane range so income tax can never go negative or exceed 100%. */
export function setTaxRate(world: World, rate: number): ActionResult {
  world.player.taxRate = Math.max(0, Math.min(1, rate));
  return { ok: true };
}
