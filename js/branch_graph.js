import { MAX_PATH_POINTS, headingSettings } from './path_model.js';
import { ensurePathSegments, getSegmentPoints, segmentMethodNames } from './segment_model.js';

const colors = ['#38bdf8', '#fb923c', '#a78bfa', '#4ade80', '#f472b6'];
const poseKeys = ['xPx', 'yPx', 'headingRad', 'locked'];
function nextId(list, prefix) {
  const used = new Set(list.map(item => item.id));
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}
function addAnchor(graph, point) {
  if (graph.anchors.length >= MAX_PATH_POINTS) throw Error('The 100-anchor limit has been reached.');
  const anchor = { id: nextId(graph.anchors, 'a') };
  for (const key of poseKeys) anchor[key] = point[key];
  graph.anchors.push(anchor);
  return anchor.id;
}
function step(anchorId, point = {}) {
  return { anchorId, controlPoints: structuredClone(point.controlPoints || []), ...headingSettings(point) };
}
function section(graph, name, steps) {
  const result = { id: nextId(graph.sections, 's'), name, color: colors[graph.sections.length % colors.length], steps };
  graph.sections.push(result);
  return result;
}
export function pathDocument(path) {
  if (!path.graph) return path;
  const { points, segments, ...document } = path;
  return document;
}

export function migrateGraph(path) {
  if (path.graph) return path.graph;
  const graph = { version: 1, anchors: [], sections: [], choices: {} };
  const ids = new Map();
  for (const segment of ensurePathSegments(path)) {
    const steps = getSegmentPoints(path, segment.id).map((point, index) => {
      if (!ids.has(point)) ids.set(point, addAnchor(graph, point));
      return step(ids.get(point), index ? point : {});
    });
    graph.sections.push({ ...segment, color: segment.color || colors[graph.sections.length % colors.length], steps });
  }
  return graph;
}
// The existing field/table editors use indexed waypoint views. Pose setters write
// through to one anchor; incoming controls and interpolation belong to the step.
export function bindGraph(path, graph = path.graph) {
  validateGraph(graph);
  path.graph = graph;
  path.segments = graph.sections;
  const anchors = new Map(graph.anchors.map(a => [a.id, a]));
  path.points = graph.sections.flatMap(s => s.steps.map((item, i) => {
    const anchor = anchors.get(item.anchorId);
    const view = { segmentId: s.id, anchorId: anchor.id, breakBefore: i === 0 };
    for (const key of [...poseKeys, 'controlPoints', 'headingMode', 'constantHeadingRad']) {
      const owner = poseKeys.includes(key) ? anchor : item;
      Object.defineProperty(view, key, { enumerable: true, get: () => owner[key], set: value => { owner[key] = value; } });
    }
    return view;
  }));
  path.activeSegment = Math.max(0, Math.min(path.activeSegment ?? 0, graph.sections.length - 1));
}
function adjacency(graph) {
  const edges = new Map(graph.anchors.map(a => [a.id, []]));
  for (const s of graph.sections) s.steps.slice(1).forEach((p,i) => edges.get(s.steps[i].anchorId).push(p.anchorId));
  return edges;
}
function reachable(edges, start) {
  const seen = new Set(), queue = [start];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...edges.get(id));
  }
  return seen;
}
export function validateGraph(graph) {
  if (graph?.version !== 1 || !Array.isArray(graph.anchors) || !Array.isArray(graph.sections)) throw Error('Unsupported path graph.');
  for (const list of [graph.anchors, graph.sections]) {
    if (list.some(v => !v || typeof v.id !== 'string' || !v.id) || new Set(list.map(v => v.id)).size !== list.length) throw Error('Duplicate or missing graph ID.');
  }
  if (graph.anchors.length > MAX_PATH_POINTS || graph.anchors.some(a => ![a.xPx,a.yPx,a.headingRad].every(Number.isFinite))) throw Error('Invalid graph anchor.');
  const ids = new Set(graph.anchors.map(a => a.id)), used = new Set();
  for (const s of graph.sections) {
    if (!Array.isArray(s.steps) || typeof s.name !== 'string') throw Error('Invalid graph section.');
    for (const p of s.steps) {
      if (p.headingMode && !['linear','constant','tangent'].includes(p.headingMode) || p.constantHeadingRad != null && !Number.isFinite(p.constantHeadingRad)) throw Error('Invalid connection heading settings.');
      if (!ids.has(p.anchorId)) throw Error('Missing connected anchor.');
      if (!Array.isArray(p.controlPoints) || p.controlPoints.length > 2 || p.controlPoints.some(c => ![c.xPx,c.yPx].every(Number.isFinite))) throw Error('Invalid curve handles.');
      used.add(p.anchorId);
    }
  }
  if (ids.size !== used.size) throw Error('Unreferenced graph anchor.');
  for (const s of graph.sections) {
    if (s.steps.slice(1,-1).some(p => graph.sections.some(other => other !== s && other.steps.some(q => q.anchorId === p.anchorId)))) throw Error('A shared anchor must be a section endpoint.');
  }
  const edges = adjacency(graph);
  for (const [id, targets] of edges) if (targets.some(to => reachable(edges,to).has(id))) throw Error('A rejoin cannot create a cycle.');
}
export const startId = s => s.steps[0]?.anchorId;
export const endId = s => s.steps.at(-1)?.anchorId;
export function incoming(g,id) { return g.sections.filter(s => s.steps.length > 1 && endId(s) === id); }
export function outgoing(g,id) { return g.sections.filter(s => startId(s) === id); }
export function promote(g,id) {
  for (const s of [...g.sections]) {
    const i = s.steps.findIndex(p => p.anchorId === id);
    if (i <= 0 || i === s.steps.length - 1) continue;
    const rest = section(g, s.name + ' continuation', [step(id), ...s.steps.splice(i+1)]);
    rest.color = s.color;
    rest.finished = s.finished;
    s.finished = false;
    return rest;
  }
}
export function fork(g,id,name) {
  if (!g.anchors.some(a => a.id === id)) throw Error('Select an existing anchor.');
  promote(g,id);
  return section(g,name,[step(id)]);
}
export function canExtend(g,s) {
  if (!s || s.finished) return false;
  if (s.steps.length < 2) return true;
  return !outgoing(g,endId(s)).length && incoming(g,endId(s)).length === 1;
}
export function validTargets(g,s) {
  if (!s?.steps.length || !canExtend(g,s)) return [];
  const edges = adjacency(g);
  return g.anchors.filter(a => !reachable(edges,a.id).has(endId(s)));
}
export function rejoin(g,s,id) {
  if (!validTargets(g,s).some(a => a.id === id)) throw Error('Choose a downstream anchor that keeps the route acyclic.');
  promote(g,id);
  s.steps.push(step(id));
}
export function appendAnchor(g,s,point,index = s.steps.length) {
  s.steps.splice(index,0,step(addAnchor(g,point),point));
}
export function duplicateSection(g,s) {
  const needs = s.steps.filter((p,i) => i > 0 && (i < s.steps.length-1 || (incoming(g,p.anchorId).length <= 1 && !outgoing(g,p.anchorId).length))).length;
  if (g.anchors.length + needs > MAX_PATH_POINTS) throw Error('Duplicating this section exceeds the anchor limit.');
  const steps = s.steps.map((p,i) => {
    const shared = i === 0 || (i === s.steps.length - 1 && (incoming(g,p.anchorId).length > 1 || outgoing(g,p.anchorId).length));
    return step(shared ? p.anchorId : addAnchor(g,g.anchors.find(a => a.id === p.anchorId)),p);
  });
  return section(g,s.name + ' copy',steps);
}
export function prune(g) {
  const used = new Set(g.sections.flatMap(s => s.steps.map(p => p.anchorId)));
  g.anchors = g.anchors.filter(a => used.has(a.id));
}
export function deletionSet(g,s) {
  const removed = new Set([s]);
  for (const current of removed) {
    if (current.steps.length < 2) continue;
    const id = endId(current);
    if (incoming(g,id).every(parent => removed.has(parent))) {
      outgoing(g,id).forEach(child => removed.add(child));
    }
  }
  return removed;
}
export function focusedRoute(g,s) {
  if (!s) return [];
  const route = [s];
  let head = s;
  while (true) {
    const parents = incoming(g,startId(head));
    head = parents.find(p => p.id === g.choices?.['in-' + startId(head)]) || parents[0];
    if (!head) break;
    route.unshift(head);
  }
  let tail = s;
  while (tail.steps.length > 1) {
    const children = outgoing(g,endId(tail));
    tail = children.find(c => c.id === g.choices?.[endId(tail)]) || children[0];
    if (!tail) break;
    route.push(tail);
  }
  return route;
}
export function selectRoute(g,s) {
  g.choices ||= {};
  for (const part of focusedRoute(g,s)) {
    g.choices[startId(part)] = part.id;
    if (part.steps.length > 1) g.choices['in-' + endId(part)] = part.id;
  }
}
export function graphWarnings(g) {
  const warnings = [];
  const edges = adjacency(g);
  const root = g.anchors.find(a => ![...edges.values()].some(targets => targets.includes(a.id)));
  const reached = root ? reachable(edges,root.id) : new Set();
  const methods = segmentMethodNames(g.sections);
  const poses = new Map(g.anchors.map(a => [a.id,a]));
  for (const [index,s] of g.sections.entries()) {
    if (s.steps.length < 2) warnings.push(s.name + ' needs two anchors.');
    if (s.steps.length && !reached.has(startId(s))) warnings.push(s.name + ' is unreachable from the start.');
    if (methods[index] !== segmentMethodNames([s])[0] || methods[index].startsWith('segment_') || !/[A-Za-z]/.test(s.name)) warnings.push(s.name + ' exports as ' + methods[index] + '().');
    if (s.steps.length < 2) continue;
    const joint = poses.get(startId(s));
    const next = s.steps[1].controlPoints[0] || poses.get(s.steps[1].anchorId);
    for (const previous of incoming(g,startId(s))) {
      const before = previous.steps.at(-1).controlPoints.at(-1) || poses.get(previous.steps.at(-2).anchorId);
      const a = Math.atan2(joint.yPx-before.yPx,joint.xPx-before.xPx);
      const b = Math.atan2(next.yPx-joint.yPx,next.xPx-joint.xPx);
      if (Math.cos(a-b) < 0.5) warnings.push('Sharp turn from ' + previous.name + ' to ' + s.name + '.');
    }
  }
  return warnings;
}

export function insertMidpoint(g,s,index) {
  if (index < 1 || index >= s.steps.length) throw Error('Select the destination of a connection.');
  const poses = s.steps.slice(index-1,index+1).map(p => g.anchors.find(a => a.id === p.anchorId));
  const end = s.steps[index];
  let level = [poses[0], ...end.controlPoints, poses[1]];
  const left = [], right = [];
  while (level.length > 1) {
    left.push(level[0]); right.unshift(level.at(-1));
    level = level.slice(1).map((b,i) => ({ xPx: (level[i].xPx+b.xPx)/2, yPx: (level[i].yPx+b.yPx)/2, locked: false }));
  }
  const delta = poses[1].headingRad - poses[0].headingRad;
  const headingRad = end.headingMode === 'constant' ? end.constantHeadingRad ?? poses[1].headingRad :
    poses[0].headingRad + Math.atan2(Math.sin(delta),Math.cos(delta))/2;
  appendAnchor(g,s,{ ...level[0], headingRad, ...headingSettings(end), controlPoints: left.slice(1) },index);
  end.controlPoints = right.slice(0,-1);
}
