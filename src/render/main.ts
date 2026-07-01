import { createWorld } from "../sim/worldgen.js";
import { tick } from "../sim/tick.js";
import { inspectBusiness, inspectHousehold, inspectTile } from "../sim/inspect.js";
import type { BusinessInspection, HouseholdInspection, TileInspection } from "../sim/inspect.js";
import { drawWorld } from "./draw.js";

const TILE_SIZE = 20;
const WIDTH = 28;
const HEIGHT = 28;
const TICK_INTERVAL_MS = 300;

const world = createWorld({ seed: 1, width: WIDTH, height: HEIGHT });

const canvas = document.getElementById("app") as HTMLCanvasElement;
canvas.width = WIDTH * TILE_SIZE;
canvas.height = HEIGHT * TILE_SIZE;
const ctx = canvas.getContext("2d")!;

const infoEl = document.getElementById("info")!;
const tickLabelEl = document.getElementById("tick")!;
const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const stepBtn = document.getElementById("step") as HTMLButtonElement;

type Selection = { kind: "tile" | "household" | "business"; id: string };
let selected: Selection | null = null;
let running = true;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function householdButton(id: string): string {
  return `<button data-kind="household" data-id="${id}">${id}</button>`;
}

function formatTile(t: TileInspection): string {
  const bd = t.landValueBreakdown;
  const lines = [
    `<span class="section-title">Tile ${t.id}</span>`,
    `(${t.x}, ${t.y})  use: ${t.use}`,
    ``,
    `Land value: ${t.landValue.toFixed(2)}`,
    `  job access:  ${bd.jobAccess.toFixed(2)}`,
    `  amenity:     ${bd.amenity.toFixed(2)}`,
    `  congestion: -${bd.congestion.toFixed(2)}`,
  ];
  if (t.businessId) {
    lines.push(``, `<button data-kind="business" data-id="${t.businessId}">Business ${t.businessId}</button>`);
  }
  if (t.units.length > 0) {
    lines.push(``, `<span class="section-title">Housing units (${t.units.length})</span>`);
    for (const u of t.units) {
      const occ = u.occupantHouseholdId ? householdButton(u.occupantHouseholdId) : "vacant";
      lines.push(`  rent ${u.rent.toFixed(1)} — ${occ}`);
    }
  }
  return lines.join("\n");
}

function formatBusiness(b: BusinessInspection): string {
  const lines = [
    `<span class="section-title">Business ${b.id}</span>`,
    `at (${b.tile.x}, ${b.tile.y})`,
    ``,
    `<span class="section-title">Jobs (${b.jobs.length})</span>`,
  ];
  for (const j of b.jobs) {
    const occ = j.occupantHouseholdId ? householdButton(j.occupantHouseholdId) : "vacant";
    lines.push(`  wage ${j.wage.toFixed(1)} — ${occ}`);
  }
  return lines.join("\n");
}

function formatHousehold(h: HouseholdInspection): string {
  const lines = [
    `<span class="section-title">Household ${h.id}</span>`,
    ``,
    `Home: ${h.homeTile ? `(${h.homeTile.x}, ${h.homeTile.y}) at rent ${h.rent!.toFixed(1)}` : "homeless"}`,
    `Job:  ${h.jobTile ? `(${h.jobTile.x}, ${h.jobTile.y}) paying ${h.wage!.toFixed(1)}/tick` : "unemployed"}`,
    `Commute cost: ${h.commuteCost.toFixed(1)}`,
    `Net utility:  ${h.utility.toFixed(1)}`,
    `Savings: ${h.savings.toFixed(1)}`,
    ``,
    `<span class="section-title">Why it's here — recent decisions</span>`,
  ];
  if (h.recentDecisions.length === 0) {
    lines.push("  (no decisions logged yet)");
  }
  for (const d of h.recentDecisions) {
    lines.push(`  t${d.tick}: ${escapeHtml(d.summary)}`);
  }
  return lines.join("\n");
}

function renderInfo(): void {
  if (!selected) {
    infoEl.innerHTML = "Click a tile to inspect it.";
    return;
  }
  if (selected.kind === "tile") {
    const inspection = inspectTile(world, selected.id);
    infoEl.innerHTML = inspection ? formatTile(inspection) : "Tile not found.";
  } else if (selected.kind === "business") {
    const inspection = inspectBusiness(world, selected.id);
    infoEl.innerHTML = inspection ? formatBusiness(inspection) : "Business not found.";
  } else {
    const inspection = inspectHousehold(world, selected.id);
    infoEl.innerHTML = inspection ? formatHousehold(inspection) : "Household no longer in the simulation (it may have left the city).";
  }
}

function render(): void {
  drawWorld(ctx, world, { tileSize: TILE_SIZE });
  tickLabelEl.textContent = `Tick ${world.tick} — ${world.households.size} households`;
  renderInfo();
}

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / TILE_SIZE);
  const y = Math.floor((e.clientY - rect.top) / TILE_SIZE);
  const tile = world.tiles.find((t) => t.x === x && t.y === y);
  if (!tile) return;
  selected = { kind: "tile", id: tile.id };
  renderInfo();
});

infoEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const kind = target.dataset.kind as Selection["kind"] | undefined;
  const id = target.dataset.id;
  if (!kind || !id) return;
  selected = { kind, id };
  renderInfo();
});

toggleBtn.addEventListener("click", () => {
  running = !running;
  toggleBtn.textContent = running ? "Pause" : "Resume";
});

stepBtn.addEventListener("click", () => {
  tick(world);
  render();
});

setInterval(() => {
  if (running) tick(world);
  render();
}, TICK_INTERVAL_MS);

render();
