import { state } from './state.js';
import { imagePxToField } from './layout.js';
import { headingToCanonical } from './coordinates.js';
import { fromMeters } from './units.js';
import { isPedroPathingSelected } from './els.js';
import { pathCollisions } from './collision.js';

let cachedKey, cached;
const pathCache = new WeakMap();
export function collisionReport() {
  const settings = state.exclusionSettings;
  const zones = state.exclusionZones || [];
  const pedro = isPedroPathingSelected();
  const key = JSON.stringify([state.imgLoaded, state.img.width, state.img.height, state.fieldConfig, state.robotDimensions,
    pedro, settings, zones, state.paths.map(path => path.points)]);
  if (cachedKey === key) return cached;
  const active = state.imgLoaded && settings?.checkingEnabled && zones.some(zone => zone.enabled);
  const configuration = JSON.stringify([active, state.img.width, state.img.height, state.fieldConfig,
    state.robotDimensions, pedro, settings.marginIn, zones]);
  const options = { unit: 'in', origin: 'bottomLeft', coordinateSystem: 'pedro' };
  const paths = state.paths.map(path => {
    const key = JSON.stringify([configuration, path.points]);
    let entry = pathCache.get(path);
    if (entry?.key === key) return entry.report;
    if (!entry) { entry = { edges: {} }; pathCache.set(path, entry); }
    if (!active) {
      entry.key = key;
      entry.report = { anchors: path.points.map(() => []), connections: {}, headings: [] };
      return entry.report;
    }
    const points = path.points.map(point => ({ ...imagePxToField(point.xPx, point.yPx, options),
      headingRad: headingToCanonical(point.headingRad, state.fieldConfig.coordinateSystem),
      headingMode: pedro ? point.headingMode : 'linear',
      constantHeadingRad: Number.isFinite(point.constantHeadingRad) ? headingToCanonical(point.constantHeadingRad, state.fieldConfig.coordinateSystem) : undefined,
      breakBefore: point.breakBefore,
      controlPoints: pedro ? (point.controlPoints || []).map(control => imagePxToField(control.xPx, control.yPx, options)) : []
    }));
    entry.report = pathCollisions(points, zones, fromMeters(state.robotDimensions.lengthM, 'in'), fromMeters(state.robotDimensions.widthM, 'in'), settings.marginIn, entry.edges);
    entry.key = key;
    return entry.report;
  });
  cachedKey = key;
  cached = { active, paths, count: paths.reduce((sum, path) => sum + Object.keys(path.connections).length + path.anchors.filter(ids => ids.length).length, 0) };
  return cached;
}
