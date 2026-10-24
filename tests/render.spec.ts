import { test, expect } from "@playwright/test";

test("canvas is non-blank after page load", async ({ page }) => {
  await page.goto("/");

  const canvas = page.locator("#scene");
  await expect(canvas).toBeVisible();

  // Wait for the module to load and render
  await page.waitForTimeout(1000);

  // Scan the canvas for non-black pixels: the spine is stroked in slate blue
  const brightPixels = await page.evaluate(() => {
    const c = document.getElementById("scene") as HTMLCanvasElement;
    if (!c) return [];
    const ctx = c.getContext("2d");
    if (!ctx) return [];
    const results: { x: number; y: number }[] = [];
    const step = 20;
    for (let y = 0; y < c.height; y += step) {
      for (let x = 0; x < c.width; x += step) {
        const p = ctx.getImageData(x, y, 1, 1).data;
        if (p[0] > 10 || p[1] > 10 || p[2] > 10) {
          results.push({ x, y });
        }
      }
    }
    return results;
  });

  // At least a few pixels must show the helix stroke
  expect(brightPixels.length).toBeGreaterThan(5);
});

test("SVG overlay has event markers after load", async ({ page }) => {
  await page.goto("/");

  // Wait for module load + data fetch + render
  await page.waitForTimeout(1500);

  // Count event nodes in SVG overlay (circles, polylines, text elements)
  const eventNodeCount = await page.evaluate(() => {
    const svg = document.getElementById("overlay") as SVGSVGElement;
    if (!svg) return -1;
    // Count circles (event markers) — should be > 0
    const circles = svg.querySelectorAll("circle");
    // Count polylines (leader lines)
    const lines = svg.querySelectorAll("polyline");
    // Count text elements (labels)
    const texts = svg.querySelectorAll("text");
    return { circles: circles.length, lines: lines.length, texts: texts.length };
  });

  expect(eventNodeCount).not.toBe(-1);
  // At least one event marker should be visible at default zoom
  expect(eventNodeCount.circles).toBeGreaterThan(0);
  expect(eventNodeCount.lines).toBeGreaterThan(0);
  expect(eventNodeCount.texts).toBeGreaterThan(0);
});

test("overlay SVG element exists and has content", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(1000);

  const svgHTML = await page.evaluate(() => {
    const svg = document.getElementById("overlay");
    return svg ? svg.innerHTML.length : 0;
  });

  // The SVG should have substantial content
  expect(svgHTML).toBeGreaterThan(100);
});