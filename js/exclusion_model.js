// Zone coordinates always use bottom-left Pedro coordinates in inches.
export const BIOBUZZ_ZONES = [
  { id: 'biobuzz-left', name: 'Bio Buzz left obstacle', enabled: true, minX: 46.729208312026394, minY: 50.468574217842026, maxX: 49.07219562084514, maxY: 92.64234577657943 },
  { id: 'biobuzz-right', name: 'Bio Buzz right obstacle', enabled: true, minX: 95.26251685184326, minY: 51.13799916321883, maxX: 97.60550416066201, maxY: 92.64234577657943 }
];

export function defaultZones() { return BIOBUZZ_ZONES.map(zone => ({ ...zone })); }

export function normalizeZones(zones) {
  if (!Array.isArray(zones) || zones.length > 100) throw new Error('Use at most 100 exclusion zones.');
  const ids = new Set();
  return zones.map((zone, index) => {
    const values = ['minX', 'minY', 'maxX', 'maxY'].map(key => zone?.[key]);
    if (!values.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100000)) {
      throw new Error('Exclusion zone coordinates must be finite numbers in inches.');
    }
    const [x1, y1, x2, y2] = values;
    if (x1 === x2 || y1 === y2) throw new Error('Exclusion zones need a positive width and height.');
    let id = String(zone.id || `zone${index + 1}`);
    while (ids.has(id)) id += '_';
    ids.add(id);
    return { id, name: String(zone.name || `Zone ${index + 1}`).slice(0, 120), enabled: zone.enabled !== false,
      minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
  });
}

export function zoneDocument(zones, settings) {
  return { version: 1, coordinateSystem: 'pedro', unit: 'in', origin: 'bottomLeft',
    zones: normalizeZones(zones), checkingEnabled: settings.checkingEnabled, marginIn: settings.marginIn };
}

export function readZoneDocument(value) {
  const data = typeof value === 'string' ? JSON.parse(value) : value;
  if (!data || data.version !== 1 || data.unit !== 'in' || data.origin !== 'bottomLeft' || data.coordinateSystem !== 'pedro') {
    throw new Error('Unsupported exclusion zone coordinate format.');
  }
  const marginIn = data.marginIn ?? 0;
  if (!Number.isFinite(marginIn) || marginIn < 0 || marginIn > 144) throw new Error('Zone clearance must be between 0 and 144 inches.');
  return { zones: normalizeZones(data.zones), checkingEnabled: data.checkingEnabled !== false, marginIn };
}

export function buildJavaZones(zones) {
  return `public static final ExclusionZone[] EXCLUSION_ZONES = new ExclusionZone[] {\n${zones.filter(zone => zone.enabled).map(zone =>
    `    new ExclusionZone(${zone.minX}, ${zone.minY}, ${zone.maxX}, ${zone.maxY})`
  ).join(',\n')}\n};`;
}

// Read numeric constructor arguments, never execute imported Java.
export function parseImportedZones(metadata, text = '') {
  const saved = metadata.exclusionZones === undefined ? null : readZoneDocument(metadata.exclusionZones);
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '');
  const array = source.match(/\bEXCLUSION_ZONES\s*=\s*(?:new\s+ExclusionZone\s*\[\s*\]\s*)?\{([\s\S]*?)\}\s*;/);
  const constructorSource = array ? array[1] : source;
  const calls = [...constructorSource.matchAll(/new\s+ExclusionZone\s*\(([^()]*)\)/g)];
  if (!array && !calls.length) return saved;
  if (array && constructorSource.replace(/new\s+ExclusionZone\s*\([^()]*\)/g, '').replace(/[\s,]/g, '')) {
    throw new Error('EXCLUSION_ZONES must contain literal numeric ExclusionZone constructors.');
  }
  const enabled = saved?.zones.filter(zone => zone.enabled) || [];
  const zones = calls.map((call, index) => {
    const args = call[1].split(',').map(argument => argument.trim());
    if (args.length !== 4 || !args.every(argument => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[dD]?$/.test(argument))) {
      throw new Error('ExclusionZone constructors must contain four numeric coordinates.');
    }
    const [minX, minY, maxX, maxY] = args.map(argument => Number(argument.replace(/[dD]$/, '')));
    return { ...enabled[index], minX, minY, maxX, maxY, enabled: true };
  });
  let next = 0;
  const ordered = saved ? saved.zones.flatMap(zone => {
    if (!zone.enabled) return [zone];
    const replacement = zones[next++];
    return replacement ? [replacement] : [];
  }) : [];
  return { checkingEnabled: saved?.checkingEnabled ?? true, marginIn: saved?.marginIn ?? 0,
    zones: normalizeZones([...ordered, ...zones.slice(next)]) };
}
