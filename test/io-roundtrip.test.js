import test from 'node:test';
import assert from 'node:assert/strict';

class FakeElement {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.textContent = '';
    this.options = [];
    this.parentElement = { clientWidth: 1000, clientHeight: 800 };
  }
  addEventListener() {}
  setCustomValidity(message) { this.validationMessage = message; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getContext() { return {}; }
}

const elements = new Map();
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  },
  createElement() { return new FakeElement('created'); }
};
globalThis.Image = class {
  constructor() {
    this.width = 1600;
    this.height = 1600;
  }
};

const javaType = document.getElementById('javaType');
javaType.value = 'pedro';
javaType.options = ['rr', 'ftclib', 'RilLib', 'pedro'].map(value => ({ value }));
const exportKind = document.getElementById('exportKind');
exportKind.value = 'pathchain';
exportKind.options = ['list', 'array', 'pathchain', 'posefactory'].map(value => ({ value }));
document.getElementById('exportFileType').value = 'json';
document.getElementById('measurementsUnit').value = 'in';
document.getElementById('originSelect').value = 'bottomLeft';
document.getElementById('coordinateSystem').value = 'pedro';
document.getElementById('fieldSize').value = '144';
document.getElementById('robotLen').value = '18';
document.getElementById('robotWid').value = '18';

const { state, pushHistory, undo, redo } = await import('../js/state.js');
const { createPath, splitPathSegment } = await import('../js/segment_model.js');
const { createAnchor } = await import('../js/path_model.js');
const { toMeters } = await import('../js/units.js');
const { buildExportArtifacts, collectPathData, collectSegmentData, doExport } = await import('../js/io_export.js');
const { importWaypointsFromText } = await import('../js/io_import.js');
const { applyPresetConfig } = await import('../js/field_config.js');

function seedPath() {
  state.img = { width: 1600, height: 1600 };
  state.imgLoaded = true;
  state.fieldConfig = {
    presetId: '',
    measurementUnit: 'in',
    fieldWidthM: toMeters(144, 'in'),
    fieldHeightM: toMeters(144, 'in'),
    origin: 'bottomLeft',
    coordinateSystem: 'pedro'
  };
  state.robotDimensions = { lengthM: toMeters(18, 'in'), widthM: toMeters(18, 'in') };
  state.paths[state.activePath].points = [
    createAnchor(0, 1600, 0),
    createAnchor(1600, 0, Math.PI / 2, false, [
      { xPx: 400, yPx: 1200, locked: false },
      { xPx: 1200, yPx: 400, locked: true }
    ])
  ];
}

function config(fileType, format = 'pathchain') {
  return {
    library: 'pedro',
    format,
    fileType,
    packageName: 'org.example.paths',
    className: 'RoundTripPath'
  };
}

function assertRoundTrip({ controlLocked = true } = {}) {
  const points = state.paths[state.activePath].points;
  assert.equal(points.length, 2);
  assert.equal(points[1].controlPoints.length, 2);
  assert.equal(points[1].controlPoints[1].locked, controlLocked);
  assert.ok(Math.abs(points[0].headingRad) < 1e-9);
  assert.ok(Math.abs(points[1].headingRad - Math.PI / 2) < 1e-9);
}

test('Pedro JSON round trips anchors, headings, controls, and locks', async () => {
  seedPath();
  const artifact = buildExportArtifacts(collectPathData(true), config('json'));
  state.paths[state.activePath].points = [];
  await importWaypointsFromText(artifact.content, 'path.json');
  assertRoundTrip();
});

test('Pedro CSV round trips anchors, headings, controls, and locks', async () => {
  seedPath();
  const artifact = buildExportArtifacts(collectPathData(true), config('csv'));
  state.paths[state.activePath].points = [];
  await importWaypointsFromText(artifact.content, 'path.csv');
  assertRoundTrip();
});

test('Pedro PathChain Java round trips from its executable Pose data', async () => {
  seedPath();
  const artifact = buildExportArtifacts(collectPathData(true), config('java-class'));
  assert.match(artifact.content, /new BezierCurve/);
  assert.match(artifact.content, /setLinearHeadingInterpolation/);
  assert.doesNotMatch(artifact.content, /plannerPoint=/);
  state.paths[state.activePath].points = [];
  await importWaypointsFromText(artifact.content, 'RoundTripPath.java');
  assert.equal(document.getElementById('exportFolderPath').value, 'org.example.paths');
  assertRoundTrip();
});

test('edited Pedro PathChain poses override legacy plannerPoint comments', async () => {
  seedPath();
  const artifact = buildExportArtifacts(collectPathData(true), config('java-class'));
  const edited = artifact.content
    .replace('new Pose(0.000, 0.000)', 'new Pose(12.000, 24.000)')
    .replace('new Pose(144.000, 144.000)', 'new Pose(132.000, 120.000)');
  const legacyComments = [
    '// plannerPoint=anchor|0|0|0|0|false',
    '// plannerPoint=anchor|1|144|144|1.5707963267948966|false'
  ].join('\n');

  state.paths[state.activePath].points = [];
  await importWaypointsFromText(`${legacyComments}\n${edited}`, 'EditedPath.java');
  const imported = collectPathData(true);
  assert.ok(Math.abs(imported[0].x - 12) < 1e-9);
  assert.ok(Math.abs(imported[0].y - 24) < 1e-9);
  assert.ok(Math.abs(imported[1].x - 132) < 1e-9);
  assert.ok(Math.abs(imported[1].y - 120) < 1e-9);
});

test('Java preview derives its package solely from the current Windows folder path', () => {
  seedPath();
  document.getElementById('exportFileType').value = 'java-class';
  document.getElementById('className').value = 'AutoPath';
  document.getElementById('exportFolderPath').value =
    'org\\firstinspires\\ftc\\teamcode\\opmodes\\autos\\paths';

  doExport();

  assert.match(
    document.getElementById('output').textContent,
    /^package org\.firstinspires\.ftc\.teamcode\.opmodes\.autos\.paths;/
  );
});

test('Pedro Pose list includes controls and round trips from its Pose entries', async () => {
  seedPath();
  const artifact = buildExportArtifacts(collectPathData(true), config('java-snippet', 'list'));
  assert.match(artifact.content, /List<Pose>/);
  assert.match(artifact.content, /role=control/);
  assert.doesNotMatch(artifact.content, /plannerPoint=/);
  state.paths[state.activePath].points = [];
  await importWaypointsFromText(artifact.content, 'RoundTripPath.txt');
  assertRoundTrip();
});

test('Pedro PathChain without planner metadata is parsed structurally', async () => {
  seedPath();
  const artifact = buildExportArtifacts(collectPathData(true), config('java-class'));
  const externalStyle = artifact.content
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
  state.paths[state.activePath].points = [];
  await importWaypointsFromText(externalStyle, 'ExternalPath.java');
  const points = state.paths[state.activePath].points;
  assert.equal(points.length, 2);
  assert.equal(points[1].controlPoints.length, 2);
  assert.ok(Math.abs(points[1].headingRad - Math.PI / 2) < 1e-9);
});

test('Pedro preset selects the Pedro Java library', () => {
  javaType.value = 'rr';
  applyPresetConfig('pedro-decode');
  assert.equal(javaType.value, 'pedro');
});

test('default Pedro metadata collapses to one config line and expands on import', async () => {
  seedPath();
  applyPresetConfig('pedro-decode');
  const java = buildExportArtifacts(collectPathData(true), config('java-class'));
  const csv = buildExportArtifacts(collectPathData(true), config('csv'));
  assert.match(java.content, /^package[^\n]+;\n\n\/\/ config=pedro\n/);
  assert.doesNotMatch(java.content, /^\/\/ (?:schemaVersion|presetId|fieldWidth|plannerPoint)=/m);
  assert.match(csv.content, /^# config=pedro\n/);

  state.paths[state.activePath].points = [];
  await importWaypointsFromText(java.content, 'CompactPedro.java');
  assert.equal(state.fieldConfig.presetId, 'pedro-decode');
  assertRoundTrip();
});

test('default RoadRunner metadata collapses to its preset config line', async () => {
  seedPath();
  applyPresetConfig('rr-into-the-deep');
  state.paths[state.activePath].points[1].locked = true;
  const roadRunnerConfig = {
    library: 'rr', format: 'list', fileType: 'java-class',
    packageName: 'org.example.paths', className: 'RoadRunnerPath'
  };
  const artifact = buildExportArtifacts(collectPathData(false), roadRunnerConfig);
  assert.match(artifact.content, /^package[^\n]+;\n\n\/\/ config=roadrunner\n/);
  assert.doesNotMatch(artifact.content, /plannerPoint=|^\/\/ fieldWidth=/m);

  state.paths[state.activePath].points = [];
  await importWaypointsFromText(artifact.content, 'RoadRunnerPath.java');
  assert.equal(state.fieldConfig.presetId, 'rr-into-the-deep');
  assert.equal(state.paths[state.activePath].points[1].locked, true);
});

test('customized preset settings keep the full lossless metadata block', () => {
  seedPath();
  applyPresetConfig('pedro-decode');
  state.robotDimensions.widthM = toMeters(17, 'in');
  const artifact = buildExportArtifacts(collectPathData(true), config('java-class'));
  assert.doesNotMatch(artifact.content, /^\/\/ config=/m);
  assert.match(artifact.content, /^\/\/ robotWid=17/m);
  assert.match(artifact.content, /^\/\/ presetId=pedro-decode/m);
});

test('non-Pedro exports and imports omit preserved Pedro control points', async () => {
  seedPath();
  assert.deepEqual(collectPathData(false).map(point => point.controlPoints), [[], []]);
  const pathData = collectPathData(true);
  const roadRunnerConfig = {
    library: 'rr',
    format: 'list',
    packageName: 'org.example.paths',
    className: 'RoadRunnerPath'
  };

  const json = buildExportArtifacts(pathData, { ...roadRunnerConfig, fileType: 'json' });
  assert.deepEqual(JSON.parse(json.content).poses.map(pose => pose.controlPoints), [[], []]);

  const csv = buildExportArtifacts(pathData, { ...roadRunnerConfig, fileType: 'csv' });
  assert.doesNotMatch(csv.content, /^control,/m);

  const java = buildExportArtifacts(pathData, { ...roadRunnerConfig, fileType: 'java-class' });
  assert.doesNotMatch(java.content, /plannerPoint=control|role=control/);

  state.paths[state.activePath].points = [];
  await importWaypointsFromText(json.content, 'RoadRunnerPath.json');
  assert.deepEqual(state.paths[state.activePath].points.map(point => point.controlPoints), [[], []]);
});

function seedSegments() {
  state.activePath = 0;
  seedPath();
  const firstPoints = state.paths[0].points;
  state.paths = Array.from({ length: 4 }, (_, index) => createPath(`Path ${index + 1}`));
  const path = state.paths[0];
  path.className = 'RoundTripPath';
  path.segments = [
    { id: 'collect', name: 'Collect, "blue"\nsamples', color: '#7dd3fc' },
    { id: 'park', name: 'Park', color: '#81c784' },
    { id: 'empty', name: 'Empty' },
    { id: 'reference', name: 'Reference point' }
  ];
  const parkPoints = Array.from({ length: 62 }, (_, index) => ({ ...createAnchor(index * 20, 800 + index, index / 100), segmentId: 'park' }));
  parkPoints[0].breakBefore = true;
  path.points = [
    ...firstPoints.map(point => ({ ...point, segmentId: 'collect' })),
    ...parkPoints,
    { ...createAnchor(400, 700, -Math.PI / 4, true), segmentId: 'reference', breakBefore: true }
  ];
  state.paths[1].className = 'BlueAuto';
  state.paths[1].segments = [{ id: 'blueOnly', name: 'Blue only' }];
  state.paths[1].points = [createAnchor(50, 50), createAnchor(90, 90)].map(point => ({ ...point, segmentId: 'blueOnly' }));
  javaType.value = 'pedro';
  exportKind.value = 'posefactory';
  state.headingWrapHalf = false;
  return collectSegmentData();
}

function segmentConfig(fileType) {
  return { ...config(fileType, 'posefactory'), segments: collectSegmentData() };
}

for (const fileType of ['json', 'csv', 'java-class', 'java-snippet']) {
  test(`mixed heading modes survive Pedro ${fileType} export and import`, async () => {
    seedSegments();
    const points = state.paths[0].points;
    points[1].headingMode = 'constant';
    points[3].headingMode = 'tangent';
    points[4].headingMode = 'constant';
    points[4].constantHeadingRad = 1.234;
    const before = collectSegmentData();
    const artifact = buildExportArtifacts([], segmentConfig(fileType));
    await importWaypointsFromText(artifact.content, `Modes.${fileType === 'json' ? 'json' : fileType === 'csv' ? 'csv' : 'java'}`);
    const after = collectSegmentData();
    for (let s = 0; s < before.length; s++) {
      for (let p = 1; p < before[s].points.length; p++) {
        assert.equal(after[s].points[p].headingMode, before[s].points[p].headingMode, `${s}:${p} mode`);
        if (before[s].points[p].constantHeadingRad !== undefined) {
          assert.ok(Math.abs(after[s].points[p].constantHeadingRad - before[s].points[p].constantHeadingRad) < 1e-8);
        }
      }
    }
  });
}

test('heading modes and fixed imported headings survive undo and redo', () => {
  seedSegments();
  const point = state.paths[0].points[1];
  point.headingMode = 'constant';
  point.constantHeadingRad = 1.234;
  pushHistory();
  point.headingMode = 'tangent';
  delete point.constantHeadingRad;
  assert.equal(undo(), true);
  assert.equal(state.paths[0].points[1].headingMode, 'constant');
  assert.equal(state.paths[0].points[1].constantHeadingRad, 1.234);
  assert.equal(redo(), true);
  assert.equal(state.paths[0].points[1].headingMode, 'tangent');
  assert.equal(state.paths[0].points[1].constantHeadingRad, undefined);
});

for (const fileType of ['json', 'csv', 'java-class', 'java-snippet']) {
  test(`named Pedro segments round trip every segment through ${fileType}`, async () => {
    const before = seedSegments();
    const artifact = buildExportArtifacts([], segmentConfig(fileType));
    const otherAutos = JSON.stringify(state.paths.slice(1));
    state.paths[0].points = [];
    await importWaypointsFromText(artifact.content, `Segments.${fileType === 'json' ? 'json' : fileType === 'csv' ? 'csv' : 'java'}`);
    const after = collectSegmentData();
    assert.equal(state.paths.length, 4);
    assert.equal(state.activePath, 0);
    assert.equal(JSON.stringify(state.paths.slice(1)), otherAutos);
    assert.deepEqual(after.map(segment => segment.name), before.map(segment => segment.name));
    assert.deepEqual(after.map(segment => segment.points.length), [2, 62, 0, 1]);
    assert.equal(after[0].points[1].controlPoints[1].locked, true);
    for (let s = 0; s < before.length; s++) {
      for (let p = 0; p < before[s].points.length; p++) {
        for (const property of ['x', 'y', 'headingRad']) {
          assert.ok(Math.abs(before[s].points[p][property] - after[s].points[p][property]) < 1e-7, `${s}:${p}:${property}`);
        }
      }
    }
    assert.equal(exportKind.value, 'posefactory');
  });
}

test('Pedro preview exports only the selected auto and all segments inside it', () => {
  seedSegments();
  document.getElementById('exportFileType').value = 'java-class';
  document.getElementById('className').value = 'AutoPaths';
  doExport();
  const java = document.getElementById('output').textContent;
  assert.equal((java.match(/public final class /g) || []).length, 1);
  assert.match(java, /public Path collectBlueSamples\(\)/);
  assert.match(java, /public Path park\(\)/);
  assert.match(java, /PoseFactory parkPoses = PoseFactory.degrees\(\)/);
  assert.match(java, /parkPoint62/);
  assert.match(java, /Paths\.curve\(/);
  assert.match(java, /Paths\.path\(/);
  assert.doesNotMatch(java, /blueOnly|BlueAuto/);
  assert.doesNotMatch(java, /private AutoPaths\(\)|PathChain|Follower|new Pose\(/);
});

test('factory Java import reads externally edited executable pose values', async () => {
  seedSegments();
  const artifact = buildExportArtifacts([], segmentConfig('java-class'));
  const edited = artifact.content.replace('collectBlueSamplesPoses.of(0.000000000, 0.000000000, 0.000000000)', 'collectBlueSamplesPoses.of(12.000000000, 24.000000000, 180.000000000)');
  await importWaypointsFromText(edited, 'Edited.java');
  const point = collectSegmentData()[0].points[0];
  assert.ok(Math.abs(point.x - 12) < 1e-8);
  assert.ok(Math.abs(point.y - 24) < 1e-8);
  assert.ok(Math.abs(point.headingRad - Math.PI) < 1e-8);
});

test('the 100-point path limit counts shared boundaries once across segments', async () => {
  seedSegments();
  state.paths[0].points = Array.from({ length: 100 }, (_, index) => createAnchor(index, index));
  delete state.paths[0].segments;
  collectSegmentData();
  splitPathSegment(state.paths[0], 50);
  const artifact = buildExportArtifacts([], segmentConfig('json'));
  await importWaypointsFromText(artifact.content, 'Hundred.json');
  assert.equal(state.paths[0].points.length, 100);
  assert.equal(state.paths[0].segments.length, 2);
  const before = JSON.stringify(state.paths);
  const oversized = JSON.parse(artifact.content);
  oversized.segments[1].poses.push(oversized.segments[1].poses[0]);
  await assert.rejects(importWaypointsFromText(JSON.stringify(oversized), 'TooMany.json'), /100 anchor points/);
  assert.equal(JSON.stringify(state.paths), before);
});

test('legacy pose imports also enforce the 100-point limit', async () => {
  seedSegments();
  const oversized = Array.from({ length: 101 }, () => ({ x: 0, y: 0, headingRad: 0 }));
  await assert.rejects(importWaypointsFromText(JSON.stringify(oversized), 'Legacy.json'), /100 anchor points/);
});

test('segment labels and shared boundary membership are restored by undo and redo', () => {
  seedSegments();
  state._history = [];
  state._future = [];
  const original = JSON.parse(JSON.stringify(state.paths));
  pushHistory();
  assert.equal(splitPathSegment(state.paths[0], 30), true);
  state.paths[0].segments[state.paths[0].activeSegment].name = 'Return to score';
  const split = JSON.parse(JSON.stringify(state.paths));
  assert.equal(undo(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.paths)), original);
  assert.equal(state.activePath, 0);
  assert.equal(redo(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(state.paths)), split);
  assert.equal(state.activePath, 0);
});

test('four Pedro autos can be loaded independently, one class and segment set per path slot', async () => {
  seedSegments();
  const names = ['RedOne', 'RedTwo', 'BlueOne', 'BlueTwo'];
  for (let index = 0; index < 4; index++) {
    state.activePath = index;
    const artifact = buildExportArtifacts([], {
      ...config('java-class', 'posefactory'), className: names[index],
      segments: [{ name: `${names[index]} route`, points: [
        { x: index * 10, y: 0, headingRad: 0, controlPoints: [] },
        { x: index * 10 + 10, y: 10, headingRad: 0, controlPoints: [] }
      ] }]
    });
    await importWaypointsFromText(artifact.content, `${names[index]}.java`);
    assert.equal(state.activePath, index);
    assert.equal(state.paths.length, 4);
  }
  assert.deepEqual(state.paths.map(path => path.className), names);
  assert.deepEqual(state.paths.map(path => path.segments[0].name), names.map(name => `${name} route`));
  for (let index = 0; index < 4; index++) {
    state.activePath = index;
    const artifact = buildExportArtifacts([], {
      ...config('java-class', 'posefactory'), className: state.paths[index].className,
      segments: collectSegmentData()
    });
    assert.match(artifact.content, new RegExp(`public final class ${names[index]}`));
    for (const other of names.filter(name => name !== names[index])) assert.ok(!artifact.content.includes(other));
  }
});
