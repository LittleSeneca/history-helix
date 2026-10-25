// Strand rendering — batched Path2D, two depth passes (DESIGN.md §2.2, §3.2–3.3)
//
// Strategy: group all strands by era color → one Path2D per (era, depth-half).
// That gives at most ~14 stroke() calls total (7 eras × 2 passes), not 60,000.
//
// Uses the viewport module for pan/zoom transform.

import { depth, project } from "../geometry/helix.js";
import { strandPath } from "../geometry/coil.js";
import { colors } from "../config.js";
import { toScreen, getZoom } from "../interaction/viewport.js";

const SPINE_SAMPLES = 2000;

// ── Spine guide (faint) ─────────────────────────────────────

/**
 * Draw the bare corkscrew spine as a faint guide behind the strands.
 * Uses the viewport transform.
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawSpine(ctx) {
  ctx.save();
  _applyViewportTransform(ctx);

  ctx.beginPath();
  for (let i = 0; i <= SPINE_SAMPLES; i++) {
    const pt = project(i / SPINE_SAMPLES);
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }

  ctx.strokeStyle = "rgba(90,125,154,0.15)";
  ctx.lineWidth = 0.8 / _normalizedLineWidth();
  ctx.stroke();
  ctx.restore();
}

// ── Strand batching ─────────────────────────────────────────

/**
 * Build one Path2D per era color × depth half.
 *
 * @param {{u0:number, u1:number, rho:number, cohortPhase:number, era:string}[]} strands
 * @returns {Map<string, {back:Path2D, front:Path2D}>}
 */
export function buildStrandBatches(strands) {
  const batches = new Map();

  for (const s of strands) {
    const era = s.era;
    if (!batches.has(era)) {
      batches.set(era, { back: new Path2D(), front: new Path2D() });
    }
    const batch = batches.get(era);

    const path = strandPath(s.u0, s.u1, s.rho, s.cohortPhase);

    // Classify by midpoint depth
    const midU = (s.u0 + s.u1) / 2;
    if (depth(midU) > 0) {
      batch.front.addPath(path);
    } else {
      batch.back.addPath(path);
    }
  }

  return batches;
}

// ── Rendering ───────────────────────────────────────────────

/**
 * Apply the interactive viewport transform to the canvas context.
 * All subsequent drawing uses scene coordinates directly.
 * @param {CanvasRenderingContext2D} ctx
 */
function _applyViewportTransform(ctx) {
  const dpr = window.devicePixelRatio || 1;
  const zoom = getZoom();
  // toScreen returns CSS pixels. Canvas backing store is in device pixels (CSS × dpr).
  const vp = toScreen(0, 0); // CSS-pixel position of scene origin on screen
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, vp.x * dpr, vp.y * dpr);
}

function _normalizedLineWidth() {
  return Math.max(0.3, getZoom());
}

/**
 * Draw all strand batches in two depth passes.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<string,{back:Path2D,front:Path2D}>} batches
 */
export function drawStrands(ctx, batches) {
  ctx.save();
  _applyViewportTransform(ctx);

  const lw = 0.8 / _normalizedLineWidth();

  // Pass 1: back half (depth < 0)
  for (const [era, batch] of batches) {
    const color = colors[era] || "#888888";
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.35;
    ctx.stroke(batch.back);
  }

  // Pass 2: front half (depth > 0) — slightly brighter
  for (const [era, batch] of batches) {
    const color = colors[era] || "#888888";
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.55;
    ctx.stroke(batch.front);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Full render orchestration ───────────────────────────────

/**
 * Render the full canvas scene: faint spine + batched strands.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<string,{back:Path2D,front:Path2D}>} batches
 * @param {number} vw - viewport CSS width (unused — viewport handles sizing)
 * @param {number} vh - viewport CSS height (unused — viewport handles sizing)
 */
export function renderScene(ctx, batches, vw, vh) {
  ctx.clearRect(0, 0, vw, vh);
  drawSpine(ctx);
  if (batches && batches.size > 0) {
    drawStrands(ctx, batches);
  }
}