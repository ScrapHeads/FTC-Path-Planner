import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the real UI controllers, keyboard handlers, and canvas drawing calls.
const drawing = { anchors: [], controls: [], connections: [] };
class Element {
  constructor() {
    this.value = '';
    this.width = 1000;
    this.height = 800;
    this.children = [];
    this.listeners = new Map();
    const classes = new Set();
    this.classList = {
      add(name) { classes.add(name); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    };
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  getBoundingClientRect() { return { left: 0, top: 0 }; }
  setCustomValidity() {}
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  set innerHTML(value) { this.markup = value; this.children = []; }
  get innerHTML() { return this.markup || ''; }
  querySelectorAll() { return []; }
  getContext() {
    return new Proxy({
      canvas: this,
      measureText: () => ({ width: 0 }),
      arc() { drawing.anchors.push(this.fillStyle); },
      fillRect(x, y, width, height) {
        if (x === -5.5 && y === -5.5 && width === 11 && height === 11) drawing.controls.push(this.fillStyle);
      },
      stroke() { if (this.lineWidth === 3) drawing.connections.push(this.strokeStyle); }
    }, {
      get: (target, property) => property in target ? target[property] : () => {}
    });
  }
}
const elements = new Map();
const listeners = new Map();
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener(type, listener) { listeners.set(type, listener); }
};
globalThis.document = {
  activeElement: { tagName: 'BODY' },
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  },
  createElement() { return new Element(); }
};
globalThis.Image = class {};

const { state } = await import('../js/state.js');
const { createAnchor } = await import('../js/path_model.js');
const { createPath, ensurePathSegments, splitPathSegment } = await import('../js/segment_model.js');
const { initInteractions } = await import('../js/interactions.js');
const { setActivePath, setActiveSegment } = await import('../js/ui.js');
const { draw } = await import('../js/draw.js');
const { imagePxToCanvas, headingToCanvasAngle } = await import('../js/layout.js');
initInteractions();

function seed() {
  state.img = { width: 1600, height: 1600 };
  state.imgLoaded = true;
  state.hudVisible = false;
  state.paths = [createPath('Collect', Array.from({ length: 99 }, (_, i) => createAnchor(i, i)))];
  state.activePath = 0;
  state.selected = 0;
  state.selectedControl = null;
  document.getElementById('javaType').value = 'pedro';
  document.getElementById('exportKind').value = 'posefactory';
  document.getElementById('exportFileType').value = 'java-class';
  document.getElementById('className').value = 'AutoPaths';
}
function key(key, ctrlKey = false) {
  listeners.get('keydown')({ key, ctrlKey, preventDefault() {} });
}

for (const library of ['pedro', 'rr']) {
  test(`adding the first ${library} anchor after clearing creates a fresh segment`, () => {
    seed();
    state.paths[0] = createPath('Cleared');
    state.paths[0].segments = [];
    state.paths[0].activeSegment = -1;
    document.getElementById('javaType').value = library;
    key('n');
    const path = state.paths[0];
    assert.equal(path.points.length, 1);
    assert.equal(path.segments.length, 1);
    assert.equal(path.points[0].segmentId, path.segments[0].id);
  });
}

test('N places the 100th anchor and refuses further placement and duplication', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  seed();
  key('n');
  assert.equal(state.paths[0].points.length, 100);
  const historyCount = state._history.length;
  key('n');
  key('d', true);
  assert.equal(state.paths[0].points.length, 100);
  assert.equal(state._history.length, historyCount);
});

test('Ctrl+D duplicates the 100th anchor and refuses further duplication', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  seed();
  key('d', true);
  assert.equal(state.paths[0].points.length, 100);
  assert.equal(state.selected, 1);
  key('d', true);
  assert.equal(state.paths[0].points.length, 100);
});

test('adding to an earlier segment inserts points into that segment without adding path slots', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  seed();
  state.paths[0].points = Array.from({ length: 5 }, (_, i) => createAnchor(i * 10, i * 10));
  ensurePathSegments(state.paths[0]);
  splitPathSegment(state.paths[0], 2);
  state.paths[0].activeSegment = 0;
  const nextSegmentStart = state.paths[0].points[3];
  key('n');
  assert.equal(state.paths.length, 1);
  assert.equal(state.paths[0].points.length, 6);
  assert.equal(state.selected, 3);
  assert.equal(state.paths[0].points[3].segmentId, state.paths[0].segments[0].id);
  assert.equal(state.paths[0].points[4], nextSegmentStart);
});

test('the original path selection restores each auto class name and keeps its segments separate', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  seed();
  state.paths = Array.from({ length: 4 }, (_, i) => {
    const path = createPath(`Path ${i + 1}`, [createAnchor(i * 10, 0), createAnchor(i * 10 + 5, 0)]);
    path.className = ['RedOne', 'RedTwo', 'BlueOne', 'BlueTwo'][i];
    ensurePathSegments(path);
    path.segments[0].name = `Route ${i + 1}`;
    return path;
  });
  setActivePath(3);
  assert.equal(document.getElementById('className').value, 'BlueTwo');
  assert.match(document.getElementById('output').textContent, /class BlueTwo/);
  assert.match(document.getElementById('output').textContent, /Path route4\(\)/);
  assert.doesNotMatch(document.getElementById('output').textContent, /route1|RedOne/);
  setActivePath(0);
  assert.equal(document.getElementById('className').value, 'RedOne');
  assert.match(document.getElementById('output').textContent, /Path route1\(\)/);
  assert.equal(state.paths.length, 4);
});

function seedSegmentFocus() {
  seed();
  const path = state.paths[0];
  path.points = Array.from({ length: 5 }, (_, i) => createAnchor(100 + i * 100, 500));
  path.points[2].controlPoints = [{ xPx: 250, yPx: 450 }];
  path.points[3].controlPoints = [{ xPx: 350, yPx: 550 }];
  ensurePathSegments(path);
  splitPathSegment(path, 2);
  state.paths.push(createPath('Other auto', [createAnchor(100, 100), createAnchor(200, 200)], '#81c784'));
  return path;
}

function resetDrawing() {
  drawing.anchors.length = drawing.controls.length = drawing.connections.length = 0;
}

test('All segments is the first dropdown choice for every path, including single-segment paths', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  seed();
  state.paths = Array.from({ length: 4 }, (_, i) => createPath(`Path ${i + 1}`, [createAnchor(0, 0), createAnchor(10, 10), createAnchor(20, 20)]));
  splitPathSegment(state.paths[0], 1);
  for (let i = 0; i < 4; i++) {
    setActivePath(i);
    const options = document.getElementById('segmentSelect').children;
    assert.equal(options[0].textContent, 'All segments');
    assert.equal(options[0].value, '-1');
    assert.equal(options.length, state.paths[i].segments.length + 1);
    setActiveSegment(-1);
    assert.equal(document.getElementById('segmentSelect').value, '-1');
    assert.equal(document.getElementById('segmentName').disabled, true);
    assert.equal(document.getElementById('deleteSegment').disabled, true);
  }
  setActivePath(0);
  assert.equal(state.paths[0].activeSegment, -1);
  setActiveSegment(1);
  assert.equal(document.getElementById('segmentName').disabled, false);
});

test('segment focus dims outside anchors, curves, and other autos while keeping shared anchors bright', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  resetDrawing();
  setActiveSegment(1);
  const dimAnchor = 'rgba(226, 232, 240, 0.35)';
  const dimConnection = 'rgba(148, 163, 184, 0.45)';
  assert.deepEqual(drawing.anchors, [dimAnchor, dimAnchor, path.color, path.color, path.color, dimAnchor, dimAnchor]);
  assert.deepEqual(drawing.controls, ['rgba(245, 158, 11, 0.35)', '#f59e0b']);
  assert.deepEqual(drawing.connections, [dimConnection, dimConnection, path.color, path.color, dimConnection]);
  const rows = document.getElementById('pointRows').children;
  assert.equal(rows[0].classList.contains('dimmed-segment-row'), true);
  assert.equal(rows[2].classList.contains('dimmed-segment-row'), false);
  assert.equal(rows[3].classList.contains('dimmed-segment-row'), true); // incoming control at the shared anchor
});

test('All segments removes focus dimming and does not change generated Java', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  setActiveSegment(-1);
  const exported = document.getElementById('output').textContent;
  setActiveSegment(1);
  assert.equal(document.getElementById('output').textContent, exported);
  resetDrawing();
  setActiveSegment(-1);
  assert.deepEqual(drawing.anchors, [...Array(5).fill(path.color), ...Array(2).fill('#81c784')]);
  assert.deepEqual(drawing.controls, ['#f59e0b', '#f59e0b']);
  assert.equal(document.getElementById('output').textContent, exported);
  assert.equal(path.segments.length, 2);
});

test('segment focus and point preview combine; All segments preserves the preview position', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  path.previewEnabled = true;
  path.previewIndex = 2;
  const dim = 'rgba(226, 232, 240, 0.35)';
  resetDrawing();
  setActiveSegment(1);
  assert.deepEqual(drawing.anchors.slice(0, 5), [dim, dim, path.color, dim, dim]);
  resetDrawing();
  setActiveSegment(-1);
  assert.deepEqual(drawing.anchors.slice(0, 5), [path.color, path.color, path.color, dim, dim]);
  assert.equal(path.previewIndex, 2);
  assert.equal(path.previewEnabled, true);
});

test('adding a point from All segments appends to the last real segment', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  setActiveSegment(-1);
  key('n');
  assert.equal(path.points.length, 6);
  assert.equal(path.points[5].segmentId, path.segments[1].id);
  assert.equal(path.activeSegment, -1);
  assert.equal(path.segments.length, 2);
  assert.equal(state.paths.length, 2);
});

test('RoadRunner rendering ignores the stored Pedro segment selection', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  setActiveSegment(1);
  document.getElementById('javaType').value = 'rr';
  resetDrawing();
  draw();
  assert.deepEqual(drawing.anchors, [...Array(5).fill(path.color), ...Array(2).fill('#81c784')]);
  assert.deepEqual(drawing.controls, []);
});

function clickFieldPoint(point, headingHandle = false) {
  const position = imagePxToCanvas(point.xPx, point.yPx);
  const angle = headingToCanvasAngle(point.headingRad || 0);
  document.getElementById('canvas').listeners.get('mousedown')({
    button: 0,
    clientX: position.x + (headingHandle ? Math.cos(angle) * 28 : 0),
    clientY: position.y + (headingHandle ? Math.sin(angle) * 28 : 0),
    preventDefault() {}
  });
}

test('clicking a field anchor selects its segment from All segments or another segment', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  for (const previous of [-1, 0]) {
    setActiveSegment(previous);
    resetDrawing();
    clickFieldPoint(path.points[3]);
    assert.equal(path.activeSegment, 1);
    assert.equal(document.getElementById('segmentSelect').value, '1');
    assert.equal(document.getElementById('segmentName').value, path.segments[1].name);
    assert.equal(state.selected, 3);
    assert.equal(state.selectedControl, null);
    assert.equal(state.dragMode, 'move-point');
    assert.equal(drawing.anchors[0], 'rgba(226, 232, 240, 0.35)');
    assert.equal(drawing.anchors[3], '#a78bfa');
    assert.equal(state.paths.length, 2);
  }
});

test('clicking a shared anchor retains either selected segment, or chooses its owner from All segments', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  for (const selected of [0, 1]) {
    setActiveSegment(selected);
    clickFieldPoint(path.points[2]);
    assert.equal(path.activeSegment, selected);
    assert.equal(state.selected, 2);
  }
  setActiveSegment(-1);
  clickFieldPoint(path.points[2]);
  assert.equal(path.activeSegment, 0);
  assert.equal(state.selected, 2);
});

test('clicking a dimmed control selects its incoming segment and preserves control dragging', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  setActiveSegment(1);
  clickFieldPoint(path.points[2].controlPoints[0]);
  assert.equal(path.activeSegment, 0);
  assert.equal(document.getElementById('segmentSelect').value, '0');
  assert.deepEqual(state.selectedControl, { pointIndex: 2, controlIndex: 0 });
  assert.equal(state.dragMode, 'move-control');
});

test('heading handles and locked anchors select their segments without changing drag restrictions', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  setActiveSegment(0);
  clickFieldPoint(path.points[3], true);
  assert.equal(path.activeSegment, 1);
  assert.equal(state.selected, 3);
  assert.equal(state.dragMode, 'rotate');
  path.points[4].locked = true;
  setActiveSegment(0);
  clickFieldPoint(path.points[4]);
  assert.equal(path.activeSegment, 1);
  assert.equal(state.selected, 4);
  assert.equal(state.dragMode, null);
});

test('RoadRunner field selection does not change the stored Pedro segment selection', t => {
  t.mock.method(console, 'error', (...args) => assert.fail(args.join(' ')));
  const path = seedSegmentFocus();
  setActiveSegment(0);
  document.getElementById('javaType').value = 'rr';
  clickFieldPoint(path.points[3]);
  assert.equal(state.selected, 3);
  assert.equal(path.activeSegment, 0);
});
