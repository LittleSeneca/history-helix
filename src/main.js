// History Helix — main bootstrap
//
// Loads data, initializes viewport + interaction, orchestrates rendering.
// Canvas: population envelope → batched strands. SVG overlay: helix guides + event markers + labels.
//
// B-4: id-buffer strand picking with hover highlight and person tooltip.

import { loadDemographics, loadPeople, pop } from "./data/load.js";
import { peopleStrands } from "./geometry/coil.js";
import { buildStrandBatches, renderScene } from "./render/strands.js";
import { drawOverlay, onAnchorsRendered } from "./render/overlay.js";
import { tMin, tMax, buildDensityCache } from "./geometry/helix.js";
import * as viewport from "./interaction/viewport.js";
import {
  initHover,
  setEventAnchors,
  setStrands,
  invalidatePicking,
  rebuildPickingBuffer,
  getHoveredIndex,
  onHoverRenderRequest,
  showTooltipForEvent,
} from "./interaction/hover.js";
import {
  toggleCategory,
  getCategories,
  getHiddenCategories,
  getCurrentEra,
  onFiltersChanged,
  setSearchEvents,
  searchEvents,
  jumpToEvent,
} from "./interaction/filters.js";
import { createPanel, updateEraBanner, updateFilterRail } from "./ui/panel.js";
import { SPREAD } from "./config.js";

// ── DOM refs ────────────────────────────────────────────────

const canvas = document.getElementById("scene");
const svg = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

// ── State ───────────────────────────────────────────────────

let strandBatches = null;
let strandData = [];   // full strand array for picking / highlight
let eventData = [];
let panel = null;
let _pickingSettleTimer = null;

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

  // Picking buffer needs rebuild after resize
  invalidatePicking();
  _schedulePickingRebuild();
}

// ── Render ──────────────────────────────────────────────────

function render() {
  const t0 = performance.now();

  // Canvas: clear the full backing store, then draw
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (strandBatches) {
    const hoveredIdx = getHoveredIndex();
    renderScene(ctx, strandBatches, window.innerWidth, window.innerHeight, {
      hoveredIndex: hoveredIdx >= 0 ? hoveredIdx : undefined,
      strands: strandData,
    });
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

// ── Picking buffer lifecycle ────────────────────────────────

function _schedulePickingRebuild() {
  clearTimeout(_pickingSettleTimer);
  _pickingSettleTimer = setTimeout(() => {
    rebuildPickingBuffer();
  }, 300);
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
    const rawEvents = data.events || [];

    // Filter events to the configured timeline span
    eventData = rawEvents.filter(
      (e) => e.year >= tMin && e.year <= tMax,
    );
    const filteredOut = rawEvents.length - eventData.length;
    console.log(
      `Loaded ${eventData.length} events (${filteredOut} outside [${tMin}, ${tMax}] filtered out)`,
    );

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
  window.__getZoom = () => viewport.getZoom();
  viewport.onUpdate(() => {
    // Invalidate picking buffer immediately; rebuild on settle
    invalidatePicking();
    _schedulePickingRebuild();
    render();
  });

  // 3. Wire hover
  initHover(canvas, panel.tooltip);
  onAnchorsRendered((anchors) => {
    setEventAnchors(anchors);
  });

  // Hover state changes (strand highlight on/off) need re-render
  onHoverRenderRequest(() => {
    render();
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

    // Enter/Space on a focused event marker → show tooltip
    if ((e.key === "Enter" || e.key === " ") && e.target.tagName === "circle") {
      e.preventDefault();
      const eventId = e.target.getAttribute("data-event-id");
      const circle = e.target;
      const cx = parseFloat(circle.getAttribute("cx"));
      const cy = parseFloat(circle.getAttribute("cy"));
      const anchors = window.__lastAnchors || [];
      const match = anchors.find((a) => (a.event.id || "") === eventId);
      if (match) {
        showTooltipForEvent(match.event, cx, cy);
      }
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

  // 8. Load data — people + demographics + events in parallel
  const eventsPromise = loadEvents();

  // Load demographics first (needed for population envelope)
  console.log("[history-helix] loading demographics…");
  await loadDemographics();
  console.log("[history-helix] demographics loaded — pop envelope ready");

  // C-1: build density cache for density-driven coil radius R(u)
  buildDensityCache(pop);
  console.log("[history-helix] density cache built for R(u)");

  // Load real people
  try {
    console.log("[history-helix] loading people…");
    const people = await loadPeople();
    console.log(`[history-helix] people loaded: ${people.length} records`);

    // Generate strands from real people, filtered to [tMin, tMax]
    const { strands, filtered } = peopleStrands(people, tMin, tMax, SPREAD);
    strandData = strands;
    window.__strandCount = strands.length;
    window.__filteredOut = filtered;

    console.log(
      `[history-helix] people strands: ${strands.length}, filtered out: ${filtered}`,
    );

    // Build batched Path2Ds (one per palette entry)
    strandBatches = buildStrandBatches(strands);
    console.log(
      `[history-helix] batches: ${strandBatches.size} palette entries → ${strandBatches.size} stroke() calls`,
    );

    // Pass strand data to hover system for picking
    setStrands(strands);
  } catch (err) {
    console.error("[history-helix] people init failed:", err);
  }

  // Ensure events are loaded
  await eventsPromise;

  // Initial render
  render();

  // Build picking buffer after first render (viewport is settled)
  _schedulePickingRebuild();
}

// ── Event listeners ─────────────────────────────────────────

window.addEventListener("resize", () => {
  resize();
  render();
});

// Kick off
init();