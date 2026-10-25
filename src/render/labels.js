// Label track assignment with collision avoidance (DESIGN.md §2.4)
// assignTracks(events) — greedy placement on parallel tracks
// Overflow collapses into "+N more" cluster nodes

import { TRACK_GAP } from "../config.js";

/** Vertical gap enforced between label text blocks on the same side. */
export const MIN_LABEL_GAP = 14;

/**
 * @typedef {Object} LabelPlacement
 * @property {number} track - which track this label sits on (0-indexed)
 * @property {'left'|'right'} side - left or right of the coil axis
 * @property {number} y - anchor Y position in scene space
 * @property {number} labelY - de-collided Y position of the label text
 * @property {boolean} clustered - true if this label is part of a "+N more" cluster
 * @property {number} clusterSize - if clustered, how many events this represents
 */

/**
 * @typedef {Object} EventWithPosition
 * @property {number} anchorY - Y coordinate of the anchor point on the coil
 * @property {number} anchorX - X coordinate of the anchor point
 * @property {number} depth - depth signal (sin(theta)) for side determination
 */

const MAX_TRACKS = 12; // maximum tracks per side before clustering

/**
 * Assign labels to parallel tracks with collision avoidance.
 *
 * Algorithm:
 * 1. Determine side (left/right) based on anchor depth sign
 * 2. Sort events by anchor Y within each side
 * 3. Greedy place: each event goes on the lowest track where
 *    the last occupant's Y is at least TRACK_GAP away
 * 4. If no track within MAX_TRACKS is free, collapse into cluster
 *
 * @param {EventWithPosition[]} events - events with anchorX, anchorY, depth
 * @returns {LabelPlacement[]} placements in same order as input
 */
export function assignTracks(events) {
  const leftEvents = [];
  const rightEvents = [];

  // Split by side based on depth (positive = front/right, negative = back/left
  // but we flip so that consistent visual: depth > 0 → right, depth < 0 → left)
  const indexed = events.map((e, i) => ({ ...e, idx: i }));

  for (const e of indexed) {
    if (e.depth >= 0) {
      rightEvents.push(e);
    } else {
      leftEvents.push(e);
    }
  }

  // Sort by anchor Y within each side
  const sortByY = (a, b) => a.anchorY - b.anchorY;
  leftEvents.sort(sortByY);
  rightEvents.sort(sortByY);

  // Track state: for each track, the Y of the last placed label's end
  /** @type {Map<'left'|'right', number[]>} */
  const trackEnds = {
    left: new Array(MAX_TRACKS).fill(-Infinity),
    right: new Array(MAX_TRACKS).fill(-Infinity),
  };

  /** @type {Map<number, LabelPlacement>} */
  const placements = new Map();

  /**
   * Place a single event on its side.
   * @param {EventWithPosition} e
   * @param {'left'|'right'} side
   * @returns {LabelPlacement}
   */
  function placeOne(e, side) {
    const ends = trackEnds[side];
    const y = e.anchorY;

    // Find the lowest track where this label fits
    let track = -1;
    for (let t = 0; t < MAX_TRACKS; t++) {
      if (y - ends[t] >= TRACK_GAP) {
        track = t;
        break;
      }
    }

    if (track >= 0) {
      ends[track] = y;
      return {
        track,
        side,
        y,
        labelY: y + track * 8, // vertical stagger per track
        clustered: false,
        clusterSize: 1,
      };
    }

    // No track available — this will be part of a cluster
    return {
      track: MAX_TRACKS,
      side,
      y,
      labelY: y,
      clustered: true,
      clusterSize: 1,
    };
  }

  // Place left events
  for (const e of leftEvents) {
    placements.set(e.idx, placeOne(e, "left"));
  }

  // Place right events
  for (const e of rightEvents) {
    placements.set(e.idx, placeOne(e, "right"));
  }

  // Second pass: collapse consecutive clustered events
  collapseClusters(placements, leftEvents, "left");
  collapseClusters(placements, rightEvents, "right");

  // Third pass: vertical de-collision — ensure non-clustered labels
  // on the same side don't overlap vertically.
  decolideLabels(placements, events);

  // Return placements in original event order
  return events.map((_, i) => {
    const p = placements.get(i);
    if (!p) {
      return { track: 0, side: "right", y: 0, labelY: 0, clustered: true, clusterSize: 1 };
    }
    return p;
  });
}

/**
 * Collapse consecutive events marked `clustered` into "+N more" cluster nodes.
 * The first event in a run keeps its position and accumulates clusterSize;
 * subsequent events get `clusterSize: 0` (absorbed).
 *
 * @param {Map<number, LabelPlacement>} placements
 * @param {EventWithPosition[]} events - side-sorted events
 * @param {'left'|'right'} side
 */
export function collapseClusters(placements, events, side) {
  let runStart = null;
  let runCount = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const p = placements.get(e.idx);
    if (!p || p.side !== side) continue;

    if (p.clustered) {
      if (runStart === null) {
        runStart = i;
        runCount = 1;
      } else {
        runCount++;
        // Absorb this event into the cluster
        placements.set(e.idx, { ...p, clusterSize: 0 });
      }
    } else {
      // End of a cluster run
      if (runStart !== null && runCount > 1) {
        const firstP = placements.get(events[runStart].idx);
        placements.set(events[runStart].idx, {
          ...firstP,
          clustered: true,
          clusterSize: runCount,
        });
      }
      runStart = null;
      runCount = 0;
    }
  }

  // Handle final cluster run
  if (runStart !== null && runCount > 1) {
    const firstP = placements.get(events[runStart].idx);
    placements.set(events[runStart].idx, {
      ...firstP,
      clustered: true,
      clusterSize: runCount,
    });
  }
}

/**
 * Vertical de-collision pass: ensures non-clustered labels on the same side
 * maintain at least MIN_LABEL_GAP px between their labelY positions.
 *
 * Walks labels sorted by labelY; pushes each label down if it would overlap
 * the previous label's block. Works in-place on the placements map.
 *
 * @param {Map<number, LabelPlacement>} placements
 * @param {Object[]} events — full event array (indexed by original position)
 */
export function decolideLabels(placements, events) {
  for (const side of ["left", "right"]) {
    // Collect placements on this side, skipping absorbed labels
    const items = [];
    for (const [idx, p] of placements) {
      if (p.side !== side) continue;
      if (p.clusterSize === 0) continue; // absorbed into cluster
      items.push({ idx, p });
    }

    // Sort by current labelY
    items.sort((a, b) => a.p.labelY - b.p.labelY);

    // Walk and push down overlapping labels
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1].p;
      const curr = items[i].p;
      const minY = prev.labelY + MIN_LABEL_GAP;
      if (curr.labelY < minY) {
        curr.labelY = minY;
      }
    }
  }
}

/**
 * Screen-space unified de-collision for all rendered labels.
 * Covers event labels AND era/millennium ticks together in one pass.
 *
 * Groups labels by screen side (left/right of viewport center), sorts each
 * group vertically by screenY, and pushes overlapping labels down to maintain
 * at least MIN_LABEL_GAP pixels of vertical separation on screen.
 *
 * @param {Array<{screenX: number, screenY: number, key: string}>} entries
 *   Each entry represents one text element:
 *   - screenX: text x position in screen pixels
 *   - screenY: text y (baseline) position in screen pixels
 *   - key: unique identifier (e.g., "event:0", "era:5")
 * @param {number} vpCenterX - viewport width / 2 (screen pixels)
 * @returns {Map<string, number>} adjusted screenY value for each entry key
 */
export function decolideAllLabels(entries, vpCenterX) {
  const left = [];
  const right = [];

  for (const e of entries) {
    if (e.screenX < vpCenterX) {
      left.push(e);
    } else {
      right.push(e);
    }
  }

  const adjusted = new Map();

  for (const group of [left, right]) {
    // Sort by screenY ascending
    group.sort((a, b) => a.screenY - b.screenY);

    for (let i = 0; i < group.length; i++) {
      let sy = group[i].screenY;
      if (i > 0) {
        const prevAdjusted = adjusted.get(group[i - 1].key);
        const minY = prevAdjusted + MIN_LABEL_GAP;
        if (sy < minY) sy = minY;
      }
      adjusted.set(group[i].key, sy);
    }
  }

  return adjusted;
}

/**
 * Return the maximum track number used (for layout calculations).
 * @param {LabelPlacement[]} placements
 * @returns {number}
 */
export function maxTrack(placements) {
  let max = 0;
  for (const p of placements) {
    if (!p.clustered && p.track > max) max = p.track;
  }
  return max;
}