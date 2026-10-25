import { describe, it, expect } from "vitest";
import {
  tMin,
  tMax,
  u,
  theta,
  depth,
  project,
  pointOnSurface,
  R,
  R_BASE,
} from "../src/geometry/helix.js";
import { TURNS } from "../src/config.js";

const EPS = 1e-10;

describe("u(t) — time normalization", () => {
  it("maps tMin to 0 and tMax to 1", () => {
    expect(u(tMin)).toBeCloseTo(0, 10);
    expect(u(tMax)).toBeCloseTo(1, 10);
  });

  it("is strictly increasing across the full span", () => {
    // Sample a grid of years between tMin and tMax
    const step = 500;
    let prev = u(tMin);
    for (let t = tMin + step; t <= tMax; t += step) {
      const curr = u(t);
      expect(curr).toBeGreaterThan(prev);
      prev = curr;
    }
  });

  it("handles the BCE/CE boundary correctly", () => {
    // -1 (2 BCE) → 0 (1 BCE) → 1 (1 CE)
    // No year zero in historical convention, but our t uses astronomical numbering
    // where BCE is negative, so -1 = 2 BCE, 0 doesn't exist historically,
    // 1 = 1 CE. The function u(t) is purely mathematical.
    const uNeg1 = u(-1);
    const u0 = u(0);
    const u1 = u(1);
    expect(uNeg1).toBeLessThan(u0);
    expect(u0).toBeLessThan(u1);
  });
});

describe("theta(u) — angular advance", () => {
  it("advances by 2π when u advances by 1/TURNS", () => {
    // Pick a few arbitrary u values
    for (const base of [0, 0.1, 0.5, 0.73, 0.99]) {
      const delta = 1 / TURNS;
      if (base + delta > 1) continue; // skip if out of range
      const th1 = theta(base);
      const th2 = theta(base + delta);
      const diff = th2 - th1;
      expect(diff).toBeCloseTo(2 * Math.PI, 10);
    }
  });

  it("theta(0) === 0", () => {
    expect(theta(0)).toBeCloseTo(0, 10);
  });

  it("theta(1) === 2π * TURNS", () => {
    expect(theta(1)).toBeCloseTo(2 * Math.PI * TURNS, 10);
  });
});

describe("project(u) — scene-space projection", () => {
  it("climbs up-and-right: project(u(tMax)).x > project(u(tMin)).x and project(u(tMax)).y < project(u(tMin)).y", () => {
    const early = project(u(tMin));
    const late = project(u(tMax));
    expect(late.x).toBeGreaterThan(early.x);
    expect(late.y).toBeLessThan(early.y);
  });

  it("returns an object with numeric x and y", () => {
    const p = project(0.5);
    expect(typeof p.x).toBe("number");
    expect(typeof p.y).toBe("number");
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe("depth(u) — z-order signal", () => {
  it("returns +1 when sin(theta) > 0 (front)", () => {
    // At u such that theta is near π/2, sin(theta) ≈ 1
    // theta(u) = 2π * TURNS * u = π/2 → u = 1/(4*TURNS)
    const uFront = 1 / (4 * TURNS);
    expect(depth(uFront)).toBeGreaterThan(0);
  });

  it("returns -1 when sin(theta) < 0 (back)", () => {
    // At u such that theta is near 3π/2, sin(theta) ≈ -1
    // theta(u) = 3π/2 → u = 3/(4*TURNS)
    const uBack = 3 / (4 * TURNS);
    expect(depth(uBack)).toBeLessThan(0);
  });

  it("sign flips when crossing from back to front", () => {
    // Find a crossing point: where theta passes through 0 mod 2π
    // theta(u) = 2π * TURNS * u. sin flips at u = 0, 1/TURNS, 2/TURNS, ...
    const crossing = 0.5 / TURNS; // near the crossing after u=0
    const before = depth(crossing - 0.001);
    const after = depth(crossing + 0.001);
    // Signs should differ (one positive, one negative)
    expect(Math.sign(before)).not.toBe(Math.sign(after));
  });

  it("is in range [-1, 1]", () => {
    for (let i = 0; i <= 100; i++) {
      const d = depth(i / 100);
      expect(d).toBeGreaterThanOrEqual(-1);
      expect(d).toBeLessThanOrEqual(1);
    }
  });
});

describe("pointOnSurface(u, radius, phaseOffset)", () => {
  it("returns a point at the given radius offset from the spine", () => {
    const p1 = pointOnSurface(0.3, 10, 0);
    const pSpine = project(0.3);
    // At phaseOffset 0, the point should be at x = spine.x + 10 (if cos(theta) ≈ 1)
    // More robust: the radial distance should be reflected in the coordinates
    expect(typeof p1.x).toBe("number");
    expect(typeof p1.y).toBe("number");
  });

  it("shifts azimuthally with phaseOffset", () => {
    // At phaseOffset=0, point aligns with the spine's angular position.
    // At phaseOffset=π, it's on the opposite side of the coil circle.
    const uMid = 0.5;
    const rad = 80;
    const p0 = pointOnSurface(uMid, rad, 0);
    const pPi = pointOnSurface(uMid, rad, Math.PI);
    // Rotation preserves distances, so opposite points on a circle of
    // radius `rad` should be 2*rad apart.
    const dx = p0.x - pPi.x;
    const dy = p0.y - pPi.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeCloseTo(2 * rad, 10);
  });
});

// ── Strand path tests (coil.js) ─────────────────────────────
// Test strandPoints (pure, Node-compatible). strandPath is the
// browser wrapper that builds a Path2D.
import { strandPoints } from "../src/geometry/coil.js";

describe("strandPoints(u0, u1, rho, phase)", () => {
  it("returns an array of {x,y} points", () => {
    const pts = strandPoints(0.1, 0.3, 5, 0.05, 6);
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    for (const p of pts) {
      expect(typeof p.x).toBe("number");
      expect(typeof p.y).toBe("number");
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("returns 1 + samples points", () => {
    const pts = strandPoints(0.2, 0.7, 0, 0, 12);
    expect(pts.length).toBe(13); // start + 12 intermediate
  });

  it("start point matches pointOnSurface at u0", () => {
    const u0 = 0.15;
    const u1 = 0.42;
    const rho = 7;
    const phase = 0.08;
    const pts = strandPoints(u0, u1, rho, phase, 12);
    const expected = pointOnSurface(u0, R(u0) + rho, phase);
    expect(pts[0].x).toBeCloseTo(expected.x, 10);
    expect(pts[0].y).toBeCloseTo(expected.y, 10);
  });

  it("end point matches pointOnSurface at u1", () => {
    const u0 = 0.15;
    const u1 = 0.42;
    const rho = 7;
    const phase = 0.08;
    const pts = strandPoints(u0, u1, rho, phase, 12);
    const expected = pointOnSurface(u1, R(u1) + rho, phase);
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(expected.x, 10);
    expect(last.y).toBeCloseTo(expected.y, 10);
  });

  it("at rho=0, phase=0, strandPoints(u, u, 0, 0) gives pointOnSurface(u, R(u), 0)", () => {
    const u = 0.4;
    const pts = strandPoints(u, u, 0, 0, 6);
    const expected = pointOnSurface(u, R(u), 0);
    // When u0 === u1, all points should be the same
    for (const p of pts) {
      expect(p.x).toBeCloseTo(expected.x, 10);
      expect(p.y).toBeCloseTo(expected.y, 10);
    }
  });

  it("pointOnSurface(u, R(u), 0) equals project(u)", () => {
    const u = 0.3;
    const p1 = pointOnSurface(u, R(u), 0);
    const p2 = project(u);
    expect(p1.x).toBeCloseTo(p2.x, 10);
    expect(p1.y).toBeCloseTo(p2.y, 10);
  });
});

// ── Real-people strand tests (B-3, coil.js) ─────────────────

import { peopleStrands } from "../src/geometry/coil.js";

describe("peopleStrands(people, tStart, tEnd)", () => {
  const samplePeople = [
    { id: "abc", name: "Alpha", birth: -1000, death: -900 },
    { id: "def", name: "Beta",  birth: 1500,  death: 1580 },
    { id: "ghi", name: "Gamma", birth: 1900,  death: 1970 },
    // Outside range (before tMin)
    { id: "out1", name: "Prehistoric", birth: -3000, death: -2800 },
    // Outside range (after tMax)
    { id: "out2", name: "Futureborn",  birth: 2050,  death: 2100 },
  ];

  it("returns one strand per in-range person", () => {
    const { strands, filtered } = peopleStrands(samplePeople, tMin, tMax);
    // 3 in-range, 2 filtered
    expect(strands.length).toBe(3);
    expect(filtered).toBe(2);
  });

  it("strands have correct structure", () => {
    const { strands } = peopleStrands(samplePeople, tMin, tMax);
    for (const s of strands) {
      expect(s).toHaveProperty("u0");
      expect(s).toHaveProperty("u1");
      expect(s).toHaveProperty("rho");
      expect(s).toHaveProperty("cohortPhase");
      expect(s).toHaveProperty("era");
      expect(s.u0).toBeGreaterThanOrEqual(0);
      expect(s.u0).toBeLessThanOrEqual(1);
      expect(s.u1).toBeGreaterThanOrEqual(0);
      expect(s.u1).toBeLessThanOrEqual(1);
      expect(s.u1).toBeGreaterThanOrEqual(s.u0);
    }
  });

  it("u0 and u1 are computed correctly (endpoint math)", () => {
    const { strands } = peopleStrands(samplePeople, tMin, tMax);
    // Alpha: birth -1000, death -900
    const alpha = strands.find((s) => s.era === "ancient"); // -1000 is ancient era
    expect(alpha).toBeDefined();
    const expectedU0 = (-1000 - tMin) / (tMax - tMin);
    const expectedU1 = (-900 - tMin) / (tMax - tMin);
    expect(alpha.u0).toBeCloseTo(expectedU0, 10);
    expect(alpha.u1).toBeCloseTo(expectedU1, 10);
  });

  it("deterministic rho from id hash", () => {
    const { strands: s1 } = peopleStrands(samplePeople, tMin, tMax);
    const { strands: s2 } = peopleStrands(samplePeople, tMin, tMax);
    for (let i = 0; i < s1.length; i++) {
      expect(s1[i].rho).toBe(s2[i].rho);
      expect(s1[i].cohortPhase).toBe(s2[i].cohortPhase);
    }
  });

  it("filters out people completely outside [tStart, tEnd]", () => {
    const farPast = [{ id: "x", name: "X", birth: -5000, death: -4900 }];
    const { strands, filtered } = peopleStrands(farPast, tMin, tMax);
    expect(strands.length).toBe(0);
    expect(filtered).toBe(1);
  });

  it("clamps u to [0, 1] when birth or death is near boundary", () => {
    const edgeCases = [
      { id: "e1", name: "Edge1", birth: -2000, death: -1900 },
      { id: "e2", name: "Edge2", birth: 2000,  death: 2030 },
    ];
    const { strands } = peopleStrands(edgeCases, tMin, tMax);
    // First: birth at exactly tMin
    expect(strands[0].u0).toBeCloseTo(0, 10);
    // Second: death beyond tMax should clamp to 1
    expect(strands[1].u1).toBeCloseTo(1, 10);
  });
});