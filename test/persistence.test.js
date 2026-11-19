import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
const elements = new Map([
  ['className', { value: 'RedAuto', type: 'text' }],
  ['boxRotate', { checked: false, type: 'checkbox' }],
  ['fieldSize', { value: '143.75', type: 'number' }],
  ['javaType', { value: 'ftclib', tagName: 'SELECT', options: [{ value: 'rr' }, { value: 'ftclib' }] }]
]);
const listeners = new Map();
globalThis.Image = class {};
globalThis.window = {
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  },
  addEventListener: (type, handler) => listeners.set(type, handler)
};
globalThis.document = {
  getElementById: id => elements.get(id),
  addEventListener: (type, handler) => listeners.set(type, handler)
};
const { state } = await import('../js/state.js');
const { STORAGE_KEY, saveAppState, restoreAppState, restoreControls, initPersistence } = await import('../js/persistence.js');
const defaults = JSON.parse(JSON.stringify(state));

function reset() {
  Object.assign(state, JSON.parse(JSON.stringify(defaults)));
  storage.clear();
}

test('refresh restores all paths, controls, segments, map identity, selection and settings', () => {
  reset();
  state.paths.forEach((path, index) => {
    path.className = `Auto${index}`;
    path.segments = [{ id: 'collect', name: 'Collect samples', color: '#abc123' }];
    path.activeSegment = 0;
    path.points = [{
      xPx: index * 10, yPx: 150, headingRad: Math.PI / 2, locked: true,
      headingMode: 'constant', constantHeadingRad: 1.234,
      segmentId: 'collect', breakBefore: true,
      controlPoints: [{ xPx: 25, yPx: 50, locked: true }]
    }];
    path.previewEnabled = true;
    path.previewIndex = 0;
  });
  state.activePath = 2;
  state.selected = 0;
  state.selectedControl = { pointIndex: 0, controlIndex: 0 };
  state.imageSource = { kind: 'upload' };
  state.exclusionBox = { start: { x: 20, y: 30 }, end: { x: 90, y: 80 } };
  state.exclusionZones = [{ id: 'obstacle', name: 'Obstacle', minX: 40, minY: 50, maxX: 45, maxY: 90, enabled: false }];
  state.exclusionSettings = { checkingEnabled: true, exportEnabled: true, marginIn: 0.5, biobuzzInitialized: true };
  state.fieldConfig = {
    presetId: '', measurementUnit: 'in', fieldWidthM: 3.65,
    fieldHeightM: 3.67, origin: 'bottomLeft', coordinateSystem: 'pedro'
  };
  state.robotDimensions = { lengthM: 0.4, widthM: 0.3 };
  state.dimFuture = false;
  state.hudVisible = false;
  state.headingWrapHalf = true;
  state.chosenDirPath = 'auto/paths';
  // Browser objects, active drags, and timers must never be serialized.
  state.img = { circular: state };
  assert.equal(saveAppState(), true);
  const saved = JSON.parse(storage.get(STORAGE_KEY));
  assert.equal('img' in saved.workspace, false);
  assert.equal('chosenDirHandle' in saved.workspace, false);
  Object.assign(state, JSON.parse(JSON.stringify(defaults)));
  assert.deepEqual(restoreAppState(), saved);
  for (const [key, value] of Object.entries(saved.workspace)) assert.deepEqual(state[key], value);
});

test('form values and checkboxes restore without firing configuration transforms', () => {
  reset();
  assert.equal(saveAppState(), true);
  const saved = restoreAppState();
  elements.get('className').value = 'AutoPath';
  elements.get('fieldSize').value = '3.66';
  elements.get('boxRotate').checked = true;
  elements.get('javaType').value = 'rr';
  restoreControls(saved.controls);
  assert.equal(elements.get('className').value, 'RedAuto');
  assert.equal(elements.get('fieldSize').value, '143.75');
  assert.equal(elements.get('boxRotate').checked, false);
  assert.equal(elements.get('javaType').value, 'ftclib');
  restoreControls({ javaType: 'missing-library' });
  assert.equal(elements.get('javaType').value, 'ftclib');
  assert.doesNotThrow(() => restoreControls(null));
});

test('invalid or incompatible saved workspaces leave the default editor usable', () => {
  reset();
  saveAppState();
  const saved = JSON.parse(storage.get(STORAGE_KEY));
  const invalidDrafts = [
    { ...saved, version: 999 },
    { ...saved, workspace: { ...saved.workspace, paths: [] } },
    { ...saved, workspace: { ...saved.workspace, activePath: 90 } },
    { ...saved, workspace: { ...saved.workspace, fieldConfig: {} } },
    { ...saved, workspace: { ...saved.workspace, exclusionBox: { start: null } } },
    { ...saved, workspace: { ...saved.workspace, imageSource: { kind: 'url', url: 'blob:expired' } } }
  ];
  const original = JSON.stringify(state);
  for (const draft of invalidDrafts) {
    storage.set(STORAGE_KEY, JSON.stringify(draft));
    assert.equal(restoreAppState(), null);
    assert.equal(JSON.stringify(state), original);
  }
});

test('interaction and page lifecycle events synchronously save the latest workspace', () => {
  reset();
  initPersistence();
  state.hudVisible = false;
  listeners.get('keyup')();
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).workspace.hudVisible, false);
  state.paths[0].points = [{ xPx: 45, yPx: 70, headingRad: 0 }];
  listeners.get('mouseup')();
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).workspace.paths[0].points[0].xPx, 45);
  elements.get('className').value = 'UnblurredEdit';
  listeners.get('beforeunload')();
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)).controls.className, 'UnblurredEdit');
  state.paths[0].points = [];
  listeners.get('pagehide')();
  assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY)).workspace.paths[0].points, []);
});

test('malformed JSON and unavailable storage do not throw or mutate state', () => {
  reset();
  const warn = console.warn;
  console.warn = () => {};
  try {
    storage.set(STORAGE_KEY, '{incomplete');
    assert.equal(restoreAppState(), null);
    const availableStorage = window.localStorage;
    window.localStorage = {
      getItem() { throw new Error('Storage blocked'); },
      setItem() { throw new Error('Storage full'); }
    };
    try {
      assert.equal(restoreAppState(), null);
      assert.equal(saveAppState(), false);
    } finally {
      window.localStorage = availableStorage;
    }
  } finally {
    console.warn = warn;
  }
});
