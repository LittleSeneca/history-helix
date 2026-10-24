import { loadDemographics, pop, lifeExp, isLoaded } from "./data/load.js";
import { allocCohorts, generateStrands } from "./geometry/coil.js";
import { buildStrandBatches, renderScene } from "./render/strands.js";
import { tMin, tMax } from "./geometry/helix.js";
import { BUDGET } from "./config.js";

const FLOOR = 1;
const COHORT_WIDTH = 25;
const BAND_PX = 8;

const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

// ── State ───────────────────────────────────────────────────
let strandBatches = null;

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
}

// ── Render with timing ──────────────────────────────────────

function render() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const t0 = performance.now();
  renderScene(ctx, strandBatches, vw, vh);
  const elapsed = performance.now() - t0;

  // Report first-frame timing to console
  if (!window.__frameReported) {
    window.__frameReported = true;
    console.log(
      `[history-helix] frame: ${elapsed.toFixed(1)} ms, strands: ${window.__strandCount || 0}`,
    );
  }
}

// ── Bootstrap ───────────────────────────────────────────────

async function init() {
  resize();

  // Show the spine immediately while data loads
  render();

  try {
    console.log("[history-helix] loading demographics…");
    await loadDemographics();
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

    // Re-render with strands
    render();
  } catch (err) {
    console.error("[history-helix] init failed:", err);
  }
}

// ── Event listeners ─────────────────────────────────────────

window.addEventListener("resize", () => {
  resize();
  render();
});

// Kick off
init();