// Strand rendering — draws the bare helix spine for now (DESIGN.md §2.1)
// Real strand rendering from demographics data is A-4.

import { project, getBounds } from "../geometry/helix.js";

const SPINE_SAMPLES = 2000;

/**
 * Draw the bare corkscrew spine on the canvas, centered in the viewport.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} vw - viewport width
 * @param {number} vh - viewport height
 * @param {number} [padding=0.9] - fraction of viewport to fill
 */
export function drawSpine(ctx, vw, vh, padding = 0.9) {
  const bounds = getBounds();
  const bw = bounds.xMax - bounds.xMin;
  const bh = bounds.yMax - bounds.yMin;

  // Scale to fit viewport with padding
  const scale = Math.min((vw * padding) / bw, (vh * padding) / bh);
  const cx = vw / 2;
  const cy = vh / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-bounds.cx, -bounds.cy);

  ctx.beginPath();

  for (let i = 0; i <= SPINE_SAMPLES; i++) {
    const u = i / SPINE_SAMPLES;
    const p = project(u);
    if (i === 0) {
      ctx.moveTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }

  ctx.strokeStyle = "#5a7d9a"; // slate blue — visible on dark bg
  ctx.lineWidth = 1.5 / scale; // keep stroke thin after scaling
  ctx.stroke();
  ctx.restore();
}