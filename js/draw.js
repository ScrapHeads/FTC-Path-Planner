import { ctx, dpi, els, getMeasurementUnit } from './els.js';
import { state, getVisibleWaypointCount, PATH_COLORS } from './state.js';
import { layout, pxPerFieldSize, pxToField } from './layout.js';

export function draw() {
  try {
    const { imgRect } = layout();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    drawGrid();

    if (state.imgLoaded) {
      ctx.drawImage(state.img, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
    } else {
      ctx.fillStyle = '#101820';
      ctx.fillRect(imgRect.x, imgRect.y, imgRect.w, imgRect.h);
      ctx.fillStyle = '#789';
      ctx.font = `${14 * dpi}px sans-serif`;
      ctx.fillText('Load a field image', imgRect.x + 16, imgRect.y + 28);
    }

    drawPoints();
    drawMeasurement();
    drawHoverLabel();
    if (state.hudVisible) drawHUD();
    drawPaths(ctx);
  } catch (err) {
    console.error(err);
    alert('Render error: ' + err.message);
  }
}

function drawGrid() {
  const step = 40 * dpi;
  ctx.save();
  ctx.fillStyle = '#172231';
  for (let y = step / 2; y < ctx.canvas.height; y += step) {
    for (let x = step / 2; x < ctx.canvas.width; x += step) {
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
}

function drawPoints() {
  if (!state.imgLoaded) return;
  const { imgRect, imgToCanvas } = layout();
  const ppi = pxPerFieldSize();
  const R = 6 * dpi;
  const handleLen = 28 * dpi;

  state.paths.forEach((path, pathIdx) => {
    const points = path.points;
    const color = path.color;

    const lenIn = Math.max(0, parseFloat(els.robotLen.value || '0.4572'));
    const widIn = Math.max(0, parseFloat(els.robotWid.value || '0.4572'));
    const lenPxCanvas = lenIn * ppi * imgToCanvas;
    const widPxCanvas = widIn * ppi * imgToCanvas;

    // If you want preview per path, use path.previewEnabled and path.previewIndex
    const visibleCount = typeof path.previewEnabled === "boolean" && path.previewEnabled && typeof path.previewIndex === "number"
      ? Math.max(0, path.previewIndex + 1)
      : points.length;

    // visible segments
    for (let i = 1; i < visibleCount; i++) {
      const a = points[i - 1], b = points[i];
      const ax = imgRect.x + a.xPx * (imgRect.w / state.img.width);
      const ay = imgRect.y + a.yPx * (imgRect.h / state.img.height);
      const bx = imgRect.x + b.xPx * (imgRect.w / state.img.width);
      const by = imgRect.y + b.yPx * (imgRect.h / state.img.height);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 * dpi;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    // future segments dashed (preview)
    if (path.previewEnabled && state.dimFuture && visibleCount >= 1 && points.length > visibleCount) {
      const start = points[visibleCount - 1];
      let sx = imgRect.x + start.xPx * (imgRect.w / state.img.width);
      let sy = imgRect.y + start.yPx * (imgRect.h / state.img.height);
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 2 * dpi;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      for (let i = visibleCount; i < points.length; i++) {
        const p = points[i];
        const px = imgRect.x + p.xPx * (imgRect.w / state.img.width);
        const py = imgRect.y + p.yPx * (imgRect.h / state.img.height);
        ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // points
    points.forEach((p, i) => {
      const cx = imgRect.x + p.xPx * (imgRect.w / state.img.width);
      const cy = imgRect.y + p.yPx * (imgRect.h / state.img.height);

      const isFuture = path.previewEnabled && (i >= visibleCount);
      const isSel = (pathIdx === state.activePath) && (i === state.selected);
      const isLocked = !!p.locked;

      // Field 0 = North, CCW positive → Canvas angle is clockwise (y-down)
      // angCanvas = -(θ_field + π/2)
      const angCanvas = -(p.headingRad + Math.PI / 2);

      // robot footprint for visible points only
      if (!isFuture && lenPxCanvas > 0 && widPxCanvas > 0) {
        ctx.save();
        ctx.translate(cx, cy);
        const angle = els.boxRotate.checked ? angCanvas : 0;
        ctx.rotate(angle);
        ctx.globalAlpha = 0.12; ctx.fillStyle = isLocked ? '#f59e0b' : color;
        ctx.fillRect(-widPxCanvas / 2, -lenPxCanvas / 2, widPxCanvas, lenPxCanvas);
        ctx.globalAlpha = 1; ctx.lineWidth = 2 * dpi; ctx.strokeStyle = isLocked ? '#f59e0b' : color;
        ctx.strokeRect(-widPxCanvas / 2, -lenPxCanvas / 2, widPxCanvas, lenPxCanvas);
        ctx.restore();
      }

      // point dot
      ctx.fillStyle = isFuture ? 'rgba(226,232,240,0.35)' : (isSel ? '#a78bfa' : color);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 2 * dpi;
      ctx.strokeStyle = isLocked ? '#f59e0b' : (isFuture ? 'rgba(148,163,184,0.35)' : '#94a3b8');
      ctx.stroke();

      // heading handle (uses CANVAS angle)
      const hx = cx + Math.cos(angCanvas) * handleLen;
      const hy = cy + Math.sin(angCanvas) * handleLen;
      ctx.save();
      if (isLocked) ctx.setLineDash([6, 4]);
      ctx.strokeStyle = isFuture ? 'rgba(148,163,184,0.35)' : (isLocked ? '#f59e0b' : '#94a3b8');
      ctx.lineWidth = 2 * dpi;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.restore();

      if (!isFuture) {
        drawArrow(hx, hy, angCanvas, isLocked ? '#f59e0b' : '#94a3b8');
      }

      // label
      ctx.fillStyle = isFuture ? 'rgba(11,15,20,0.6)' : '#0b0f14';
      ctx.font = `${12 * dpi}px sans-serif`;
      const label = isLocked ? `🔒 ${i + 1}` : String(i + 1);
      ctx.fillText(label, cx + 8 * dpi, cy - 8 * dpi);
    });
  });
}

function drawArrow(x, y, theta, color) {
  const s = 8 * dpi;
  ctx.save(); ctx.translate(x, y); ctx.rotate(theta);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-s, -s / 2); ctx.lineTo(-s, s / 2);
  ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore();
}

function drawMeasurement() {
  if (!state.measureActive) return;
  const a = state.measureStart, b = state.measureEnd;
  ctx.save();
  ctx.lineWidth = 2 * dpi;
  ctx.strokeStyle = '#60a5fa';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);

  // distance & bearing in FIELD units (0 at +X/North, CCW+)
  const fa = pxToField(a.x, a.y);
  const fb = pxToField(b.x, b.y);
  const dx = fb.x - fa.x, dy = fb.y - fa.y;
  const dist = Math.hypot(dx, dy);
  const angRad = Math.atan2(dy, dx);

  let angDeg;
  if (state.headingWrapHalf) {
    let d = angRad * 180 / Math.PI;
    if (d <= -180) d += 360;
    if (d > 180) d -= 360;
    angDeg = d;
  } else {
    let d = (angRad * 180 / Math.PI) % 360;
    if (d < 0) d += 360;
    angDeg = d;
  }

  const pad = 6 * dpi;
  const text = `${dist.toFixed(2)} in • ${angDeg.toFixed(1)}°`;
  ctx.font = `${12 * dpi}px sans-serif`;
  const tw = ctx.measureText(text).width;
  const midx = b.x;
  const midy = b.y - 18 * dpi;
  ctx.fillStyle = 'rgba(2,6,14,0.85)';
  ctx.fillRect(midx - tw / 2 - pad, midy - 12 * dpi, tw + 2 * pad, 18 * dpi);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(text, midx - tw / 2, midy + 2 * dpi);
  ctx.restore();
}

function drawHoverLabel() {
  if (state.measureActive) return;
  if (!state.hoverActive || !state.imgLoaded) return;

  const { imgRect } = layout();
  const m = state.hoverPos;
  const within = m.x >= imgRect.x && m.x <= imgRect.x + imgRect.w && m.y >= imgRect.y && m.y <= imgRect.y + imgRect.h;
  if (!within) return;

  const f = pxToField(m.x, m.y);
  const text = `X ${f.x.toFixed(2)}  Y ${f.y.toFixed(2)} ${getMeasurementUnit()}`;

  ctx.save();
  ctx.font = `${12 * dpi}px sans-serif`;
  const pad = 6 * dpi;
  const tw = ctx.measureText(text).width;
  const bx = m.x;
  const by = m.y - 22 * dpi;

  ctx.fillStyle = 'rgba(2,6,14,0.85)';
  ctx.fillRect(bx - tw / 2 - pad, by - 12 * dpi, tw + 2 * pad, 20 * dpi);

  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(text, bx - tw / 2, by + 3 * dpi);
  ctx.restore();
}

function drawHUD() {
  const lines = [
    'N: Add point at cursor',
    'Q/E: Rotate selected (Shift=15° / Alt=5°)',
    'P: Toggle preview   [ / ]: Step   \\\\: All   /: None',
    'Ctrl+Z / Ctrl+Y: Undo / Redo',
    'Delete: Remove selected   Ctrl+D: Duplicate',
    'M (hold): Measure (1in, Shift=0.5in)',
    'H: Toggle this HUD'
  ];
  const pad = 8 * dpi;
  const lineH = 16 * dpi;
  const w = 340 * dpi, h = (lines.length * lineH) + pad * 2;
  const x = ctx.canvas.width - w - 12 * dpi;
  const y = ctx.canvas.height - h - 12 * dpi;

  ctx.save();
  ctx.fillStyle = 'rgba(2,6,14,0.85)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `${12 * dpi}px sans-serif`;
  lines.forEach((t, i) => {
    ctx.fillText(t, x + pad, y + pad + (i + 1) * lineH - 6 * dpi);
  });
  ctx.restore();
}

function drawPaths(ctx) {
  const { imgRect } = layout();
  state.paths.forEach((path, idx) => {
    if (!path.points.length) return;
    ctx.save();
    ctx.strokeStyle = path.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    path.points.forEach((p, i) => {
      const cx = imgRect.x + p.xPx * (imgRect.w / state.img.width);
      const cy = imgRect.y + p.yPx * (imgRect.h / state.img.height);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    ctx.restore();
  });
}
