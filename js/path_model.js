export const MAX_PATH_POINTS = 100;

export function getHeadingMode(point) {
  return ['tangent', 'constant'].includes(point?.headingMode) ? point.headingMode : 'linear';
}

export function headingSettings(point) {
  const mode = getHeadingMode(point);
  return {
    ...(mode !== 'linear' ? { headingMode: mode } : {}),
    ...(mode === 'constant' && Number.isFinite(point.constantHeadingRad) ? { constantHeadingRad: point.constantHeadingRad } : {})
  };
}

export function setHeadingMode(point, mode) {
  if (!['linear', 'tangent', 'constant'].includes(mode)) throw new Error('Unsupported heading mode.');
  delete point.headingMode;
  delete point.constantHeadingRad;
  if (mode !== 'linear') point.headingMode = mode;
}

export function createAnchor(xPx, yPx, headingRad = 0, locked = false, controlPoints = [], headingMode = 'linear', constantHeadingRad) {
  return {
    xPx: Number(xPx) || 0,
    yPx: Number(yPx) || 0,
    headingRad: Number(headingRad) || 0,
    locked: !!locked,
    ...headingSettings({ headingMode, constantHeadingRad }),
    controlPoints: (controlPoints || []).slice(0, 2).map(createControlFrom)
  };
}

export function createControl(xPx, yPx, locked = false) {
  return { xPx: Number(xPx) || 0, yPx: Number(yPx) || 0, locked: !!locked };
}

export function normalizePath(path) {
  path.points = (path.points || []).map(point => ({ ...createAnchor(
    point.xPx,
    point.yPx,
    point.headingRad,
    point.locked,
    point.controlPoints
  ), ...headingSettings(point), segmentId: point.segmentId, breakBefore: point.breakBefore }));
  return path;
}

export function addControlPoint(path, endIndex) {
  if (!path || endIndex < 1 || endIndex >= path.points.length) return -1;
  const end = path.points[endIndex];
  if (end.breakBefore) return -1;
  const start = path.points[endIndex - 1];
  end.controlPoints ||= [];
  if (end.controlPoints.length >= 2) return -1;

  const t = end.controlPoints.length === 0 ? 0.5 : 2 / 3;
  end.controlPoints.push(createControl(
    start.xPx + (end.xPx - start.xPx) * t,
    start.yPx + (end.yPx - start.yPx) * t
  ));
  return end.controlPoints.length - 1;
}

export function removeControlPoint(path, endIndex, controlIndex) {
  const controls = path?.points?.[endIndex]?.controlPoints;
  if (!controls || controlIndex < 0 || controlIndex >= controls.length) return false;
  controls.splice(controlIndex, 1);
  return true;
}

export function removeAnchor(path, index) {
  if (!path || index < 0 || index >= path.points.length) return false;
  const breakBefore = path.points[index].breakBefore;
  path.points.splice(index, 1);
  // The next anchor's controls described a segment starting at the deleted anchor.
  if (path.points[index]) path.points[index].controlPoints = [];
  if (breakBefore && path.points[index]) path.points[index].breakBefore = true;
  if (path.points[0]) path.points[0].controlPoints = [];
  return true;
}

export function evaluateBezier(start, controls, end, t) {
  let level = [start, ...(controls || []), end].map(point => ({ x: point.xPx, y: point.yPx }));
  const clampedT = Math.max(0, Math.min(1, Number(t) || 0));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length - 1; i++) {
      next.push({
        x: level[i].x + (level[i + 1].x - level[i].x) * clampedT,
        y: level[i].y + (level[i + 1].y - level[i].y) * clampedT
      });
    }
    level = next;
  }
  return level[0];
}

export function sampleSegment(start, end, sampleCount = 40) {
  const samples = [];
  const controls = end.controlPoints || [];
  for (let i = 0; i <= sampleCount; i++) {
    samples.push(evaluateBezier(start, controls, end, i / sampleCount));
  }
  return samples;
}

function createControlFrom(control) {
  return createControl(control?.xPx, control?.yPx, control?.locked);
}
