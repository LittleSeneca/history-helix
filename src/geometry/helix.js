// Helix geometry — the single source of truth for all coordinates (DESIGN.md §2.1)
// No drawing code. No DOM access. Pure math.
//
// C-1: R(u) now varies with local population density so the coil widens
// in the crowded modern era and narrows in the sparse ancient turns.

import { TURNS, LEAN_DEG, SQUASH, R_BASE, DENSITY_GAIN, tMin, tMax } from "../config.js";

// Re-export for consumers (coil.js, tests)
export { R_BASE, tMin, tMax };

// ── Density-driven coil radius ────────────────────────────

/** @type {number[]|null} — cached density norm values along u */
let _densityCache = null;

/**
 * Build a cache of log-normalised population density values
 * across the timeline span. Called lazily; falls back to a
 * linear ramp u→u when demographics have not been loaded.
 */
function _ensureDensityCache() {
  if (_densityCache) return;
  try {
    // Dynamic import guard: pop() only works after loadDemographics()
    const { pop } = require("../src/data/load.js"); // eslint-disable-line
    // won't work in ES modules — use a dynamic approach
  } catch {
    // not available
  }

  // Try the static import approach by checking if the module is loaded
  try {
    // We'll populate via the _buildDensityCache export instead
  } catch {
    // fall through to linear fallback
  }
}

/**
 * Normalized population density at position u (0..1).
 * Falls back to linear ramp u when demographics are not yet loaded.
 * @param {number} u — normalised time 0..1
 * @returns {number} density norm 0..1
 */
export function densityNorm(u) {
  if (!_densityCache) return u; // linear fallback (tests, early render)
  const idx = Math.round(u * (_densityCache.length - 1));
  const i = Math.max(0, Math.min(_densityCache.length - 1, idx));
  return _densityCache[i];
}

/**
 * Populate the density cache from an external pop() accessor.
 * Called by main.js after demographics are loaded.
 * @param {function(number):number} popFn — year → population
 */
export function buildDensityCache(popFn) {
  const N = 500;
  const pops = [];
  for (let i = 0; i <= N; i++) {
    const up = i / N;
    const year = tMin + up * (tMax - tMin);
    pops.push(Math.max(1, popFn(year)));
  }
  const logMin = Math.log10(Math.min(...pops));
  const logMax = Math.log10(Math.max(...pops));
  const logRange = logMax - logMin || 1;
  _densityCache = pops.map(p => (Math.log10(p) - logMin) / logRange);
}

/**
 * Coil radius at normalised position u — varies with local density.
 * R(u) = R_BASE + DENSITY_GAIN * densityNorm(u)
 * @param {number} u — normalised time 0..1
 * @returns {number} radius in scene px
 */
export function R(u) {
  return R_BASE + DENSITY_GAIN * densityNorm(u);
}

// ── Coil dimensions (scene pixels) ─────────────────────────

// LEN uses R_BASE so the coil's vertical pitch stays constant even
// as the local radius bulges with density.
const LEN = R_BASE * TURNS * 0.45; // total coil height in local space before rotation
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
// C-1: now uses R(u) instead of constant R — the spine bulges
// where population density is high.
export function project(u) {
  const th = theta(u);
  const r = R(u);
  const lx = r * Math.cos(th);
  const ly = -LEN * u + SQUASH * r * Math.sin(th);
  return rotate(lx, ly);
}

// ── Point on the coil surface at given radius and phase ────
// C-1: radius is the FULL radius (callers compute R(u) + rho).
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