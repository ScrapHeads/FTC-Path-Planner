export const UNIT_TO_METERS = Object.freeze({
  m: 1,
  cm: 0.01,
  ft: 0.3048,
  in: 0.0254
});

export function normalizeUnit(unit) {
  return Object.prototype.hasOwnProperty.call(UNIT_TO_METERS, unit) ? unit : 'm';
}

export function toMeters(value, unit = 'm') {
  const n = Number(value);
  return Number.isFinite(n) ? n * UNIT_TO_METERS[normalizeUnit(unit)] : 0;
}

export function fromMeters(value, unit = 'm') {
  const n = Number(value);
  return Number.isFinite(n) ? n / UNIT_TO_METERS[normalizeUnit(unit)] : 0;
}

export function convertDistance(value, fromUnit, toUnit) {
  return fromMeters(toMeters(value, fromUnit), toUnit);
}

export function formatDistance(value) {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(6)).toString();
}
