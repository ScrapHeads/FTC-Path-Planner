import { canvas, ctx, dpi } from './els.js';
import { state } from './state.js';
import { canvasToImagePx, imagePxToField, imagePxToCanvas, fieldToCanvas } from './layout.js';

export function isExclusionDrawingEnabled() {
  return document.getElementById('exclusionEnabled').checked;
}

export function startExclusionBox(mouse) {
  const point = boundedPoint(mouse);
  state.exclusionBox = { start: point, end: point };
}

export function moveExclusionBox(mouse) {
  const box = state.exclusionBox;
  if (box) box.end = boundedPoint(mouse);
}

function boundedPoint(mouse) {
  const point = canvasToImagePx(mouse.x, mouse.y);
  return { x: Math.max(0, Math.min(state.img.width, point.x)), y: Math.max(0, Math.min(state.img.height, point.y)) };
}

export function drawExclusionBox() {
  const box = state.exclusionBox;
  const output = document.getElementById('exclusionOutput');
  const copy = document.getElementById('copyExclusionBtn');
  if (!box || !state.imgLoaded) {
    output.value = '';
    copy.disabled = true;
    return;
  }
  const a = imagePxToField(box.start.x, box.start.y);
  const b = imagePxToField(box.end.x, box.end.y);
  const minX = Math.min(a.x, b.x), minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x, b.x), maxY = Math.max(a.y, b.y);
  const valid = maxX > minX && maxY > minY;
  output.value = valid ? `new ExclusionZone(${minX}, ${minY}, ${maxX}, ${maxY})` : '';
  copy.disabled = !valid;
  const p = imagePxToCanvas(box.start.x, box.start.y);
  const q = imagePxToCanvas(box.end.x, box.end.y);
  ctx.save();
  ctx.fillStyle = 'rgba(255, 190, 60, 0.18)';
  ctx.strokeStyle = '#ffca62';
  ctx.lineWidth = 2 * dpi;
  ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
  ctx.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
  ctx.font = `${11 * dpi}px sans-serif`;
  for (const [name, x, y] of [
    ['bottomLeft', minX, minY], ['bottomRight', maxX, minY],
    ['topRight', maxX, maxY], ['topLeft', minX, maxY]
  ]) {
    const corner = fieldToCanvas(x, y);
    const label = `${name} (${Number(x.toFixed(3))}, ${Number(y.toFixed(3))})`;
    const width = ctx.measureText(label).width + 8 * dpi;
    const left = Math.max(0, Math.min(canvas.width - width, corner.x <= (p.x + q.x) / 2 ? corner.x : corner.x - width));
    const top = Math.max(0, Math.min(canvas.height - 18 * dpi, corner.y <= (p.y + q.y) / 2 ? corner.y - 19 * dpi : corner.y + 3 * dpi));
    ctx.fillStyle = '#172231';
    ctx.fillRect(left, top, width, 18 * dpi);
    ctx.fillStyle = '#ffca62';
    ctx.fillText(label, left + 4 * dpi, top + 13 * dpi);
  }
  ctx.restore();
}

export function initExclusionBox(draw) {
  const toggle = document.getElementById('exclusionEnabled');
  const clearBox = () => {
    state.exclusionBox = null;
    if (state.dragMode === 'exclusion-box') state.dragMode = null;
    draw();
  };
  toggle.addEventListener('change', () => {
    if (!toggle.checked) clearBox();
  });
  const output = document.getElementById('exclusionOutput');
  const copy = document.getElementById('copyExclusionBtn');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      copy.textContent = 'Copied!';
      setTimeout(() => { copy.textContent = 'Copy ExclusionZone'; }, 1200);
    } catch {
      output.focus();
      output.select();
      copy.textContent = 'Selected — press Ctrl+C / Cmd+C';
    }
  });
  document.getElementById('clearExclusionBtn').addEventListener('click', clearBox);
}
