// Helix geometry — the single source of truth for all coordinates (DESIGN.md §2.1)
// No drawing code. No DOM access. Pure math.

import { TURNS, LEAN_DEG, SQUASH } from "../config.js";

// ── Time span ──────────────────────────────────────────────
export const tMin = -10000;
export const tMax = 2100;

// ── Coil dimensions (scene pixels) ─────────────────────────
export const R = 150; // coil radius
const LEN = R * TURNS * 0.45; // total coil height in local space before rotation
const LEAN_RAD = (LEAN_DEG * Math.PI) / 180;
const THETA = 2 * Math.PI * TURNS;

// ── Normalized position 0..1 ───────────────────────────────
export function u(t) {
  return (t - tMin) / (tMax - tMin);
}

// ── Angular position (radians) ─────────────────────────────
export function theta(u) {
  return THETA * u;
}

// ── Depth signal: +1 at camera, −1 behind (sin phase) ──────
export function depth(u) {
  return Math.sin(theta(u));
}

// ── Rotate a local (x,y) by LEAN ───────────────────────────
function rotate(lx, ly) {
  const cosL = Math.cos(LEAN_RAD);
  const sinL = Math.sin(LEAN_RAD);
  return {
    x: lx * cosL - ly * sinL,
    y: lx * sinL + ly * cosL,
  };
}

// ── Scene-space projection of the spine at u ───────────────
export function project(u) {
  const th = theta(u);
  const lx = R * Math.cos(th);
  const ly = -LEN * u + SQUASH * R * Math.sin(th);
  return rotate(lx, ly);
}

// ── Point on the coil surface at given radius and phase ────
export function pointOnSurface(u, radius, phaseOffset) {
  const th = theta(u) + phaseOffset;
  const lx = radius * Math.cos(th);
  const ly = -LEN * u + SQUASH * radius * Math.sin(th);
  return rotate(lx, ly);
}

// ── Bounding box of the projected spine ─────────────────────
const _boundsCache = (() => {
  const N = 2000;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i <= N; i++) {
    const p = project(i / N);
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
  }
  return { xMin, xMax, yMin, yMax, cx: (xMin + xMax) / 2, cy: (yMin + yMax) / 2 };
})();

export function getBounds() {
  return _boundsCache;
}