// Label track assignment with collision avoidance (DESIGN.md §2.4)
// assignTracks(events) — greedy placement on parallel tracks
// Overflow collapses into "+N more" cluster nodes

import { TRACK_GAP } from "../config.js";

/**
 * @typedef {Object} LabelPlacement
 * @property {number} track - which track this label sits on (0-indexed)
 * @property {'left'|'right'} side - left or right of the coil axis
 * @property {number} y - anchor Y position in scene space
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
        clustered: false,
        clusterSize: 1,
      };
    }

    // No track available — this will be part of a cluster
    return {
      track: MAX_TRACKS,
      side,
      y,
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

  // Return placements in original event order
  return events.map((_, i) => {
    const p = placements.get(i);
    if (!p) {
      return { track: 0, side: "right", y: 0, clustered: true, clusterSize: 1 };
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
function collapseClusters(placements, events, side) {
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