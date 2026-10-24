import { describe, it, expect } from "vitest";
import { allocCohorts } from "../src/geometry/coil.js";
import { tMin, tMax } from "../src/geometry/helix.js";
import { BUDGET } from "../src/config.js";

const FLOOR = 1;
const WIDTH = 25;

// ── Mock interpolators ──────────────────────────────────────

/** Linear growth from 1M to 8B across the span */
function linearPop(year) {
  const span = tMax - tMin;
  const frac = (year - tMin) / span;
  return 1e6 + frac * (8e9 - 1e6);
}

/** Step function: doubles after year 0 */
function stepPop(year) {
  return year < 0 ? 100 : 200;
}

// ── Tests ───────────────────────────────────────────────────

describe("allocCohorts — conservation", () => {
  it("Σalloc === BUDGET exactly (largest-remainder)", () => {
    const cohorts = allocCohorts(linearPop, BUDGET, FLOOR, tMin, tMax, WIDTH);
    const total = cohorts.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(BUDGET);
  });

  it("every cohort gets ≥ FLOOR", () => {
    const cohorts = allocCohorts(linearPop, BUDGET, FLOOR, tMin, tMax, WIDTH);
    for (const c of cohorts) {
      expect(c.count).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it("allocates at least one cohort", () => {
    const cohorts = allocCohorts(linearPop, BUDGET, FLOOR, tMin, tMax, WIDTH);
    expect(cohorts.length).toBeGreaterThan(0);
  });

  it("cohort count is roughly proportional to population at midpoint", () => {
    const cohorts = allocCohorts(stepPop, 10000, 1, tMin, tMax, WIDTH);

    const preCohorts = cohorts.filter((c) => c.midpoint < 0);
    const postCohorts = cohorts.filter((c) => c.midpoint >= 0);

    // post-0 population is double, so per-cohort average should be roughly double
    if (preCohorts.length > 0 && postCohorts.length > 0) {
      const preAvg = preCohorts.reduce((s, c) => s + c.count, 0) / preCohorts.length;
      const postAvg =
        postCohorts.reduce((s, c) => s + c.count, 0) / postCohorts.length;
      // Should be roughly 2× (allow ±30% for rounding noise)
      const ratio = postAvg / preAvg;
      expect(ratio).toBeGreaterThan(1.3);
      expect(ratio).toBeLessThan(2.7);
    }
  });

  it("cohort midpoints lie within [tMin, tMax]", () => {
    const cohorts = allocCohorts(linearPop, BUDGET, FLOOR, tMin, tMax, WIDTH);
    for (const c of cohorts) {
      expect(c.midpoint).toBeGreaterThanOrEqual(tMin);
      expect(c.midpoint).toBeLessThanOrEqual(tMax);
    }
  });

  it("cohort widths are ≤ WIDTH", () => {
    const cohorts = allocCohorts(linearPop, BUDGET, FLOOR, tMin, tMax, WIDTH);
    for (const c of cohorts) {
      expect(c.end - c.start).toBeLessThanOrEqual(WIDTH + 0.001);
    }
  });
});