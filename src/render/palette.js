// Pastel palette — deterministic per-life colors (C-2)
//
// Replaces era-based strand coloring with a soft pastel mosaic:
// every life gets its own color derived from a deterministic hash
// of that person's identity (name + birth year).
//
// Palette: 64 pastel colors, HSL L ≥ 80%, S ≤ 45%.
// Hues are evenly spaced around 360° with alternating S/L bands.

const PASTEL = [
  "#d8c4c4", "#e1cdcb", "#e9d6d2", "#e2c5ba", "#ded4ce", "#e6ddd4", "#dfd0be", "#e6dbc5",
  "#e4e1d7", "#dbd7c1", "#e4e2c8", "#eaebd0", "#d5d8c4", "#dce1cb", "#e2e9d2", "#d2e2ba",
  "#d6dece", "#dce6d4", "#c8dfbe", "#cce6c5", "#d8e4d7", "#c2dbc1", "#c8e4ca", "#d0ebd4",
  "#c4d8c9", "#cbe1d2", "#d2e9dc", "#bae2cf", "#ceded8", "#d4e6e1", "#bedfd8", "#c5e6e3",
  "#d7e4e4", "#c1d9db", "#c8dee4", "#d0e3eb", "#c4d0d8", "#cbd6e1", "#d2dce9", "#bac8e2",
  "#ced2de", "#d4d7e6", "#bec0df", "#c6c5e6", "#d8d7e4", "#c7c1db", "#d0c8e4", "#dbd0eb",
  "#cec4d8", "#d8cbe1", "#e2d2e9", "#d9bae2", "#dccede", "#e6d4e6", "#dfbedc", "#e6c5e1",
  "#e4d7e1", "#dbc1d2", "#e4c8d7", "#ebd0dd", "#d8c4cc", "#e1cbd1", "#e9d2d6", "#e2babe",
];

const SIZE = PASTEL.length; // 64

/**
 * Simple string hash — deterministic, stable across reloads.
 * djb2 variant: starts at 5381, shifts left 5 + adds char.
 * @param {string} str
 * @returns {number} non-negative integer hash
 */
function hashCode(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Deterministic palette index for a person record.
 * Hashes name + birth year so the same life is always the same color.
 * Falls back to era-based mapping when person data is missing (synthetic strands).
 *
 * @param {{name?:string, birth?:number, sourceUrl?:string}} person
 * @returns {number} palette index 0..63
 */
export function colorIndex(person) {
  if (person && person.name) {
    const key = `${person.name}:${person.birth ?? ""}`;
    return hashCode(key) % SIZE;
  }
  // Fallback for synthetic strands without person data
  if (person && person.sourceUrl) {
    return hashCode(person.sourceUrl) % SIZE;
  }
  return 0; // should not happen with real data
}

/**
 * The hex color for a given palette index.
 * @param {number} idx — 0..63
 * @returns {string} hex color, e.g. "#d8c4c4"
 */
export function colorAt(idx) {
  return PASTEL[idx % SIZE];
}

/**
 * Deterministic hex color for a person record.
 * Convenince: colorIndex → colorAt in one call.
 * @param {{name?:string, birth?:number, sourceUrl?:string}} person
 * @returns {string} hex color
 */
export function colorFor(person) {
  return colorAt(colorIndex(person));
}

/**
 * The full palette array (64 #rrggbb entries).
 * All entries: HSL L ≥ 80%, S ≤ 45%.
 */
export const PALETTE = PASTEL;
export const PALETTE_SIZE = SIZE;