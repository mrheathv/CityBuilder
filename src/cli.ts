import { createWorld } from "./sim/worldgen.js";
import { tick } from "./sim/tick.js";
import { inspectHousehold, inspectTile } from "./sim/inspect.js";

/**
 * Headless CLI runner: no canvas, no rendering deps, just the sim. Proves
 * the sim can run and be inspected without a UI.
 *
 * Usage: npm run sim -- --seed 1 --width 20 --height 20 --ticks 100 [--household h-3] [--tile t-5-5]
 */
function parseArgs(argv: string[]): Record<string, string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    opts[arg.slice(2)] = argv[i + 1] ?? "";
    i++;
  }
  return opts;
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

const opts = parseArgs(process.argv.slice(2));
const seed = Number(opts.seed ?? 1);
const width = Number(opts.width ?? 20);
const height = Number(opts.height ?? 20);
const ticks = Number(opts.ticks ?? 100);

const world = createWorld({ seed, width, height });
console.log(`Seed ${seed}, ${width}x${height} grid, running ${ticks} ticks...\n`);

for (let i = 0; i < ticks; i++) tick(world);

const households = Array.from(world.households.values());
const employed = households.filter((h) => h.jobSlotId !== null).length;
const homed = households.filter((h) => h.homeUnitId !== null).length;
const units = Array.from(world.housingUnits.values());
const occupiedUnits = units.filter((u) => u.occupantId !== null).length;

console.log(`Tick: ${world.tick}`);
console.log(`Households: ${households.length} (employed ${employed}, homed ${homed})`);
console.log(`Housing occupancy: ${occupiedUnits}/${units.length} (${((100 * occupiedUnits) / units.length).toFixed(1)}%)`);
console.log(`Avg rent: ${average(units.map((u) => u.rent)).toFixed(2)}`);
console.log(`Avg land value: ${average(world.tiles.map((t) => t.landValue)).toFixed(2)}`);

console.log("\nTop 5 land value tiles:");
for (const t of [...world.tiles].sort((a, b) => b.landValue - a.landValue).slice(0, 5)) {
  const bd = t.landValueBreakdown;
  console.log(
    `  (${t.x},${t.y}) [${t.use}] landValue=${t.landValue.toFixed(2)} (jobAccess=${bd.jobAccess.toFixed(2)} amenity=${bd.amenity.toFixed(2)} congestion=${bd.congestion.toFixed(2)})`,
  );
}

if (opts.household) {
  const inspection = inspectHousehold(world, opts.household);
  console.log(`\nHousehold ${opts.household}:`);
  console.log(inspection ? JSON.stringify(inspection, null, 2) : "  not found");
}

if (opts.tile) {
  const inspection = inspectTile(world, opts.tile);
  console.log(`\nTile ${opts.tile}:`);
  console.log(inspection ? JSON.stringify(inspection, null, 2) : "  not found");
}
