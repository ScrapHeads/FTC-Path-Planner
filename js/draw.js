import { ctx, dpi, els, getMeasurementUnit, isPedroPathingSelected } from './els.js';
import { state, PATH_COLORS } from './state.js';
import { layout, withCanvasLayout, imagePxToCanvas, pxToField, headingToCanvasAngle } from './layout.js';
import { doExport } from './io_export.js';
import { sampleSegment, evaluateBezier } from './path_model.js';
import { ensurePathSegments, getSegmentPoints } from './segment_model.js';
import { drawExclusionBox } from './exclusion_zone.js';
import { collisionReport } from './collision_state.js';

export function draw(options = {}) {
  try {
    withCanvasLayout(({ imgRect }) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      drawGrid();

      if (state.imgLoaded) {
        ctx.drawImage(state.img, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
        drawExclusionBox();
        drawPathsAndPoints();
        drawHoverLabel();
      } else {
        ctx.fillStyle = '#101820';
        ctx.fillRect(imgRect.x, imgRect.y, imgRect.w, imgRect.h);
        ctx.fillStyle = '#789';
        ctx.font = `${14 * dpi}px sans-serif`;
        ctx.fillText('Load a field image', imgRect.x + 16, imgRect.y + 28);
      }

      if (!state.imgLoaded) drawExclusionBox();
      if (state.hudVisible) drawHUD();
      if (options.updateExport ?? !state.dragMode) doExport();
    });
  } catch (error) {
    console.error('Render error', error);
  }
}

function drawGrid() {
  const step = 40 * dpi;
  ctx.save();
  ctx.fillStyle = '#172231';
  for (let y = step / 2; y < ctx.canvas.height; y += step) {
    for (let x = step / 2; x < ctx.canvas.width; x += step) ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function drawPathsAndPoints() {
  const controlsEnabled = isPedroPathingSelected();
  const activePath = state.paths[state.activePath];
  const selectedSegment = controlsEnabled ? ensurePathSegments(activePath)[activePath.activeSegment] : null;
  const focusedPoints = selectedSegment ? new Set(getSegmentPoints(activePath, selectedSegment.id)) : null;
  const reports = collisionReport().paths;
  state.paths.forEach((path, pathIndex) => {
    const collisions = reports[pathIndex];
    const visibleCount = path.previewEnabled
      ? Math.max(0, Math.min(path.points.length, path.previewIndex + 1))
      : path.points.length;

    for (let endIndex = 1; endIndex < path.points.length; endIndex++) {
      if (path.points[endIndex].breakBefore) continue;
      const outsideSegment = focusedPoints && (pathIndex !== state.activePath || path.points[endIndex].segmentId !== selectedSegment.id);
      const dimmed = endIndex >= visibleCount || outsideSegment;
      drawSegment(path.points[endIndex - 1], path.points[endIndex], path.color, dimmed, controlsEnabled);
      if (collisions.connections[endIndex]) drawCollisionIntervals(path.points[endIndex - 1], path.points[endIndex], collisions.connections[endIndex], controlsEnabled);
      if (controlsEnabled && pathIndex === state.activePath) drawControlPolygon(path, endIndex, dimmed);
    }

    path.points.forEach((point, pointIndex) => {
      const outsideSegment = focusedPoints && (pathIndex !== state.activePath || !focusedPoints.has(point));
      const future = pointIndex >= visibleCount;
      drawAnchor(path, pathIndex, point, pointIndex, future || outsideSegment, collisions.anchors[pointIndex]?.length > 0, collisions.headings[pointIndex]);
      if (controlsEnabled && pathIndex === state.activePath) {
        // Controls belong to the incoming connection, including at shared anchors.
        drawControls(path, pointIndex, future || (selectedSegment && point.segmentId !== selectedSegment.id));
      }
    });
  });
}

const geometryCache = new WeakMap();
function segmentGeometry(start, end, controlsEnabled) {
  const controls = controlsEnabled ? end.controlPoints || [] : [];
  const key = [start.xPx, start.yPx, end.xPx, end.yPx, ...controls.flatMap(control => [control.xPx, control.yPx])].join(',');
  let geometry = geometryCache.get(end);
  if (!geometry || geometry.key !== key) {
    geometry = { key, controls, samples: sampleSegment(start, { ...end, controlPoints: controls }, controls.length ? 48 : 1) };
    geometryCache.set(end, geometry);
  }
  return geometry;
}

function drawSegment(start, end, color, isFuture, controlsEnabled) {
  const { samples } = segmentGeometry(start, end, controlsEnabled);
  ctx.save();
  ctx.strokeStyle = isFuture ? 'rgba(148, 163, 184, 0.45)' : color;
  ctx.lineWidth = 3 * dpi;
  if (isFuture) ctx.setLineDash([7 * dpi, 6 * dpi]);
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const canvasPoint = imagePxToCanvas(sample.x, sample.y);
    if (index === 0) ctx.moveTo(canvasPoint.x, canvasPoint.y);
    else ctx.lineTo(canvasPoint.x, canvasPoint.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawControlPolygon(path, endIndex, isFuture) {
  const end = path.points[endIndex];
  const controls = end.controlPoints || [];
  if (!controls.length) return;
  const polygon = [path.points[endIndex - 1], ...controls, end];
  ctx.save();
  ctx.strokeStyle = isFuture ? 'rgba(245, 158, 11, 0.25)' : 'rgba(245, 158, 11, 0.75)';
  ctx.lineWidth = 1.5 * dpi;
  ctx.setLineDash([4 * dpi, 4 * dpi]);
  ctx.beginPath();
  polygon.forEach((point, index) => {
    const canvasPoint = imagePxToCanvas(point.xPx, point.yPx);
    if (index === 0) ctx.moveTo(canvasPoint.x, canvasPoint.y);
    else ctx.lineTo(canvasPoint.x, canvasPoint.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawControls(path, pointIndex, isFuture) {
  const controls = path.points[pointIndex].controlPoints || [];
  controls.forEach((control, controlIndex) => {
    const canvasPoint = imagePxToCanvas(control.xPx, control.yPx);
    const selected = state.selectedControl?.pointIndex === pointIndex &&
      state.selectedControl?.controlIndex === controlIndex;
    const radius = 5.5 * dpi;
    ctx.save();
    ctx.translate(canvasPoint.x, canvasPoint.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = isFuture
      ? 'rgba(245, 158, 11, 0.35)'
      : (selected ? '#a78bfa' : '#f59e0b');
    ctx.strokeStyle = control.locked ? '#ef4444' : '#fff7ed';
    ctx.lineWidth = 2 * dpi;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
  });
}

function drawCollisionIntervals(start, end, intervals, controlsEnabled) {
  const geometry = segmentGeometry(start, end, controlsEnabled);
  if (geometry.intervals !== intervals) {
    geometry.intervals = intervals;
    // Overlapping enabled zones may report the same interval. Draw their union.
    const merged = [];
    for (const interval of [...intervals].sort((a, b) => a.from - b.from)) {
      const last = merged.at(-1);
      if (last && interval.from <= last.to) last.to = Math.max(last.to, interval.to);
      else merged.push({ from: interval.from, to: interval.to });
    }
    geometry.collisionLines = merged.map(interval => {
      const steps = Math.max(1, Math.ceil((interval.to - interval.from) * 128));
      return Array.from({ length: steps + 1 }, (_, index) => evaluateBezier(start, geometry.controls, end,
        interval.from + (interval.to - interval.from) * index / steps));
    });
  }
  ctx.save(); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 5 * dpi; ctx.setLineDash([]);
  for (const points of geometry.collisionLines) {
    ctx.beginPath();
    points.forEach((point, index) => { const p = imagePxToCanvas(point.x, point.y); if (!index) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
  }
  ctx.restore();
}

function drawAnchor(path, pathIndex, point, pointIndex, isFuture, collides = false, expectedHeading) {
  const canvasPoint = imagePxToCanvas(point.xPx, point.yPx);
  const selected = pathIndex === state.activePath && pointIndex === state.selected && !state.selectedControl;
  const color = collides ? '#ef4444' : path.color || PATH_COLORS[pathIndex] || '#94a3b8';
  const angle = headingToCanvasAngle(point.headingRad);

  const footprintAngle = Number.isFinite(expectedHeading) ? -expectedHeading : angle;
  if (!isFuture || collides) drawRobotFootprint(canvasPoint, footprintAngle, color, point.locked && !collides, collides);

  const radius = 6 * dpi;
  ctx.fillStyle = collides ? '#ef4444' : isFuture ? 'rgba(226, 232, 240, 0.35)' : (selected ? '#a78bfa' : color);
  ctx.beginPath();
  ctx.arc(canvasPoint.x, canvasPoint.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = point.locked ? '#f59e0b' : '#e2e8f0';
  ctx.lineWidth = 2 * dpi;
  ctx.stroke();

  const handleLength = 28 * dpi;
  const handleX = canvasPoint.x + Math.cos(angle) * handleLength;
  const handleY = canvasPoint.y + Math.sin(angle) * handleLength;
  ctx.save();
  if (point.locked) ctx.setLineDash([5 * dpi, 4 * dpi]);
  ctx.strokeStyle = isFuture ? 'rgba(148, 163, 184, 0.4)' : '#e2e8f0';
  ctx.lineWidth = 2 * dpi;
  ctx.beginPath();
  ctx.moveTo(canvasPoint.x, canvasPoint.y);
  ctx.lineTo(handleX, handleY);
  ctx.stroke();
  ctx.restore();
  if (!isFuture) drawArrow(handleX, handleY, angle, point.locked ? '#f59e0b' : '#e2e8f0');

  ctx.fillStyle = isFuture ? 'rgba(11, 15, 20, 0.55)' : '#0b0f14';
  ctx.font = `${12 * dpi}px sans-serif`;
  ctx.fillText(point.locked ? `L${pointIndex + 1}` : `${pointIndex + 1}`, canvasPoint.x + 8 * dpi, canvasPoint.y - 8 * dpi);
}

function drawRobotFootprint(canvasPoint, angle, color, locked, collides = false) {
  const { imgRect } = layout();
  const metersPerCanvasPixelX = state.fieldConfig.fieldWidthM / imgRect.w;
  const metersPerCanvasPixelY = state.fieldConfig.fieldHeightM / imgRect.h;
  const metersPerCanvasPixel = (metersPerCanvasPixelX + metersPerCanvasPixelY) / 2;
  const length = state.robotDimensions.lengthM / metersPerCanvasPixel;
  const width = state.robotDimensions.widthM / metersPerCanvasPixel;
  if (!(length > 0 && width > 0)) return;

  ctx.save();
  ctx.translate(canvasPoint.x, canvasPoint.y);
  ctx.rotate(collides || els.boxRotate.checked ? angle : 0);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = locked ? '#f59e0b' : color;
  ctx.fillRect(-length / 2, -width / 2, length, width);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = locked ? '#f59e0b' : color;
  ctx.lineWidth = 2 * dpi;
  ctx.strokeRect(-length / 2, -width / 2, length, width);
  ctx.restore();
}

function drawArrow(x, y, theta, color) {
  const size = 8 * dpi;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(theta);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size / 2);
  ctx.lineTo(-size, size / 2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawHoverLabel() {
  if (!state.hoverActive || !state.imgLoaded) return;
  const { imgRect } = layout();
  const mouse = state.hoverPos;
  if (mouse.x < imgRect.x || mouse.x > imgRect.x + imgRect.w || mouse.y < imgRect.y || mouse.y > imgRect.y + imgRect.h) return;
  const field = pxToField(mouse.x, mouse.y);
  const text = `X ${field.x.toFixed(2)}  Y ${field.y.toFixed(2)} ${getMeasurementUnit()}`;
  const padding = 6 * dpi;
  ctx.save();
  ctx.font = `${12 * dpi}px sans-serif`;
  const width = ctx.measureText(text).width;
  const x = mouse.x;
  const y = mouse.y - 22 * dpi;
  ctx.fillStyle = 'rgba(2, 6, 14, 0.85)';
  ctx.fillRect(x - width / 2 - padding, y - 12 * dpi, width + padding * 2, 20 * dpi);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(text, x - width / 2, y + 3 * dpi);
  ctx.restore();
}

function drawHUD() {
  const lines = [
    'N: Add anchor at cursor',
    'Drag diamond: Move control point',
    'Q/E: Rotate selected (Shift=15 degrees)',
    'P: Toggle preview   [ / ]: Step',
    'Ctrl+Z / Ctrl+Y: Undo / Redo',
    'Delete: Remove selection   H: Hide help'
  ];
  const padding = 8 * dpi;
  const lineHeight = 16 * dpi;
  const width = 350 * dpi;
  const height = lines.length * lineHeight + padding * 2;
  const x = ctx.canvas.width - width - 12 * dpi;
  const y = ctx.canvas.height - height - 12 * dpi;
  ctx.save();
  ctx.fillStyle = 'rgba(2, 6, 14, 0.85)';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = `${12 * dpi}px sans-serif`;
  lines.forEach((line, index) => ctx.fillText(line, x + padding, y + padding + (index + 1) * lineHeight - 6 * dpi));
  ctx.restore();
}
