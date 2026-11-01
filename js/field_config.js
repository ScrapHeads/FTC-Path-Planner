import { els } from './els.js';
import { state } from './state.js';
import { formatDistance, fromMeters, normalizeUnit, toMeters } from './units.js';
import { canonicalToHeading, headingToCanonical } from './coordinates.js';

export { canonicalToHeading, headingToCanonical } from './coordinates.js';

export const FIELD_PRESETS = Object.freeze({
  'rr-into-the-deep': Object.freeze({
    id: 'rr-into-the-deep',
    label: 'RoadRunner Into the Deep',
    src: 'ReferenceImages/into-the-deep.png',
    measurementUnit: 'm',
    fieldWidth: 3.66,
    fieldHeight: 3.66,
    origin: 'center',
    coordinateSystem: 'ftc',
    javaLibrary: 'rr'
  }),
  'rr-decode': Object.freeze({
    id: 'rr-decode',
    label: 'RoadRunner DECODE',
    src: 'ReferenceImages/decode.webp',
    measurementUnit: 'm',
    fieldWidth: 3.66,
    fieldHeight: 3.66,
    origin: 'center',
    coordinateSystem: 'ftc',
    javaLibrary: 'rr'
  }),
  'pedro-decode': Object.freeze({
    id: 'pedro-decode',
    label: 'Pedro Pathing DECODE',
    src: 'ReferenceImages/pedroFieldImage.webp',
    measurementUnit: 'in',
    fieldWidth: 144,
    fieldHeight: 144,
    origin: 'bottomLeft',
    coordinateSystem: 'pedro',
    javaLibrary: 'pedro'
  }),
  'pedro-biobuzz': Object.freeze({
    id: 'pedro-biobuzz',
    label: 'Pedro Pathing Biobuzz',
    src: 'ReferenceImages/biobuzzPedropathing.webp',
    measurementUnit: 'in',
    fieldWidth: 144,
    fieldHeight: 144,
    origin: 'bottomLeft',
    coordinateSystem: 'pedro',
    javaLibrary: 'pedro'
  })
});

const LEGACY_PRESET_IDS = Object.freeze({
  'ReferenceImages\\into-the-deep.png': 'rr-into-the-deep',
  'ReferenceImages/into-the-deep.png': 'rr-into-the-deep',
  'ReferenceImages\\decode.webp': 'rr-decode',
  'ReferenceImages/decode.webp': 'rr-decode',
  'ReferenceImages\\pedroFieldImage.webp': 'pedro-decode',
  'ReferenceImages/pedroFieldImage.webp': 'pedro-decode'
});

const COMPACT_CONFIGS = Object.freeze({
  pedro: Object.freeze({ presetId: 'pedro-decode', library: 'pedro', format: 'pathchain' }),
  'pedro-segments': Object.freeze({ presetId: 'pedro-decode', library: 'pedro', format: 'posefactory', schemaVersion: 3 }),
  roadrunner: Object.freeze({ presetId: 'rr-into-the-deep', library: 'rr', format: 'list' }),
  'roadrunner-decode': Object.freeze({ presetId: 'rr-decode', library: 'rr', format: 'list' })
});

export function getCompactConfigMetadata(name) {
  const compact = COMPACT_CONFIGS[name];
  const preset = compact && FIELD_PRESETS[compact.presetId];
  if (!preset) return null;
  const robotSize = fromMeters(toMeters(18, 'in'), preset.measurementUnit);
  return {
    schemaVersion: compact.schemaVersion || 2,
    ...(compact.schemaVersion === 3 ? { className: 'AutoPath' } : {}),
    library: compact.library,
    format: compact.format,
    headingWrapHalf: false,
    presetId: preset.id,
    presetField: preset.src,
    measurementUnit: preset.measurementUnit,
    fieldSize: preset.fieldWidth,
    fieldWidth: preset.fieldWidth,
    fieldHeight: preset.fieldHeight,
    origin: preset.origin,
    coordinateSystem: preset.coordinateSystem,
    robotLen: robotSize,
    robotWid: robotSize,
    dataMeasurementUnit: preset.measurementUnit,
    dataOrigin: preset.origin,
    dataCoordinateSystem: preset.coordinateSystem
  };
}

export function findCompactConfig(metadata) {
  return Object.keys(COMPACT_CONFIGS).find(name => {
    const defaults = getCompactConfigMetadata(name);
    const keys = Object.keys(defaults);
    return Object.keys(metadata).length === keys.length && keys.every(key => metadataValuesEqual(metadata[key], defaults[key]));
  }) || '';
}

function metadataValuesEqual(left, right) {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-9;
  return left === right;
}

export function resolvePresetId(value) {
  if (!value || value === 'None') return '';
  return FIELD_PRESETS[value] ? value : (LEGACY_PRESET_IDS[value] || '');
}

export function getPreset(value) {
  return FIELD_PRESETS[resolvePresetId(value)] || null;
}

export function getPresetSource(value) {
  return getPreset(value)?.src || '';
}

export function initFieldConfigUI() {
  syncConfigUI();
}

export function syncConfigUI() {
  const cfg = state.fieldConfig;
  const unit = cfg.measurementUnit;
  if (els.measurementUnit) els.measurementUnit.value = unit;
  if (els.fieldSize) els.fieldSize.value = formatDistance(fromMeters(cfg.fieldWidthM, unit));
  if (els.robotLen) els.robotLen.value = formatDistance(fromMeters(state.robotDimensions.lengthM, unit));
  if (els.robotWid) els.robotWid.value = formatDistance(fromMeters(state.robotDimensions.widthM, unit));
  if (els.originSelect) els.originSelect.value = cfg.origin;
  if (els.coordinateSystem) els.coordinateSystem.value = cfg.coordinateSystem;
  if (els.sampleSelect) els.sampleSelect.value = cfg.presetId || '';
  const preset = getPreset(cfg.presetId);
  if (preset?.javaLibrary && els.javaType) els.javaType.value = preset.javaLibrary;
}

export function setMeasurementUnit(unit) {
  state.fieldConfig.measurementUnit = normalizeUnit(unit);
  syncConfigUI();
}

export function setFieldSizeFromDisplay(value) {
  const meters = toMeters(value, state.fieldConfig.measurementUnit);
  if (!(meters > 0)) return false;
  state.fieldConfig.fieldWidthM = meters;
  state.fieldConfig.fieldHeightM = meters;
  state.fieldConfig.presetId = '';
  return true;
}

export function setRobotDimensionsFromDisplay(length, width) {
  const unit = state.fieldConfig.measurementUnit;
  const lengthM = toMeters(length, unit);
  const widthM = toMeters(width, unit);
  if (lengthM >= 0) state.robotDimensions.lengthM = lengthM;
  if (widthM >= 0) state.robotDimensions.widthM = widthM;
}

export function setOrigin(origin) {
  if (!['center', 'bottomLeft', 'topLeft'].includes(origin)) return;
  state.fieldConfig.origin = origin;
  state.fieldConfig.presetId = '';
}

export function setCoordinateSystem(coordinateSystem, { preserveHeading = true } = {}) {
  if (!['ftc', 'pedro', 'image'].includes(coordinateSystem)) return;
  const previous = state.fieldConfig.coordinateSystem;
  if (coordinateSystem === previous) return;

  if (preserveHeading) {
    state.paths.forEach(path => {
      path.points.forEach(point => {
        const canonical = headingToCanonical(point.headingRad, previous);
        point.headingRad = canonicalToHeading(canonical, coordinateSystem);
        if (Number.isFinite(point.constantHeadingRad)) {
          point.constantHeadingRad = canonicalToHeading(headingToCanonical(point.constantHeadingRad, previous), coordinateSystem);
        }
      });
    });
  }
  state.fieldConfig.coordinateSystem = coordinateSystem;
  state.fieldConfig.presetId = '';
}

export function applyPresetConfig(value) {
  const preset = getPreset(value);
  if (!preset) return null;
  const previousSystem = state.fieldConfig.coordinateSystem;

  state.paths.forEach(path => {
    path.points.forEach(point => {
      const canonical = headingToCanonical(point.headingRad, previousSystem);
      point.headingRad = canonicalToHeading(canonical, preset.coordinateSystem);
      if (Number.isFinite(point.constantHeadingRad)) {
        point.constantHeadingRad = canonicalToHeading(headingToCanonical(point.constantHeadingRad, previousSystem), preset.coordinateSystem);
      }
    });
  });

  state.fieldConfig = {
    presetId: preset.id,
    measurementUnit: preset.measurementUnit,
    fieldWidthM: toMeters(preset.fieldWidth, preset.measurementUnit),
    fieldHeightM: toMeters(preset.fieldHeight, preset.measurementUnit),
    origin: preset.origin,
    coordinateSystem: preset.coordinateSystem
  };
  syncConfigUI();
  return preset;
}

export function applyMetadataConfig(meta = {}) {
  const preset = getPreset(meta.presetId || meta.presetField);
  if (preset) applyPresetConfig(preset.id);
  else if (Object.prototype.hasOwnProperty.call(meta, 'presetId') || Object.prototype.hasOwnProperty.call(meta, 'presetField')) {
    state.fieldConfig.presetId = '';
  }

  const unit = normalizeUnit(meta.measurementUnit || state.fieldConfig.measurementUnit);
  state.fieldConfig.measurementUnit = unit;

  const width = Number(meta.fieldWidth ?? meta.fieldSize);
  const height = Number(meta.fieldHeight ?? meta.fieldSize);
  if (width > 0) state.fieldConfig.fieldWidthM = toMeters(width, unit);
  if (height > 0) state.fieldConfig.fieldHeightM = toMeters(height, unit);
  if (['center', 'bottomLeft', 'topLeft'].includes(meta.origin)) state.fieldConfig.origin = meta.origin;
  if (['ftc', 'pedro', 'image'].includes(meta.coordinateSystem)) {
    setCoordinateSystem(meta.coordinateSystem);
  }

  const robotLen = Number(meta.robotLen);
  const robotWid = Number(meta.robotWid);
  if (robotLen >= 0) state.robotDimensions.lengthM = toMeters(robotLen, unit);
  if (robotWid >= 0) state.robotDimensions.widthM = toMeters(robotWid, unit);
  syncConfigUI();
  return preset;
}

export function getFieldMetadata() {
  const cfg = state.fieldConfig;
  const unit = cfg.measurementUnit;
  return {
    presetId: cfg.presetId || '',
    presetField: getPresetSource(cfg.presetId) || 'None',
    measurementUnit: unit,
    fieldSize: fromMeters(cfg.fieldWidthM, unit),
    fieldWidth: fromMeters(cfg.fieldWidthM, unit),
    fieldHeight: fromMeters(cfg.fieldHeightM, unit),
    origin: cfg.origin,
    coordinateSystem: cfg.coordinateSystem,
    robotLen: fromMeters(state.robotDimensions.lengthM, unit),
    robotWid: fromMeters(state.robotDimensions.widthM, unit)
  };
}
