// Coil surface geometry — strand paths and cohort sampling (DESIGN.md §2.2–2.3)
// Depends on helix.js for the underlying math.
//
// No DOM. No canvas drawing. Pure geometry + data allocation.

import { u as toU, pointOnSurface, R, tMin, tMax } from "./helix.js";
import { BUDGET, colors } from "../config.js";

const FLOOR = 1;
const COHORT_WIDTH = 25;
const STRAND_SAMPLES = 12;
const BAND_PX = 8;

// ── Era → color-key mapping ─────────────────────────────────

const ERA_BOUNDS = [
  { key: "prehistory",  end: -3000 },
  { key: "ancient",     end: 500   },
  { key: "classical",   end: 1500  },
  { key: "earlyModern", end: 1800  },
  { key: "industrial",  end: 1950  },
  { key: "modern",      end: 2020  },
  { key: "future",      end: 2100  },
];

/**
 * Map a year to its era key (matches config.colors keys).
 * @param {number} year
 * @returns {string} era key
 */
export function getEra(year) {
  for (const b of ERA_BOUNDS) {
    if (year < b.end) return b.key;
  }
  return "future";
}

// ── Strand points (pure, testable) ──────────────────────────

/**
 * Compute the polyline points along a strand on the coil surface.
 *
 * @param {number} u0      - start normalized position (0..1)
 * @param {number} u1      - end normalized position (0..1)
 * @param {number} rho     - radial offset in px (relative to R)
 * @param {number} phase   - angular phase offset in radians
 * @param {number} [samples=12] - polyline segment count
 * @returns {{x:number, y:number}[]} array of points
 */
export function strandPoints(u0, u1, rho, phase, samples = STRAND_SAMPLES) {
  const radius = R + rho;
  const points = [];

  // Start point
  points.push(pointOnSurface(u0, radius, phase));

  // Intermediate points
  for (let i = 1; i <= samples; i++) {
    const u = u0 + (u1 - u0) * (i / samples);
    points.push(pointOnSurface(u, radius, phase));
  }

  return points;
}

/**
 * Build a Path2D polyline for the strand. Browser-only (Path2D
 * is not available in Node/vitest).
 *
 * @param {number} u0
 * @param {number} u1
 * @param {number} rho
 * @param {number} phase
 * @param {number} [samples=12]
 * @returns {Path2D}
 */
export function strandPath(u0, u1, rho, phase, samples = STRAND_SAMPLES) {
  const points = strandPoints(u0, u1, rho, phase, samples);
  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y);
  }
  return path;
}

// ── Cohort allocation ───────────────────────────────────────

/**
 * Allocate strand budget across 25-year cohorts spanning [tMin, tMax].
 * Uses the largest-remainder method for exact conservation.
 * Every cohort gets at least `floor` strands.
 *
 * @param {function(number):number} popFn    - year → population
 * @param {number} budget                    - total strand budget
 * @param {number} floor                     - minimum per cohort
 * @param {number} tStart                    - start year
 * @param {number} tEnd                      - end year
 * @param {number} [cohortWidth=25]          - cohort bin width in years
 * @returns {{start:number, end:number, midpoint:number, pop:number, count:number}[]}
 */
export function allocCohorts(
  popFn,
  budget,
  floor,
  tStart,
  tEnd,
  cohortWidth = COHORT_WIDTH,
) {
  // Build cohort bins aligned to cohortWidth grid
  const cohorts = [];
  const gridStart = Math.floor(tStart / cohortWidth) * cohortWidth;

  for (let t = gridStart; t < tEnd; t += cohortWidth) {
    const midpoint = t + cohortWidth / 2;
    if (midpoint > tEnd) break;
    cohorts.push({
      start: t,
      end: Math.min(t + cohortWidth, tEnd),
      midpoint,
      pop: Math.max(0, popFn(midpoint)),
    });
  }

  const totalPop = cohorts.reduce((s, c) => s + c.pop, 0);

  if (totalPop === 0) {
    for (const c of cohorts) c.count = floor;
    return cohorts;
  }

  // Raw proportional allocation, floored with FLOOR gate
  let totalAlloc = 0;
  const fracts = [];

  for (let i = 0; i < cohorts.length; i++) {
    const c = cohorts[i];
    c.raw = (budget * c.pop) / totalPop;
    c.count = Math.max(floor, Math.floor(c.raw));
    totalAlloc += c.count;
    fracts.push({ i, frac: c.raw - c.count });
  }

  // Largest-remainder: distribute remaining budget
  let remainder = budget - totalAlloc;
  fracts.sort((a, b) => b.frac - a.frac);

  for (let r = 0; r < remainder && r < fracts.length; r++) {
    cohorts[fracts[r].i].count++;
  }

  return cohorts;
}

// ── Strand generation ───────────────────────────────────────

/**
 * Generate individual strand descriptors from cohort allocations.
 *
 * Each strand: { u0, u1, rho, cohortPhase, era }
 *
 * @param {object[]} cohorts      - output of allocCohorts()
 * @param {function(number):number} lifeExpFn - year → life expectancy
 * @param {number} [bandPx=8]     - radial band width in px
 * @returns {object[]}
 */
export function generateStrands(cohorts, lifeExpFn, bandPx = BAND_PX) {
  const strands = [];

  for (const cohort of cohorts) {
    // Coherent jitter shared by all strands in this cohort (± ~3°)
    const cohortPhase = (Math.random() - 0.5) * 0.1;

    for (let i = 0; i < cohort.count; i++) {
      const birthYear =
        cohort.start + Math.random() * (cohort.end - cohort.start);
      const lifeExp = lifeExpFn(birthYear);

      // Individual lifespan: Gaussian around lifeExp, σ = 0.25 * lifeExp
      // Box-Muller transform
      let lifespan;
      do {
        const u1 = Math.random();
        const u2 = Math.random();
        const sigma = 0.25 * lifeExp;
        lifespan =
          lifeExp + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      } while (lifespan <= 0);

      const deathYear = birthYear + lifespan;

      // Clamp u to [0, 1]
      const u0 = Math.max(0, Math.min(1, (birthYear - tMin) / (tMax - tMin)));
      const u1Clamp = Math.max(
        u0,
        Math.min(1, (deathYear - tMin) / (tMax - tMin)),
      );

      // Per-strand radial offset (uniform in [-bandPx, +bandPx])
      const rho = (Math.random() - 0.5) * 2 * bandPx;
      const era = getEra(birthYear);

      strands.push({
        u0,
        u1: u1Clamp,
        rho,
        cohortPhase,
        era,
      });
    }
  }

  return strands;
}