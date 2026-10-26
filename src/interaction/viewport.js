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
    case "+":
    case "=":
      // Zoom in at screen center
      zoom(1.1, _screenW / 2, _screenH / 2);
      return true;
    case "-":
    case "_":
      // Zoom out at screen center
      zoom(0.9, _screenW / 2, _screenH / 2);
      return true;
    default:
      return false;
  }
}

// ── Mouse/touch event wiring ────────────────────────────────

let _dragging = false;
let _lastX = 0;
let _lastY = 0;

// Multi-touch gesture state
const _touchPointers = new Map();  // pointerId → {clientX, clientY}
let _pinchDist = 0;
let _pinchCx = 0;
let _pinchCy = 0;
let _isPinching = false;
const _pinchFresh = new Set();  // pointerIds that have moved this frame

/**
 * Wire pan/zoom to a canvas element's pointer events.
 * Supports mouse drag (pan), wheel (zoom), one-finger touch pan,
 * and two-finger pinch zoom — all through Pointer Events.
 * @param {HTMLCanvasElement} canvas
 */
export function wireCanvas(canvas) {
  // Ensure the browser doesn't steal touch gestures for page scroll
  canvas.style.touchAction = "none";

  // ── pointerdown ──
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") {
      _touchPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

      if (_touchPointers.size === 1) {
        // One finger: start pan
        _dragging = true;
        _lastX = e.clientX;
        _lastY = e.clientY;
        _isPinching = false;
      } else if (_touchPointers.size === 2) {
        // Two fingers: start pinch
        const pts = [..._touchPointers.values()];
        _pinchDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        _pinchCx = (pts[0].clientX + pts[1].clientX) / 2;
        _pinchCy = (pts[0].clientY + pts[1].clientY) / 2;
        _isPinching = true;
        _dragging = false;
        _pinchFresh.clear();
      }
    } else {
      // Mouse drag
      _dragging = true;
      _lastX = e.clientX;
      _lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  // ── pointermove ──
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") {
      if (!_touchPointers.has(e.pointerId)) return;
      _touchPointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

      if (_isPinching && _touchPointers.size >= 2) {
        // Wait for both tracked fingers to report fresh positions
        _pinchFresh.add(e.pointerId);
        if (_pinchFresh.size < 2) return;

        // Two-finger pinch zoom — both fingers have fresh data
        const pts = [..._touchPointers.values()].slice(0, 2);
        const newDist = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        const newCx = (pts[0].clientX + pts[1].clientX) / 2;
        const newCy = (pts[0].clientY + pts[1].clientY) / 2;

        if (_pinchDist > 0 && newDist > 0) {
          // Pan to follow midpoint movement (grab-and-drag)
          pan(newCx - _pinchCx, newCy - _pinchCy);

          // Zoom at the new midpoint
          const factor = newDist / _pinchDist;
          zoom(factor, newCx, newCy);
        }

        _pinchDist = newDist;
        _pinchCx = newCx;
        _pinchCy = newCy;
        _pinchFresh.clear();
      } else if (_dragging && _touchPointers.size === 1) {
        // One-finger pan (same motion as mouse drag)
        const dx = e.clientX - _lastX;
        const dy = e.clientY - _lastY;
        _lastX = e.clientX;
        _lastY = e.clientY;
        pan(-dx, -dy);
      }
    } else if (_dragging) {
      // Mouse pan
      const dx = e.clientX - _lastX;
      const dy = e.clientY - _lastY;
      _lastX = e.clientX;
      _lastY = e.clientY;
      pan(-dx, -dy);
    }
  });

  // ── pointerup / pointercancel ──
  function _handleTouchEnd(e) {
    if (e.pointerType === "touch") {
      _touchPointers.delete(e.pointerId);

      if (_touchPointers.size === 0) {
        _dragging = false;
        _isPinching = false;
        _pinchDist = 0;
        _pinchFresh.clear();
      } else if (_touchPointers.size === 1 && _isPinching) {
        // Transition from pinch to single-finger pan
        const [pt] = [..._touchPointers.values()];
        _lastX = pt.clientX;
        _lastY = pt.clientY;
        _dragging = true;
        _isPinching = false;
        _pinchDist = 0;
        _pinchFresh.clear();
      }
    } else {
      _dragging = false;
    }
  }

  canvas.addEventListener("pointerup", _handleTouchEnd);
  canvas.addEventListener("pointercancel", _handleTouchEnd);

  canvas.addEventListener("pointerleave", () => {
    _dragging = false;
    _touchPointers.clear();
    _isPinching = false;
    _pinchDist = 0;
    _pinchFresh.clear();
  });

  // ── Wheel → zoom (scroll DOWN = zoom IN) ──
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    zoom(factor, e.clientX, e.clientY);
  }, { passive: false });
}