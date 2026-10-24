import { TURNS, LEAN_DEG, SQUASH, BUDGET, colors } from "./config.js";

const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resize);
resize();

// Log the config for smoke verification — no rendering until A-2
console.log("History Helix loaded", { TURNS, LEAN_DEG, SQUASH, BUDGET, colors });