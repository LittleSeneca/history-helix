import { drawSpine } from "./render/strands.js";

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

function render() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);
  drawSpine(ctx, w, h);
}

window.addEventListener("resize", () => {
  resize();
  render();
});

resize();
render();