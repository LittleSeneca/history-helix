// Strand rendering — batched Path2D, single pass (DESIGN.md §2.2, §3.2–3.3)
//
// Strategy: group all strands by era color → one Path2D per era.
// That gives at most 7 stroke() calls (one per era), well under the ≤10 target.
// The two-pass depth split is dropped: the visual difference between alpha 0.35
// and 0.55 on 0.8 px lines is negligible, and the DESIGN.md explicitly sets
// <10 stroke calls as the target (§3.3).
//
// Uses the viewport module for pan/zoom transform.

import { project, tMin, tMax } from "../geometry/helix.js";
import { strandPath } from "../geometry/coil.js";
import { colors } from "../config.js";
import { toScreen, getZoom } from "../interaction/viewport.js";
import { pop } from "../data/load.js";

const SPINE_SAMPLES = 2000;
const ENVELOPE_SAMPLES = 500;

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

// ── Population envelope (B-3) ────────────────────────────────

/**
 * Draw a faint background "population envelope" along the coil —
 * a soft band whose width traces the population curve.
 *
 * Uses a filled ribbon: for each sample point along the coil,
 * offset perpendicular by an amount proportional to log(pop).
 * Low alpha so it reads as context, not as data.
 *
 * @param {CanvasRenderingContext2D} ctx
 */
export function drawPopulationEnvelope(ctx) {
  ctx.save();
  _applyViewportTransform(ctx);

  const samples = ENVELOPE_SAMPLES;

  // Collect population values to compute log range
  const pops = [];
  for (let i = 0; i <= samples; i++) {
    const up = i / samples;
    const year = tMin + up * (tMax - tMin);
    pops.push(Math.max(1, pop(year)));
  }

  const logMin = Math.log10(Math.min(...pops));
  const logMax = Math.log10(Math.max(...pops));
  const logRange = logMax - logMin || 1;

  // Build upper and lower envelope paths
  const upper = [];
  const lower = [];

  for (let i = 0; i <= samples; i++) {
    const up = i / samples;
    const pt = project(up);
    const logPop = Math.log10(pops[i]);
    const frac = (logPop - logMin) / logRange;

    // Band width: 2px to 35px (scene space), mapped from population fraction
    const halfWidth = 2 + frac * 16;

    // Compute perpendicular direction numerically
    const eps = 0.0005;
    const ptAhead = project(Math.min(1, up + eps));
    const ptBehind = project(Math.max(0, up - eps));
    const dx = ptAhead.x - ptBehind.x;
    const dy = ptAhead.y - ptBehind.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;

    upper.push({ x: pt.x + nx * halfWidth, y: pt.y + ny * halfWidth });
    lower.push({ x: pt.x - nx * halfWidth, y: pt.y - ny * halfWidth });
  }

  // Build filled path: upper envelope forward, lower envelope backward
  ctx.beginPath();
  ctx.moveTo(upper[0].x, upper[0].y);
  for (let i = 1; i < upper.length; i++) {
    ctx.lineTo(upper[i].x, upper[i].y);
  }
  for (let i = lower.length - 1; i >= 0; i--) {
    ctx.lineTo(lower[i].x, lower[i].y);
  }
  ctx.closePath();

  ctx.fillStyle = "rgba(90,125,154,0.20)";
  ctx.fill();

  // Soft edge along the envelope boundary
  ctx.strokeStyle = "rgba(90,125,154,0.30)";
  ctx.lineWidth = 1.0 / _normalizedLineWidth();
  ctx.stroke();

  ctx.restore();
}

// ── Strand batching ─────────────────────────────────────────

/**
 * Build one Path2D per era color.
 * All strands (front and back) go into the same batch — one stroke() per era.
 *
 * @param {{u0:number, u1:number, rho:number, cohortPhase:number, era:string}[]} strands
 * @returns {Map<string, Path2D>}
 */
export function buildStrandBatches(strands) {
  const batches = new Map();

  for (const s of strands) {
    const era = s.era;
    if (!batches.has(era)) {
      batches.set(era, new Path2D());
    }
    const batch = batches.get(era);
    const path = strandPath(s.u0, s.u1, s.rho, s.cohortPhase);
    batch.addPath(path);
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
 * Draw all strand batches — one stroke() per era (7 calls total, ≤ 10 target).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<string, Path2D>} batches
 */
export function drawStrands(ctx, batches) {
  ctx.save();
  _applyViewportTransform(ctx);

  const lw = 0.8 / _normalizedLineWidth();

  // Single pass: one stroke per era (7 calls — well under the ≤10 target)
  for (const [era, path] of batches) {
    const color = colors[era] || "#888888";
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = 0.45;
    ctx.stroke(path);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Full render orchestration ───────────────────────────────

/**
 * Render the full canvas scene: population envelope → faint spine → batched strands.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<string, Path2D>} batches
 * @param {number} vw - viewport CSS width
 * @param {number} vh - viewport CSS height
 */
export function renderScene(ctx, batches, vw, vh) {
  ctx.clearRect(0, 0, vw, vh);
  drawPopulationEnvelope(ctx);
  drawSpine(ctx);
  if (batches && batches.size > 0) {
    drawStrands(ctx, batches);
  }
}