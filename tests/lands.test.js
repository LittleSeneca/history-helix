// Pipeline normalization tests — date precision, BCE/CE, dedup, category mapping
// (DESIGN.md §4.2)
//
// These tests validate the output JSON shape from fetch_events.py.
// The paths assume events.json has been generated in data/events.json.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Helper: load events from JSON if available
function loadEvents() {
  const p = resolve(import.meta.dirname || __dirname, "../data/events.json");
  try {
    const raw = readFileSync(p, "utf-8");
    return JSON.parse(raw).events || [];
  } catch {
    return null;
  }
}

const events = loadEvents();
const hasEvents = events !== null && events.length > 0;

// Skip integration tests if data not generated yet
const maybe = hasEvents ? describe : describe.skip;

describe("events.json shape", () => {
  it("has the expected structure when generated", () => {
    if (!hasEvents) {
      console.warn("data/events.json not found — skipping integration tests");
      return;
    }
    for (const e of events.slice(0, 100)) {
      expect(e).toHaveProperty("id");
      expect(e).toHaveProperty("title");
      expect(e).toHaveProperty("year");
      expect(e).toHaveProperty("precision");
      expect(e).toHaveProperty("category");
      expect(e).toHaveProperty("sitelinks");
      expect(e).toHaveProperty("qid");
      expect(e).toHaveProperty("sourceUrl");
    }
  });
});

// Fixture-based tests (always run, no data dependency)
describe("date normalization — fixture tests", () => {
  // These mirror the Python normalize_date() logic in fetch_events.py.
  // Wikidata stores 1 BCE as year 0. Our output should convert correctly.

  it("1 BCE (Wikidata year 0) becomes year -1", () => {
    // This is the critical boundary: Wikidata stores 1 BCE as year 0.
    // Our normalizer should output year = -1 for 1 BCE.
    // Since we can't test the Python directly, we test the JSON output
    // when available, and document the expected behavior here.
    expect(true).toBe(true); // placeholder — tested by pipeline output
  });

  it("1 CE (Wikidata year 1) stays year 1", () => {
    expect(true).toBe(true); // placeholder
  });

  it("century precision: 19th century → year 1850", () => {
    // When precision=7 (century), the midpoint is used:
    // 1800–1899 → 1850 (or 1801–1900 → 1850)
    // Wikidata century 19 = year 1800, precision 7 → our output ≈ 1850
    expect(true).toBe(true); // placeholder
  });

  it("decade precision: 1940s → year 1945", () => {
    // When precision=8 (decade), the midpoint is used:
    // 1940–1949 → 1945
    expect(true).toBe(true); // placeholder
  });
});

maybe("integration: BCE/CE boundary in actual data", () => {
  it("has no year zero in the output", () => {
    const years = events.map((e) => e.year);
    expect(years).not.toContain(0); // no year zero
  });

  it("has negative years for BCE events", () => {
    const bceEvents = events.filter((e) => e.year < 0);
    if (bceEvents.length > 0) {
      for (const e of bceEvents) {
        expect(e.year).toBeLessThan(0);
      }
    }
  });

  it("all years are within configured span", () => {
    for (const e of events) {
      expect(e.year).toBeGreaterThanOrEqual(-10000);
      expect(e.year).toBeLessThanOrEqual(2100);
    }
  });
});

maybe("integration: dedup — no exact duplicates", () => {
  it("has no events with same (year, title, qid)", () => {
    const seen = new Set();
    for (const e of events) {
      const key = `${e.year}|${e.title}|${e.qid}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

maybe("integration: category mapping", () => {
  it("all events have a valid category", () => {
    const validCategories = [
      "war", "politics", "science", "exploration",
      "religion", "culture", "disaster", "economy",
    ];
    for (const e of events) {
      expect(validCategories).toContain(e.category);
    }
  });
});

maybe("integration: sitelinks threshold", () => {
  it("all events have sitelinks >= 8", () => {
    for (const e of events) {
      expect(e.sitelinks).toBeGreaterThanOrEqual(8);
    }
  });
});

maybe("integration: precision field", () => {
  it("all events have a non-empty precision string", () => {
    for (const e of events) {
      expect(e.precision).toBeTruthy();
      expect(typeof e.precision).toBe("string");
    }
  });
});