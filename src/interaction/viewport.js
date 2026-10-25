// Viewport manager — pan/zoom/scrub, transform matrix, LOD recalculation
// (DESIGN.md §2.5, §5.1)
//
// Maintains a camera looking at the helix: view center in scene coordinates
// and zoom (pixels per scene unit). Exposes toScreen / toScene for all
// rendering and hit-testing code.
//
// LOD: on zoom settle, recomputes the sitelink threshold for event culling.

import { getBounds } from "../geometry/helix.js";
import { LOD_SITELINK_THRESHOLDS } from "../config.js";

// ── State ───────────────────────────────────────────────────

let _screenW = 800;
let _screenH = 600;
let _viewX = 0;    // scene-space x at screen center
let _viewY = 0;    // scene-space y at screen center
let _zoom = 1;     // pixels per scene unit
let _baseScale = 1;
let _lodThreshold = 0;
let _settleTimer = null;
let _onUpdate = null;
let _onLODChange = null;

// ── Initialization ──────────────────────────────────────────

/**
 * Initialize the viewport. Call once on app startup and on resize.
 * @param {number} screenW - viewport CSS width
 * @param {number} screenH - viewport CSS height
 */
export function resize(screenW, screenH) {
  _screenW = screenW;
  _screenH = screenH;

  const bounds = getBounds();
  const bw = bounds.xMax - bounds.xMin;
  const bh = bounds.yMax - bounds.yMin;

  _baseScale = Math.min((screenW * 0.9) / bw, (screenH * 0.9) / bh);

  // On first call, center on the helix
  if (_viewX === 0 && _viewY === 0) {
    _viewX = bounds.cx;
    _viewY = bounds.cy;
    _zoom = _baseScale;
  }

  recomputeLOD();
}

// ── Transform ───────────────────────────────────────────────

/**
 * Scene → screen. Returns pixel coordinates in the viewport.
 * @param {number} sx - scene x
 * @param {number} sy - scene y
 * @returns {{x:number, y:number}}
 */
export function toScreen(sx, sy) {
  return {
    x: (sx - _viewX) * _zoom + _screenW / 2,
    y: (sy - _viewY) * _zoom + _screenH / 2,
  };
}

/**
 * Screen → scene. Inverse of toScreen.
 * @param {number} px - screen pixel x
 * @param {number} py - screen pixel y
 * @returns {{x:number, y:number}}
 */
export function toScene(px, py) {
  return {
    x: (px - _screenW / 2) / _zoom + _viewX,
    y: (py - _screenH / 2) / _zoom + _viewY,
  };
}

/**
 * Current zoom level (pixels per scene unit).
 * @returns {number}
 */
export function getZoom() {
  return _zoom;
}

/**
 * Current view center in scene coordinates.
 * @returns {{x:number, y:number}}
 */
export function getViewCenter() {
  return { x: _viewX, y: _viewY };
}

// ── Pan ─────────────────────────────────────────────────────

/**
 * Pan the view by a screen-space delta (in pixels).
 * @param {number} dx - screen pixel delta x
 * @param {number} dy - screen pixel delta y
 */
export function pan(dx, dy) {
  _viewX -= dx / _zoom;
  _viewY -= dy / _zoom;
  _fireUpdate();
}

// ── Zoom ────────────────────────────────────────────────────

/**
 * Zoom about a given screen point by a multiplicative factor.
 * factor > 1 = zoom in, factor < 1 = zoom out.
 *
 * @param {number} factor  - multiplicative zoom change
 * @param {number} centerX - screen pixel x to zoom about
 * @param {number} centerY - screen pixel y to zoom about
 */
export function zoom(factor, centerX, centerY) {
  const oldZoom = _zoom;
  _zoom *= factor;

  // Clamp
  _zoom = Math.max(_baseScale * 0.1, Math.min(_zoom, _baseScale * 20));

  const actualFactor = _zoom / oldZoom;

  // Adjust view center so the point under the cursor stays fixed
  if (actualFactor !== 1) {
    const sceneAtCursor = toScene(centerX, centerY);
    _viewX = sceneAtCursor.x - (centerX - _screenW / 2) / _zoom;
    _viewY = sceneAtCursor.y - (centerY - _screenH / 2) / _zoom;
  }

  _fireUpdate();

  // Debounced LOD recompute
  clearTimeout(_settleTimer);
  _settleTimer = setTimeout(() => {
    recomputeLOD();
  }, 250);
}

// ── Scrub ───────────────────────────────────────────────────

/**
 * Move the view along the helix axis (time dimension) by delta years.
 * @param {number} deltaYears - years to advance (positive = forward in time)
 */
export function scrub(deltaYears) {
  // Approximate: find a u change and move view center along the coil
  // For simplicity, adjust viewY (the coil climbs vertically in scene space)
  // A better approach: move along the helix spine
  // But for now: simple Y pan proportional to years on the coil
  const bounds = getBounds();
  const coilHeight = bounds.yMax - bounds.yMin;
  const totalYears = 2100 - (-10000); // 12100
  const dy = -(deltaYears / totalYears) * coilHeight;

  _viewY += dy;
  _fireUpdate();
}

// ── Jump to ─────────────────────────────────────────────────

/**
 * Jump the view to center on a specific scene point.
 * @param {number} sx
 * @param {number} sy
 */
export function jumpTo(sx, sy) {
  _viewX = sx;
  _viewY = sy;
  _fireUpdate();
}

// ── LOD ─────────────────────────────────────────────────────

function recomputeLOD() {
  const zoomFrac = (_zoom - _baseScale * 0.1) / (_baseScale * 20 - _baseScale * 0.1);
  const clampedFrac = Math.max(0, Math.min(1, zoomFrac));

  // Find the threshold for this zoom level
  let threshold = 0;
  for (const level of LOD_SITELINK_THRESHOLDS) {
    if (clampedFrac >= level.zoom) {
      threshold = level.min;
    }
  }

  if (threshold !== _lodThreshold) {
    _lodThreshold = threshold;
    if (_onLODChange) _onLODChange(threshold);
  }
}

/**
 * Current LOD sitelink threshold: events with fewer sitelinks are hidden.
 * @returns {number}
 */
export function getLODThreshold() {
  return _lodThreshold;
}

// ── Callbacks ───────────────────────────────────────────────

/**
 * Register callbacks for viewport changes.
 * @param {function} onUpdate    - called after every pan/zoom/scrub
 * @param {function} [onLODChange] - called when the LOD threshold changes
 */
export function onUpdate(onUpdate, onLODChange) {
  _onUpdate = onUpdate;
  if (onLODChange) _onLODChange = onLODChange;
}

function _fireUpdate() {
  if (_onUpdate) _onUpdate();
}

// ── Keyboard scrub ──────────────────────────────────────────

/**
 * Handle keyboard events for navigation (arrow keys).
 * Returns true if the event was handled.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
export function handleKeyboard(e) {
  const STEP = 50; // scene units per keypress
  switch (e.key) {
    case "ArrowLeft":
      pan(STEP, 0);
      return true;
    case "ArrowRight":
      pan(-STEP, 0);
      return true;
    case "ArrowUp":
      pan(0, STEP);
      return true;
    case "ArrowDown":
      pan(0, -STEP);
      return true;
    default:
      return false;
  }
}

// ── Mouse/touch event wiring ────────────────────────────────

let _dragging = false;
let _lastX = 0;
let _lastY = 0;

/**
 * Wire pan/zoom to a canvas element's pointer events.
 * @param {HTMLCanvasElement} canvas
 */
export function wireCanvas(canvas) {
  // Pointer down → start drag
  canvas.addEventListener("pointerdown", (e) => {
    _dragging = true;
    _lastX = e.clientX;
    _lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  // Pointer move → pan if dragging
  canvas.addEventListener("pointermove", (e) => {
    if (_dragging) {
      const dx = e.clientX - _lastX;
      const dy = e.clientY - _lastY;
      _lastX = e.clientX;
      _lastY = e.clientY;
      pan(-dx, -dy);
    }
  });

  // Pointer up → end drag
  canvas.addEventListener("pointerup", () => {
    _dragging = false;
  });

  canvas.addEventListener("pointerleave", () => {
    _dragging = false;
  });

  // Wheel → zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    zoom(factor, e.clientX, e.clientY);
  }, { passive: false });
}