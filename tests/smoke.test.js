import { describe, it, expect } from "vitest";
import { TURNS, LEAN_DEG, SQUASH, BUDGET, colors } from "../src/config.js";

describe("config", () => {
  it("exports TURNS = 12", () => {
    expect(TURNS).toBe(12);
  });

  it("exports LEAN_DEG = 32", () => {
    expect(LEAN_DEG).toBe(32);
  });

  it("exports SQUASH = 0.40", () => {
    expect(SQUASH).toBe(0.40);
  });

  it("exports BUDGET = 60_000", () => {
    expect(BUDGET).toBe(60_000);
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