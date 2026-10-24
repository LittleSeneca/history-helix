import { test, expect } from "@playwright/test";

test("canvas is non-blank after page load", async ({ page }) => {
  await page.goto("/");

  const canvas = page.locator("#scene");
  await expect(canvas).toBeVisible();

  // Wait for the module to load and render the helix
  await page.waitForTimeout(500);

  // Scan the canvas for non-black pixels: the spine is stroked in slate blue
  const brightPixels = await page.evaluate(() => {
    const c = document.getElementById("scene");
    const ctx = c.getContext("2d");
    const results = [];
    const step = 20; // coarse grid — we only need to prove the canvas isn't blank
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