import { getSegmentPoints } from './segment_model.js';

export function sectionColor(path, section) {
  return section.color || path.color;
}

// Section topology uses shared anchor IDs, or the shared point index at a legacy segment boundary.
export function sectionDiagram(path, collision = {}) {
  const sections = path.segments || [];
  const nodes = sections.map((section, index) => {
    const indices = [];
    path.points.forEach((point, i) => { if (point.segmentId === section.id) indices.push(i); });
    const first = indices[0];
    if (!path.graph && first > 0 && !path.points[first].breakBefore) indices.unshift(first - 1);
    if (!path.graph && first === undefined && section.sharesPreviousEnd) {
      const [boundary] = getSegmentPoints(path, section.id);
      if (boundary) indices.push(path.points.indexOf(boundary));
    }
    const keys = indices.map(i => path.graph ? path.points[i].anchorId : i);
    return { id: section.id, name: section.name, index, indices, keys, color: sectionColor(path, section),
      collision: indices.some(i => collision.anchors?.[i]?.length ||
        (path.points[i].segmentId === section.id && collision.connections?.[i]?.length)) };
  });
  const edges = [];
  for (const from of nodes) {
    if (!path.graph && sections[from.index].sharesPreviousEnd && from.indices.length === 1) continue;
    if (from.keys.length < (path.graph ? 2 : 1)) continue;
    for (const to of nodes) {
      if (from === to || !to.keys.length || from.keys.at(-1) !== to.keys[0]) continue;
      edges.push({ from: from.id, to: to.id, point: to.indices[0] });
    }
  }
  const parents = new Map(nodes.map(node => [node.id, []]));
  const children = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    parents.get(edge.to).push(edge.from);
    children.get(edge.from).push(edge.to);
  }
  const depths = new Map();
  function depthOf(id) {
    if (!depths.has(id)) {
      depths.set(id, parents.get(id).reduce((depth, parent) => Math.max(depth, depthOf(parent) + 1), 0));
    }
    return depths.get(id);
  }
  const levels = new Map();
  for (const node of nodes) {
    const depth = depthOf(node.id);
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth).push(node);
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const laneWidth = 190;
  for (let depth = 0; depth < levels.size; depth++) {
    const level = levels.get(depth);
    level.forEach((node, index) => {
      const incoming = parents.get(node.id);
      if (incoming.length) {
        const lanes = incoming.map(parent => {
          const siblings = children.get(parent);
          const offset = siblings.indexOf(node.id) - (siblings.length - 1) / 2;
          return byId.get(parent).x + offset * laneWidth;
        });
        node.x = (Math.min(...lanes) + Math.max(...lanes)) / 2;
      } else {
        node.x = (index - (level.length - 1) / 2) * laneWidth;
      }
      node.y = depth * 80;
    });
    // Nested forks can propose the same lane. Keep their left-to-right order.
    level.sort((a, b) => a.x - b.x);
    for (let i = 1; i < level.length; i++) {
      level[i].x = Math.max(level[i].x, level[i - 1].x + laneWidth);
    }
  }
  return { nodes, edges };
}

export function positionNode(positions, id, x, y) {
  return { ...positions, [id]: { x, y } };
}

export function routeOutline({nodes, edges}) {
  const children = new Map(nodes.map(node => [node.id, []]));
  const parents = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    children.get(edge.from).push(edge.to);
    parents.get(edge.to).push(edge.from);
  }

  // Defer a shared continuation until every incoming branch has been listed.
  const rows = [];
  const ancestry = new Map();
  function visit(id, branch) {
    const incoming = parents.get(id);
    if (ancestry.has(id) || incoming.some(parent => !ancestry.has(parent))) return;
    if (incoming.length > 1) {
      const paths = incoming.map(parent => ancestry.get(parent));
      branch = [];
      for (const [i, ancestor] of paths[0].entries()) {
        if (!paths.every(path => path[i] === ancestor)) break;
        branch.push(ancestor);
      }
    }
    ancestry.set(id, branch);
    rows.push({id, depth: branch.length, joined: incoming.length > 1});
    const next = children.get(id);
    for (const child of next) visit(child, next.length > 1 ? [...branch, child] : branch);
  }
  for (const node of nodes) if (!parents.get(node.id).length) visit(node.id, []);
  return rows;
}
