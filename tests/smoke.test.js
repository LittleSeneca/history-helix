import { describe, it, expect } from "vitest";
import { TURNS, LEAN_DEG, SQUASH, R_BASE, DENSITY_GAIN, SPREAD, BUDGET, colors, tMin, tMax } from "../src/config.js";

describe("config", () => {
  it("exports TURNS = 6", () => {
    expect(TURNS).toBe(6);
  });

  it("exports LEAN_DEG = 32", () => {
    expect(LEAN_DEG).toBe(32);
  });

  it("exports SQUASH = 0.45", () => {
    expect(SQUASH).toBe(0.45);
  });

  it("exports R_BASE = 180", () => {
    expect(R_BASE).toBe(180);
  });

  it("exports DENSITY_GAIN = 170", () => {
    expect(DENSITY_GAIN).toBe(170);
  });

  it("exports SPREAD = 20", () => {
    expect(SPREAD).toBe(20);
  });

  it("exports BUDGET = 60_000", () => {
    expect(BUDGET).toBe(60_000);
  });

  it("exports tMin = -2000", () => {
    expect(tMin).toBe(-2000);
  });

  it("exports tMax = 2026", () => {
    expect(tMax).toBe(2026);
  });

  it("exports a non-empty colors map", () => {
    expect(colors).toBeDefined();
    expect(typeof colors).toBe("object");
    expect(Object.keys(colors).length).toBeGreaterThan(0);
  });

  it("colors values are valid hex strings", () => {
    for (const [key, value] of Object.entries(colors)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});