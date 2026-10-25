import { loadDemographics, pop, lifeExp } from "./data/load.js";
import { allocCohorts, generateStrands } from "./geometry/coil.js";
import { buildStrandBatches, renderScene } from "./render/strands.js";
import { drawOverlay } from "./render/overlay.js";
import { tMin, tMax } from "./geometry/helix.js";
import { BUDGET } from "./config.js";

const FLOOR = 1;
const COHORT_WIDTH = 25;
const BAND_PX = 8;

const canvas = document.getElementById("scene");
const svg = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

// ── State ───────────────────────────────────────────────────
let strandBatches = null;
let eventData = [];

// ── Viewport management ─────────────────────────────────────

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
}

// ── Render with timing ──────────────────────────────────────

function render() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const t0 = performance.now();

  // Canvas: strands
  if (strandBatches) {
    renderScene(ctx, strandBatches, vw, vh);
  }

  // SVG overlay: era markers + events
  drawOverlay(svg, vw, vh, eventData);

  const elapsed = performance.now() - t0;

  // Report first-frame timing to console
  if (!window.__frameReported) {
    window.__frameReported = true;
    console.log(
      `[history-helix] frame: ${elapsed.toFixed(1)} ms, strands: ${window.__strandCount || 0}`,
    );
  }
}

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
  } catch (err) {
    console.warn("Could not load events.json:", err.message);
  }
}

// ── Bootstrap ───────────────────────────────────────────────

async function init() {
  resize();

  // Load events and demographics in parallel
  const eventsPromise = loadEvents();
  const demosPromise = loadDemographics();

  await eventsPromise;

  try {
    console.log("[history-helix] loading demographics…");
    await demosPromise;
    console.log("[history-helix] demographics loaded");

    // Allocate cohorts
    const cohorts = allocCohorts(pop, BUDGET, FLOOR, tMin, tMax, COHORT_WIDTH);
    const totalAlloc = cohorts.reduce((s, c) => s + c.count, 0);
    console.log(
      `[history-helix] cohorts: ${cohorts.length}, Σalloc = ${totalAlloc}`,
    );

    // Generate strands
    const strands = generateStrands(cohorts, lifeExp, BAND_PX);
    window.__strandCount = strands.length;
    console.log(`[history-helix] strands generated: ${strands.length}`);

    // Build batched Path2Ds
    strandBatches = buildStrandBatches(strands);
    console.log(
      `[history-helix] batches: ${strandBatches.size} eras × 2 passes = ~${strandBatches.size * 2} stroke() calls`,
    );
  } catch (err) {
    console.error("[history-helix] demographics init failed:", err);
  }

  // Render everything
  render();
}

// ── Event listeners ─────────────────────────────────────────

window.addEventListener("resize", () => {
  resize();
  render();
});

// Kick off
init();