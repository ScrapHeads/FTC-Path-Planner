import { els } from './els.js';
import { state, pushHistory } from './state.js';
import { fieldToImagePx } from './layout.js';
import { updateTable, syncSelectedUI } from './ui.js';
import { draw } from './draw.js';
import { loadPresetImage } from './io_image.js';
import {
  applyMetadataConfig,
  canonicalToHeading,
  getCompactConfigMetadata,
  headingToCanonical,
  syncConfigUI
} from './field_config.js';
import { createAnchor, MAX_PATH_POINTS } from './path_model.js';
import { ensurePathSegments, samePose } from './segment_model.js';
import { parsePedroJavaSegments } from './pedro_java.js';
import { parseImportedZones } from './exclusion_model.js';

export function initImport() {
  els.loadBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv,.java,.txt,application/json,text/plain,text/csv';
    input.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        pushHistory();
        await importWaypointsFromText(await file.text(), file.name.toLowerCase());
        els.javaType.dispatchEvent(new Event('change'));
        const path = state.paths[state.activePath];
        state.selected = path.points.length ? 0 : -1;
        state.selectedControl = null;
        syncConfigUI();
        syncSelectedUI();
        updateTable();
        draw();
      } catch (error) {
        console.error(error);
        alert(`Could not load waypoints: ${error.message}`);
      }
    });
    input.click();
  });
}

export async function importWaypointsFromText(text, filename = 'path.txt') {
  const trimmed = text.trim();
  const extension = filename.split('.').pop()?.toLowerCase();
  let metadata;
  let javaText = '';
  if (extension === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) metadata = JSON.parse(text)?.meta || {};
  else if (extension === 'csv') {
    metadata = {};
    for (const line of text.split(/\r?\n/)) if (/^\s*#/.test(line)) parseMetadataLine(line, metadata);
  } else { metadata = parseJavaMetadata(text); javaText = text; }
  const imported = parseImportedZones(metadata, javaText);
  const previousZones = state.exclusionZones, previousSettings = { ...state.exclusionSettings };
  try { await importPathContents(text, filename); }
  finally { state.exclusionZones = previousZones; state.exclusionSettings = previousSettings; }
  if (imported) {
    state.exclusionZones = imported.zones;
    Object.assign(state.exclusionSettings, { checkingEnabled: imported.checkingEnabled, marginIn: imported.marginIn, exportEnabled: true, biobuzzInitialized: true });
  } else if (state.fieldConfig.presetId === 'pedro-biobuzz') {
    state.exclusionSettings.biobuzzInitialized = true;
  }
}

async function importPathContents(text, filename) {
  const trimmed = text.trim();
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    els.exportFileType.value = 'json';
    await importJson(text);
    return;
  }
  if (extension === 'csv') {
    els.exportFileType.value = 'csv';
    await importCsv(text);
    return;
  }
  if (extension === 'java' || extension === 'txt' || /PoseFactory|new\s+Pose(?:2d)?\s*\(/.test(text)) {
    els.exportFileType.value = extension === 'java' ? 'java-class' : 'java-snippet';
    await importJava(text);
    return;
  }
  throw new Error('Unsupported file type.');
}

async function importJson(text) {
  const value = JSON.parse(text);
  if (Array.isArray(value)) {
    await ensureImageForMetadata({});
    loadStructuredPoses(value, {});
    return;
  }

  const metadata = value?.meta || {};
  await ensureImageForMetadata(metadata);
  applyExportSelections(metadata);

  if (Array.isArray(value?.segments)) {
    loadSegments(value.segments.map(segment => ({ ...segment, points: segment.poses || segment.points || [] })), metadata);
    return;
  }
  if (Array.isArray(value?.poses)) {
    loadStructuredPoses(value.poses, metadata);
    return;
  }
  if (Array.isArray(value?.points)) {
    assertPointLimit(value.points);
    const supportsControls = metadataSupportsControls(metadata);
    state.paths[state.activePath].points = value.points.map(point => createAnchor(
      point.xPx,
      point.yPx,
      point.headingRad,
      point.locked,
      supportsControls ? point.controlPoints : [],
      point.headingMode,
      point.constantHeadingRad
    ));
    delete state.paths[state.activePath].segments;
    ensurePathSegments(state.paths[state.activePath]);
    return;
  }
  throw new Error('Unrecognized JSON structure.');
}

async function importCsv(text) {
  const metadata = {};
  let csvText = text.trimStart();
  let comment;
  while ((comment = csvText.match(/^#[^\r\n]*(?:\r?\n|$)/))) {
    parseMetadataLine(comment[0].trim(), metadata);
    csvText = csvText.slice(comment[0].length);
  }
  const records = parseCsvRows(csvText).filter(row => row.some(value => value.trim()));
  if (!records.length) throw new Error('CSV is empty.');
  await ensureImageForMetadata(metadata);
  applyExportSelections(metadata);

  const header = records.shift().map(value => value.trim().toLowerCase());
  const rows = records;
  if (header.includes('segment_index')) {
    const segments = new Map();
    rows.forEach(row => {
      const index = Number(cell(row, header, 'segment_index'));
      if (!Number.isInteger(index) || index < 0) throw new Error('Invalid segment index.');
      if (!segments.has(index)) segments.set(index, {
        name: cell(row, header, 'segment_name') || `Segment ${index + 1}`,
        color: cell(row, header, 'segment_color'), anchors: new Map(), controls: []
      });
      const segment = segments.get(index);
      const role = cell(row, header, 'role');
      if (role === 'segment') return;
      const anchorIndex = Number(cell(row, header, 'anchor_index'));
      if (!Number.isInteger(anchorIndex) || anchorIndex < 0) throw new Error('Invalid anchor index.');
      const point = {
        x: Number(cell(row, header, 'x')), y: Number(cell(row, header, 'y')),
        headingRad: Number(cell(row, header, 'heading_rad') || 0),
        headingMode: cell(row, header, 'heading_mode') || 'linear',
        constantHeadingRad: cell(row, header, 'constant_heading_rad') === '' ? undefined : Number(cell(row, header, 'constant_heading_rad')),
        locked: parseBoolean(cell(row, header, 'locked')), controlPoints: []
      };
      if (role === 'anchor') segment.anchors.set(anchorIndex, point);
      else if (role === 'control') segment.controls.push({ ...point, anchorIndex, controlIndex: Number(cell(row, header, 'control_index')) });
      else throw new Error(`Unknown CSV point role: ${role}.`);
    });
    const imported = [...segments.entries()].sort(([a], [b]) => a - b).map(([, segment]) => {
      segment.controls.sort((a, b) => a.controlIndex - b.controlIndex).forEach(control => {
        const anchor = segment.anchors.get(control.anchorIndex);
        if (!anchor) throw new Error('A control point has no anchor.');
        anchor.controlPoints.push(control);
      });
      return { ...segment, points: [...segment.anchors.entries()].sort(([a], [b]) => a - b).map(([, point]) => point) };
    });
    loadSegments(imported, metadata);
    return;
  }
  if (header.includes('role') && header.includes('anchor_index')) {
    const anchors = new Map();
    const controls = [];
    rows.forEach(row => {
      const role = cell(row, header, 'role');
      const anchorIndex = Number(cell(row, header, 'anchor_index'));
      const record = {
        x: Number(cell(row, header, 'x')),
        y: Number(cell(row, header, 'y')),
        headingRad: Number(cell(row, header, 'heading_rad') || 0),
        locked: parseBoolean(cell(row, header, 'locked'))
      };
      if (role === 'anchor') anchors.set(anchorIndex, record);
      else if (role === 'control') {
        controls.push({ ...record, anchorIndex, controlIndex: Number(cell(row, header, 'control_index')) });
      }
    });
    const poses = [...anchors.entries()].sort(([a], [b]) => a - b).map(([, anchor]) => ({ ...anchor, controlPoints: [] }));
    controls.sort((a, b) => a.anchorIndex - b.anchorIndex || a.controlIndex - b.controlIndex).forEach(control => {
      if (poses[control.anchorIndex]) poses[control.anchorIndex].controlPoints.push(control);
    });
    loadStructuredPoses(poses, metadata);
    return;
  }

  const hasKnownHeader = header.some(name => ['x', 'x_in', 'y', 'y_in', 'heading_rad', 'heading_deg'].includes(name));
  const legacyRows = hasKnownHeader ? rows : [header, ...rows];
  const legacyHeader = hasKnownHeader ? header : [];
  const poses = legacyRows.map(columns => {
    const x = legacyHeader.length
      ? Number(columns[indexOfEither(legacyHeader, ['x', 'x_in'], 1)] || 0)
      : Number(columns[1] ?? columns[0] ?? 0);
    const y = legacyHeader.length
      ? Number(columns[indexOfEither(legacyHeader, ['y', 'y_in'], 2)] || 0)
      : Number(columns[2] ?? columns[1] ?? 0);
    const headingRadIndex = legacyHeader.indexOf('heading_rad');
    const headingDegIndex = legacyHeader.indexOf('heading_deg');
    const headingRad = headingRadIndex >= 0 && columns[headingRadIndex] !== ''
      ? Number(columns[headingRadIndex])
      : Number(columns[headingDegIndex >= 0 ? headingDegIndex : 4] || 0) * Math.PI / 180;
    const lockedIndex = legacyHeader.indexOf('locked');
    return {
      x, y, headingRad,
      locked: parseBoolean(columns[lockedIndex >= 0 ? lockedIndex : 5]),
      controlPoints: []
    };
  });
  if ((legacyHeader.includes('x_in') || legacyHeader.includes('y_in')) && !metadata.dataMeasurementUnit) {
    metadata.dataMeasurementUnit = 'in';
  }
  loadStructuredPoses(poses, metadata);
}

async function importJava(text) {
  const metadata = parseJavaMetadata(text);
  await ensureImageForMetadata(metadata);
  applyExportSelections(metadata);
  applyJavaDocumentSelections(text);

  const segments = parsePedroJavaSegments(text);
  if (segments) {
    loadSegments(segments, { ...metadata, library: 'pedro', format: 'posefactory', dataMeasurementUnit: 'in', dataOrigin: 'bottomLeft', dataCoordinateSystem: 'pedro' });
    return;
  }
  const pathChainPoses = parsePedroPathChain(text);
  if (pathChainPoses.length) {
    const pedroMetadata = {
      ...metadata,
      library: 'pedro',
      format: 'pathchain',
      dataMeasurementUnit: metadata.dataMeasurementUnit || 'in',
      dataOrigin: metadata.dataOrigin || 'bottomLeft',
      dataCoordinateSystem: metadata.dataCoordinateSystem || 'pedro'
    };
    loadStructuredPoses(pathChainPoses, pedroMetadata);
    return;
  }

  const isPedroDocument = metadata.library === 'pedro' || /new\s+Pose\s*\(/.test(text);
  if (isPedroDocument) {
    const collectionPoses = parsePoseCollection(text);
    if (collectionPoses.length) {
      const pedroMetadata = {
        ...metadata,
        library: 'pedro',
        dataMeasurementUnit: metadata.dataMeasurementUnit || 'in',
        dataOrigin: metadata.dataOrigin || 'bottomLeft',
        dataCoordinateSystem: metadata.dataCoordinateSystem || 'pedro'
      };
      loadStructuredPoses(collectionPoses, pedroMetadata);
      return;
    }
  }

  const plannerPoses = parsePlannerPointComments(text);
  if (plannerPoses.length) {
    loadStructuredPoses(plannerPoses, metadata);
    return;
  }

  const collectionPoses = parsePoseCollection(text);
  if (!collectionPoses.length) throw new Error('No Pose or Pose2d entries found in Java file.');
  loadStructuredPoses(collectionPoses, metadata);
}

async function ensureImageForMetadata(metadata) {
  const previousPresetId = state.fieldConfig.presetId;
  const preset = applyMetadataConfig(metadata);
  if (preset && (!state.imgLoaded || previousPresetId !== preset.id)) await loadPresetImage(preset.id);
  if (!state.imgLoaded) {
    throw new Error('This file has no field preset. Load a field image before importing it.');
  }
}

function structuredPoints(poses, metadata) {
  assertPointLimit(poses);
  const options = getDataCoordinateOptions(metadata);
  const dataSystem = options.coordinateSystem;
  const activeSystem = state.fieldConfig.coordinateSystem;
  const supportsControls = metadataSupportsControls(metadata);
  const points = poses.map(pose => {
    if (![Number(pose.x), Number(pose.y), Number(pose.headingRad ?? pose.h ?? 0)].every(Number.isFinite)) {
      throw new Error('A point has invalid coordinates or heading.');
    }
    const image = fieldToImagePx(Number(pose.x), Number(pose.y), options);
    const canonicalHeading = headingToCanonical(Number(pose.headingRad ?? pose.h ?? 0), dataSystem);
    return createAnchor(
      image.x,
      image.y,
      canonicalToHeading(canonicalHeading, activeSystem),
      pose.locked,
      (supportsControls ? pose.controlPoints || [] : []).slice(0, 2).map(control => {
        const controlImage = fieldToImagePx(Number(control.x), Number(control.y), options);
        return { xPx: controlImage.x, yPx: controlImage.y, locked: !!control.locked };
      }),
      pose.headingMode,
      Number.isFinite(pose.constantHeadingRad) ? canonicalToHeading(headingToCanonical(pose.constantHeadingRad, dataSystem), activeSystem) : undefined
    );
  });
  if (points[0]) points[0].controlPoints = [];
  return points;
}

function loadStructuredPoses(poses, metadata) {
  const path = state.paths[state.activePath];
  path.points = structuredPoints(poses, metadata);
  delete path.segments;
  ensurePathSegments(path);
  path.previewIndex = path.points.length - 1;
}

function loadSegments(segments, metadata) {
  const pedroMetadata = { ...metadata, library: 'pedro', format: 'posefactory' };
  const labels = [];
  const points = [];
  // A file represents one autonomous program. Validate before replacing that slot.
  segments.forEach((segment, index) => {
    const id = `segment${index + 1}`;
    labels.push({ id, name: String(segment.name || `Segment ${index + 1}`), color: segment.color });
    const imported = structuredPoints(segment.points, pedroMetadata);
    if (points.length && imported.length && samePose(points[points.length - 1], imported[0])) {
      points[points.length - 1].locked ||= imported[0].locked;
      imported.shift();
    } else if (points.length && imported.length) imported[0].breakBefore = true;
    imported.forEach(point => { point.segmentId = id; points.push(point); });
  });
  assertPointLimit(points);
  const path = state.paths[state.activePath];
  path.points = points;
  path.segments = labels;
  path.activeSegment = -1;
  path.previewIndex = points.length - 1;
  ensurePathSegments(path);
  state.selected = -1;
  state.selectedControl = null;
  applyExportSelections(pedroMetadata);
}

function assertPointLimit(points) {
  if (!Array.isArray(points)) throw new Error('Segment points must be an array.');
  if (points.length > MAX_PATH_POINTS) throw new Error(`A path cannot contain more than ${MAX_PATH_POINTS} anchor points across its segments.`);
}

function metadataSupportsControls(metadata) {
  return metadata.library === 'pedro' || metadata.format === 'pathchain';
}

function getDataCoordinateOptions(metadata) {
  return {
    unit: metadata.dataMeasurementUnit || metadata.measurementUnit || state.fieldConfig.measurementUnit,
    origin: metadata.dataOrigin || metadata.origin || state.fieldConfig.origin,
    coordinateSystem: metadata.dataCoordinateSystem || metadata.coordinateSystem || state.fieldConfig.coordinateSystem
  };
}

function parsePlannerPointComments(text) {
  const anchors = new Map();
  const controls = [];
  const pattern = /plannerPoint\s*=\s*([^\r\n]+)/g;
  let match;
  while ((match = pattern.exec(text))) {
    const parts = match[1].trim().split('|');
    if (parts[0] === 'anchor' && parts.length >= 6) {
      anchors.set(Number(parts[1]), {
        x: Number(parts[2]), y: Number(parts[3]), headingRad: Number(parts[4]),
        locked: parseBoolean(parts[5]), controlPoints: []
      });
    } else if (parts[0] === 'control' && parts.length >= 6) {
      controls.push({
        anchorIndex: Number(parts[1]), controlIndex: Number(parts[2]),
        x: Number(parts[3]), y: Number(parts[4]), locked: parseBoolean(parts[5])
      });
    }
  }
  const poses = [...anchors.entries()].sort(([a], [b]) => a - b).map(([, pose]) => pose);
  controls.sort((a, b) => a.anchorIndex - b.anchorIndex || a.controlIndex - b.controlIndex).forEach(control => {
    if (poses[control.anchorIndex]) poses[control.anchorIndex].controlPoints.push(control);
  });
  return poses;
}

function parsePedroPathChain(text) {
  const poses = [];
  const segmentPattern = /\.addPath\s*\(\s*new\s+(BezierLine|BezierCurve)\s*\(([\s\S]*?)\)\s*\)\s*\.setLinearHeadingInterpolation\s*\(([^)]*(?:\([^)]*\)[^)]*)*)\)/g;
  let match;
  while ((match = segmentPattern.exec(text))) {
    const curvePoses = parsePedroPoseConstructors(match[2]);
    if (curvePoses.length < 2) continue;
    const headingArgs = splitJavaArguments(match[3]).map(parseJavaNumber);
    const start = curvePoses[0];
    const end = curvePoses[curvePoses.length - 1];
    if (!poses.length) poses.push({ ...start, headingRad: headingArgs[0] || 0, controlPoints: [] });
    poses.push({
      ...end,
      headingRad: headingArgs[1] || 0,
      controlPoints: curvePoses.slice(1, -1).slice(0, 2)
    });
  }
  return poses;
}

function parsePedroPoseConstructors(text) {
  const poses = [];
  const pattern = /new\s+Pose\s*\(\s*([^,()]+)\s*,\s*([^,()]+)(?:\s*,\s*([^()]+(?:\([^)]*\))?))?\s*\)\s*,?\s*(?:\/\/\s*([^\r\n]*))?/g;
  let match;
  while ((match = pattern.exec(text))) {
    poses.push({
      x: parseJavaNumber(match[1]),
      y: parseJavaNumber(match[2]),
      headingRad: parseJavaNumber(match[3] || '0'),
      locked: parseBoolean(match[4]?.match(/\blocked=(true|false)\b/i)?.[1] || false)
    });
  }
  return poses;
}

function parsePoseCollection(text) {
  const poses = [];
  const pedroEntries = [];
  const pedroPattern = /new\s+Pose\s*\(\s*([^,()]+)\s*,\s*([^,()]+)(?:\s*,\s*([^()]+(?:\([^)]*\))?))?\s*\)\s*,?\s*(?:\/\/\s*([^\r\n]*))?/g;
  let match;
  while ((match = pedroPattern.exec(text))) {
    const comment = match[4] || '';
    pedroEntries.push({
      x: parseJavaNumber(match[1]),
      y: parseJavaNumber(match[2]),
      headingRad: parseJavaNumber(match[3] || '0'),
      role: comment.match(/\brole=(anchor|control)\b/)?.[1] || '',
      anchorIndex: Number(comment.match(/\banchor=(\d+)\b/)?.[1]),
      controlIndex: Number(comment.match(/\bcontrol=(\d+)\b/)?.[1]),
      locked: parseBoolean(comment.match(/\blocked=(true|false)\b/i)?.[1] || false)
    });
  }
  if (pedroEntries.some(entry => entry.role)) {
    const anchors = new Map();
    const controls = [];
    pedroEntries.forEach(entry => {
      if (entry.role === 'control') controls.push(entry);
      else {
        const anchorIndex = Number.isFinite(entry.anchorIndex) ? entry.anchorIndex : anchors.size;
        anchors.set(anchorIndex, { ...entry, controlPoints: [] });
      }
    });
    controls.sort((a, b) => a.anchorIndex - b.anchorIndex || a.controlIndex - b.controlIndex).forEach(control => {
      anchors.get(control.anchorIndex)?.controlPoints.push(control);
    });
    return [...anchors.entries()].sort(([a], [b]) => a - b).map(([, anchor]) => anchor);
  }
  if (pedroEntries.length) {
    return pedroEntries.map(entry => ({ ...entry, controlPoints: [] }));
  }

  const pose2dPattern = /new\s+Pose2d\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*(?:new\s+Rotation2d\s*\(\s*)?([-+\d.eE]+|Math\.toRadians\([^)]*\))\s*\)?\s*\)\s*,?\s*(?:\/\/\s*([^\r\n]*))?/g;
  while ((match = pose2dPattern.exec(text))) {
    poses.push({
      x: Number(match[1]),
      y: Number(match[2]),
      headingRad: parseJavaNumber(match[3]),
      locked: parseBoolean(match[4]?.match(/\blocked=(true|false)\b/i)?.[1] || false),
      controlPoints: []
    });
  }
  return poses;
}

function parseJavaMetadata(text) {
  const metadata = {};
  text.split(/\r?\n/).forEach(line => {
    if (/^\s*\/\//.test(line) && !/plannerPoint\s*=/.test(line)) parseMetadataLine(line, metadata);
  });
  return metadata;
}

function parseMetadataLine(line, target) {
  const match = line.match(/^(?:\s*\/\/|\s*#)\s*([\w]+)\s*=\s*(.*?)\s*$/);
  if (!match) return;
  if (match[1] === 'config') {
    const compactMetadata = getCompactConfigMetadata(match[2]);
    if (compactMetadata) Object.assign(target, compactMetadata);
    return;
  }
  target[match[1]] = coerceMetadataValue(match[2]);
}

function coerceMetadataValue(value) {
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (value !== '' && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function applyExportSelections(metadata) {
  if (metadata.className) {
    state.paths[state.activePath].className = String(metadata.className);
    els.className.value = String(metadata.className);
  }
  if (metadata.library && [...els.javaType.options].some(option => option.value === metadata.library)) {
    els.javaType.value = metadata.library;
  }
  if (metadata.format && [...els.exportKind.options].some(option => option.value === metadata.format)) {
    els.exportKind.value = metadata.format;
  }
  if (metadata.headingWrapHalf !== undefined) {
    state.headingWrapHalf = !!metadata.headingWrapHalf;
    els.headingWrap.checked = state.headingWrapHalf;
  }
}

function applyJavaDocumentSelections(text) {
  const packageMatch = text.match(/package\s+([\w.]+)\s*;/);
  const classMatch = text.match(/^\s*(?:(?:public|final|abstract)\s+)*class\s+(\w+)/m);
  if (packageMatch && els.exportFolderPath) els.exportFolderPath.value = packageMatch[1];
  if (classMatch) {
    els.className.value = classMatch[1];
    state.paths[state.activePath].className = classMatch[1];
  }
  if (/com\.pedropathing\.(?:geometry|math)\.Pose|PoseFactory/.test(text)) els.javaType.value = 'pedro';
  else if (/com\.arcrobotics\.ftclib/.test(text)) els.javaType.value = 'ftclib';
  else if (/RilLib/.test(text)) els.javaType.value = 'RilLib';
  else if (/com\.acmerobotics\.roadrunner/.test(text)) els.javaType.value = 'rr';
  if (/PoseFactory/.test(text)) els.exportKind.value = 'posefactory';
  else if (/PathChain/.test(text)) els.exportKind.value = 'pathchain';
  else if (/Pose(?:2d)?\s*\[\]/.test(text)) els.exportKind.value = 'array';
  else els.exportKind.value = 'list';
}

function parseJavaNumber(expression) {
  const value = String(expression || '').trim();
  const radians = value.match(/Math\.toRadians\s*\(\s*([-+\d.eE]+)\s*\)/);
  if (radians) return Number(radians[1]) * Math.PI / 180;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
}

function splitJavaArguments(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '(') depth++;
    else if (value[index] === ')') depth--;
    else if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += char;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted value.');
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

function cell(row, header, name) {
  const index = header.indexOf(name);
  return index >= 0 ? (row[index] ?? '') : '';
}

function indexOfEither(header, names, fallback) {
  for (const name of names) {
    const index = header.indexOf(name);
    if (index >= 0) return index;
  }
  return fallback;
}

function parseBoolean(value) {
  return String(value).trim().toLowerCase() === 'true';
}
