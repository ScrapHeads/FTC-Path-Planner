import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnchor, evaluateBezier } from '../js/path_model.js';
import { createPath, splitPathSegment } from '../js/segment_model.js';
import { appendAnchor, bindGraph, deletionSet, duplicateSection, endId, focusedRoute, fork,
  insertMidpoint, migrateGraph, prune, rejoin, startId, validTargets, validateGraph } from '../js/branch_graph.js';

test('migration preserves shared starts, coincident independent points and incoming controls', () => {
  const points = [0,10,20,20,40].map(x => createAnchor(x,x,1));
  const path = createPath('HIVE',points);
  splitPathSegment(path,1);
  splitPathSegment(path,2);
  points[3].breakBefore = true;
  points[2].controlPoints.push({xPx:16,yPx:12});
  points[2].headingMode = 'constant';
  const g = migrateGraph(path);
  assert.equal(g.anchors.length,5);
  assert.equal(endId(g.sections[0]),startId(g.sections[1]));
  assert.notEqual(endId(g.sections[1]),startId(g.sections[2]));
  assert.deepEqual(g.sections[1].steps[1].controlPoints,points[2].controlPoints);
  assert.equal(g.sections[1].steps[1].headingMode,'constant');
});

test('multiple arrivals, nested independent parking and deleting one subtree preserve the shared return', () => {
  const path = createPath('HIVE',[0,10,20,30].map(x=>createAnchor(x,0)));
  const g = migrateGraph(path);
  const tipped = fork(g,'a2','Tipped');
  appendAnchor(g,tipped,createAnchor(12,10));
  const tip = endId(tipped);
  rejoin(g,tipped,'a3');
  const parking = fork(g,tip,'Independent park');
  appendAnchor(g,parking,createAnchor(15,20));
  const second = duplicateSection(g,g.sections.find(s=>startId(s)===tip && endId(s)==='a3'));
  const sharedReturn = g.sections.find(s=>startId(s)==='a3');
  assert.ok(focusedRoute(g,second).includes(sharedReturn));
  assert.equal(focusedRoute(g,parking).at(-1),parking);
  assert.ok(!validTargets(g,parking).some(a=>a.id==='a2'));
  assert.throws(()=>rejoin(g,parking,'a2'),/acyclic/);
  const removed = deletionSet(g,tipped);
  assert.ok(removed.has(parking) && removed.has(second));
  assert.ok(!removed.has(sharedReturn));
  g.sections = g.sections.filter(s=>!removed.has(s)); prune(g);
  bindGraph(path,g);
  assert.equal(g.anchors.length,4);
  assert.ok(g.sections.includes(sharedReturn));
});

test('splitting cubic geometry preserves samples and wrapped linear heading', () => {
  const first = createAnchor(0,0,170*Math.PI/180);
  const last = createAnchor(20,0,-170*Math.PI/180,false,[{xPx:0,yPx:20},{xPx:20,yPx:20}]);
  const path = createPath('Curve',[first,last]), g=migrateGraph(path);
  insertMidpoint(g,g.sections[0],1); bindGraph(path,g);
  const [a,m,b] = path.points;
  assert.ok(Math.abs(m.headingRad-Math.PI)<1e-9);
  for (let i=0;i<=100;i++) {
    const t=i/100, old=evaluateBezier(first,last.controlPoints,last,t);
    const now=t<0.5 ? evaluateBezier(a,m.controlPoints,m,2*t) : evaluateBezier(m,b.controlPoints,b,2*t-1);
    assert.ok(Math.hypot(old.x-now.x,old.y-now.y)<1e-9);
  }
});

test('shared references do not consume extra anchors at the limit and invalid graphs are rejected', () => {
  const g=migrateGraph(createPath('Full',Array.from({length:100},(_,i)=>createAnchor(i,0))));
  const draft=fork(g,'a2','Alternate');
  rejoin(g,draft,'a99');
  assert.equal(g.anchors.length,100);
  validateGraph(g);
  assert.throws(()=>appendAnchor(g,draft,createAnchor(1,1)),/limit/);
  draft.steps.reverse();
  assert.throws(()=>validateGraph(g),/cycle/);
  draft.steps.at(-1).anchorId='missing';
  assert.throws(()=>validateGraph(g),/Missing/);
});
