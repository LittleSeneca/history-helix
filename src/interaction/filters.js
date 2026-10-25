// Interaction filters — category toggles, era banner, search-jump
// (DESIGN.md §5.3)
//
// Category filters: toggle event categories on/off. Hidden categories
// remove their markers and leader lines from both canvas and SVG.
//
// Era banner: shows the current era at the view center (or cursor).
// Arrow key scrub moves the era readout.
//
// Search: jump the view to an event by name substring.

import { getViewCenter, getZoom, jumpTo } from "./viewport.js";
import { u as toU, project, tMin, tMax } from "../geometry/helix.js";

// ── Category filter state ───────────────────────────────────

/** @type {Set<string>} categories currently hidden */
const hiddenCategories = new Set();

/** @type {function|null} callback fired when filters change */
let _onFiltersChanged = null;

/**
 * Toggle visibility of a category.
 * @param {string} category
 * @returns {boolean} true if now visible
 */
export function toggleCategory(category) {
  if (hiddenCategories.has(category)) {
    hiddenCategories.delete(category);
    _fireFiltersChanged();
    return true;
  } else {
    hiddenCategories.add(category);
    _fireFiltersChanged();
    return false;
  }
}

/**
 * Check if a category is currently visible.
 * @param {string} category
 * @returns {boolean}
 */
export function isCategoryVisible(category) {
  return !hiddenCategories.has(category);
}

/**
 * Get all hidden categories.
 * @returns {string[]}
 */
export function getHiddenCategories() {
  return [...hiddenCategories];
}

/**
 * Get all known categories from the current event data.
 * @param {object[]} events
 * @returns {string[]} unique sorted category names
 */
export function getCategories(events) {
  const cats = new Set();
  for (const e of events) {
    if (e.category) cats.add(e.category);
  }
  return [...cats].sort();
}

/**
 * Register a callback for when filters change.
 * @param {function} cb
 */
export function onFiltersChanged(cb) {
  _onFiltersChanged = cb;
}

function _fireFiltersChanged() {
  if (_onFiltersChanged) _onFiltersChanged();
}

// ── Era banner ──────────────────────────────────────────────

/**
 * Get the era at the current view center.
 * @returns {{label:string, years:string, eraKey:string}}
 */
export function getCurrentEra() {
  const center = getViewCenter();

  // Find the u value closest to the view center
  let bestU = 0;
  let bestDist = Infinity;
  const N = 100;

  for (let i = 0; i <= N; i++) {
    const up = i / N;
    const p = project(up);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestU = up;
    }
  }

  const year = Math.round(tMin + bestU * (tMax - tMin));
  const eraKey = _eraKeyForYear(year);
  const eraLabel = _eraLabel(eraKey);

  const yearAbs = Math.abs(year);
  const yearLabel = year < 0 ? `${yearAbs} BCE` : `${year} CE`;

  return { label: eraLabel, years: yearLabel, eraKey };
}

function _eraKeyForYear(y) {
  if (y < -3000) return "prehistory";
  if (y < 500) return "ancient";
  if (y < 1500) return "classical";
  if (y < 1800) return "earlyModern";
  if (y < 1950) return "industrial";
  if (y < 2020) return "modern";
  return "future";
}

function _eraLabel(key) {
  const labels = {
    prehistory: "Prehistory",
    ancient: "Ancient Era",
    classical: "Classical Era",
    earlyModern: "Early Modern",
    industrial: "Industrial Age",
    modern: "Modern Era",
    future: "Future",
  };
  return labels[key] || key;
}

// ── Search ──────────────────────────────────────────────────

/** @type {object[]} current event list for search */
let _searchEvents = [];

/**
 * Set the event list for search indexing.
 * @param {object[]} events
 */
export function setSearchEvents(events) {
  _searchEvents = events;
}

/**
 * Search events by name substring. Returns matches sorted by sitelinks desc.
 * @param {string} query
 * @returns {object[]} matching events (up to 10)
 */
export function searchEvents(query) {
  if (!query || query.length < 2) return [];

  const q = query.toLowerCase();
  const matches = _searchEvents.filter(
    (e) => e.title && e.title.toLowerCase().includes(q),
  );

  matches.sort((a, b) => (b.sitelinks || 0) - (a.sitelinks || 0));
  return matches.slice(0, 10);
}

/**
 * Jump the view to a specific event's anchor on the helix.
 * @param {object} event
 * @returns {object|null} the event if jumped, null if invalid
 */
export function jumpToEvent(event) {
  if (!event || event.year === undefined) return null;

  const up = toU(event.year);
  if (up < 0 || up > 1) return null;

  const p = project(up);
  jumpTo(p.x, p.y);
  return event;
}

// ── Time range display ──────────────────────────────────────

/**
 * Get human-readable description of the visible time span.
 * @returns {string}
 */
export function getTimeRangeLabel() {
  const z = getZoom();
  const center = getViewCenter();

  // Approximate: find years near the edges of the viewport
  let bestU = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= 100; i++) {
    const up = i / 100;
    const p = project(up);
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestU = up;
    }
  }

  const year = Math.round(tMin + bestU * (tMax - tMin));
  const absY = Math.abs(year);
  return year < 0 ? `${absY} BCE` : `${year} CE`;
}