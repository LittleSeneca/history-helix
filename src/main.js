import { drawSpine } from "./render/strands.js";
import { drawOverlay } from "./render/overlay.js";

const canvas = document.getElementById("scene");
const svg = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

// Event data loaded from JSON
let eventData = [];

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
}

function render() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Canvas: clear and draw helix spine
  ctx.clearRect(0, 0, w, h);
  drawSpine(ctx, w, h);

  // SVG overlay: era markers + events
  drawOverlay(svg, w, h, eventData);
}

async function loadEvents() {
  try {
    const resp = await fetch("data/events.json");
    if (!resp.ok) {
      console.warn("events.json not found or fetch failed, overlay will be minimal");
      return;
    }
    const data = await resp.json();
    eventData = data.events || [];
    console.log(`Loaded ${eventData.length} events`);
  } catch (err) {
    console.warn("Could not load events.json:", err.message);
  }
}

async function init() {
  resize();
  await loadEvents();
  render();
}

window.addEventListener("resize", () => {
  resize();
  render();
});

init();