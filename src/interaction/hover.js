// Hover hit-testing — strand bands and event markers, tooltip driver
// (DESIGN.md §5.2)
//
// Approach:
// - Strands: geometric proximity to the helix spine → cohort year → sample strand info
// - Events: spatial index of screen-space anchor positions, nearest-neighbor lookup
//
// Verifiable via dispatched PointerEvents + read-back (not screenshots).

import { toScene } from "./viewport.js";
import { u as toU, project, tMin, tMax } from "../geometry/helix.js";

// ── State ───────────────────────────────────────────────────

/** @type {HTMLDivElement|null} */
let _tooltipEl = null;

/** @type {{event:object, sx:number, sy:number}[]} */
let _eventAnchors = [];

/** @type {object[]} */
let _cohorts = [];

let _canvas = null;
let _hoveredEvent = null;
let _hoveredStrand = null;
let _onHighlight = null;

const HIT_RADIUS = 20; // screen pixels for event marker hit-testing

// ── Initialization ──────────────────────────────────────────

/**
 * Initialize hover system.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLDivElement} tooltipEl
 */
export function initHover(canvas, tooltipEl) {
  _canvas = canvas;
  _tooltipEl = tooltipEl;

  canvas.addEventListener("pointermove", _onPointerMove);
  canvas.addEventListener("pointerleave", _onPointerLeave);
}

/**
 * Update the event anchor index. Call after each overlay render.
 * @param {{event:object, sx:number, sy:number}[]} anchors
 */
export function setEventAnchors(anchors) {
  _eventAnchors = anchors;
}

/**
 * Update the cohort data for strand hover. Call after strand generation.
 * @param {object[]} cohorts
 */
export function setCohorts(cohorts) {
  _cohorts = cohorts;
}

/**
 * Register a callback for highlighting (e.g., pulse an event marker).
 * Called with null to clear or {event} to highlight.
 * @param {function} cb
 */
export function onHighlight(cb) {
  _onHighlight = cb;
}

// ── Hit-testing ─────────────────────────────────────────────

/**
 * Hit-test event markers. Returns the nearest event within HIT_RADIUS.
 * @param {number} px - screen x
 * @param {number} py - screen y
 * @returns {object|null} the event record or null
 */
export function hitTestEvent(px, py) {
  let best = null;
  let bestDist = HIT_RADIUS;

  for (const a of _eventAnchors) {
    const dx = a.sx - px;
    const dy = a.sy - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = a.event;
    }
  }

  return best;
}

/**
 * Hit-test strand bands. Returns representative strand info for the
 * cohort nearest to the screen point, or null if too far from the coil.
 * @param {number} px - screen x
 * @param {number} py - screen y
 * @returns {object|null} {birthYear, deathYear, cohortLabel, era}
 */
export function hitTestStrand(px, py) {
  if (_cohorts.length === 0) return null;

  const scene = toScene(px, py);

  // Find the closest point on the helix spine (sample at 200 points)
  let bestU = 0;
  let bestDist = Infinity;
  const N = 200;

  for (let i = 0; i <= N; i++) {
    const up = i / N;
    const p = project(up);
    const dx = p.x - scene.x;
    const dy = p.y - scene.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestU = up;
    }
  }

  // Require proximity to the coil: within ~60 scene units
  if (bestDist > 3600) return null;  // 60^2

  // Map u → year
  const year = tMin + bestU * (tMax - tMin);

  // Find the cohort this year falls into
  for (const c of _cohorts) {
    if (year >= c.start && year < c.end) {
      const cohortLabel = `${Math.floor(c.midpoint / 10) * 10}s`;
      return {
        birthYear: Math.round(year),
        deathYear: Math.round(year + _cohortLifeExp(c, year)),
        cohortLabel,
        era: _cohortEra(c),
      };
    }
  }

  return null;
}

function _cohortLifeExp(cohort, year) {
  // Use the cohort's life expectancy if available, else estimate 35
  if (cohort.lifeExp) return cohort.lifeExp;
  return 35;
}

function _cohortEra(cohort) {
  if (cohort.era) return cohort.era;
  // Infer from midpoint
  const y = cohort.midpoint;
  if (y < -3000) return "prehistory";
  if (y < 500) return "ancient";
  if (y < 1500) return "classical";
  if (y < 1800) return "earlyModern";
  if (y < 1950) return "industrial";
  if (y < 2020) return "modern";
  return "future";
}

// ── Tooltip display ─────────────────────────────────────────

function _buildTooltipHTML(info) {
  if (!info) return "";

  if (info.title !== undefined) {
    // Event tooltip
    const yearLabel = info.year < 0 ? `${Math.abs(info.year)} BCE` : `${info.year} CE`;
    const cat = info.category ? info.category : "unknown";
    const url = info.sourceUrl || `https://www.wikidata.org/wiki/${info.qid || ""}`;
    return `<strong>${info.title}</strong><br><small>${yearLabel} · ${cat}</small><br><a href="${url}" target="_blank" rel="noopener">wikidata</a>`;
  }

  if (info.birthYear !== undefined) {
    // Strand tooltip
    const bLabel = info.birthYear < 0 ? `${Math.abs(info.birthYear)} BCE` : `${info.birthYear} CE`;
    const dLabel = info.deathYear < 0 ? `${Math.abs(info.deathYear)} BCE` : `${info.deathYear} CE`;
    return `a life: b ${bLabel} – d ${dLabel}, cohort ${info.cohortLabel}`;
  }

  return "";
}

function _showTooltip(info, px, py) {
  if (!_tooltipEl) return;

  const html = _buildTooltipHTML(info);
  if (!html) {
    _tooltipEl.style.display = "none";
    _tooltipEl.innerHTML = "";
    return;
  }

  _tooltipEl.innerHTML = html;
  _tooltipEl.style.display = "block";

  // Position near the cursor, clamped to viewport
  const offsetX = 12;
  const offsetY = -10;
  let left = px + offsetX;
  let top = py + offsetY;

  // Clamp
  const rect = _tooltipEl.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 8) {
    left = px - rect.width - offsetX;
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = py - rect.height - offsetY;
  }
  if (left < 4) left = 4;
  if (top < 4) top = 4;

  _tooltipEl.style.left = `${left}px`;
  _tooltipEl.style.top = `${top}px`;
}

function _hideTooltip() {
  if (_tooltipEl) {
    _tooltipEl.style.display = "none";
    _tooltipEl.innerHTML = "";
  }
}

// ── Event handlers ──────────────────────────────────────────

function _onPointerMove(e) {
  const px = e.clientX;
  const py = e.clientY;

  // Check events first (they're on top, more important)
  const event = hitTestEvent(px, py);
  if (event) {
    if (_hoveredEvent !== event) {
      _hoveredEvent = event;
      _hoveredStrand = null;
      _showTooltip(event, px, py);
      if (_onHighlight) _onHighlight({ event });
    }
    return;
  }

  // Check strands
  const strand = hitTestStrand(px, py);
  if (strand) {
    if (_hoveredStrand !== strand) {
      _hoveredStrand = strand;
      _hoveredEvent = null;
      _showTooltip(strand, px, py);
      if (_onHighlight) _onHighlight(null);
    }
    return;
  }

  // Nothing hit
  if (_hoveredEvent || _hoveredStrand) {
    _hoveredEvent = null;
    _hoveredStrand = null;
    _hideTooltip();
    if (_onHighlight) _onHighlight(null);
  }
}

function _onPointerLeave() {
  _hoveredEvent = null;
  _hoveredStrand = null;
  _hideTooltip();
  if (_onHighlight) _onHighlight(null);
}