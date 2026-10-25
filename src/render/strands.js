// Strand rendering — batched Path2D, two depth passes (DESIGN.md §2.2, §3.2–3.3)
//
// Strategy: group all strands by era color → one Path2D per (era, depth-half).
// That gives at most ~14 stroke() calls total (7 eras × 2 passes), not 60,000.

import { depth, getBounds, project } from "../geometry/helix.js";
import { strandPath } from "../geometry/coil.js";
import { colors } from "../config.js";

const SPINE_SAMPLES = 2000;

// ── Spine guide (faint) ─────────────────────────────────────

/**
 * Draw the bare corkscrew spine as a faint guide behind the strands.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} vw - viewport CSS width
 * @param {number} vh - viewport CSS height
 */
export function drawSpine(ctx, vw, vh) {
  const bounds = getBounds();
  const bw = bounds.xMax - bounds.xMin;
  const bh = bounds.yMax - bounds.yMin;

  const scale = Math.min((vw * 0.9) / bw, (vh * 0.9) / bh);
  const cx = vw / 2;
  const cy = vh / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-bounds.cx, -bounds.cy);

  ctx.beginPath();
  for (let i = 0; i <= SPINE_SAMPLES; i++) {
    const pt = project(i / SPINE_SAMPLES);
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  }

  ctx.strokeStyle = "rgba(90,125,154,0.15)"; // very faint slate
  ctx.lineWidth = 0.8 / scale;
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
 * Apply the viewport transform (center + scale to fit).
 * Returns the scale factor for line-width normalization.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} vw
 * @param {number} vh
 * @returns {{scale: number, set():void, restore():void}}
 */
function applyViewport(ctx, vw, vh) {
  const bounds = getBounds();
  const bw = bounds.xMax - bounds.xMin;
  const bh = bounds.yMax - bounds.yMin;

  const scale = Math.min((vw * 0.92) / bw, (vh * 0.92) / bh);

  ctx.save();
  ctx.translate(vw / 2, vh / 2);
  ctx.scale(scale, scale);
  ctx.translate(-bounds.cx, -bounds.cy);

  return {
    scale,
    set() {
      // Already applied by the save/translate above
    },
    restore() {
      ctx.restore();
    },
  };
}

/**
 * Draw all strand batches in two depth passes.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<string,{back:Path2D,front:Path2D}>} batches
 * @param {number} vw - viewport CSS width
 * @param {number} vh - viewport CSS height
 */
export function drawStrands(ctx, batches, vw, vh) {
  const vp = applyViewport(ctx, vw, vh);

  // Pass 1: back half (depth < 0)
  for (const [era, batch] of batches) {
    const color = colors[era] || "#888888";
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8 / vp.scale;
    ctx.globalAlpha = 0.35;
    ctx.stroke(batch.back);
  }

  // Pass 2: front half (depth > 0) — slightly brighter
  for (const [era, batch] of batches) {
    const color = colors[era] || "#888888";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.0 / vp.scale;
    ctx.globalAlpha = 0.55;
    ctx.stroke(batch.front);
  }

  ctx.globalAlpha = 1;
  vp.restore();
}

// ── Full render orchestration ───────────────────────────────

/**
 * Render the full scene: faint spine + batched strands.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Map<string,{back:Path2D,front:Path2D}>} batches
 * @param {number} vw
 * @param {number} vh
 */
export function renderScene(ctx, batches, vw, vh) {
  ctx.clearRect(0, 0, vw, vh);
  drawSpine(ctx, vw, vh);
  if (batches && batches.size > 0) {
    drawStrands(ctx, batches, vw, vh);
  }
}