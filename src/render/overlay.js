// SVG overlay rendering — era markers, event markers, leader lines, labels
// (DESIGN.md §2.4, §4.4)

import { project, u, depth, tMin, tMax, getBounds } from "../geometry/helix.js";
import { TURNS, TRACK_GAP, LABEL_OFFSET_X, colors } from "../config.js";
import { assignTracks, maxTrack } from "./labels.js";

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

/**
 * Draw the full SVG overlay on the given SVG element.
 * @param {SVGSVGElement} svg
 * @param {number} vw - viewport width
 * @param {number} vh - viewport height
 * @param {Object[]} events - normalized event records from events.json
 * @param {number} [padding=0.9]
 */
export function drawOverlay(svg, vw, vh, events, padding = 0.9) {
  const bounds = getBounds();
  const bw = bounds.xMax - bounds.xMin;
  const bh = bounds.yMax - bounds.yMin;
  const scale = Math.min((vw * padding) / bw, (vh * padding) / bh);
  const cx = vw / 2;
  const cy = vh / 2;

  // Transform from scene space to SVG space
  function toScreen(sx, sy) {
    return {
      x: cx + (sx - bounds.cx) * scale,
      y: cy + (sy - bounds.cy) * scale,
    };
  }

  // Clear SVG
  while (svg.firstChild) svg.firstChild.remove();

  // Create main group with transform
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(g);

  // ── 1. Helix guide line (subtle) ──────────────────────────
  drawHelixGuide(g, bounds, scale, cx, cy);

  // ── 2. Era markers (century tick labels) ──────────────────
  drawEraMarkers(g, bounds, scale, cx, cy);

  // ── 3. Event markers + leader lines + labels ──────────────
  if (events && events.length > 0) {
    drawEvents(g, events, bounds, scale, cx, cy, vw, vh);
  }
}

/**
 * Draw the subtle helix guide line on the SVG overlay.
 */
function drawHelixGuide(g, bounds, scale, cx, cy) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  let d = "";

  for (let i = 0; i <= SPINE_SAMPLES; i++) {
    const up = i / SPINE_SAMPLES;
    const p = project(up);
    const sx = cx + (p.x - bounds.cx) * scale;
    const sy = cy + (p.y - bounds.cy) * scale;
    if (i === 0) {
      d += `M ${sx} ${sy}`;
    } else {
      d += ` L ${sx} ${sy}`;
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
function drawEraMarkers(g, bounds, scale, cx, cy) {
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
    const sx = cx + (p.x - bounds.cx) * scale;
    const sy = cy + (p.y - bounds.cy) * scale;

    // Tick mark
    const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tick.setAttribute("x1", sx - 4);
    tick.setAttribute("y1", sy);
    tick.setAttribute("x2", sx + 4);
    tick.setAttribute("y2", sy);
    tick.setAttribute("stroke", "#8b9a8b");
    tick.setAttribute("stroke-width", "0.5");
    tick.setAttribute("opacity", "0.5");
    g.appendChild(tick);

    // Label
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", sx + 8);
    text.setAttribute("y", sy + 4);
    text.setAttribute("fill", "#8b9a8b");
    text.setAttribute("font-family", "monospace");
    text.setAttribute("font-size", "9");
    text.setAttribute("opacity", "0.6");
    text.textContent = era.label;
    g.appendChild(text);
  }
}

/**
 * Draw event markers with leader lines and labels.
 */
function drawEvents(g, events, bounds, scale, cx, cy, vw, vh) {
  // Filter: show top events by sitelinks (LOD)
  const sorted = [...events].sort((a, b) => b.sitelinks - a.sitelinks);
  const toShow = sorted.slice(0, 200); // cap at 200 labels to avoid explosion

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
  const maxT = maxTrack(placements) + 1;

  // Draw each event
  for (let i = 0; i < positioned.length; i++) {
    const e = positioned[i];
    const pl = placements[i];
    if (!pl || pl.clusterSize === 0) continue; // absorbed into cluster

    const color = CATEGORY_COLORS[e.category] || "#c49a6c";

    // Anchor point in screen space
    const anchor = {
      x: cx + (e.anchorX - bounds.cx) * scale,
      y: cy + (e.anchorY - bounds.cy) * scale,
    };

    // Label position
    const labelXDir = pl.side === "left" ? -1 : 1;
    const labelX = anchor.x + labelXDir * (LABEL_OFFSET_X + pl.track * 20);
    const labelY = anchor.y;

    // Elbow point (midway in X, same Y as anchor)
    const elbowX = anchor.x + labelXDir * LABEL_OFFSET_X * 0.6;

    // ── Leader line ─────────────────────────────────────
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    const pts = `${anchor.x},${anchor.y} ${elbowX},${anchor.y} ${labelX},${labelY}`;
    line.setAttribute("points", pts);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "0.6");
    line.setAttribute("opacity", "0.4");
    line.setAttribute("pointer-events", "none");
    g.appendChild(line);

    // ── Event marker (small circle at anchor) ───────────
    const circ = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circ.setAttribute("cx", anchor.x);
    circ.setAttribute("cy", anchor.y);
    circ.setAttribute("r", "2.5");
    circ.setAttribute("fill", color);
    circ.setAttribute("opacity", "0.7");
    circ.setAttribute("pointer-events", "none");
    g.appendChild(circ);

    // ── Label ───────────────────────────────────────────
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

    if (pl.clustered && pl.clusterSize > 1) {
      text.textContent = `+${pl.clusterSize} more`;
      text.setAttribute("font-weight", "bold");
    } else {
      const yearLabel = e.year < 0 ? `${Math.abs(e.year)} BCE` : `${e.year} CE`;
      const maxLen = 30;
      let title = e.title;
      if (title.length > maxLen) title = title.slice(0, maxLen - 1) + "…";
      text.textContent = `${title} (${yearLabel})`;
    }

    g.appendChild(text);
  }
}