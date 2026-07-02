import { createWorld } from "../sim/worldgen.js";
import { tick } from "../sim/tick.js";
import { inspectBusiness, inspectHousehold, inspectTile } from "../sim/inspect.js";
import type { BusinessInspection, HouseholdInspection, TileInspection } from "../sim/inspect.js";
import {
  buildJobCenter,
  investInAmenity,
  removeJobCenter,
  setTaxRate,
  unzoneTile,
  zoneCommercial,
  zoneResidential,
} from "../sim/playerActions.js";
import type { ActionResult } from "../sim/playerActions.js";
import { drawWorld, OVERLAY_LABELS } from "./draw.js";
import type { LegendInfo, OverlayMode } from "./draw.js";
import { SEQUENTIAL_HIGH, SEQUENTIAL_LOW } from "./colorScales.js";

const TILE_SIZE = 34;
const WIDTH = 16;
const HEIGHT = 16;
const TICK_INTERVAL_MS = 300;

const world = createWorld({ seed: 1, width: WIDTH, height: HEIGHT });

const canvas = document.getElementById("app") as HTMLCanvasElement;
canvas.width = WIDTH * TILE_SIZE;
canvas.height = HEIGHT * TILE_SIZE;
const ctx = canvas.getContext("2d")!;

const infoEl = document.getElementById("info")!;
const legendEl = document.getElementById("legend")!;
const feedbackEl = document.getElementById("feedback")!;
const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const stepBtn = document.getElementById("step") as HTMLButtonElement;
const taxUpBtn = document.getElementById("tax-up") as HTMLButtonElement;
const taxDownBtn = document.getElementById("tax-down") as HTMLButtonElement;

const hudTick = document.getElementById("hud-tick")!;
const hudPopulation = document.getElementById("hud-population")!;
const hudTreasury = document.getElementById("hud-treasury")!;
const hudTax = document.getElementById("hud-tax")!;
const hudOverlay = document.getElementById("hud-overlay")!;
const hudTool = document.getElementById("hud-tool")!;

type ToolName = "inspect" | "zoneResidential" | "zoneCommercial" | "buildJobCenter" | "removeJobCenter" | "unzone" | "investAmenity";

const TOOL_LABELS: Record<ToolName, string> = {
  inspect: "Inspect",
  zoneResidential: `Zone Residential ($${world.params.zoneCost})`,
  zoneCommercial: `Zone Commercial ($${world.params.zoneCost})`,
  buildJobCenter: `Build Job Center ($${world.params.buildJobCenterCost})`,
  removeJobCenter: "Remove Job Center",
  unzone: "Unzone",
  investAmenity: `Invest Amenity ($${world.params.amenityInvestmentCost})`,
};

const TOOL_ACTIONS: Partial<Record<ToolName, (tileId: string) => ActionResult>> = {
  zoneResidential: (tileId) => zoneResidential(world, tileId),
  zoneCommercial: (tileId) => zoneCommercial(world, tileId),
  buildJobCenter: (tileId) => buildJobCenter(world, tileId),
  removeJobCenter: (tileId) => removeJobCenter(world, tileId),
  unzone: (tileId) => unzoneTile(world, tileId),
  investAmenity: (tileId) => investInAmenity(world, tileId),
};

type Selection = { kind: "tile" | "household" | "business"; id: string };
let selected: Selection | null = null;
let overlay: OverlayMode = "landValue";
let tool: ToolName = "inspect";
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

/** Resolves the current selection down to a tile id so the grid can outline it, whatever kind of thing is selected. */
function resolveHighlightTileId(): string | null {
  if (!selected) return null;
  if (selected.kind === "tile") return selected.id;
  if (selected.kind === "household") {
    const h = inspectHousehold(world, selected.id);
    if (!h?.homeTile) return null;
    return world.tiles.find((t) => t.x === h.homeTile!.x && t.y === h.homeTile!.y)?.id ?? null;
  }
  const b = inspectBusiness(world, selected.id);
  if (!b) return null;
  return world.tiles.find((t) => t.x === b.tile.x && t.y === b.tile.y)?.id ?? null;
}

function renderLegend(legend: LegendInfo): void {
  if (legend.kind === "sequential") {
    legendEl.innerHTML = `
      <div class="legend-title">${legend.label}</div>
      <div class="legend-bar-row">
        <span>${legend.min.toFixed(1)}</span>
        <div class="legend-bar" style="background: linear-gradient(to right, ${SEQUENTIAL_LOW}, ${SEQUENTIAL_HIGH})"></div>
        <span>${legend.max.toFixed(1)}</span>
      </div>`;
  } else {
    legendEl.innerHTML =
      `<div class="legend-title">${legend.label}</div>` +
      legend.entries.map((e) => `<div class="legend-entry"><span class="legend-swatch" style="background:${e.color}"></span>${e.label}</div>`).join("");
  }
}

function renderHud(): void {
  hudTick.textContent = String(world.tick);
  hudPopulation.textContent = String(world.households.size);
  hudTreasury.textContent = `$${world.player.treasury.toFixed(0)}`;
  hudTax.textContent = `${(world.player.taxRate * 100).toFixed(0)}%`;
  hudOverlay.textContent = OVERLAY_LABELS[overlay];
  hudTool.textContent = TOOL_LABELS[tool];
}

function render(): void {
  const legend = drawWorld(ctx, world, { tileSize: TILE_SIZE, overlay, highlightTileId: resolveHighlightTileId() });
  renderLegend(legend);
  renderHud();
  renderInfo();
}

function setOverlay(next: OverlayMode): void {
  overlay = next;
  document.querySelectorAll<HTMLButtonElement>("#overlay-toolbar button").forEach((b) => b.classList.toggle("active", b.dataset.overlay === next));
  render();
}

function setTool(next: ToolName): void {
  tool = next;
  document.querySelectorAll<HTMLButtonElement>("#tool-toolbar button").forEach((b) => b.classList.toggle("active", b.dataset.tool === next));
  renderHud();
}

document.querySelectorAll<HTMLButtonElement>("#overlay-toolbar button").forEach((btn) => {
  btn.addEventListener("click", () => setOverlay(btn.dataset.overlay as OverlayMode));
});

document.querySelectorAll<HTMLButtonElement>("#tool-toolbar button").forEach((btn) => {
  const name = btn.dataset.tool as ToolName;
  btn.textContent = TOOL_LABELS[name];
  btn.addEventListener("click", () => setTool(name));
});

document.addEventListener("keydown", (e) => {
  if (e.key === "1") setOverlay("landValue");
  else if (e.key === "2") setOverlay("occupancy");
  else if (e.key === "3") setOverlay("congestion");
  else if (e.key === "4") setOverlay("landUse");
});

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / TILE_SIZE);
  const y = Math.floor((e.clientY - rect.top) / TILE_SIZE);
  const clickedTile = world.tiles.find((t) => t.x === x && t.y === y);
  if (!clickedTile) return;

  const action = TOOL_ACTIONS[tool];
  if (action) {
    const result = action(clickedTile.id);
    feedbackEl.textContent = result.ok ? `${TOOL_LABELS[tool]} on ${clickedTile.id}: done.` : `${TOOL_LABELS[tool]} on ${clickedTile.id}: ${result.reason}`;
    selected = { kind: "tile", id: clickedTile.id };
  } else {
    selected = { kind: "tile", id: clickedTile.id };
  }
  render();
});

infoEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const kind = target.dataset.kind as Selection["kind"] | undefined;
  const id = target.dataset.id;
  if (!kind || !id) return;
  selected = { kind, id };
  render();
});

toggleBtn.addEventListener("click", () => {
  running = !running;
  toggleBtn.textContent = running ? "Pause" : "Resume";
});

stepBtn.addEventListener("click", () => {
  tick(world);
  render();
});

taxUpBtn.addEventListener("click", () => {
  setTaxRate(world, world.player.taxRate + 0.05);
  render();
});

taxDownBtn.addEventListener("click", () => {
  setTaxRate(world, world.player.taxRate - 0.05);
  render();
});

setOverlay(overlay);
setTool(tool);

setInterval(() => {
  if (running) tick(world);
  render();
}, TICK_INTERVAL_MS);

render();
