import { getHeadingMode } from './path_model.js';
import { normalizeAngle } from './coordinates.js';

const EPS = 1e-8;

export function bezier(points, t) {
  let level = points;
  while (level.length > 1) level = level.slice(1).map((point, i) => ({
    x: level[i].x + (point.x - level[i].x) * t, y: level[i].y + (point.y - level[i].y) * t
  }));
  return level[0];
}

function split(points) {
  let level = points;
  const left = [points[0]], right = [points.at(-1)];
  while (level.length > 1) {
    level = level.slice(1).map((point, i) => ({ x: (level[i].x + point.x) / 2, y: (level[i].y + point.y) / 2 }));
    left.push(level[0]); right.unshift(level.at(-1));
  }
  return [left, right];
}

function derivative(points) { return points.slice(1).map((point, i) => ({ x: point.x - points[i].x, y: point.y - points[i].y })); }

export function connectionPose(start, end, t) {
  const points = [start, ...(end.controlPoints || []), end];
  const position = bezier(points, t);
  const mode = getHeadingMode(end);
  let headingRad;
  if (mode === 'constant') headingRad = end.constantHeadingRad ?? end.headingRad;
  else if (mode === 'tangent') {
    let vector = bezier(derivative(points), t);
    // At a stationary endpoint, use the limiting tangent of the curve.
    if (Math.hypot(vector.x, vector.y) < EPS) vector = bezier(derivative(points), t < 0.5 ? Math.min(1, t + 1e-7) : Math.max(0, t - 1e-7));
    headingRad = Math.hypot(vector.x, vector.y) < EPS ? start.headingRad : Math.atan2(vector.y, vector.x);
  } else headingRad = start.headingRad + normalizeAngle(end.headingRad - start.headingRad) * t;
  return { ...position, headingRad };
}

// Signed separation on the four separating axes of an oriented robot and an
// axis-aligned obstacle. Nonpositive means overlap, including touching.
export function footprintGap(pose, zone, length, width, margin = 0) {
  const c = Math.cos(pose.headingRad), s = Math.sin(pose.headingRad);
  const dx = pose.x - (zone.minX + zone.maxX) / 2, dy = pose.y - (zone.minY + zone.maxY) / 2;
  const zx = (zone.maxX - zone.minX) / 2 + margin, zy = (zone.maxY - zone.minY) / 2 + margin;
  return Math.max(
    Math.abs(dx) - zx - Math.abs(c) * length / 2 - Math.abs(s) * width / 2,
    Math.abs(dy) - zy - Math.abs(s) * length / 2 - Math.abs(c) * width / 2,
    Math.abs(dx * c + dy * s) - length / 2 - zx * Math.abs(c) - zy * Math.abs(s),
    Math.abs(-dx * s + dy * c) - width / 2 - zx * Math.abs(s) - zy * Math.abs(c)
  );
}

function angleBound(points, mode, start, end, a, b, heading) {
  if (mode === 'constant') return 0;
  if (mode === 'linear') return Math.abs(normalizeAngle(end.headingRad - start.headingRad)) * (b - a) / 2;
  const vectors = derivative(points).filter(vector => Math.hypot(vector.x, vector.y) > 0);
  if (!vectors.length) return 0;
  let bound = 0;
  for (const vector of vectors) {
    const difference = Math.abs(normalizeAngle(Math.atan2(vector.y, vector.x) - heading));
    if (difference >= Math.PI / 2) return Math.PI;
    bound = Math.max(bound, difference);
  }
  return bound;
}

export function connectionCollisions(start, end, zones, length, width, margin = 0) {
  const hits = [];
  const radius = Math.hypot(length, width) / 2;
  const mode = getHeadingMode(end);
  const controlPoints = [start, ...(end.controlPoints || []), end];
  for (const zone of zones.filter(zone => zone.enabled)) {
    function visit(points, a, b, depth) {
      const mid = (a + b) / 2;
      const pose = connectionPose(start, end, mid);
      const travel = Math.max(...points.map(point => Math.hypot(point.x - pose.x, point.y - pose.y)));
      const turn = angleBound(points, mode, start, end, a, b, pose.headingRad);
      const bound = travel + 2 * radius * Math.sin(turn / 2);
      const gap = footprintGap(pose, zone, length, width, margin);
      // A fixed separating axis remains separating over the whole interval if
      // its gap exceeds every possible corner displacement in that interval.
      if (gap > bound + EPS) return;
      if ((gap <= EPS && depth >= 5) || bound <= 0.02 || depth >= 14) {
        hits.push({ from: a, to: b, zoneId: zone.id, conservative: gap > EPS });
        return;
      }
      const [left, right] = split(points);
      visit(left, a, mid, depth + 1); visit(right, mid, b, depth + 1);
    }
    visit(controlPoints, 0, 1, 0);
  }
  return hits;
}

export function pathCollisions(points, zones, length, width, margin = 0, cache = null) {
  const enabled = zones.filter(zone => zone.enabled);
  if (cache) {
    const configuration = JSON.stringify([enabled, length, width, margin]);
    if (cache.configuration !== configuration) {
      cache.configuration = configuration;
      cache.connections = new Map();
    }
  }
  const anchors = points.map(() => []), connections = {}, headings = points.map(point => point.headingRad);
  const checkAnchor = (index, pose) => {
    for (const zone of enabled) if (footprintGap(pose, zone, length, width, margin) <= EPS && !anchors[index].includes(zone.id)) anchors[index].push(zone.id);
  };
  points.forEach((point, index) => {
    if ((index === 0 || point.breakBefore) && (!points[index + 1] || points[index + 1].breakBefore)) checkAnchor(index, point);
    if (index > 0 && !point.breakBefore) {
      const key = JSON.stringify([points[index - 1], point]);
      let entry = cache?.connections.get(index);
      if (!entry || entry.key !== key) {
        entry = { key, startPose: connectionPose(points[index - 1], point, 0), endPose: connectionPose(points[index - 1], point, 1),
          hits: connectionCollisions(points[index - 1], point, enabled, length, width, margin) };
        cache?.connections.set(index, entry);
      }
      const { startPose, endPose, hits } = entry;
      checkAnchor(index - 1, startPose); checkAnchor(index, endPose);
      headings[index] = endPose.headingRad;
      if (index === 1 || points[index - 1].breakBefore) headings[index - 1] = startPose.headingRad;
      if (hits.length) connections[index] = hits;
    }
  });
  return { anchors, connections, headings };
}
