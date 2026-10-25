// History Helix — main bootstrap
//
// Loads data, initializes viewport + interaction, orchestrates rendering.
// Canvas: batched strands. SVG overlay: helix guides + event markers + labels.

import { loadDemographics, pop, lifeExp } from "./data/load.js";
import { allocCohorts, generateStrands } from "./geometry/coil.js";
import { buildStrandBatches, renderScene } from "./render/strands.js";
import { drawOverlay, onAnchorsRendered } from "./render/overlay.js";
import { tMin, tMax } from "./geometry/helix.js";
import { BUDGET } from "./config.js";
import * as viewport from "./interaction/viewport.js";
import { initHover, setEventAnchors, setCohorts } from "./interaction/hover.js";
import {
  toggleCategory,
  isCategoryVisible,
  getCategories,
  getHiddenCategories,
  getCurrentEra,
  onFiltersChanged,
  setSearchEvents,
  searchEvents,
  jumpToEvent,
} from "./interaction/filters.js";
import { createPanel, updateEraBanner, updateFilterRail } from "./ui/panel.js";

// ── DOM refs ────────────────────────────────────────────────

const canvas = document.getElementById("scene");
const svg = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

// ── Constants ───────────────────────────────────────────────

const FLOOR = 1;
const COHORT_WIDTH = 25;
const BAND_PX = 8;

// ── State ───────────────────────────────────────────────────

let strandBatches = null;
let eventData = [];
let allCohorts = [];
let panel = null;

// ── Viewport sizing ─────────────────────────────────────────

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  // Reset DPR transform for crisp text — the viewport handles zoom/pan
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  viewport.resize(w, h);
}

// ── Render ──────────────────────────────────────────────────

function render() {
  const t0 = performance.now();

  // Canvas: clear the full backing store, then draw strands
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (strandBatches) {
    renderScene(ctx, strandBatches, window.innerWidth, window.innerHeight);
  }
  ctx.restore();

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // SVG overlay
  const hiddenSet = new Set(getHiddenCategories());
  drawOverlay(svg, vw, vh, eventData, hiddenSet);

  // Update era banner
  if (panel) {
    const eraInfo = getCurrentEra();
    updateEraBanner(panel.eraBanner, eraInfo);
  }

  const elapsed = performance.now() - t0;
  if (!window.__frameReported) {
    window.__frameReported = true;
    console.log(
      `[history-helix] frame: ${elapsed.toFixed(1)} ms, strands: ${window.__strandCount || 0}`,
    );
  }
}

// ── Data loading ────────────────────────────────────────────

async function loadEvents() {
  try {
    const resp = await fetch("data/events.json");
    if (!resp.ok) {
      console.warn("events.json not found or fetch failed, overlay will be minimal");
      return;
    }
    const data = await resp.json();
    eventData = data.events || [];
    console.log(`Loaded ${eventData.length} events`);

    // Populate search index and filter rail
    setSearchEvents(eventData);

    if (panel) {
      const cats = getCategories(eventData);
      updateFilterRail(panel.filterRail, cats, new Set(), (cat) => {
        const nowVisible = toggleCategory(cat);
        render();
        return nowVisible;
      });
    }
  } catch (err) {
    console.warn("Could not load events.json:", err.message);
  }
}

// ── Bootstrap ───────────────────────────────────────────────

async function init() {
  // 1. Create UI panel (elements are appended to body by createPanel)
  panel = createPanel(document.body);

  // 2. Initialize viewport
  resize();
  viewport.onUpdate(() => {
    render();
  });

  // 3. Wire hover
  initHover(canvas, panel.tooltip);
  onAnchorsRendered((anchors) => {
    setEventAnchors(anchors);
  });

  // 4. Wire viewport to canvas events
  viewport.wireCanvas(canvas);

  // 5. Keyboard navigation
  window.addEventListener("keydown", (e) => {
    // Don't capture when typing in search box
    if (e.target.tagName === "INPUT") return;

    if (viewport.handleKeyboard(e)) {
      // Viewport already fires onUpdate → render
      return;
    }

    // Custom keys
    if (e.key === "Escape" && panel.searchInput.input.value) {
      panel.searchInput.input.value = "";
      panel.searchInput.dropdown.style.display = "none";
    }
  });

  // 6. Filter change → re-render
  onFiltersChanged(() => {
    render();
  });

  // 7. Search box
  panel.searchInput.input.addEventListener("input", () => {
    const query = panel.searchInput.input.value.trim();
    const dropdown = panel.searchInput.dropdown;

    if (query.length < 2) {
      dropdown.style.display = "none";
      dropdown.innerHTML = "";
      return;
    }

    const matches = searchEvents(query);
    if (matches.length === 0) {
      dropdown.style.display = "block";
      dropdown.innerHTML =
        '<div style="padding:6px 10px;color:#666;font-size:11px">No matches</div>';
      return;
    }

    dropdown.style.display = "block";
    dropdown.innerHTML = "";
    for (const ev of matches) {
      const row = document.createElement("div");
      const yearLabel = ev.year < 0 ? `${Math.abs(ev.year)} BCE` : `${ev.year} CE`;
      row.textContent = `${ev.title} (${yearLabel})`;
      Object.assign(row.style, {
        padding: "4px 10px",
        cursor: "pointer",
        color: "#ccc",
        fontSize: "12px",
        fontFamily: "sans-serif",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      });
      row.addEventListener("pointerenter", () => {
        row.style.background = "rgba(255,255,255,0.1)";
      });
      row.addEventListener("pointerleave", () => {
        row.style.background = "";
      });
      row.addEventListener("click", () => {
        dropdown.style.display = "none";
        panel.searchInput.input.value = ev.title;
        jumpToEvent(ev);
        render();
      });
      dropdown.appendChild(row);
    }
  });

  // Close search dropdown on outside click
  document.addEventListener("click", (e) => {
    if (!panel.searchInput.wrapper.contains(e.target)) {
      panel.searchInput.dropdown.style.display = "none";
    }
  });

  // 8. Load data (events first, they're fast, then demographics)
  const eventsPromise = loadEvents();

  try {
    console.log("[history-helix] loading demographics…");
    await loadDemographics();
    console.log("[history-helix] demographics loaded");

    // Allocate cohorts
    allCohorts = allocCohorts(pop, BUDGET, FLOOR, tMin, tMax, COHORT_WIDTH);
    const totalAlloc = allCohorts.reduce((s, c) => s + c.count, 0);
    console.log(
      `[history-helix] cohorts: ${allCohorts.length}, Σalloc = ${totalAlloc}`,
    );

    // Generate strands
    const strands = generateStrands(allCohorts, lifeExp, BAND_PX);
    window.__strandCount = strands.length;
    console.log(`[history-helix] strands generated: ${strands.length}`);

    // Build batched Path2Ds
    strandBatches = buildStrandBatches(strands);
    console.log(
      `[history-helix] batches: ${strandBatches.size} eras × 2 passes = ~${strandBatches.size * 2} stroke() calls`,
    );

    // Pass cohort data to hover system for strand hit-testing
    setCohorts(allCohorts);
  } catch (err) {
    console.error("[history-helix] demographics init failed:", err);
  }

  // Ensure events are loaded
  await eventsPromise;

  // Initial render
  render();
}

// ── Event listeners ─────────────────────────────────────────

window.addEventListener("resize", () => {
  resize();
  render();
});

// Kick off
init();