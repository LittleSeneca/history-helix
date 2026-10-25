import { test, expect } from "@playwright/test";

test("canvas is non-blank after page load", async ({ page }) => {
  await page.goto("/");

  const canvas = page.locator("#scene");
  await expect(canvas).toBeVisible();

  // The spine renders immediately. Wait for strands (async demographics load).
  // The app logs "[history-helix] strands generated: N" when ready.
  await page.waitForFunction(
    () => (window as any).__strandCount > 0,
    { timeout: 15000 },
  );

  // Extra settling time for render
  await page.waitForTimeout(300);

  // Scan the canvas for non-black pixels
  const brightPixels = await page.evaluate(() => {
    const c = document.getElementById("scene") as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
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

  console.log(`bright pixels: ${brightPixels.length}`);
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
    const circles = svg.querySelectorAll("circle");
    const lines = svg.querySelectorAll("polyline");
    const texts = svg.querySelectorAll("text");
    return { circles: circles.length, lines: lines.length, texts: texts.length };
  });

  expect(eventNodeCount).not.toBe(-1);
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

  expect(svgHTML).toBeGreaterThan(100);
});

test("frame renders in under 500 ms", async ({ page }) => {
  await page.goto("/");

  // Wait for strands to be loaded
  await page.waitForFunction(
    () => (window as any).__strandCount > 0,
    { timeout: 15000 },
  );

  // Measure frame time via resize-triggered re-render
  const frameTime = await page.evaluate(() => {
    return new Promise<number>((resolve) => {
      const t0 = performance.now();
      window.dispatchEvent(new Event("resize"));

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve(performance.now() - t0);
        });
      });
    });
  });

  console.log(`frame time: ${frameTime.toFixed(1)} ms`);
  expect(frameTime).toBeLessThan(500);
});