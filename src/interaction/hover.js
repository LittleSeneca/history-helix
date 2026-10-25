// Hover hit-testing — strand picking (id-buffer), event markers, tooltip driver
// (DESIGN.md §5.2, B-4)
//
// Picking strategy (B-4):
// - Offscreen canvas the size of the display canvas in device pixels.
// - Every strand drawn in a colour encoding its array index (r,g,b = 24-bit).
// - On pointermove: getImageData(x, y, 1, 1) → decode index → look up person.
// - Buffer rebuilt only on viewport change — never per mouse move.
// - Event markers: existing spatial index (nearest-neighbor).

import { toScene, getZoom, toScreen } from "./viewport.js";
import { drawStrandsToPickingBuffer } from "../render/strands.js";

// ── State ───────────────────────────────────────────────────

/** @type {HTMLDivElement|null} */
let _tooltipEl = null;

/** @type {{event:object, sx:number, sy:number}[]} */
let _eventAnchors = [];

/** @type {object[]} */
let _strands = [];

let _canvas = null;
let _pickingCanvas = null;
let _pickingCtx = null;
let _hoveredEvent = null;
let _hoveredStrandIndex = -1;
let _onHighlight = null;
let _pickingDirty = true;

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

  // Listen on document for pointermove — SVG circles have pointer-events: auto
  // for keyboard accessibility, so they capture events before the canvas.
  document.addEventListener("pointermove", _onPointerMove);
  canvas.addEventListener("pointerleave", _onPointerLeave);

  // Create offscreen picking buffer
  _createPickingBuffer();
}

/**
 * Set the strand data array for picking. Call after strand generation.
 * Each strand should have a .person property for the tooltip.
 * @param {object[]} strands
 */
export function setStrands(strands) {
  _strands = strands;
  _pickingDirty = true;
}

/**
 * Mark the picking buffer as needing a rebuild (call after viewport change).
 */
export function invalidatePicking() {
  _pickingDirty = true;
  // Clear highlight on viewport change
  _clearStrandHover();
}

/**
 * Get the currently hovered strand index, or -1 if none.
 * @returns {number}
 */
export function getHoveredIndex() {
  return _hoveredStrandIndex;
}

/**
 * Update the event anchor index. Call after each overlay render.
 * @param {{event:object, sx:number, sy:number}[]} anchors
 */
export function setEventAnchors(anchors) {
  _eventAnchors = anchors;
}

/**
 * Register a callback for highlighting (e.g., pulse an event marker).
 * Called with null to clear or {event} to highlight.
 * @param {function} cb
 */
export function onHighlight(cb) {
  _onHighlight = cb;
}

// ── Picking buffer ──────────────────────────────────────────

function _createPickingBuffer() {
  const dpr = window.devicePixelRatio || 1;
  const w = _canvas.width;
  const h = _canvas.height;

  _pickingCanvas = document.createElement("canvas");
  _pickingCanvas.width = w;
  _pickingCanvas.height = h;
  _pickingCtx = _pickingCanvas.getContext("2d", { willReadFrequently: true });
}

/**
 * Ensure the picking buffer matches the display canvas size.
 */
function _resizePickingBuffer() {
  const w = _canvas.width;
  const h = _canvas.height;
  if (_pickingCanvas.width !== w || _pickingCanvas.height !== h) {
    _pickingCanvas.width = w;
    _pickingCanvas.height = h;
    _pickingDirty = true;
  }
}

/**
 * Rebuild the picking buffer by drawing all strands in color-encoded indices.
 * Call after viewport settle. Measures rebuild time.
 */
export function rebuildPickingBuffer() {
  if (!_pickingCtx || _strands.length === 0) return;

  _resizePickingBuffer();

  if (!_pickingDirty) return;

  const t0 = performance.now();

  const ctx = _pickingCtx;
  const dpr = window.devicePixelRatio || 1;

  // Clear
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, _pickingCanvas.width, _pickingCanvas.height);

  // Apply the same viewport transform as the display canvas
  const zoom = getZoom();
  const vp = toScreen(0, 0);
  ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, vp.x * dpr, vp.y * dpr);

  // Draw all strands in picking colors
  drawStrandsToPickingBuffer(ctx, _strands);

  const elapsed = performance.now() - t0;
  console.log(
    `[history-helix] picking buffer rebuilt: ${elapsed.toFixed(1)} ms, ${_strands.length} strands`,
  );

  _pickingDirty = false;

  // Store rebuild time for reporting
  window.__pickingRebuildMs = elapsed;
  window.__pickingReady = true;

  // Expose picking buffer for tests (so they can find strand positions)
  window.__pickingCanvas = _pickingCanvas;
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
 * Pick the strand at the given screen coordinates using the id-buffer.
 * Returns the strand object (with .person) or null if no strand is under the cursor.
 * @param {number} px - screen x (CSS pixels)
 * @param {number} py - screen y (CSS pixels)
 * @returns {object|null} the strand object or null
 */
export function pickStrand(px, py) {
  if (!_pickingCtx || _strands.length === 0) return null;
  if (_pickingDirty) return null; // stale buffer, don't pick

  const dpr = window.devicePixelRatio || 1;
  const bx = Math.round(px * dpr);
  const by = Math.round(py * dpr);

  // Bounds check
  if (bx < 0 || by < 0 || bx >= _pickingCanvas.width || by >= _pickingCanvas.height) {
    return null;
  }

  const pixel = _pickingCtx.getImageData(bx, by, 1, 1).data;
  const r = pixel[0];
  const g = pixel[1];
  const b = pixel[2];
  const a = pixel[3];

  // Transparent = no strand hit
  if (a === 0) return null;

  const index = (r << 16) | (g << 8) | b;

  if (index >= 0 && index < _strands.length) {
    return _strands[index];
  }

  return null;
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

  // Person tooltip (B-4)
  if (info.name !== undefined) {
    const bLabel = info.birth < 0 ? `${Math.abs(info.birth)} BCE` : `${info.birth} CE`;
    const dLabel = info.death < 0 ? `${Math.abs(info.death)} BCE` : `${info.death} CE`;
    const url = info.sourceUrl || "";
    let html = `<strong>${info.name}</strong><br><small>${bLabel} – ${dLabel}</small>`;
    if (url) {
      html += `<br><a href="${url}" target="_blank" rel="noopener">wikidata</a>`;
    }
    return html;
  }

  // Legacy strand tooltip (synthetic)
  if (info.birthYear !== undefined) {
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

/**
 * Show tooltip for an event at specific screen coordinates.
 * Used by keyboard navigation (Enter/Space on focused circles).
 * @param {object} event - event record
 * @param {number} sx - screen x
 * @param {number} sy - screen y
 */
export function showTooltipForEvent(event, sx, sy) {
  _showTooltip(event, sx, sy);
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
      _clearStrandHover();
      _showTooltip(event, px, py);
      if (_onHighlight) _onHighlight({ event });
    }
    return;
  }

  // Check strands via picking buffer
  const strand = pickStrand(px, py);
  if (strand && strand.person) {
    const idx = _strands.indexOf(strand);
    if (idx !== _hoveredStrandIndex) {
      _hoveredStrandIndex = idx;
      _hoveredEvent = null;
      _showTooltip(strand.person, px, py);
      if (_onHighlight) _onHighlight(null);
      // Trigger render for highlight
      _requestRender();
    }
    return;
  }

  // Nothing hit
  if (_hoveredEvent || _hoveredStrandIndex >= 0) {
    _hoveredEvent = null;
    _clearStrandHover();
    _hideTooltip();
    if (_onHighlight) _onHighlight(null);
    _requestRender();
  }
}

function _onPointerLeave() {
  _hoveredEvent = null;
  _clearStrandHover();
  _hideTooltip();
  if (_onHighlight) _onHighlight(null);
  _requestRender();
}

function _clearStrandHover() {
  _hoveredStrandIndex = -1;
}

// ── Render trigger ──────────────────────────────────────────

let _renderCallback = null;

/**
 * Register a callback to request a re-render when hover state changes.
 * @param {function} cb
 */
export function onHoverRenderRequest(cb) {
  _renderCallback = cb;
}

function _requestRender() {
  if (_renderCallback) _renderCallback();
}