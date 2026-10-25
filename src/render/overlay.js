// SVG overlay rendering — era markers, event markers, leader lines, labels
// (DESIGN.md §2.4, §4.4)
//
// Uses the viewport module's toScreen() for transforms.
// Emits event anchor positions for hover hit-testing via a callback.

import { project, u, depth, tMin, tMax } from "../geometry/helix.js";
import { TURNS, TRACK_GAP, LABEL_OFFSET_X, colors, LOD_SITELINK_THRESHOLDS } from "../config.js";
import { assignTracks, maxTrack, decolideAllLabels } from "./labels.js";
import { toScreen, getLODThreshold } from "../interaction/viewport.js";

const SPINE_SAMPLES = 2000;

// Category → stroke color
const CATEGORY_COLORS = {
  war: "#c76b4a",
  politics: "#d4a853",
  science: "#5a7d9a",
  exploration: "#8b9a8b",
  religion: "#7a5c8a",
  culture: "#c49a6c",
  disaster: "#4a6b5d",
  economy: "#4a6b5d",
};

/** @type {function|null} callback receiving {event, sx, sy}[] after each render */
let _onAnchorsRendered = null;

/**
 * Register a callback to receive event anchor positions after each overlay render.
 * @param {function} cb — receives array of {event, sx, sy}
 */
export function onAnchorsRendered(cb) {
  _onAnchorsRendered = cb;
}

// ── Era marker definitions ──────────────────────────────────

const ERA_MARKERS = [
  { year: -2000, label: "2,000 BCE" },
  { year: -1000, label: "1,000 BCE" },
  { year: -500, label: "500 BCE" },
  { year: 1, label: "1 CE" },
  { year: 500, label: "500 CE" },
  { year: 1000, label: "1000 CE" },
  { year: 1500, label: "1500 CE" },
  { year: 1800, label: "1800 CE" },
  { year: 1900, label: "1900 CE" },
  { year: 1950, label: "1950 CE" },
  { year: 2000, label: "2000 CE" },
  { year: 2026, label: "2026 CE" },
];

/**
 * Compute screen-space positions for all era/millennium tick labels.
 * Filters out markers outside the visible timeline range.
 * @returns {Array<{year: number, label: string, anchorX: number, anchorY: number, labelScreenX: number, labelScreenY: number}>}
 */
function computeEraScreenPositions() {
  const results = [];
  for (const era of ERA_MARKERS) {
    const up = u(era.year);
    if (up < 0 || up > 1) continue;
    const p = project(up);
    const s = toScreen(p.x, p.y);
    results.push({
      year: era.year,
      label: era.label,
      anchorX: s.x,
      anchorY: s.y,
      labelScreenX: s.x + 8,
      labelScreenY: s.y + 4,
    });
  }
  return results;
}

// ── Main draw entry point ───────────────────────────────────

/**
 * Draw the full SVG overlay on the given SVG element.
 *
 * Phase 1: compute all label positions in screen space (events + era ticks).
 * Phase 2: draw every label at its provisional Y, collecting a ref per text
 *          element (key → textEl + optional leader line + baseline Y).
 * Phase 3: measure each rendered text's getBBox() and run height-aware
 *          de-collision over the actual bounding boxes.
 * Phase 4: apply the resulting shifts to text baselines and leader-line ends.
 *
 * @param {SVGSVGElement} svg
 * @param {number} vw - viewport width (screen pixels)
 * @param {number} vh - viewport height (screen pixels)
 * @param {Object[]} events - normalized event records from events.json
 * @param {Set<string>} [hiddenCategories] - categories to hide
 */
export function drawOverlay(svg, vw, vh, events, hiddenCategories) {
  // Clear SVG
  while (svg.firstChild) svg.firstChild.remove();

  // Create main group
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(g);

  // 1. Helix guide line (subtle)
  drawHelixGuide(g);

  // ── Phase 1: Compute positions in screen space ─────────────

  const eraScreen = computeEraScreenPositions();
  const eventData = computeEventPlacements(events, hiddenCategories);

  // ── Phase 2: Draw at provisional Y, collecting text refs ───
  // Each ref links a rendered <text> (and its leader line, for event
  // labels) to its key + baseline screenY, so the measured-height
  // de-collision pass can nudge it down without redrawing.

  /** @type {Array<{key:string, screenX:number, screenY:number, textEl:SVGTextElement, lineEl:SVGPolylineElement|null}>} */
  const refs = [];
  drawEraMarkers(g, eraScreen, refs);

  const anchorList = [];
  if (eventData.positioned.length > 0) {
    drawEvents(g, eventData.positioned, eventData.placements, anchorList, refs);
  }

  // ── Phase 3: measure boxes, de-collide by real height ──────

  const boxes = refs.map((r) => {
    const box = r.textEl.getBBox();
    return {
      key: r.key,
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      bottom: box.y + box.height,
    };
  });
  const shifts = decolideAllLabels(boxes);

  // ── Phase 4: apply shifts to text baselines + leader lines ─

  applyLabelShifts(refs, shifts);

  // Store on window for keyboard tooltip access
  window.__lastAnchors = anchorList;

  // Notify hover system
  if (_onAnchorsRendered) {
    _onAnchorsRendered(anchorList);
  }
}

// ── Event placement (filtering + track assignment, no drawing) ─

/**
 * @typedef {Object} EventPlacementData
 * @property {Object[]} positioned - events with anchorX, anchorY, depth
 * @property {import("./labels.js").LabelPlacement[]} placements - track assignments
 */

/**
 * Filter, sort, position, and assign tracks for events.
 * Pure computation — no DOM access.
 *
 * @param {Object[]} events
 * @param {Set<string>} [hiddenCategories]
 * @returns {EventPlacementData}
 */
function computeEventPlacements(events, hiddenCategories) {
  if (!events || events.length === 0) {
    return { positioned: [], placements: [] };
  }

  const lodThreshold = getLODThreshold();

  // Filter by LOD sitelink threshold
  const filtered = events.filter(
    (e) => (e.sitelinks || 0) >= lodThreshold,
  );

  // Filter by hidden categories
  const visible = hiddenCategories
    ? filtered.filter((e) => !hiddenCategories.has(e.category))
    : filtered;

  // Sort by sitelinks desc, cap at 200
  const sorted = [...visible].sort((a, b) => b.sitelinks - a.sitelinks);
  const toShow = sorted.slice(0, 200);

  if (toShow.length === 0) {
    return { positioned: [], placements: [] };
  }

  // Compute anchor positions
  const positioned = toShow.map((e) => {
    const up = u(e.year);
    const p = project(up);
    return {
      ...e,
      anchorX: p.x,
      anchorY: p.y,
      depth: depth(up),
    };
  });

  // Assign tracks (includes scene-space de-collision pass)
  const placements = assignTracks(positioned);

  return { positioned, placements };
}

// ── Drawing helpers ─────────────────────────────────────────

/**
 * Draw the subtle helix guide line on the SVG overlay.
 */
function drawHelixGuide(g) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  let d = "";

  for (let i = 0; i <= SPINE_SAMPLES; i++) {
    const up = i / SPINE_SAMPLES;
    const p = project(up);
    const s = toScreen(p.x, p.y);
    if (i === 0) {
      d += `M ${s.x} ${s.y}`;
    } else {
      d += ` L ${s.x} ${s.y}`;
    }
  }

  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#5a7d9a");
  path.setAttribute("stroke-width", "0.5");
  path.setAttribute("opacity", "0.25");
  path.setAttribute("pointer-events", "none");
  g.appendChild(path);
}

/**
 * Draw era/millennium tick marks at their original anchor positions,
 * and label text at its provisional screen Y. The label text is measured
 * and de-collided (height-aware) after all drawing; the tick stays put.
 *
 * @param {SVGGElement} g
 * @param {Array<{year:number, label:string, anchorX:number, anchorY:number, labelScreenX:number, labelScreenY:number}>} eraScreen
 * @param {Array} refs - output: pushed label refs for the de-collision pass
 */
function drawEraMarkers(g, eraScreen, refs) {
  for (let i = 0; i < eraScreen.length; i++) {
    const era = eraScreen[i];

    // Tick mark at original anchor position (does not move)
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", era.anchorX - 4);
    tick.setAttribute("y1", era.anchorY);
    tick.setAttribute("x2", era.anchorX + 4);
    tick.setAttribute("y2", era.anchorY);
    tick.setAttribute("stroke", "#8b9a8b");
    tick.setAttribute("stroke-width", "0.5");
    tick.setAttribute("opacity", "0.5");
    tick.setAttribute("pointer-events", "none");
    g.appendChild(tick);

    // Label at provisional Y (measured + de-collided after all drawing)
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", era.labelScreenX);
    text.setAttribute("y", era.labelScreenY);
    text.setAttribute("fill", "#8b9a8b");
    text.setAttribute("font-family", "monospace");
    text.setAttribute("font-size", "9");
    text.setAttribute("opacity", "0.6");
    text.setAttribute("pointer-events", "none");
    text.setAttribute("data-label-key", `era:${i}`);
    text.textContent = era.label;
    g.appendChild(text);

    refs.push({
      key: `era:${i}`,
      screenX: era.labelScreenX,
      screenY: era.labelScreenY,
      textEl: text,
      lineEl: null,
    });
  }
}

/**
 * Draw event markers with leader lines and labels.
 * Leader lines terminate at the label position (de-collided later).
 * Emits {event, sx, sy} for each visible event anchor.
 *
 * @param {SVGGElement} g
 * @param {Object[]} positioned - events with anchorX, anchorY, depth, plus event fields
 * @param {import("./labels.js").LabelPlacement[]} placements - track assignments
 * @param {Object[]} anchorList - output: filled with {event, sx, sy}
 * @param {Array} refs - output: pushed label refs for the de-collision pass
 */
function drawEvents(g, positioned, placements, anchorList, refs) {
  for (let i = 0; i < positioned.length; i++) {
    const e = positioned[i];
    const pl = placements[i];
    if (!pl || pl.clusterSize === 0) continue; // absorbed into cluster

    const color = CATEGORY_COLORS[e.category] || "#c49a6c";

    // Anchor point in screen space
    const anchor = toScreen(e.anchorX, e.anchorY);

    // Emit anchor for hover
    anchorList.push({ event: e, sx: anchor.x, sy: anchor.y });

    // Label position — provisional baseline Y (scene-space labelY),
    // de-collided height-aware after all drawing
    const labelXDir = pl.side === "left" ? -1 : 1;
    const trackOffset = LABEL_OFFSET_X + pl.track * 20;
    const labelX = anchor.x + labelXDir * trackOffset;

    const labelY = pl.labelY != null
      ? toScreen(e.anchorX, pl.labelY).y + 4
      : anchor.y + 4;

    // Elbow point (midway in X, same Y as anchor)
    const elbowX = anchor.x + labelXDir * LABEL_OFFSET_X * 0.6;

    // Leader line — provisional end point (shifted later)
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    const pts = `${anchor.x},${anchor.y} ${elbowX},${anchor.y} ${labelX},${labelY}`;
    line.setAttribute("points", pts);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "0.6");
    line.setAttribute("opacity", "0.4");
    line.setAttribute("pointer-events", "none");
    line.setAttribute("data-event-id", e.id || "");
    line.setAttribute("data-category", e.category || "");
    line.setAttribute("data-label-key", `event:${i}`);
    g.appendChild(line);

    // Event marker (small circle at anchor) — keyboard-focusable
    const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circ.setAttribute("cx", anchor.x);
    circ.setAttribute("cy", anchor.y);
    circ.setAttribute("r", "3");
    circ.setAttribute("fill", color);
    circ.setAttribute("opacity", "0.8");
    circ.setAttribute("pointer-events", "auto");
    circ.setAttribute("tabindex", "0");
    circ.setAttribute("role", "button");
    const yearLabel = e.year < 0 ? `${Math.abs(e.year)} BCE` : `${e.year} CE`;
    circ.setAttribute("aria-label", `${e.title || "Event"} — ${yearLabel}, ${e.category || ""}`);
    circ.setAttribute("data-event-id", e.id || "");
    circ.setAttribute("data-category", e.category || "");
    g.appendChild(circ);

    // Label text at provisional Y (measured + de-collided after all drawing)
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const textAnchor = pl.side === "left" ? "end" : "start";
    const tx = pl.side === "left" ? labelX - 4 : labelX + 4;

    text.setAttribute("x", tx);
    text.setAttribute("y", labelY);
    text.setAttribute("text-anchor", textAnchor);
    text.setAttribute("fill", color);
    text.setAttribute("font-family", "sans-serif");
    text.setAttribute("font-size", "10");
    text.setAttribute("opacity", "0.8");
    text.setAttribute("pointer-events", "none");
    text.setAttribute("data-event-id", e.id || "");
    text.setAttribute("data-category", e.category || "");
    text.setAttribute("data-label-key", `event:${i}`);

    if (pl.clustered && pl.clusterSize > 1) {
      text.textContent = `+${pl.clusterSize} more`;
      text.setAttribute("font-weight", "bold");
    } else {
      const yearLabel = e.year < 0 ? `${Math.abs(e.year)} BCE` : `${e.year} CE`;
      const maxLen = 30;
      let title = e.title;
      if (title.length > maxLen) title = title.slice(0, maxLen - 1) + "\u2026";
      text.textContent = `${title} (${yearLabel})`;
    }

    g.appendChild(text);

    refs.push({
      key: `event:${i}`,
      screenX: labelX,
      screenY: labelY,
      textEl: text,
      lineEl: line,
    });
  }
}

/**
 * Apply the height-aware de-collision shifts to each text baseline and,
 * for event labels, to the end point of its leader line.
 *
 * @param {Array<{key:string, screenY:number, textEl:SVGTextElement, lineEl:SVGPolylineElement|null}>} refs
 * @param {Map<string, number>} shifts - vertical shift (px) per key
 */
function applyLabelShifts(refs, shifts) {
  for (const r of refs) {
    const shift = shifts.get(r.key) ?? 0;
    if (shift === 0) continue;

    r.textEl.setAttribute("y", String(r.screenY + shift));

    if (r.lineEl) {
      const points = r.lineEl.getAttribute("points").trim().split(/\s+/);
      const last = points[points.length - 1].split(",");
      last[1] = String(r.screenY + shift);
      points[points.length - 1] = last.join(",");
      r.lineEl.setAttribute("points", points.join(" "));
    }
  }
}
