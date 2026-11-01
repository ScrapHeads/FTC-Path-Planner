const JAVA_RESERVED = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null _ record sealed permits var yield wait notify notifyAll getClass hashCode equals clone finalize toString').split(' '));

import { MAX_PATH_POINTS } from './path_model.js';

export function createPath(name, points = [], color = '#7dd3fc') {
  return { name, color, points, previewEnabled: false, previewIndex: points.length - 1 };
}

export function samePose(a, b) {
  if (!a || !b) return false;
  const headingDelta = (a.headingRad || 0) - (b.headingRad || 0);
  return Math.abs((a.x ?? a.xPx) - (b.x ?? b.xPx)) < 1e-7 &&
    Math.abs((a.y ?? a.yPx) - (b.y ?? b.yPx)) < 1e-7 &&
    Math.abs(Math.atan2(Math.sin(headingDelta), Math.cos(headingDelta))) < 1e-7;
}

export function ensurePathSegments(path) {
  if (!path.segments?.length) {
    path.segments = path.points.length ? [{ id: 'segment1', name: 'Segment 1' }] : [];
  }
  // -1 is the overview selection; it never becomes an exported segment.
  path.activeSegment = Number.isInteger(path.activeSegment)
    ? Math.max(-1, Math.min(path.activeSegment, path.segments.length - 1))
    : -1;
  const ids = new Set(path.segments.map(segment => segment.id));
  for (const point of path.points) {
    if (!ids.has(point.segmentId)) point.segmentId = path.segments[0].id;
  }
  return path.segments;
}

export function getSegmentPoints(path, segmentId) {
  ensurePathSegments(path);
  const first = path.points.findIndex(point => point.segmentId === segmentId);
  if (first < 0) return [];
  const points = path.points.filter(point => point.segmentId === segmentId);
  // A boundary anchor is shared by the preceding and following segment.
  if (first > 0 && !path.points[first].breakBefore) points.unshift(path.points[first - 1]);
  return points;
}

export function addPathSegment(path, name) {
  ensurePathSegments(path);
  let sequence = 1;
  while (path.segments.some(segment => segment.id === `segment${sequence}`)) sequence++;
  const segment = { id: `segment${sequence}`, name: name || `Segment ${path.segments.length + 1}` };
  path.segments.push(segment);
  path.activeSegment = path.segments.length - 1;
  return segment;
}

export function pointInsertionIndex(path) {
  const segments = ensurePathSegments(path);
  if (path.activeSegment === -1) return path.points.length;
  const segmentId = segments[path.activeSegment].id;
  for (let index = path.points.length - 1; index >= 0; index--) {
    if (path.points[index].segmentId === segmentId) return index + 1;
  }
  const laterIds = new Set(segments.slice(path.activeSegment + 1).map(segment => segment.id));
  const next = path.points.findIndex(point => laterIds.has(point.segmentId));
  return next < 0 ? path.points.length : next;
}

export function canSplitPathSegment(path, pointIndex) {
  ensurePathSegments(path);
  return pointIndex >= 1 && pointIndex < path.points.length - 1 &&
    path.points[pointIndex].segmentId === path.points[pointIndex + 1].segmentId &&
    !path.points[pointIndex + 1].breakBefore;
}

export function splitPathSegment(path, pointIndex) {
  if (!canSplitPathSegment(path, pointIndex)) return false;
  const sourceId = path.points[pointIndex].segmentId;
  const sourceIndex = path.segments.findIndex(segment => segment.id === sourceId);
  const segment = addPathSegment(path, `${path.segments[sourceIndex].name} 2`);
  path.segments.pop();
  path.segments.splice(sourceIndex + 1, 0, segment);
  for (let index = pointIndex + 1; index < path.points.length && path.points[index].segmentId === sourceId; index++) {
    path.points[index].segmentId = segment.id;
  }
  path.activeSegment = sourceIndex + 1;
  return true;
}

export function canRemovePathSegment(path, index) {
  const segments = ensurePathSegments(path);
  if (segments.length <= 1 || !segments[index]) return false;
  const ids = new Set([segments[index].id, segments[index > 0 ? index - 1 : 1].id]);
  const points = path.points.filter(point => ids.has(point.segmentId));
  return !points.slice(1).some(point => point.breakBefore);
}

export function removePathSegment(path, index) {
  if (!canRemovePathSegment(path, index)) return false;
  const segments = path.segments;
  const removed = segments[index];
  const target = segments[index > 0 ? index - 1 : 1];
  for (const point of path.points) {
    if (point.segmentId === removed.id) point.segmentId = target.id;
  }
  segments.splice(index, 1);
  path.activeSegment = Math.max(0, index - 1);
  return true;
}

// Plan edits before committing so rejected edits do not alter the path or history.
export function planSegmentReorder(path, from, to) {
  const segments = ensurePathSegments(path);
  if (!Number.isInteger(from) || !Number.isInteger(to) || !segments[from] || !segments[to] || from === to) return null;
  const groups = segments.map(segment => ({ segment, points: getSegmentPoints(path, segment.id) }));
  const [group] = groups.splice(from, 1);
  groups.splice(to, 0, group);
  // Keep the autonomous starting pose fixed. Each segment retains its target
  // anchors and incoming controls, but takes its start from its new predecessor.
  // Explicit starts from previously disconnected segments are replaced too.
  let endpoint = path.points[0];
  for (const current of groups) {
    if (!current.points.length) continue;
    const destinations = current.points.length > 1
      ? current.points.slice(1)
      : current.points[0] === endpoint ? [] : current.points;
    current.points = [endpoint, ...destinations];
    endpoint = current.points.at(-1);
  }
  return buildSegmentEdit(path, groups, to);
}

export function planPointMove(path, pointIndex, targetId) {
  const segments = ensurePathSegments(path);
  const point = path.points[pointIndex];
  if (!point || point.segmentId === targetId || !segments.some(segment => segment.id === targetId)) return null;
  const targetIndex = segments.findIndex(segment => segment.id === targetId);
  const transfersSharedStart = getSegmentPoints(path, targetId)[0] === point;
  // Rebuild from owned anchors rather than carrying old shared starts along:
  // removing an endpoint or appending to an earlier segment changes which
  // anchor must start the following segment.
  let endpoint;
  const groups = segments.map(segment => {
    const owned = path.points.filter(candidate => candidate.segmentId === segment.id && candidate !== point);
    if (segment.id === targetId) {
      if (transfersSharedStart) owned.unshift(point);
      else owned.push(point);
    }
    const points = owned.length && endpoint ? [endpoint, ...owned] : owned;
    if (owned.length) endpoint = owned.at(-1);
    return { segment, points };
  });
  return buildSegmentEdit(path, groups, targetIndex, point);
}

export function planPointAsSegment(path, pointIndex) {
  const segments = ensurePathSegments(path);
  const selected = path.points[pointIndex];
  if (!selected) return null;
  const draft = { ...path, segments: [...segments], points: [] };
  const added = addPathSegment(draft);
  const sourceIndex = segments.findIndex(segment => segment.id === selected.segmentId);
  const source = segments[sourceIndex];
  const before = path.points.slice(0, pointIndex).some(point => point.segmentId === source.id);
  const after = path.points.slice(pointIndex + 1).some(point => point.segmentId === source.id);
  const points = path.points.map(point => ({
    ...point, controlPoints: (point.controlPoints || []).map(control => ({ ...control }))
  }));
  points[pointIndex].segmentId = added.id;
  const updatedSegments = [...segments];
  const insertionIndex = sourceIndex + (before || !after ? 1 : 0);
  const inserted = [added];
  if (before && after) {
    // The old segment now has two runs. Label the later run separately so the
    // segment list and export follow the unchanged anchor order.
    const continuation = addPathSegment(draft, `${source.name} (continued)`);
    Object.assign(continuation, { ...source, id: continuation.id, name: continuation.name });
    inserted.push(continuation);
    points.slice(pointIndex + 1).forEach(point => {
      if (point.segmentId === source.id) point.segmentId = continuation.id;
    });
  }
  updatedSegments.splice(insertionIndex, 0, ...inserted);
  return {
    changes: { segments: updatedSegments, points, activeSegment: insertionIndex, previewIndex: path.previewIndex },
    selectedIndex: pointIndex
  };
}

function buildSegmentEdit(path, groups, activeSegment, selectedPoint = null) {
  const points = [];
  let previousOriginal;
  let selectedIndex = -1;
  let previewIndex = -1;
  const previewPoint = path.points[path.previewIndex];
  groups.forEach(({ segment, points: groupPoints }, groupIndex) => {
    groupPoints.forEach((original, index) => {
      const shared = index === 0 && groupPoints.length > 1 && previousOriginal === original;
      if (!shared) {
        points.push({
          ...original,
          segmentId: segment.id,
          breakBefore: index === 0,
          controlPoints: index === 0 && !(groupIndex === activeSegment && original === selectedPoint)
            ? [] : (original.controlPoints || []).map(control => ({ ...control }))
        });
      }
      if (groupIndex === activeSegment && original === selectedPoint) selectedIndex = points.length - 1;
      if (original === previewPoint && previewIndex < 0) previewIndex = points.length - 1;
      previousOriginal = original;
    });
  });
  if (points.length > MAX_PATH_POINTS) {
    throw new Error(`This edit needs ${points.length} anchors to preserve shared endpoints. The path limit is ${MAX_PATH_POINTS}. Remove an anchor first.`);
  }
  return {
    changes: { segments: groups.map(group => group.segment), points, activeSegment, previewIndex },
    selectedIndex
  };
}

export function segmentMethodNames(segments) {
  const used = new Set();
  return segments.map((segment, index) => {
    const words = String(segment.name || '').match(/[A-Za-z0-9_]+/g) || [];
    let base = words.map((word, i) => i ? word[0].toUpperCase() + word.slice(1) : word[0].toLowerCase() + word.slice(1)).join('');
    if (!base) base = `segment${index + 1}`;
    if (/^[0-9]/.test(base) || JAVA_RESERVED.has(base)) base = `segment_${base}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}${suffix++}`;
    used.add(name);
    return name;
  });
}

