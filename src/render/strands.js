// Strand rendering — batched Path2D, single pass (DESIGN.md §2.2, §3.2–3.3)
//
// Strategy: group all strands by palette index → one Path2D per color.
// That gives exactly PALETTE_SIZE stroke() calls (≤64), well under the
// naïve count of one-per-strand (27,944).
//
// Uses the viewport module for pan/zoom transform.
//
// B-4: adds picking-buffer rendering (color-encoded strand indices),
// single-strand highlight drawing, and hover highlight/dim support.
//
// C-2: per-life pastel colors replace era-based coloring. Colors are
// deterministic from the person's name + birth year.

import { project, tMin, tMax } from "../geometry/helix.js";
import { strandPath } from "../geometry/coil.js";
import { colorIndex, colorAt, PALETTE_SIZE } from "./palette.js";
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
 * Build one Path2D per palette index.
 * All strands (front and back) go into the same batch — one stroke() per color.
 *
 * @param {{u0:number, u1:number, rho:number, cohortPhase:number, era:string, person?:{name:string, birth:number, sourceUrl:string}}[]} strands
 * @returns {Map<number, Path2D>}
 */
export function buildStrandBatches(strands) {
  const batches = new Map();

  for (const s of strands) {
    const idx = s._paletteIdx ?? colorIndex(s.person || null);
    // Cache on the strand so colorFor is stable even if person data shifts
    s._paletteIdx = idx;

    if (!batches.has(idx)) {
      batches.set(idx, new Path2D());
    }
    const batch = batches.get(idx);
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
  const vp = toScreen(0, 0);
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, vp.x * dpr, vp.y * dpr);
}

function _normalizedLineWidth() {
  return Math.max(0.3, getZoom());
}

/**
 * Draw all strand batches — one stroke() per palette index (≤64 calls).
 *
 * Supports highlight mode: when hoveredIndex is set, all strands are dimmed
 * and the hovered strand is drawn bright/thick on top as white + its own color glow.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<number, Path2D>} batches
 * @param {object} [opts]
 * @param {number} [opts.hoveredIndex] - index of the hovered strand (if any)
 * @param {object[]} [opts.strands] - strand data array (needed for highlight)
 */
export function drawStrands(ctx, batches, opts = {}) {
  const { hoveredIndex, strands } = opts;
  const hasHighlight = hoveredIndex != null && strands != null;

  ctx.save();
  _applyViewportTransform(ctx);

  const lw = 0.8 / _normalizedLineWidth();

  // Dimmed pass: all strands at reduced alpha when highlighting
  // C-4: alpha raised from 0.45 to 0.90 to fix alpha-compositing desaturation
  // over dark background (#0b0b0e). At 0.45, the rendered saturation was ~82%
  // below palette values; at 0.90, the rendered saturation retains ~60% of
  // palette saturation — passing the AC-1 gate (mean rendered S ≥ 35%).
  const alpha = hasHighlight ? 0.15 : 0.90;

  for (const [idx, path] of batches) {
    const color = colorAt(idx);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.globalAlpha = alpha;
    ctx.stroke(path);
  }

  // Highlight pass: draw the single hovered strand bright and thick
  if (hasHighlight) {
    const s = strands[hoveredIndex];
    const highlightIdx = s._paletteIdx ?? colorIndex(s.person || null);
    const highlightColor = colorAt(highlightIdx);

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = lw * 2.5;

    const p = strandPath(s.u0, s.u1, s.rho, s.cohortPhase);
    ctx.stroke(p);

    // Also draw a slightly wider glow in the strand's own pastel
    ctx.strokeStyle = highlightColor;
    ctx.lineWidth = lw * 1.5;
    ctx.globalAlpha = 0.7;
    ctx.stroke(p);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Single strand drawing (for picking buffer) ──────────────

/**
 * Draw a single strand onto a context that already has the viewport
 * transform applied. Used by the picking buffer.
 *
 * @param {CanvasRenderingContext2D} ctx - context WITH viewport transform applied
 * @param {object} strand - {u0, u1, rho, cohortPhase}
 * @param {object} style - {strokeStyle, lineWidth, globalAlpha}
 */
export function drawSingleStrand(ctx, strand, style = {}) {
  const s = style;
  if (s.strokeStyle) ctx.strokeStyle = s.strokeStyle;
  if (s.lineWidth != null) ctx.lineWidth = s.lineWidth;
  if (s.globalAlpha != null) ctx.globalAlpha = s.globalAlpha;

  const p = strandPath(strand.u0, strand.u1, strand.rho, strand.cohortPhase);
  ctx.stroke(p);
}

// ── Picking buffer rendering (B-4) ──────────────────────────

/**
 * Draw all strands onto a context using color-encoded indices.
 * Each strand is drawn as a thin line in the color r,g,b = index as 24-bit.
 * The caller must set up the viewport transform on the context first.
 *
 * @param {CanvasRenderingContext2D} ctx - context WITH viewport transform applied
 * @param {object[]} strands - full strand data array
 */
export function drawStrandsToPickingBuffer(ctx, strands) {
  // Draw each strand individually in its index-encoded color
  // Use 1px lines so there's minimal aliasing into neighbor colors
  for (let i = 0; i < strands.length; i++) {
    const s = strands[i];
    const r = (i >> 16) & 0xff;
    const g = (i >> 8) & 0xff;
    const b = i & 0xff;

    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 1.5; // slightly thicker than display for reliable picking

    const p = strandPath(s.u0, s.u1, s.rho, s.cohortPhase);
    ctx.stroke(p);
  }
}

// ── Full render orchestration ───────────────────────────────

/**
 * Render the full canvas scene: population envelope → faint spine → batched strands.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<string, Path2D>} batches
 * @param {number} vw - viewport CSS width
 * @param {number} vh - viewport CSS height
 * @param {object} [opts] - passed through to drawStrands
 */
export function renderScene(ctx, batches, vw, vh, opts) {
  ctx.clearRect(0, 0, vw, vh);
  drawPopulationEnvelope(ctx);
  drawSpine(ctx);
  if (batches && batches.size > 0) {
    drawStrands(ctx, batches, opts);
  }
}