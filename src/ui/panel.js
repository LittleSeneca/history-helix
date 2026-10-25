// UI panel — legend, filter rail, era banner, search box, tooltip
// (DESIGN.md §4, §5.3)
//
// Creates and manages DOM elements for the interaction UI. All elements
// are positioned outside the canvas for crisp text rendering.
//
// Exports:
//   createPanel(container) → {tooltip, eraBanner, searchInput, filterRail, legend}
//   updateEraBanner(eraInfo)
//   updateFilterRail(categories, hiddenSet, onToggle)

import { getCurrentEra } from "../interaction/filters.js";

// ── Color palette for categories ────────────────────────────

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

const ERA_COLORS = {
  prehistory: "#8b9a8b",
  ancient: "#c49a6c",
  classical: "#d4a853",
  earlyModern: "#5a7d9a",
  industrial: "#4a6b5d",
  modern: "#c76b4a",
  future: "#7a5c8a",
};

// ── DOM creation ────────────────────────────────────────────

/**
 * Create all UI elements and append them to the container.
 * Returns references so other modules can update them.
 *
 * @param {HTMLElement} container — typically document.body
 * @returns {{tooltip: HTMLDivElement, eraBanner: HTMLDivElement,
 *            searchInput: HTMLInputElement, filterRail: HTMLDivElement,
 *            legend: HTMLDivElement}}
 */
export function createPanel(container) {
  const tooltip = _createTooltip(container);
  const eraBanner = _createEraBanner(container);
  const searchInput = _createSearchBox(container);
  const filterRail = _createFilterRail(container);
  const legend = _createLegend(container);

  return { tooltip, eraBanner, searchInput, filterRail, legend };
}

// ── Tooltip ─────────────────────────────────────────────────

function _createTooltip(container) {
  const el = document.createElement("div");
  el.id = "helix-tooltip";
  Object.assign(el.style, {
    position: "fixed",
    display: "none",
    pointerEvents: "none",
    zIndex: "1000",
    background: "rgba(11,11,14,0.92)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "4px",
    padding: "6px 10px",
    color: "#ddd",
    fontFamily: "sans-serif",
    fontSize: "12px",
    lineHeight: "1.5",
    maxWidth: "300px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
  el.innerHTML = "";
  container.appendChild(el);
  return el;
}

// ── Era banner ──────────────────────────────────────────────

function _createEraBanner(container) {
  const el = document.createElement("div");
  el.id = "helix-era-banner";
  Object.assign(el.style, {
    position: "fixed",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "100",
    background: "rgba(11,11,14,0.85)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "4px",
    padding: "4px 16px",
    color: "#aaa",
    fontFamily: "monospace",
    fontSize: "13px",
    pointerEvents: "none",
    transition: "opacity 0.2s",
  });
  el.textContent = "History Helix";
  container.appendChild(el);
  return el;
}

/**
 * Update the era banner text.
 * @param {HTMLDivElement} el
 * @param {{label:string, years:string, eraKey:string}} eraInfo
 */
export function updateEraBanner(el, eraInfo) {
  if (!el || !eraInfo) return;
  const color = ERA_COLORS[eraInfo.eraKey] || "#aaa";
  el.innerHTML = `<span style="color:${color}">${eraInfo.label}</span> · ${eraInfo.years}`;
}

// ── Search box ──────────────────────────────────────────────

function _createSearchBox(container) {
  const wrapper = document.createElement("div");
  wrapper.id = "helix-search";
  Object.assign(wrapper.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    zIndex: "100",
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Search events…";
  Object.assign(input.style, {
    background: "rgba(11,11,14,0.85)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "4px",
    padding: "4px 10px",
    color: "#ddd",
    fontFamily: "sans-serif",
    fontSize: "12px",
    width: "180px",
    outline: "none",
  });

  // Results dropdown
  const dropdown = document.createElement("div");
  dropdown.id = "helix-search-results";
  Object.assign(dropdown.style, {
    display: "none",
    position: "absolute",
    top: "100%",
    right: "0",
    marginTop: "4px",
    background: "rgba(11,11,14,0.95)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: "4px",
    maxHeight: "300px",
    overflowY: "auto",
    width: "280px",
  });

  wrapper.appendChild(input);
  wrapper.appendChild(dropdown);
  container.appendChild(wrapper);

  return { wrapper, input, dropdown };
}

// ── Filter rail ─────────────────────────────────────────────

function _createFilterRail(container) {
  const el = document.createElement("div");
  el.id = "helix-filters";
  Object.assign(el.style, {
    position: "fixed",
    left: "12px",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: "100",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  });
  container.appendChild(el);
  return el;
}

/**
 * Populate the filter rail with category toggle buttons.
 * @param {HTMLDivElement} rail
 * @param {string[]} categories
 * @param {Set<string>} hiddenSet
 * @param {function(string):boolean} onToggle — returns true if now visible
 */
export function updateFilterRail(rail, categories, hiddenSet, onToggle) {
  if (!rail) return;
  rail.innerHTML = "";

  for (const cat of categories) {
    const visible = !hiddenSet.has(cat);
    const color = CATEGORY_COLORS[cat] || "#888";

    const btn = document.createElement("button");
    btn.textContent = cat;
    Object.assign(btn.style, {
      display: "block",
      background: visible ? `${color}33` : "rgba(255,255,255,0.05)",
      border: `1px solid ${visible ? color : "rgba(255,255,255,0.1)"}`,
      borderRadius: "3px",
      padding: "3px 8px",
      color: visible ? color : "#666",
      fontFamily: "sans-serif",
      fontSize: "11px",
      cursor: "pointer",
      textAlign: "left",
      textTransform: "capitalize",
      transition: "all 0.15s",
    });

    btn.addEventListener("click", () => {
      const nowVisible = onToggle(cat);
      btn.style.background = nowVisible ? `${color}33` : "rgba(255,255,255,0.05)";
      btn.style.border = `1px solid ${nowVisible ? color : "rgba(255,255,255,0.1)"}`;
      btn.style.color = nowVisible ? color : "#666";
    });

    rail.appendChild(btn);
  }
}

// ── Legend ──────────────────────────────────────────────────

function _createLegend(container) {
  const el = document.createElement("div");
  el.id = "helix-legend";
  Object.assign(el.style, {
    position: "fixed",
    bottom: "12px",
    left: "12px",
    zIndex: "100",
    display: "flex",
    gap: "8px",
    fontFamily: "sans-serif",
    fontSize: "10px",
    color: "#888",
  });

  // Strand legend: era colors
  const strandPart = document.createElement("div");
  strandPart.innerHTML = "<span style='opacity:0.6'>strands:</span> ";

  for (const [era, color] of Object.entries(ERA_COLORS)) {
    const span = document.createElement("span");
    span.style.color = color;
    span.style.marginRight = "4px";
    span.textContent = era;
    strandPart.appendChild(span);
  }

  el.appendChild(strandPart);
  container.appendChild(el);
  return el;
}