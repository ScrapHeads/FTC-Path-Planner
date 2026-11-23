import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionDiagram, positionNode } from '../js/route_diagram.js';
import { bindGraph } from '../js/branch_graph.js';

function branchingPath(routes = {
    start: ['a','b'], collect: ['b','c'], bypass: ['b','d'],
    inner: ['c','d'], park: ['c','e'], finish: ['d','f']
  }) {
  const path = { color: '#447788' };
  bindGraph(path, {
    version: 1,
    anchors: [...new Set(Object.values(routes).flat())].map(id => ({ id, xPx: 50, yPx: 50, headingRad: 0 })),
    sections: Object.entries(routes).map(([id, anchors]) => ({
      id, name: id, color: '#447788', steps: anchors.map(anchorId => ({ anchorId, controlPoints: [] }))
    }))
  });
  return path;
}

test('unequal fork lanes stay aligned until the shared continuation', () => {
  for (const longerSide of ['left', 'right']) {
    const routes = {
      fork: ['a', 'b'],
      left: ['b', longerSide === 'left' ? 'c' : 'd'],
      right: ['b', longerSide === 'right' ? 'c' : 'd'],
      joint: ['d', 'e'], tail: ['e', 'f'], extra: ['c', 'd']
    };
    const {nodes} = sectionDiagram(branchingPath(routes));
    const x = Object.fromEntries(nodes.map(node => [node.id, node.x]));
    assert.ok(x.left < x.fork && x.fork < x.right);
    assert.equal(x.extra, x[longerSide]);
    assert.equal(x.joint, x.fork);
    assert.equal(x.tail, x.joint);
  }
});

test('one node per named section, including nested forks, a shared continuation and a separate ending', () => {
  const path = branchingPath();
  const hit = path.points.findIndex(p => p.segmentId === 'park');
  const {nodes, edges} = sectionDiagram(path, {anchors:{[hit]:['zone']}});
  assert.deepEqual(nodes.map(n => n.id), ['start','collect','bypass','inner','park','finish']);
  assert.deepEqual(edges.map(e => [e.from,e.to]), [
    ['start','collect'], ['start','bypass'], ['collect','inner'], ['collect','park'],
    ['bypass','finish'], ['inner','finish']
  ]);
  assert.ok(nodes.find(n => n.id === 'park').collision);
  const collect = nodes.find(node => node.id === 'collect');
  const bypass = nodes.find(node => node.id === 'bypass');
  assert.equal(collect.y, bypass.y);
  assert.notEqual(collect.x, bypass.x);
  for (const e of edges) {
    const target = path.points[e.point];
    assert.equal(target.anchorId, path.segments.find(s => s.id === e.from).steps.at(-1).anchorId);
    assert.equal(target.segmentId, e.to);
    assert.ok(nodes.find(n=>n.id===e.to).y > nodes.find(n=>n.id===e.from).y);
  }
});

test('All branches preserves section colors across forks and rejoins', () => {
  const path = branchingPath();
  path.segments[0].color = '#ff8800';
  path.segments.at(-1).color = '#ff0033';
  delete path.segments[1].color;
  const expected = path.segments.map(s => s.color || path.color);
  for (const compare of [false, true, false]) {
    path.compareBranches = compare;
    assert.deepEqual(sectionDiagram(path).nodes.map(n => n.color), expected);
  }
});

test('legacy segment adjacency honors breaks between identical poses and retains empty sections', () => {
  const path = {segments:['one','two','three','empty'].map(id=>({id,name:id})),
    points:['one','one','two','three'].map((segmentId,i)=>({segmentId,xPx:50,yPx:50,breakBefore:i===3}))};
  const {nodes,edges} = sectionDiagram(path);
  assert.equal(nodes.length,4);
  assert.deepEqual(edges,[{from:'one',to:'two',point:1}]);
});

test('repositioning a diagram node leaves geometry, connectivity and automatic layout intact', () => {
  const path=branchingPath(), before=JSON.stringify(path);
  const original=sectionDiagram(path);
  const positions=positionNode({},'collect',712,-91);
  assert.deepEqual(positions,{collect:{x:712,y:-91}});
  assert.deepEqual(sectionDiagram(path),original);
  assert.equal(JSON.stringify(path),before);
});
