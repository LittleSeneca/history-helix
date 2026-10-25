// Data loading and interpolation layer (DESIGN.md §3.2)
//
// Fetches demographics.json at runtime and provides
// linear-interpolated accessors: pop(year), lifeExp(year).

let _popData = null; // sorted array of {year, value}
let _leData = null; // sorted array of {year, value, estimated}

/**
 * Fetch and cache the demographics dataset.
 * Call once at bootstrap; returns the raw data.
 * @returns {Promise<object>}
 */
export async function loadDemographics() {
  const resp = await fetch("/data/demographics.json");
  if (!resp.ok) {
    throw new Error(`Failed to load demographics: ${resp.status}`);
  }
  const data = await resp.json();

  _popData = data.population;
  _leData = data.lifeExpectancy;

  return data;
}

// ── Linear interpolation helpers ────────────────────────────

/**
 * Linear interpolation over a sorted array of {year, value} points.
 * Clamps to the first/last value outside the range.
 *
 * @param {{year:number, value:number}[]} points - sorted by year ascending
 * @param {number} year
 * @returns {number}
 */
function lerp(points, year) {
  if (!points || points.length === 0) return 0;

  // Below the range
  if (year <= points[0].year) return points[0].value;

  // Above the range
  const last = points[points.length - 1];
  if (year >= last.year) return last.value;

  // Binary search for the interval
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].year <= year) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const a = points[lo];
  const b = points[hi];
  const t = (year - a.year) / (b.year - a.year);
  return a.value + t * (b.value - a.value);
}

/**
 * Interpolated world population at the given year.
 * Requires loadDemographics() to have been called first.
 *
 * @param {number} year
 * @returns {number}
 */
export function pop(year) {
  if (!_popData) {
    throw new Error("Demographics not loaded. Call loadDemographics() first.");
  }
  return lerp(_popData, year);
}

/**
 * Interpolated life expectancy at the given year.
 * Requires loadDemographics() to have been called first.
 *
 * @param {number} year
 * @returns {number}
 */
export function lifeExp(year) {
  if (!_leData) {
    throw new Error("Demographics not loaded. Call loadDemographics() first.");
  }
  return lerp(_leData, year);
}

/**
 * True if demographics have been loaded.
 * @returns {boolean}
 */
export function isLoaded() {
  return _popData !== null && _leData !== null;
}

// ── People data (real individuals, B-3) ─────────────────────

let _people = null;

/**
 * Fetch and cache the people dataset (data/people.json).
 * Call once at bootstrap; returns the raw data.
 * @returns {Promise<object>}
 */
export async function loadPeople() {
  const resp = await fetch("/data/people.json");
  if (!resp.ok) {
    throw new Error(`Failed to load people: ${resp.status}`);
  }
  const data = await resp.json();
  _people = data.people || [];
  return _people;
}

/**
 * Return the loaded people array.
 * Requires loadPeople() to have been called first.
 * @returns {object[]}
 */
export function getPeople() {
  if (!_people) {
    throw new Error("People not loaded. Call loadPeople() first.");
  }
  return _people;
}

/**
 * True if people have been loaded.
 * @returns {boolean}
 */
export function peopleLoaded() {
  return _people !== null;
}