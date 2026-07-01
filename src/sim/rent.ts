import { distance } from "./geometry.js";
import type { World } from "./types.js";

/**
 * Eases every unit's rent toward a target, with extra decay while vacant (a
 * landlord dropping the ask to attract a tenant).
 *
 * The target is landValue * rentMultiplier (location value: job access +
 * amenity - congestion), adjusted by local *vacancy* rate: a neighborhood
 * with few nearby vacancies pushes rent up beyond what location alone
 * explains, one with lots of vacancies pushes it down. This is the direct
 * "scarce desirable housing gets expensive" mechanic — location sets the
 * baseline, scarcity moves you off it. Land value's congestion term is a
 * separate, opposing effect (crowding is a real negative, not what creates
 * scarcity value), so the two don't fight for the same job.
 */
export function updateRents(world: World): void {
  const { housingUnits, tilesById, params, tiles } = world;

  const residentialTiles = tiles.filter((t) => t.use === "residential");
  const vacancyRateByTile = new Map<string, number>();
  for (const tile of residentialTiles) {
    let total = 0;
    let vacant = 0;
    for (const other of residentialTiles) {
      if (distance(tile.x, tile.y, other.x, other.y) > params.rentDemandRadius) continue;
      for (const unitId of other.housingUnitIds) {
        total++;
        if (housingUnits.get(unitId)!.occupantId === null) vacant++;
      }
    }
    vacancyRateByTile.set(tile.id, total > 0 ? vacant / total : params.targetVacancyRate);
  }

  for (const unit of housingUnits.values()) {
    const tile = tilesById.get(unit.tileId)!;
    const vacancyRate = vacancyRateByTile.get(tile.id) ?? params.targetVacancyRate;
    const demandPressure = (params.targetVacancyRate - vacancyRate) * params.demandPressureWeight;
    const target = tile.landValue * params.rentMultiplier * (1 + demandPressure);

    let next = unit.rent + params.rentAdjustSpeed * (target - unit.rent);
    if (unit.occupantId === null) {
      next *= 1 - params.vacancyRentDecay;
    }
    unit.rent = Math.max(0, next);
  }
}
