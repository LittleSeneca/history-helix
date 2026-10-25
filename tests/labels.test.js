// Label track assignment + collision tests (DESIGN.md §2.4, §4.3)
// Property-based tests for assignTracks()

import { describe, it, expect } from "vitest";
import { assignTracks, maxTrack, decolideLabels, decolideAllLabels, MIN_LABEL_GAP } from "../src/render/labels.js";
import { TRACK_GAP } from "../src/config.js";

/**
 * Generate synthetic events with known anchor Y positions.
 */
function makeEvents(ys, depths) {
  return ys.map((y, i) => ({
    anchorX: 100,
    anchorY: y,
    depth: depths ? depths[i] : (i % 2 === 0 ? 1 : -1),
  }));
}

describe("assignTracks — basic placement", () => {
  it("places a single event on track 0", () => {
    const events = makeEvents([50], [1]);
    const placements = assignTracks(events);
    expect(placements[0].track).toBe(0);
    expect(placements[0].clustered).toBe(false);
  });

  it("places two far-apart events on same track", () => {
    const gap = TRACK_GAP + 10;
    const events = makeEvents([50, 50 + gap], [1, 1]);
    const placements = assignTracks(events);
    expect(placements[0].track).toBe(0);
    expect(placements[1].track).toBe(0);
    expect(placements[0].clustered).toBe(false);
    expect(placements[1].clustered).toBe(false);
  });

  it("places two close events on different tracks", () => {
    const events = makeEvents([50, 50 + TRACK_GAP - 5], [1, 1]);
    const placements = assignTracks(events);
    // They should be on different tracks since they overlap
    expect(placements[0].track).toBe(0);
    expect(placements[1].track).toBe(1);
  });

  it("respects TRACK_GAP across multiple tracks", () => {
    // Place many events at the exact same Y — each should go to a new track
    const n = 8;
    const events = makeEvents(new Array(n).fill(100), new Array(n).fill(1));
    const placements = assignTracks(events);
    // All should be on different tracks (0, 1, 2, ...)
    const tracks = placements.map((p) => p.track);
    const uniqueTracks = new Set(tracks);
    expect(uniqueTracks.size).toBe(n);
  });
});

describe("assignTracks — sides", () => {
  it("places events on different sides based on depth", () => {
    const events = makeEvents(
      [50, 50], // same Y
      [1, -1],  // opposite sides
    );
    const placements = assignTracks(events);
    // Both should be on track 0 since they're on opposite sides
    expect(placements[0].side).toBe("right"); // depth > 0
    expect(placements[1].side).toBe("left");  // depth < 0
    expect(placements[0].track).toBe(0);
    expect(placements[1].track).toBe(0);
  });

  it("tracks are independent per side", () => {
    // Two events on same side, close Y → different tracks
    const events = makeEvents(
      [50, 50 + TRACK_GAP - 2],
      [1, 1], // both right side
    );
    const placements = assignTracks(events);
    expect(placements[0].track).toBe(0);
    expect(placements[1].track).toBe(1);
  });
});

describe("assignTracks — cluster overflow", () => {
  it("clusters events when no track is available", () => {
    // Create more events than MAX_TRACKS (12) at the same Y on the same side
    const n = 15;
    const events = makeEvents(new Array(n).fill(100), new Array(n).fill(1));
    const placements = assignTracks(events);

    // First 12 should get tracks 0-11, the rest should be clustered
    let clusteredCount = 0;
    for (let i = 0; i < n; i++) {
      if (placements[i].clustered) clusteredCount++;
    }

    // At least some should be clustered (the ones beyond track 11)
    expect(clusteredCount).toBeGreaterThan(0);
    // But not all — first ones fit on tracks
    expect(clusteredCount).toBeLessThan(n);
  });

  it("clusterSize > 1 for collapse runs", () => {
    // 15 events at same Y on same side — should produce a cluster
    const n = 15;
    const events = makeEvents(new Array(n).fill(100), new Array(n).fill(1));
    const placements = assignTracks(events);

    // Find the cluster head
    const clusters = placements.filter(
      (p) => p.clustered && p.clusterSize > 1,
    );
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    // Cluster should represent the overflow
    const totalInCluster = clusters.reduce((s, p) => s + p.clusterSize, 0);
    // Count absorbed events (clusterSize === 0)
    const absorbed = placements.filter((p) => p.clusterSize === 0).length;
    expect(totalInCluster + absorbed).toBeGreaterThanOrEqual(3); // n - MAX_TRACKS
  });
});

describe("maxTrack", () => {
  it("returns 0 for one event", () => {
    const events = makeEvents([50], [1]);
    const placements = assignTracks(events);
    expect(maxTrack(placements)).toBe(0);
  });

  it("returns correct max for multiple tracks", () => {
    const n = 5;
    const events = makeEvents(new Array(n).fill(100), new Array(n).fill(1));
    const placements = assignTracks(events);
    expect(maxTrack(placements)).toBe(n - 1);
  });
});

describe("assignTracks — property: no overlapping labels on same track", () => {
  it("no two labels on same track+side are within TRACK_GAP", () => {
    // Generate random events
    const rng = (seed) => {
      let s = seed;
      return () => {
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
      };
    };
    const rand = rng(42);
    const n = 100;
    const ys = Array.from({ length: n }, () => rand() * 2000 - 1000);
    const depths = Array.from({ length: n }, () => (rand() > 0.5 ? 1 : -1));

    const events = makeEvents(ys, depths);
    const placements = assignTracks(events);

    // Group by (side, track)
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const p = placements[i];
      if (p.clustered) continue; // skip clusters
      const key = `${p.side}|${p.track}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...p, y: events[i].anchorY });
    }

    // Check each group for overlaps
    for (const [key, group] of groups) {
      group.sort((a, b) => a.y - b.y);
      for (let i = 1; i < group.length; i++) {
        const gap = group[i].y - group[i - 1].y;
        expect(gap).toBeGreaterThanOrEqual(TRACK_GAP);
      }
    }
  });
});

describe("decolideLabels — vertical spacing", () => {
  it("ensures labels on the same side maintain MIN_LABEL_GAP", () => {
    // Three labels close together on the right side
    const events = makeEvents([100, 105, 108], [1, 1, 1]);
    const placements = assignTracks(events);

    // All should be on the right side
    for (const p of placements) {
      expect(p.side).toBe("right");
    }

    // Sort by labelY
    const sorted = [...placements].sort((a, b) => a.labelY - b.labelY);
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].labelY - sorted[i - 1].labelY;
      if (sorted[i].clusterSize > 0 && sorted[i - 1].clusterSize > 0) {
        expect(gap).toBeGreaterThanOrEqual(MIN_LABEL_GAP);
      }
    }
  });

  it("does not affect labels on different sides", () => {
    const events = makeEvents([100, 100], [1, -1]); // same Y, opposite sides
    const placements = assignTracks(events);

    expect(placements[0].side).toBe("right");
    expect(placements[1].side).toBe("left");
    // Labels at same Y on different sides don't need de-collision
    // Their labelY values can be close — they're on opposite sides
  });

  it("sets labelY for every placement", () => {
    const events = makeEvents([50, 80, 120], [1, 1, -1]);
    const placements = assignTracks(events);

    for (const p of placements) {
      expect(p.labelY).toBeTypeOf("number");
    }
  });

  it("labelY reflects track stagger", () => {
    // Two events at same Y on same side →
    // different tracks with different labelY
    const events = makeEvents([100, 100], [1, 1]);
    const placements = assignTracks(events);

    expect(placements[0].track).not.toBe(placements[1].track);
    expect(placements[0].labelY).not.toBe(placements[1].labelY);
  });
});

describe("decolideAllLabels — unified screen-space de-collision", () => {
  it("returns original Ys when no overlaps exist", () => {
    const entries = [
      { screenX: 500, screenY: 100, key: "a" },
      { screenX: 500, screenY: 200, key: "b" },
    ];
    const result = decolideAllLabels(entries, 400);
    expect(result.get("a")).toBe(100);
    expect(result.get("b")).toBe(200);
  });

  it("pushes overlapping label down on same side", () => {
    const entries = [
      { screenX: 500, screenY: 100, key: "a" },
      { screenX: 500, screenY: 105, key: "b" }, // too close
    ];
    const result = decolideAllLabels(entries, 400);
    expect(result.get("a")).toBe(100);
    expect(result.get("b")).toBe(100 + MIN_LABEL_GAP);
  });

  it("groups by screen side (left/right of viewport center)", () => {
    // "a" and "b" are on opposite screen sides → shouldn't collide
    const entries = [
      { screenX: 100, screenY: 100, key: "a" },  // left of center 400
      { screenX: 700, screenY: 105, key: "b" },  // right of center 400
    ];
    const result = decolideAllLabels(entries, 400);
    // Both should be at their original positions (different sides)
    expect(result.get("a")).toBe(100);
    expect(result.get("b")).toBe(105);
  });

  it("pushes multiple overlapping labels in a chain", () => {
    const entries = [
      { screenX: 600, screenY: 100, key: "a" },
      { screenX: 600, screenY: 105, key: "b" },
      { screenX: 600, screenY: 108, key: "c" },
    ];
    const result = decolideAllLabels(entries, 400);
    expect(result.get("a")).toBe(100);
    expect(result.get("b")).toBe(100 + MIN_LABEL_GAP);
    expect(result.get("c")).toBe(100 + MIN_LABEL_GAP * 2);
  });

  it("preserves order: earlier label never moves past later label", () => {
    const entries = [
      { screenX: 600, screenY: 100, key: "first" },
      { screenX: 600, screenY: 102, key: "second" },
    ];
    const result = decolideAllLabels(entries, 400);
    expect(result.get("first")).toBeLessThan(result.get("second"));
  });

  it("handles mixed event and era entries together", () => {
    const entries = [
      { screenX: 600, screenY: 100, key: "event:0" },
      { screenX: 610, screenY: 105, key: "era:0" },  // close to event
      { screenX: 600, screenY: 108, key: "event:1" },
    ];
    const result = decolideAllLabels(entries, 400);
    // All three should be spaced by at least MIN_LABEL_GAP
    const ys = [
      result.get("event:0"),
      result.get("era:0"),
      result.get("event:1"),
    ];
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(MIN_LABEL_GAP);
    }
  });
});