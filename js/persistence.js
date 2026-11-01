import { state } from './state.js';

export const STORAGE_KEY = 'ftc-path-planner.workspace.v1';
const STATE_KEYS = [
  'paths', 'activePath', 'fieldConfig', 'robotDimensions', 'selected',
  'selectedControl', 'headingWrapHalf', 'hudVisible', 'dimFuture',
  'exclusionBox', 'chosenDirPath', 'imageSource'
];
// Generated table/preview controls are rebuilt from state. File inputs and
// directory permissions cannot be restored by assigning a form value.
const CONTROL_IDS = [
  'sampleSelect', 'fieldSize', 'measurementsUnit', 'originSelect',
  'coordinateSystem', 'selXIn', 'selYIn', 'headingDeg', 'headingWrap',
  'robotLen', 'robotWid', 'boxRotate', 'javaType', 'exportKind',
  'exportFileType', 'className', 'exportFolderPath', 'segmentName',
  'exclusionEnabled'
];
let autosaveEnabled = false;
let storageWarningShown = false;

function reportStorageError(error) {
  if (storageWarningShown) return;
  storageWarningShown = true;
  console.warn('The workspace could not be saved in browser storage.', error);
}

export function saveAppState() {
  try {
    const controls = {};
    for (const id of CONTROL_IDS) {
      const element = document.getElementById(id);
      if (element) controls[id] = element.type === 'checkbox' ? element.checked : element.value;
    }
    const workspace = Object.fromEntries(STATE_KEYS.map(key => [key, state[key]]));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, workspace, controls }));
    return true;
  } catch (error) {
    reportStorageError(error);
    return false;
  }
}

export function restoreAppState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !validWorkspace(saved.workspace)) return null;
    for (const key of STATE_KEYS) {
      if (Object.hasOwn(saved.workspace, key)) state[key] = saved.workspace[key];
    }
    return saved;
  } catch (error) {
    // Unavailable storage or an incomplete/corrupt draft must not prevent boot.
    reportStorageError(error);
    return null;
  }
}

export function restoreControls(controls = {}) {
  for (const id of CONTROL_IDS) {
    const element = document.getElementById(id);
    const value = controls?.[id];
    if (!element) continue;
    if (element.type === 'checkbox') {
      if (typeof value === 'boolean') element.checked = value;
    } else if (typeof value === 'string') {
      if (element.tagName !== 'SELECT' || [...element.options].some(option => option.value === value)) {
        element.value = value;
      }
    }
  }
}

export function saveAfterImageLoad() {
  if (autosaveEnabled) saveAppState();
}

export function initPersistence() {
  autosaveEnabled = true;
  // These bubble after the editor's handlers, so additions, deletes, history,
  // selections, keyboard shortcuts and finished drags are saved immediately.
  for (const type of ['input', 'change', 'click', 'keyup', 'mouseup']) {
    window.addEventListener(type, saveAppState);
  }
  window.addEventListener('pagehide', saveAppState);
  window.addEventListener('beforeunload', saveAppState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveAppState();
  });
  saveAppState();
}

function validWorkspace(workspace) {
  if (!workspace || !Array.isArray(workspace.paths) || workspace.paths.length !== 4) return false;
  if (!Number.isInteger(workspace.activePath) || !workspace.paths[workspace.activePath]) return false;
  const validPosition = point => point && Number.isFinite(point.xPx) && Number.isFinite(point.yPx);
  if (!workspace.paths.every(path => path && typeof path.name === 'string' &&
    typeof path.color === 'string' && Array.isArray(path.points) &&
    path.points.every(point => validPosition(point) && Number.isFinite(point.headingRad) &&
      (!point.controlPoints || (Array.isArray(point.controlPoints) && point.controlPoints.every(validPosition)))) &&
    (!path.segments || (Array.isArray(path.segments) && path.segments.every(segment =>
      segment && typeof segment.id === 'string' && typeof segment.name === 'string'))))) return false;
  const config = workspace.fieldConfig;
  const robot = workspace.robotDimensions;
  if (!config || !['m', 'cm', 'ft', 'in'].includes(config.measurementUnit) ||
    !['center', 'bottomLeft', 'topLeft'].includes(config.origin) ||
    !['ftc', 'pedro', 'image'].includes(config.coordinateSystem) ||
    !Number.isFinite(config.fieldWidthM) || config.fieldWidthM <= 0 ||
    !Number.isFinite(config.fieldHeightM) || config.fieldHeightM <= 0 ||
    !robot || !Number.isFinite(robot.lengthM) || robot.lengthM < 0 ||
    !Number.isFinite(robot.widthM) || robot.widthM < 0) return false;
  const box = workspace.exclusionBox;
  if (box && ![box.start, box.end].every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return false;
  const source = workspace.imageSource;
  return !source || source.kind === 'upload' ||
    (source.kind === 'url' && typeof source.url === 'string' && !source.url.startsWith('blob:'));
}

function openImageDatabase() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open('ftc-path-planner', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function imageTransaction(mode, operation) {
  const database = await openImageDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('images', mode);
      const request = operation(transaction.objectStore('images'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveUploadedMap(file) {
  try {
    // Keep the original file, including SVGs and large maps, outside localStorage.
    await imageTransaction('readwrite', store => store.put(file, 'uploaded-map'));
    return true;
  } catch (error) {
    reportStorageError(error);
    return false;
  }
}

export async function readUploadedMap() {
  return imageTransaction('readonly', store => store.get('uploaded-map'));
}
