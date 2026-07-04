import { createWorld } from "../sim/worldgen.js";
import { tick } from "../sim/tick.js";
import { inspectBusiness, inspectHousehold, inspectTile } from "../sim/inspect.js";
import type { BusinessInspection, HouseholdInspection, TileInspection } from "../sim/inspect.js";
import {
  buildJobCenter,
  buildRoad,
  removeJobCenter,
  removeRoad,
  setTaxRate,
  unzoneTile,
  zoneCommercial,
  zoneResidential,
} from "../sim/playerActions.js";
import { buildAmenity, removeAmenity } from "../sim/amenity.js";
import type { ActionResult } from "../sim/playerActions.js";
import { OVERLAY_LABELS } from "./overlayData.js";
import type { LegendInfo, OverlayMode } from "./overlayData.js";
import { sequentialGradientCss } from "./colorScales.js";
import { createTileGrid } from "./pixiTileGrid.js";

const TILE_SIZE = 34;
const WIDTH = 16;
const HEIGHT = 16;

/** 1x = 2 ticks/sec, tuned so changes are actually watchable propagating through the fields instead of flashing by. */
const BASE_TICKS_PER_SECOND = 2;
/** Safety valve: if the tab was backgrounded/throttled, don't burn through a huge backlog of ticks in one frame. */
const MAX_CATCHUP_TICKS_PER_FRAME = 10;

/**
 * Everything lives inside this async entry point rather than at module top
 * level. createTileGrid() needs to await PixiJS's async app.init(), and a
 * top-level await compiles fine in dev (native ESM) but esbuild's default
 * production target (chrome87/es2020/etc, set by Vite) doesn't support
 * top-level await and fails the build — this is the one shape that works
 * in both.
 */
async function main(): Promise<void> {
  const world = createWorld({ seed: 1, width: WIDTH, height: HEIGHT });

  const canvas = document.getElementById("app") as HTMLCanvasElement;
  const tileGrid = await createTileGrid(canvas, world, { tileSize: TILE_SIZE });

  const infoEl = document.getElementById("info")!;
  const infoContentEl = document.getElementById("info-content")!;
  const infoCloseBtn = document.getElementById("info-close") as HTMLButtonElement;
  const infoBackdrop = document.getElementById("info-backdrop")!;
  const legendEl = document.getElementById("legend")!;
  const feedbackEl = document.getElementById("feedback")!;
  const stepBtn = document.getElementById("step") as HTMLButtonElement;
  const taxUpBtn = document.getElementById("tax-up") as HTMLButtonElement;
  const taxDownBtn = document.getElementById("tax-down") as HTMLButtonElement;
  const hudMenuToggle = document.getElementById("hud-menu-toggle") as HTMLButtonElement;
  const hudSecondaryPanel = document.getElementById("hud-secondary-panel")!;

  const hudTick = document.getElementById("hud-tick")!;
  const hudPopulation = document.getElementById("hud-population")!;
  const hudPopulationGoal = document.getElementById("hud-population-goal")!;
  const hudPopulationTrend = document.getElementById("hud-population-trend")!;
  const hudTreasury = document.getElementById("hud-treasury")!;
  const hudTreasuryTrend = document.getElementById("hud-treasury-trend")!;
  const hudTax = document.getElementById("hud-tax")!;
  const hudOverlay = document.getElementById("hud-overlay")!;
  const hudTool = document.getElementById("hud-tool")!;
  const hudSpeed = document.getElementById("hud-speed")!;

  const gameOverOverlay = document.getElementById("game-over-overlay")!;
  const gameOverTitle = document.getElementById("game-over-title")!;
  const gameOverReason = document.getElementById("game-over-reason")!;
  const gameOverStats = document.getElementById("game-over-stats")!;

  type ToolName =
    | "inspect"
    | "zoneResidential"
    | "zoneCommercial"
    | "buildJobCenter"
    | "removeJobCenter"
    | "unzone"
    | "buildRoad"
    | "removeRoad"
    | "buildAmenity"
    | "removeAmenity";

  const TOOL_LABELS: Record<ToolName, string> = {
    inspect: "Inspect",
    zoneResidential: `Zone Residential ($${world.params.zoneCost})`,
    zoneCommercial: `Zone Commercial ($${world.params.zoneCost})`,
    buildJobCenter: `Build Job Center ($${world.params.buildJobCenterCost})`,
    removeJobCenter: "Remove Job Center",
    unzone: "Unzone",
    buildRoad: `Build Road ($${world.params.roadBuildCost})`,
    removeRoad: "Remove Road",
    buildAmenity: `Build Park ($${world.params.parkBuildCost})`,
    removeAmenity: "Remove Park",
  };

  const TOOL_ACTIONS: Partial<Record<ToolName, (tileId: string) => ActionResult>> = {
    zoneResidential: (tileId) => zoneResidential(world, tileId),
    zoneCommercial: (tileId) => zoneCommercial(world, tileId),
    buildJobCenter: (tileId) => buildJobCenter(world, tileId),
    removeJobCenter: (tileId) => removeJobCenter(world, tileId),
    unzone: (tileId) => unzoneTile(world, tileId),
    buildRoad: (tileId) => buildRoad(world, tileId),
    removeRoad: (tileId) => removeRoad(world, tileId),
    buildAmenity: (tileId) => buildAmenity(world, tileId),
    removeAmenity: (tileId) => removeAmenity(world, tileId),
  };

  type Speed = 0 | 1 | 2 | 4;
  const SPEED_LABELS: Record<Speed, string> = { 0: "Paused", 1: "1x", 2: "2x", 4: "4x" };

  type Selection = { kind: "tile" | "household" | "business"; id: string };
  let selected: Selection | null = null;
  // Decoupled from `selected`: on the mobile bottom-sheet layout, a build/zone
  // tap should update the panel's data without popping it open over the
  // canvas (that would interrupt rapid zoning) — only an Inspect-tool tap or
  // drilling into a household/business from inside the sheet opens it. Has
  // no effect on desktop, where #info is always visible inline regardless.
  let infoSheetOpen = false;
  let overlay: OverlayMode = "landValue";
  let tool: ToolName = "inspect";
  let speed: Speed = 1;
  let lastFrameTime: number | null = null;
  let accumulatorMs = 0;

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  }

  function householdButton(id: string): string {
    return `<button data-kind="household" data-id="${id}">${id}</button>`;
  }

  const DEVELOPMENT_LABELS: Record<number, string> = { 0: "—", 1: "house", 2: "low-rise", 3: "mid-rise", 4: "tower" };

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
      ``,
    ];
    if (!t.connected) {
      lines.push(`<span class="section-title">Network: not connected</span>`, `  no road links this tile to any job center — job access is 0 until it's connected.`);
    } else if (t.nearestJobCenter) {
      const nj = t.nearestJobCenter;
      lines.push(
        `<span class="section-title">Network: connected</span>`,
        `  nearest job center ${nj.businessId}: ${nj.networkDistance.toFixed(1)} tiles by road (${nj.straightLineDistance} tiles straight-line)`,
      );
    }
    if (t.nearbyParks.length > 0) {
      lines.push(``, `<span class="section-title">Nearby parks (${t.nearbyParks.length})</span>`);
      for (const p of t.nearbyParks) {
        lines.push(`  ${p.id}: ${p.distance} tiles away, +${p.strength.toFixed(1)} amenity`);
      }
    }
    if (t.use === "residential") {
      const label = DEVELOPMENT_LABELS[t.developmentLevel] ?? String(t.developmentLevel);
      lines.push(``, `<span class="section-title">Development: level ${t.developmentLevel} (${label}), capacity ${t.developmentCapacity}</span>`);
      if (t.growthStreak > 0) {
        lines.push(`  growing: ${t.growthStreak} tick(s) of sustained conditions toward the next level`);
      } else if (t.decayStreak > 0) {
        lines.push(`  decaying: ${t.decayStreak} tick(s) of sustained low value/vacancy toward losing a level`);
      }
      if (t.lastDevelopmentChange) {
        const c = t.lastDevelopmentChange;
        lines.push(`  last change (tick ${c.tick}, ${c.direction} ${c.fromLevel}→${c.toLevel}): ${c.reason}`);
      }
    }
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
    infoEl.classList.toggle("open", infoSheetOpen);

    if (!selected) {
      infoContentEl.innerHTML = "Click a tile to inspect it.";
      return;
    }
    if (selected.kind === "tile") {
      const inspection = inspectTile(world, selected.id);
      infoContentEl.innerHTML = inspection ? formatTile(inspection) : "Tile not found.";
    } else if (selected.kind === "business") {
      const inspection = inspectBusiness(world, selected.id);
      infoContentEl.innerHTML = inspection ? formatBusiness(inspection) : "Business not found.";
    } else {
      const inspection = inspectHousehold(world, selected.id);
      infoContentEl.innerHTML = inspection ? formatHousehold(inspection) : "Household no longer in the simulation (it may have left the city).";
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
          <div class="legend-bar" style="background: ${sequentialGradientCss()}"></div>
          <span>${legend.max.toFixed(1)}</span>
        </div>`;
    } else {
      legendEl.innerHTML =
        `<div class="legend-title">${legend.label}</div>` +
        legend.entries.map((e) => `<div class="legend-entry"><span class="legend-swatch" style="background:${e.color}"></span>${e.label}</div>`).join("");
    }
  }

  /** How many recent ticks the up/down arrow + delta number covers — the sparkline itself shows the fuller history buffer for context. */
  const TREND_WINDOW_TICKS = 10;

  function sparklineSvg(values: number[]): string {
    const width = 64;
    const height = 18;
    if (values.length < 2) return `<svg width="${width}" height="${height}" class="sparkline"></svg>`;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const points = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * width;
        const y = height - ((v - min) / span) * (height - 2) - 1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const last = values[values.length - 1]!;
    const first = values[0]!;
    const stroke = last > first ? "#7fd17f" : last < first ? "#e07b7b" : "#888";
    return `<svg width="${width}" height="${height}" class="sparkline"><polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.5" /></svg>`;
  }

  function trendArrowHtml(delta: number): string {
    if (delta > 0) return `<span class="trend-text trend-up">▲+${delta.toFixed(0)}</span>`;
    if (delta < 0) return `<span class="trend-text trend-down">▼${delta.toFixed(0)}</span>`;
    return `<span class="trend-text trend-flat">→0</span>`;
  }

  /** "Change over the last ~10 ticks," shown as an arrow+delta, plus a sparkline over the fuller history buffer so a brewing spiral is visible before it's fatal. */
  function renderTrend(el: HTMLElement, allValues: number[]): void {
    const recent = allValues.slice(-TREND_WINDOW_TICKS);
    const delta = recent.length >= 2 ? recent[recent.length - 1]! - recent[0]! : 0;
    el.innerHTML = `${trendArrowHtml(delta)}${sparklineSvg(allValues)}`;
  }

  function renderHud(): void {
    hudTick.textContent = String(world.tick);
    hudPopulation.textContent = String(world.households.size);
    hudPopulationGoal.textContent = String(world.params.populationGoal);
    hudTreasury.textContent = `$${world.player.treasury.toFixed(0)}`;
    hudTax.textContent = `${(world.player.taxRate * 100).toFixed(0)}%`;
    hudOverlay.textContent = OVERLAY_LABELS[overlay];
    hudTool.textContent = TOOL_LABELS[tool];
    hudSpeed.textContent = SPEED_LABELS[speed];
    renderTrend(hudPopulationTrend, world.history.map((h) => h.population));
    renderTrend(hudTreasuryTrend, world.history.map((h) => h.treasury));
  }

  function renderGameOver(): void {
    if (world.game.status === "playing") {
      gameOverOverlay.classList.remove("visible");
      return;
    }
    gameOverOverlay.classList.add("visible");
    gameOverTitle.textContent = world.game.status === "won" ? "Victory!" : "Game Over";
    gameOverTitle.className = world.game.status;
    gameOverReason.textContent = world.game.reason ?? "";
    gameOverStats.innerHTML = `
      <span>Tick</span><span class="value">${world.tick}</span>
      <span>Population</span><span class="value">${world.households.size} / ${world.params.populationGoal}</span>
      <span>Treasury</span><span class="value">$${world.player.treasury.toFixed(0)}</span>
      <span>Tax rate</span><span class="value">${(world.player.taxRate * 100).toFixed(0)}%</span>
    `;
  }

  function render(nowMs: number = performance.now()): void {
    const legend = tileGrid.update(world, overlay, resolveHighlightTileId(), nowMs);
    renderLegend(legend);
    renderHud();
    renderInfo();
    renderGameOver();
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

  function setSpeed(next: Speed): void {
    speed = next;
    // Discard any banked partial-tick backlog so switching speeds never produces
    // a burst of extra ticks reinterpreted at the new (possibly faster) rate.
    accumulatorMs = 0;
    document.querySelectorAll<HTMLButtonElement>("#speed-controls button[data-speed]").forEach((b) => b.classList.toggle("active", Number(b.dataset.speed) === next));
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
    else if (e.key === "5") setOverlay("density");
    else if (e.key === "6") setOverlay("roads");
  });

  canvas.addEventListener("click", (e) => {
    // rect is the CSS-displayed size, which can differ from the canvas's
    // internal pixel resolution (canvas.width/height) once CSS scales it down
    // to fit a narrow/mobile viewport — scale the tap position back into
    // canvas-pixel space before dividing into tiles, or taps would land on
    // the wrong tile on any screen where the canvas isn't shown 1:1.
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor(((e.clientX - rect.left) * scaleX) / TILE_SIZE);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / TILE_SIZE);
    const clickedTile = world.tiles.find((t) => t.x === x && t.y === y);
    if (!clickedTile) return;

    const action = TOOL_ACTIONS[tool];
    if (action) {
      const result = action(clickedTile.id);
      feedbackEl.textContent = result.ok ? `${TOOL_LABELS[tool]} on ${clickedTile.id}: done.` : `${TOOL_LABELS[tool]} on ${clickedTile.id}: ${result.reason}`;
      selected = { kind: "tile", id: clickedTile.id };
      // Deliberately doesn't open the sheet - a build/zone tap shouldn't
      // interrupt rapid-fire zoning with a popup every time.
    } else {
      selected = { kind: "tile", id: clickedTile.id };
      infoSheetOpen = true;
    }
    render();
  });

  infoEl.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const kind = target.dataset.kind as Selection["kind"] | undefined;
    const id = target.dataset.id;
    if (!kind || !id) return;
    selected = { kind, id };
    infoSheetOpen = true;
    render();
  });

  infoCloseBtn.addEventListener("click", () => {
    infoSheetOpen = false;
    render();
  });

  infoBackdrop.addEventListener("click", () => {
    infoSheetOpen = false;
    render();
  });

  hudMenuToggle.addEventListener("click", () => {
    hudSecondaryPanel.classList.toggle("open");
    hudMenuToggle.classList.toggle("active", hudSecondaryPanel.classList.contains("open"));
  });

  document.querySelectorAll<HTMLButtonElement>("#speed-controls button[data-speed]").forEach((btn) => {
    btn.addEventListener("click", () => setSpeed(Number(btn.dataset.speed) as Speed));
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
  setSpeed(speed);

  /**
   * Rendering and simulation stepping are fully decoupled: this loop runs
   * every animation frame (full frame rate, however fast the browser wants to
   * paint), but only calls tick() often enough to hit the target ticks/sec for
   * the current speed — accumulated over real elapsed time, not tied to frame
   * count. A tab hitching from 60fps to 20fps changes how often we *check*,
   * never how many ticks accumulate per second of wall time, and never what
   * tick() itself does — so the same wall-clock duration at the same speed
   * always advances the sim by the same number of ticks regardless of frame
   * rate.
   */
  function frame(now: number): void {
    if (lastFrameTime === null) lastFrameTime = now;
    const elapsedMs = now - lastFrameTime;
    lastFrameTime = now;

    if (speed > 0) {
      const msPerTick = 1000 / (BASE_TICKS_PER_SECOND * speed);
      accumulatorMs = Math.min(accumulatorMs + elapsedMs, msPerTick * MAX_CATCHUP_TICKS_PER_FRAME);
      while (accumulatorMs >= msPerTick) {
        tick(world);
        accumulatorMs -= msPerTick;
      }
    }

    render(now);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error("Failed to start CityBuilder:", err);
});
