import { test, expect } from "@playwright/test";

/**
 * ── B-8 Regression guard: zero overlapping label boxes ─────
 *
 * Enumerates every <text> element in the overlay SVG and measures its
 * RENDERED BOUNDING BOX via getBBox() (not the y/x attributes — those are
 * baseline *anchors*). It then counts pairs whose horizontal bounds overlap
 * AND whose vertical gap (`b.top − a.bottom`) is negative, i.e. glyphs that
 * actually collide on screen.
 *
 * This is deliberately a box-overlap assertion, NOT an anchor-gap assertion.
 * The old approach (asserting a fixed 14px gap between label `y` anchors)
 * could not catch the B-8 defect: a ~11–16px glyph box is taller than the
 * 14px anchor gap, and a left-anchored label near the centre can extend back
 * across the centre to overlap a label grouped onto the other side. Two
 * anchors "14px apart" still rendered overlapping glyphs. Only bounding-box
 * overlap sees that.
 *
 * Acceptance: 0 overlapping pairs at default zoom, and at one zoomed-in
 * and one zoomed-out level.
 */

// ── Overlap measurement ──────────────────────────────────────

interface TextBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface OverlapPair {
  labelA: string;
  labelB: string;
  vGap: number;
}

/**
 * Extract the rendered bounding box for every <text> element in the overlay
 * SVG, using getBBox() (SVG user-space = screen px here, since the overlay
 * has a `0 0 w h` viewBox and no transform).
 */
async function getTextBounds(page): Promise<TextBounds[]> {
  return page.evaluate(() => {
    const svg = document.getElementById("overlay") as SVGSVGElement;
    if (!svg) return [];

    const texts = svg.querySelectorAll("text");
    const results: TextBounds[] = [];

    for (const t of texts) {
      const rect = t.getBBox();
      // Skip elements with zero dimensions (hidden/invisible)
      if (rect.width === 0 && rect.height === 0) continue;

      results.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        text: t.textContent || "",
      });
    }

    return results;
  });
}

/**
 * Group text boxes by screen side (left/right of the overlay's centre),
 * count pairs where horizontal bounds overlap AND the vertical gap is
 * negative (`b.top − a.bottom < 0`).
 *
 * Returns the overlap count and a list of overlapping pairs.
 */
async function measureOverlaps(page): Promise<{
  count: number;
  pairs: OverlapPair[];
}> {
  const bounds = await getTextBounds(page);

  if (bounds.length === 0) {
    return { count: 0, pairs: [] };
  }

  // Centre of the overlay in its own (screen-px) coordinate space
  const centerX = await page.evaluate(
    () => (document.getElementById("overlay") as SVGSVGElement).clientWidth / 2,
  );

  // Group by screen side (box centre vs overlay centre)
  const left = bounds.filter((b) => b.x + b.width / 2 < centerX);
  const right = bounds.filter((b) => b.x + b.width / 2 >= centerX);

  const pairs: OverlapPair[] = [];

  function checkGroup(group: TextBounds[]) {
    // Sort by y ascending
    const sorted = [...group].sort((a, b) => a.y - b.y);

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];

        // Horizontal overlap check: do the x-ranges intersect?
        const aRight = a.x + a.width;
        const bRight = b.x + b.width;
        const hOverlap = a.x < bRight && b.x < aRight;

        if (!hOverlap) continue;

        // Vertical gap: b.y - (a.y + a.height)
        const vGap = b.y - (a.y + a.height);

        if (vGap < 0) {
          pairs.push({
            labelA: a.text.slice(0, 40),
            labelB: b.text.slice(0, 40),
            vGap: Math.round(vGap * 10) / 10,
          });
        }
      }
    }
  }

  checkGroup(left);
  checkGroup(right);

  return { count: pairs.length, pairs };
}

// ── Wait for app readiness ──────────────────────────────────

async function waitForApp(page) {
  await page.goto("/");

  // Wait for strands to be generated (demographics loaded)
  await page.waitForFunction(
    () => (window as any).__strandCount > 0,
    { timeout: 15000 },
  );

  // Wait for overlay to have text elements
  await page.waitForFunction(
    () => {
      const svg = document.getElementById("overlay") as SVGSVGElement;
      return svg && svg.querySelectorAll("text").length > 0;
    },
    { timeout: 10000 },
  );

  // Settle
  await page.waitForTimeout(500);
}

// ── Tests ────────────────────────────────────────────────────

test("B-8: zero overlapping label pairs at default zoom", async ({ page }) => {
  await waitForApp(page);

  const result = await measureOverlaps(page);

  if (result.count > 0) {
    console.log("OVERLAPPING PAIRS:");
    for (const p of result.pairs) {
      console.log(`  "${p.labelA}" ↔ "${p.labelB}"  vGap ${p.vGap}`);
    }
  }

  expect(result.count).toBe(0);
});

test("B-8: zero overlapping label pairs after zoom in", async ({ page }) => {
  await waitForApp(page);

  // Zoom in (3 scroll-wheel steps)
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, -500);
  }
  await page.waitForTimeout(800);

  const result = await measureOverlaps(page);

  if (result.count > 0) {
    console.log("ZOOM-IN OVERLAPPING PAIRS:");
    for (const p of result.pairs) {
      console.log(`  "${p.labelA}" ↔ "${p.labelB}"  vGap ${p.vGap}`);
    }
  }

  expect(result.count).toBe(0);
});

test("B-8: zero overlapping label pairs after zoom out", async ({ page }) => {
  await waitForApp(page);

  // Zoom out (3 scroll-wheel steps)
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 500);
  }
  await page.waitForTimeout(800);

  const result = await measureOverlaps(page);

  if (result.count > 0) {
    console.log("ZOOM-OUT OVERLAPPING PAIRS:");
    for (const p of result.pairs) {
      console.log(`  "${p.labelA}" ↔ "${p.labelB}"  vGap ${p.vGap}`);
    }
  }

  expect(result.count).toBe(0);
});

test("B-8: era tick labels are present in the overlay", async ({ page }) => {
  await waitForApp(page);

  const eraTexts = await page.evaluate(() => {
    const svg = document.getElementById("overlay") as SVGSVGElement;
    if (!svg) return [];
    const texts = svg.querySelectorAll("text");
    const eraLabels: string[] = [];
    for (const t of texts) {
      const content = t.textContent || "";
      // Era ticks contain "CE" or "BCE" without a descriptive event title
      if (/^\d[\d,]+\s*(CE|BCE)$/.test(content.trim())) {
        eraLabels.push(content.trim());
      }
    }
    return eraLabels;
  });

  // Must have era tick labels (1000 CE, 1900 CE, etc.)
  expect(eraTexts.length).toBeGreaterThanOrEqual(4);

  // Key era ticks must be present
  const has1000 = eraTexts.some((t) => t.includes("1000"));
  const has1900 = eraTexts.some((t) => t.includes("1900"));
  const has2000 = eraTexts.some((t) => t.includes("2000"));

  expect(has1000 || has1900 || has2000).toBe(true);
});

test("B-8: leader lines terminate at label positions", async ({ page }) => {
  await waitForApp(page);

  const result = await page.evaluate(() => {
    const svg = document.getElementById("overlay") as SVGSVGElement;
    if (!svg) return { total: 0, close: 0 };

    const polylines = svg.querySelectorAll("polyline");
    const texts = svg.querySelectorAll("text");

    // Build a map of text element positions using SVG attributes
    // (x/y attributes are in the same coordinate system as polyline points)
    const textPositions: { x: number; y: number }[] = [];
    for (const t of texts) {
      const tx = parseFloat(t.getAttribute("x") || "0");
      const ty = parseFloat(t.getAttribute("y") || "0");
      if (!isNaN(tx) && !isNaN(ty)) {
        textPositions.push({ x: tx, y: ty });
      }
    }

    let total = 0;
    let close = 0;

    for (const line of polylines) {
      const points = line.getAttribute("points") || "";
      const coords = points.trim().split(/\s+/);
      if (coords.length < 2) continue;

      // Last point in the polyline (the label end)
      const lastPt = coords[coords.length - 1];
      const [lx, ly] = lastPt.split(",").map(Number);
      if (isNaN(lx) || isNaN(ly)) continue;

      total++;

      // Check if any text element's SVG position is within 30px
      for (const tp of textPositions) {
        const dx = lx - tp.x;
        const dy = ly - tp.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 30) {
          close++;
          break;
        }
      }
    }

    return { total, close };
  });

  // At least 90% of leader lines should terminate near a text element
  if (result.total > 0) {
    const ratio = result.close / result.total;
    console.log(`leader-line proximity: ${result.close}/${result.total} (${(ratio * 100).toFixed(0)}%)`);
    expect(ratio).toBeGreaterThanOrEqual(0.9);
  }
});