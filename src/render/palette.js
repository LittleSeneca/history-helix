// Pastel palette — deterministic per-life colors (C-2, C-4)
//
// Replaces era-based strand coloring with a soft pastel mosaic:
// every life gets its own color derived from a deterministic hash
// of that person's identity (name + birth year).
//
// Palette: 64 pastel colors, HSL L ≥ 82%, S 59–67%.
// Hues are evenly spaced around 360° with alternating S/L bands.
// C-4: raised chroma from mean S=30% to mean S=63% so rendered strands
// read as actual color after alpha compositing over dark background.

const PASTEL = [
  "#edb6b6", "#f0c1bc", "#f3ccc3", "#efc8b9", "#eccab6", "#f2d7c0", "#efd7b9", "#eddab6",
  "#eddfb6", "#f0e8bc", "#f3f0c3", "#edefb9", "#e5ecb6", "#e7f2c0", "#deefb9", "#d6edb6",
  "#d1edb6", "#d1f0bc", "#d2f3c3", "#c5efb9", "#bdecb6", "#c1f2c0", "#b9efbc", "#b6edbe",
  "#b6edc3", "#bcf0ce", "#c3f3d8", "#b9efd5", "#b6ecd8", "#c0f2e4", "#b9efe4", "#b6ede7",
  "#b6eded", "#bcebf0", "#c3eaf3", "#b9dfef", "#b6d8ec", "#c0daf2", "#b9d0ef", "#b6c8ed",
  "#b6c3ed", "#bcc4f0", "#c3c6f3", "#bab9ef", "#bdb6ec", "#cbc0f2", "#cab9ef", "#ccb6ed",
  "#d1b6ed", "#dbbcf0", "#e4c3f3", "#e3b9ef", "#e5b6ec", "#f0c0f2", "#efb9eb", "#edb6e4",
  "#edb6df", "#f0bcde", "#f3c3de", "#efb9d2", "#ecb6ca", "#f2c0ce", "#efb9c3", "#edb6bb",
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
 * C-4: HSL L 82–86%, S 59–67% — raised from L≥80%/S≤45% to fix rendered chroma.
 */
export const PALETTE = PASTEL;
export const PALETTE_SIZE = SIZE;