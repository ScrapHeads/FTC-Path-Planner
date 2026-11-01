import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnchor } from '../js/path_model.js';
import { createPath, ensurePathSegments, getSegmentPoints, segmentMethodNames, splitPathSegment, planSegmentReorder, planPointMove, planPointAsSegment, addPathSegment } from '../js/segment_model.js';
import { buildPedroJavaSegments, parsePedroJavaSegments } from '../js/pedro_java.js';

test('segment method names handle reserved words, duplicates, punctuation and leading numbers', () => {
  const names = ['Collect samples', 'Collect samples', 'class', '123 park', '!!!', 'getClass', 'wait', '_'];
  assert.deepEqual(segmentMethodNames(names.map(name => ({ name }))), [
    'collectSamples', 'collectSamples2', 'segment_class', 'segment_123Park', 'segment5', 'segment_getClass', 'segment_wait', 'segment__'
  ]);
});

test('splitting preserves geometry and incoming control points on the correct half', () => {
  const path = createPath('Auto', [
    createAnchor(0, 0),
    createAnchor(10, 10, 1, true, [{ xPx: 5, yPx: 8 }]),
    createAnchor(20, 20, 2, false, [{ xPx: 12, yPx: 18 }])
  ]);
  ensurePathSegments(path);
  assert.equal(splitPathSegment(path, 0), false);
  assert.equal(splitPathSegment(path, 2), false);
  assert.equal(splitPathSegment(path, 1), true);
  const halves = path.segments.map(segment => getSegmentPoints(path, segment.id));
  assert.deepEqual(halves.map(points => points.length), [2, 2]);
  assert.equal(path.points.length, 3);
  assert.equal(halves[0][1].controlPoints[0].xPx, 5);
  assert.equal(halves[1][1].controlPoints[0].xPx, 12);
  assert.equal(halves[1][0].locked, true);
  assert.equal(halves[0][1], halves[1][0]);
});

test('Java segment methods compose lines and quadratic/cubic curves in point order', () => {
  const points = [
    { x: 0, y: 0, headingRad: 0, controlPoints: [] },
    { x: 1, y: 1, headingRad: 1, controlPoints: [] },
    { x: 2, y: 2, headingRad: 2, controlPoints: [{ x: 1, y: 2 }] },
    { x: 3, y: 3, headingRad: 3, controlPoints: [{ x: 2, y: 3 }, { x: 3, y: 2 }] }
  ];
  const java = buildPedroJavaSegments([{ name: 'Collect samples', points }]);
  assert.match(java, /Paths.line\(collectSamplesPoint1, collectSamplesPoint2\).linear\(collectSamplesPoint1, collectSamplesPoint2\)/);
  assert.match(java, /Paths.curve\(collectSamplesPoint2, collectSamplesControl3_1, collectSamplesPoint3\)/);
  assert.match(java, /Paths.curve\(collectSamplesPoint3, collectSamplesControl4_1, collectSamplesControl4_2, collectSamplesPoint4\)/);
  const parsed = parsePedroJavaSegments(java);
  assert.deepEqual(parsed[0].points.map(point => point.controlPoints.length), [0, 0, 1, 2]);
});

test('factory methods import structurally when planner comments are removed', () => {
  const java = buildPedroJavaSegments([{ name: 'Park', points: [
    { x: 0, y: 0, headingRad: 0 }, { x: 12, y: 24, headingRad: Math.PI / 2 }
  ] }]).replace(/\/\/[^\r\n]*/g, '');
  const parsed = parsePedroJavaSegments(java);
  assert.equal(parsed[0].name, 'park');
  assert.equal(parsed[0].points.length, 2);
  assert.ok(Math.abs(parsed[0].points[1].headingRad - Math.PI / 2) < 1e-9);
});

test('factory import applies degree/radian inputs and mirror transformations', () => {
  const java = `PoseFactory p = PoseFactory.radians().mirrorX(72);
Pose start = p.of(12, 24, 0);
Pose end = p.of(36, 48, 1.5);
public Path park() { return Paths.line(start, end).linear(start, end); }`;
  const parsed = parsePedroJavaSegments(java)[0];
  assert.equal(parsed.points[0].x, 132);
  assert.equal(parsed.points[0].headingRad, Math.PI);
  assert.equal(parsed.points[1].x, 108);
  assert.equal(parsed.points[1].headingRad, Math.PI - 1.5);
});

test('factory import rejects missing pose references instead of silently losing geometry', () => {
  assert.throws(() => parsePedroJavaSegments(`PoseFactory p = PoseFactory.degrees();
Pose start = p.of(0, 0, 0);
public Path park() { return Paths.line(start, missing).linear(start, missing); }`), /Unknown pose reference/);
});

function splitRoute() {
  const path = createPath('Auto', Array.from({ length: 6 }, (_, i) => createAnchor(i * 10, i * 20, i / 10, i === 4,
    i ? [{ xPx: i * 10 - 3, yPx: i * 20 - 2, locked: true }] : [])));
  ensurePathSegments(path);
  splitPathSegment(path, 2);
  return path;
}

function geometry(path, id) {
  return getSegmentPoints(path, id).map((point, index) => ({
    x: point.xPx, y: point.yPx, heading: point.headingRad, locked: point.locked,
    controls: index ? point.controlPoints : []
  }));
}

test('reordering swaps segment starts and keeps the original start and a connected route', () => {
  const path = splitRoute();
  const ids = path.segments.map(segment => segment.id);
  const before = ids.map(id => geometry(path, id));
  const original = JSON.stringify(path);
  const plan = planSegmentReorder(path, 1, 0);
  assert.equal(JSON.stringify(path), original);
  Object.assign(path, plan.changes);
  assert.deepEqual(path.segments.map(segment => segment.id), ids.toReversed());
  assert.deepEqual(ids.map(id => geometry(path, id).slice(1)), before.map(points => points.slice(1)));
  assert.deepEqual(path.points.map(point => point.xPx), [0, 30, 40, 50, 10, 20]);
  const reordered = path.segments.map(segment => getSegmentPoints(path, segment.id));
  assert.equal(reordered[0].at(-1), reordered[1][0]);
  assert.equal(path.points.length, 6);
  assert.equal(path.activeSegment, 0);
  assert.equal(path.points.slice(1).some(point => point.breakBefore), false);
  Object.assign(path, planSegmentReorder(path, 0, 1).changes);
  assert.deepEqual(path.points.map(point => point.xPx), [0, 10, 20, 30, 40, 50]);
});

test('moving an anchor appends its heading, locks and controls and retains selection', () => {
  const path = splitRoute();
  const target = path.segments[0].id;
  const point = path.points[4];
  const plan = planPointMove(path, 4, target);
  Object.assign(path, plan.changes);
  const moved = path.points[plan.selectedIndex];
  assert.equal(moved.segmentId, target);
  assert.equal(moved.xPx, point.xPx);
  assert.equal(moved.headingRad, point.headingRad);
  assert.equal(moved.locked, true);
  assert.deepEqual(moved.controlPoints, point.controlPoints);
  assert.notEqual(moved.controlPoints[0], point.controlPoints[0]);
  assert.equal(getSegmentPoints(path, target).at(-1), moved);
  assert.equal(path.points.some(candidate => candidate.segmentId === path.segments[1].id && candidate.xPx === point.xPx), false);
  assert.equal(getSegmentPoints(path, path.segments[1].id)[0], moved);
});

test('moving a shared endpoint updates the following segment to start at the remaining endpoint', () => {
  const path = splitRoute();
  const target = path.segments[1].id;
  const plan = planPointMove(path, 2, target);
  Object.assign(path, plan.changes);
  assert.equal(path.points.length, 6);
  assert.deepEqual(getSegmentPoints(path, target).map(point => point.xPx), [10, 20, 30, 40, 50]);
  assert.equal(path.points[plan.selectedIndex].segmentId, target);
  assert.equal(path.points[plan.selectedIndex].breakBefore, false);
});

for (const selectedIndex of [0, 1, 2, 3, 4, 5]) {
  for (const targetIndex of [0, 1, 2]) {
    if ((selectedIndex <= 2 ? 0 : 1) === targetIndex) continue;
    test(`transferring point ${selectedIndex} to segment ${targetIndex} keeps all nonempty segments connected`, () => {
      const path = splitRoute();
      addPathSegment(path, 'Empty destination');
      const target = path.segments[targetIndex];
      path.points.forEach((point, index) => {
        if (index > 0) point.headingMode = index % 2 ? 'tangent' : 'constant';
      });
      const original = JSON.stringify(path);
      const originals = path.points.map(point => ({ ...point }));
      const plan = planPointMove(path, selectedIndex, target.id);
      assert.equal(JSON.stringify(path), original, 'planning must not mutate the path');
      Object.assign(path, plan.changes);
      assert.equal(path.points.length, originals.length, 'transfers must not duplicate boundary anchors');
      assert.equal(new Set(path.points.map(point => point.xPx)).size, originals.length);
      const selected = path.points[plan.selectedIndex];
      assert.equal(selected.xPx, originals[selectedIndex].xPx);
      assert.equal(selected.segmentId, target.id);
      assert.equal(selected.headingMode, originals[selectedIndex].headingMode);
      assert.deepEqual(selected.controlPoints, originals[selectedIndex].controlPoints);
      for (const originalPoint of originals) {
        const transferred = path.points.find(point => point.xPx === originalPoint.xPx);
        assert.equal(transferred.segmentId, originalPoint === originals[selectedIndex] ? target.id : originalPoint.segmentId);
        assert.equal(transferred.headingRad, originalPoint.headingRad);
        assert.equal(transferred.locked, originalPoint.locked);
        assert.equal(transferred.headingMode, originalPoint.headingMode);
      }
      const groups = path.segments.map(segment => getSegmentPoints(path, segment.id)).filter(points => points.length);
      groups.slice(1).forEach((points, index) => assert.equal(groups[index].at(-1), points[0]));
      assert.equal(path.points.slice(1).some(point => point.breakBefore), false);
    });
  }
}

test('transferring a point to a newly created segment connects it to the previous endpoint', () => {
  const path = splitRoute();
  const newSegment = addPathSegment(path);
  const plan = planPointMove(path, 1, newSegment.id);
  Object.assign(path, plan.changes);
  assert.deepEqual(getSegmentPoints(path, newSegment.id).map(point => point.xPx), [50, 10]);
  assert.equal(path.points.length, 6);
  assert.equal(path.points.at(-1).breakBefore, false);
});

test('moving an endpoint into a later segment reconnects the intervening segment', () => {
  const path = createPath('Three', Array.from({ length: 7 }, (_, i) => createAnchor(i, i)));
  ensurePathSegments(path);
  splitPathSegment(path, 2);
  splitPathSegment(path, 4);
  Object.assign(path, planPointMove(path, 2, path.segments[2].id).changes);
  const groups = path.segments.map(segment => getSegmentPoints(path, segment.id));
  assert.deepEqual(path.points.map(point => point.xPx), [0, 1, 3, 4, 5, 6, 2]);
  assert.equal(groups[0].at(-1), groups[1][0]);
  assert.equal(groups[1].at(-1), groups[2][0]);
});

test('empty segments can be reordered and receive a point', () => {
  const path = splitRoute();
  const empty = addPathSegment(path, 'Park');
  Object.assign(path, planSegmentReorder(path, 2, 0).changes);
  assert.equal(getSegmentPoints(path, empty.id).length, 0);
  const plan = planPointMove(path, path.points.length - 1, empty.id);
  Object.assign(path, plan.changes);
  assert.equal(path.points[plan.selectedIndex].segmentId, empty.id);
  assert.equal(path.points[plan.selectedIndex].controlPoints.length, 1);
  assert.equal(getSegmentPoints(path, empty.id).length, 1);
  assert.equal(path.segments.length, 3);
});

test('invalid or redundant segment edits are no-ops', () => {
  const path = splitRoute();
  const original = JSON.stringify(path);
  assert.equal(planSegmentReorder(path, 0, -1), null);
  assert.equal(planSegmentReorder(path, 0, 2), null);
  assert.equal(planSegmentReorder(path, 0, 0), null);
  assert.equal(planPointMove(path, -1, path.segments[1].id), null);
  assert.equal(planPointMove(path, 0, 'missing'), null);
  assert.equal(planPointMove(path, 0, path.segments[0].id), null);
  assert.equal(JSON.stringify(path), original);
});

test('reordering at the anchor limit shares endpoints without adding anchors', () => {
  const path = createPath('Full', Array.from({ length: 100 }, (_, i) => createAnchor(i, i)));
  ensurePathSegments(path);
  splitPathSegment(path, 50);
  Object.assign(path, planSegmentReorder(path, 1, 0).changes);
  assert.equal(path.points.length, 100);
  assert.equal(path.points[0].xPx, 0);
  assert.equal(path.points.slice(1).some(point => point.breakBefore), false);
});

test('reordering reconnects segments separated by an earlier reorder', () => {
  const path = createPath('Disconnected', [0, 10, 20, 20, 30, 40].map(x => createAnchor(x, x)));
  path.segments = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  path.points.forEach((point, i) => { point.segmentId = i < 3 ? 'a' : 'b'; point.breakBefore = i === 0 || i === 3; });
  Object.assign(path, planSegmentReorder(path, 1, 0).changes);
  assert.deepEqual(path.points.map(point => point.xPx), [0, 30, 40, 10, 20]);
  const [first, second] = path.segments.map(segment => getSegmentPoints(path, segment.id));
  assert.equal(first.at(-1), second[0]);
  assert.equal(path.points.slice(1).some(point => point.breakBefore), false);
});

test('three segments reconnect to their new predecessors when reordered', () => {
  const path = createPath('Three', Array.from({ length: 7 }, (_, i) => createAnchor(i, i)));
  ensurePathSegments(path);
  splitPathSegment(path, 2);
  splitPathSegment(path, 4);
  Object.assign(path, planSegmentReorder(path, 2, 0).changes);
  assert.deepEqual(path.points.map(point => point.xPx), [0, 5, 6, 1, 2, 3, 4]);
  const groups = path.segments.map(segment => getSegmentPoints(path, segment.id));
  assert.equal(groups[0].at(-1), groups[1][0]);
  assert.equal(groups[1].at(-1), groups[2][0]);
});

for (const selectedIndex of [0, 1, 2, 3, 4, 5]) {
  test(`point ${selectedIndex} becomes its own segment in place, preserving route geometry and connections`, () => {
    const path = splitRoute();
    const originals = path.points.map(point => ({ ...point }));
    const before = JSON.stringify(path);
    const plan = planPointAsSegment(path, selectedIndex);
    assert.equal(JSON.stringify(path), before, 'planning must leave the original path untouched');
    Object.assign(path, plan.changes);
    const sourceId = originals[selectedIndex].segmentId;
    const needsContinuation = originals.slice(0, selectedIndex).some(point => point.segmentId === sourceId)
      && originals.slice(selectedIndex + 1).some(point => point.segmentId === sourceId);
    assert.equal(path.segments.length, needsContinuation ? 4 : 3);
    assert.equal(plan.selectedIndex, selectedIndex);
    assert.equal(path.points.length, originals.length);
    const added = path.segments[path.activeSegment];
    const moved = path.points[plan.selectedIndex];
    assert.equal(moved.xPx, originals[selectedIndex].xPx);
    assert.equal(moved.segmentId, added.id);
    assert.equal(moved.headingRad, originals[selectedIndex].headingRad);
    assert.equal(moved.locked, originals[selectedIndex].locked);
    assert.deepEqual(moved.controlPoints, originals[selectedIndex].controlPoints);
    assert.equal(path.points.filter(point => point.segmentId === added.id).length, 1);
    assert.deepEqual(path.points.map(({ segmentId, ...point }) => point), originals.map(({ segmentId, ...point }) => point));
    for (let i = 0; i < originals.length; i++) {
      if (i !== selectedIndex) {
        const expectedId = needsContinuation && i > selectedIndex && originals[i].segmentId === sourceId
          ? path.segments[path.activeSegment + 1].id : originals[i].segmentId;
        assert.equal(path.points[i].segmentId, expectedId);
      }
    }
    const groups = path.segments.map(segment => getSegmentPoints(path, segment.id)).filter(points => points.length);
    groups.slice(1).forEach((points, index) => assert.equal(groups[index].at(-1), points[0]));
    assert.equal(path.points.slice(1).some(point => point.breakBefore), false);
    assert.equal(getSegmentPoints(path, added.id).length, selectedIndex === 0 ? 1 : 2);
    const seen = new Set();
    const exportedOrder = path.segments.flatMap(segment => getSegmentPoints(path, segment.id)).filter(point => {
      if (seen.has(point)) return false;
      seen.add(point);
      return true;
    });
    assert.deepEqual(exportedOrder, path.points);
  });
}

test('extracting the only point leaves the old label empty and the new one ready for more anchors', () => {
  const path = createPath('Single', [createAnchor(10, 20)]);
  ensurePathSegments(path);
  const previousId = path.segments[0].id;
  const plan = planPointAsSegment(path, 0);
  Object.assign(path, plan.changes);
  assert.equal(path.points.length, 1);
  assert.equal(path.activeSegment, 1);
  assert.equal(getSegmentPoints(path, previousId).length, 0);
  assert.equal(path.points[0].segmentId, path.segments[1].id);
  assert.equal(plan.selectedIndex, 0);
});

test('extracting a point at the anchor limit does not add anchors or reuse an existing segment id', () => {
  const path = createPath('Full', Array.from({ length: 100 }, (_, i) => createAnchor(i, i)));
  ensurePathSegments(path);
  addPathSegment(path);
  const beforeIds = path.segments.map(segment => segment.id);
  Object.assign(path, planPointAsSegment(path, 50).changes);
  assert.equal(path.points.length, 100);
  assert.equal(beforeIds.includes(path.segments[path.activeSegment].id), false);
  assert.equal(path.points[50].xPx, 50);
  assert.equal(planPointAsSegment(path, -1), null);
  assert.equal(planPointAsSegment(path, 100), null);
});

test('Pedro export supports linear, tangent and destination constant interpolation on lines and curves', () => {
  const java = buildPedroJavaSegments([{ name: 'LaunchBackFlower', points: [
    { x: 53.7, y: 128.6, headingRad: Math.PI / 2 },
    { x: 59.8, y: 126, headingRad: 3 * Math.PI / 2, headingMode: 'constant' },
    { x: 60, y: 100, headingRad: 0, headingMode: 'tangent', controlPoints: [{ x: 70, y: 120 }] },
    { x: 72, y: 90, headingRad: 1 }
  ] }]);
  assert.match(java, /Paths\.line\(launchBackFlowerPoint1, launchBackFlowerPoint2\)\.constant\(launchBackFlowerPoint2\)/);
  assert.match(java, /Paths\.curve\(launchBackFlowerPoint2, launchBackFlowerControl3_1, launchBackFlowerPoint3\)\.tangent\(\)/);
  assert.match(java, /Paths\.line\(launchBackFlowerPoint3, launchBackFlowerPoint4\)\.linear\(launchBackFlowerPoint3, launchBackFlowerPoint4\)/);
  const points = parsePedroJavaSegments(java)[0].points;
  assert.equal(points[1].headingMode, 'constant');
  assert.equal(points[2].headingMode, 'tangent');
  assert.equal(points[3].headingMode, undefined);
});

test('Java import reads edited interpolation from executable code without relying on metadata', () => {
  const java = `PoseFactory p = PoseFactory.degrees();
Pose start = p.of(0, 0, 90);
Pose end = p.of(10, 10, 270);
public Path launch() { return Paths.line(start, end).constant(end); }`;
  assert.equal(parsePedroJavaSegments(java)[0].points[1].headingMode, 'constant');
  assert.equal(parsePedroJavaSegments(java.replace('.constant(end)', '.tangent()'))[0].points[1].headingMode, 'tangent');
  assert.equal(parsePedroJavaSegments(java.replace('.constant(end)', ''))[0].points[1].headingMode, 'tangent');
  const startConstant = parsePedroJavaSegments(java.replace('.constant(end)', '.constant(start)'));
  assert.equal(startConstant[0].points[1].headingRad, 3 * Math.PI / 2);
  assert.equal(startConstant[0].points[1].constantHeadingRad, Math.PI / 2);
  assert.match(buildPedroJavaSegments(startConstant), /\.constant\(1\.570796327\)/);
  assert.throws(() => parsePedroJavaSegments(java.replace('.constant(end)', '.constant(missing)')), /constant heading/);
});
