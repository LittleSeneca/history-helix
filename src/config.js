// Geometry and render constants — single source of truth (DESIGN.md §2)

export const TURNS = 6;
export const R_BASE = 180;           // base coil radius (scene px) — ancient, sparse end
export const DENSITY_GAIN = 170;     // R(u) ranges from R_BASE to R_BASE + DENSITY_GAIN
export const SPREAD = 20;            // radial strand spread (was BAND_PX=8)
export const LEAN_DEG = 32;
export const SQUASH = 0.45;
export const BUDGET = 60_000;

// Timeline span (astronomical year numbering: BCE = negative, no year zero)
export const tMin = -2000;
export const tMax = 2026;

// Era-based color map (DESIGN.md §5 question 4: color-by-era recommended).
// Keys are era start years (BCE negative, no year zero). Values are CSS hex.
export const colors = {
  prehistory:  "#8b9a8b",  // –10000 .. –3000  (muted sage)
  ancient:     "#c49a6c",  //  –3000 ..   500  (warm clay)
  classical:   "#d4a853",  //    500 ..  1500  (gold)
  earlyModern: "#5a7d9a",  //   1500 ..  1800  (slate blue)
  industrial:  "#4a6b5d",  //   1800 ..  1950  (teal-soot)
  modern:      "#c76b4a",  //   1950 ..  2020  (rust orange)
  future:      "#7a5c8a",  //   2020 ..  2100  (muted violet)
};

// LOD thresholds (DESIGN.md §2.5)
export const LOD_SITELINK_THRESHOLDS = [
  { zoom: 0.0,  min: 100 },
  { zoom: 0.25, min: 50 },
  { zoom: 0.5,  min: 25 },
  { zoom: 0.75, min: 10 },
  { zoom: 1.0,  min: 0 },
];

// Label track layout (DESIGN.md §2.4)
export const TRACK_GAP = 22;
export const LABEL_OFFSET_X = 80;

// ── Accessibility ────────────────────────────────────────────

/**
 * Check whether the user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}