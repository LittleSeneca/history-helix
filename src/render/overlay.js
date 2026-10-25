// SVG overlay rendering — era markers, event markers, leader lines, labels
// (DESIGN.md §2.4, §4.4)
//
// Uses the viewport module's toScreen() for transforms.
// Emits event anchor positions for hover hit-testing via a callback.

import { project, u, depth, tMin, tMax } from "../geometry/helix.js";
import { TURNS, TRACK_GAP, LABEL_OFFSET_X, colors, LOD_SITELINK_THRESHOLDS } from "../config.js";
import { assignTracks, maxTrack } from "./labels.js";
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

/**
 * Draw the full SVG overlay on the given SVG element.
 * @param {SVGSVGElement} svg
 * @param {number} vw - viewport width
 * @param {number} vh - viewport height
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

  // 2. Era markers (century tick labels)
  drawEraMarkers(g);

  // 3. Event markers + leader lines + labels
  const anchorList = [];
  if (events && events.length > 0) {
    drawEvents(g, events, hiddenCategories, anchorList);
  }

  // Notify hover system
  if (_onAnchorsRendered) {
    _onAnchorsRendered(anchorList);
  }
}

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
 * Draw century and era markers along the coil.
 */
function drawEraMarkers(g) {
  const eras = [
    { year: -10000, label: "10,000 BCE" },
    { year: -5000, label: "5,000 BCE" },
    { year: -3000, label: "3,000 BCE" },
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
    { year: 2100, label: "2100 CE" },
  ];

  for (const era of eras) {
    const up = u(era.year);
    if (up < 0 || up > 1) continue;
    const p = project(up);
    const s = toScreen(p.x, p.y);

    // Tick mark
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", s.x - 4);
    tick.setAttribute("y1", s.y);
    tick.setAttribute("x2", s.x + 4);
    tick.setAttribute("y2", s.y);
    tick.setAttribute("stroke", "#8b9a8b");
    tick.setAttribute("stroke-width", "0.5");
    tick.setAttribute("opacity", "0.5");
    tick.setAttribute("pointer-events", "none");
    g.appendChild(tick);

    // Label
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", s.x + 8);
    text.setAttribute("y", s.y + 4);
    text.setAttribute("fill", "#8b9a8b");
    text.setAttribute("font-family", "monospace");
    text.setAttribute("font-size", "9");
    text.setAttribute("opacity", "0.6");
    text.setAttribute("pointer-events", "none");
    text.textContent = era.label;
    g.appendChild(text);
  }
}

/**
 * Draw event markers with leader lines and labels.
 * Emits {event, sx, sy} for each visible event anchor.
 */
function drawEvents(g, events, hiddenCategories, anchorList) {
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

  if (toShow.length === 0) return;

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

  // Assign tracks
  const placements = assignTracks(positioned);

  // Draw each event
  for (let i = 0; i < positioned.length; i++) {
    const e = positioned[i];
    const pl = placements[i];
    if (!pl || pl.clusterSize === 0) continue; // absorbed into cluster

    const color = CATEGORY_COLORS[e.category] || "#c49a6c";

    // Anchor point in screen space
    const anchor = toScreen(e.anchorX, e.anchorY);

    // Emit anchor for hover
    anchorList.push({ event: e, sx: anchor.x, sy: anchor.y });

    // Label position
    const labelXDir = pl.side === "left" ? -1 : 1;
    const trackOffset = LABEL_OFFSET_X + pl.track * 20;
    const labelX = anchor.x + labelXDir * trackOffset;
    const labelY = anchor.y;

    // Elbow point (midway in X, same Y as anchor)
    const elbowX = anchor.x + labelXDir * LABEL_OFFSET_X * 0.6;

    // Leader line
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
    g.appendChild(line);

    // Event marker (small circle at anchor)
    const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circ.setAttribute("cx", anchor.x);
    circ.setAttribute("cy", anchor.y);
    circ.setAttribute("r", "3");
    circ.setAttribute("fill", color);
    circ.setAttribute("opacity", "0.8");
    circ.setAttribute("pointer-events", "none");
    circ.setAttribute("data-event-id", e.id || "");
    circ.setAttribute("data-category", e.category || "");
    g.appendChild(circ);

    // Label text
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const textAnchor = pl.side === "left" ? "end" : "start";
    const tx = pl.side === "left" ? labelX - 4 : labelX + 4;

    text.setAttribute("x", tx);
    text.setAttribute("y", labelY + 4);
    text.setAttribute("text-anchor", textAnchor);
    text.setAttribute("fill", color);
    text.setAttribute("font-family", "sans-serif");
    text.setAttribute("font-size", "10");
    text.setAttribute("opacity", "0.8");
    text.setAttribute("pointer-events", "none");
    text.setAttribute("data-event-id", e.id || "");
    text.setAttribute("data-category", e.category || "");

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
  }
}