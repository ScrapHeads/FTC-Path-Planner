import { segmentMethodNames } from './segment_model.js';
import { getHeadingMode } from './path_model.js';

export const PEDRO_IMPORTS = [
  'com.pedropathing.api.PoseFactory',
  'com.pedropathing.api.Paths',
  'com.pedropathing.math.Pose',
  'com.pedropathing.paths.Path'
];

export function buildPedroJavaSegments(segments) {
  const names = segmentMethodNames(segments);
  const shared = new Map();
  return segments.map((segment, index) => {
    const name = names[index];
    const lines = [
      `// plannerSegment=${JSON.stringify({ name: segment.name, color: segment.color, method: name })}`,
      `private final PoseFactory ${name}Poses = PoseFactory.degrees();`
    ];
    const anchorNames = [];
    const controlNames = [];
    segment.points.forEach((point, pointIndex) => {
      const anchor = `${name}Point${pointIndex + 1}`;
      const id = segment.anchorIds?.[pointIndex];
      const existing = shared.get(id);
      anchorNames.push(existing || anchor);
      if (id) shared.set(id, existing || anchor);
      if (!existing) lines.push(`public final Pose ${anchor} = ${name}Poses.of(${number(point.x)}, ${number(point.y)}, ${number(point.headingRad * 180 / Math.PI)}); // role=anchor anchor=${pointIndex} locked=${!!point.locked}`);
      controlNames[pointIndex] = (pointIndex ? point.controlPoints || [] : []).map((control, controlIndex) => {
        const controlName = `${name}Control${pointIndex + 1}_${controlIndex + 1}`;
        lines.push(`private final Pose ${controlName} = ${name}Poses.of(${number(control.x)}, ${number(control.y)}, 0.000000000); // role=control anchor=${pointIndex} control=${controlIndex} locked=${!!control.locked}`);
        return controlName;
      });
    });
    if (segment.points.length >= 2) {
      const paths = anchorNames.slice(1).map((end, i) => {
        const start = anchorNames[i];
        const controls = controlNames[i + 1];
        const point = segment.points[i + 1];
        const mode = getHeadingMode(point);
        const interpolation = mode === 'tangent' ? 'tangent()'
          : mode === 'constant' ? `constant(${Number.isFinite(point.constantHeadingRad) ? number(point.constantHeadingRad) : end})`
          : `linear(${start}, ${end})`;
        return `Paths.${controls.length ? 'curve' : 'line'}(${[start, ...controls, end].join(', ')}).${interpolation}`;
      });
      const expression = paths.length === 1 ? paths[0] : `Paths.path(\n        ${paths.join(',\n        ')}\n    )`;
      lines.push('', `public Path ${name}() {`, `    return ${expression};`, '}');
    } else {
      if (anchorNames.length && segment.anchorIds) lines.push('// plannerSingle=' + anchorNames[0]);
      lines.push(`// Add at least two anchors to generate ${name}().`);
    }
    lines.push('// endPlannerSegment');
    return lines.join('\n');
  }).join('\n\n') || '// Add points to a segment to export its poses and path method.';
}

// Parse executable factory expressions and path references; comments only supply labels and locks.
export function parsePedroJavaSegments(text) {
  if (!/PoseFactory\s+\w+\s*=/.test(text)) return null;
  const graphFile = /^\s*\/\/\s*graph=/m.test(text);
  const poses = new Map();
  const factories = new Map();
  const factoryPattern = /PoseFactory\s+(\w+)\s*=\s*PoseFactory\.(degrees|radians)\s*\(\s*\)((?:\s*\.mirror[XY]\s*\(\s*[-+\d.eE]+\s*\))*)\s*;/g;
  for (const match of text.matchAll(factoryPattern)) {
    factories.set(match[1], { degrees: match[2] === 'degrees', mirrors: [...match[3].matchAll(/mirror([XY])\s*\(\s*([-+\d.eE]+)\s*\)/g)] });
  }
  const posePattern = /\bPose\s+(\w+)\s*=\s*(\w+)\.of\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)\s*;[^\r\n]*/g;
  for (const match of text.matchAll(posePattern)) {
    const factory = factories.get(match[2]);
    if (!factory) throw new Error(`Unsupported PoseFactory expression for ${match[2]}.`);
    const pose = { x: Number(match[3]), y: Number(match[4]), headingRad: Number(match[5]) * (factory.degrees ? Math.PI / 180 : 1), locked: /\blocked=true\b/.test(match[0]), controlPoints: [] };
    if (![pose.x, pose.y, pose.headingRad].every(Number.isFinite)) throw new Error(`Invalid pose ${match[1]}.`);
    for (const mirror of factory.mirrors) {
      if (mirror[1] === 'X') { pose.x = 2 * Number(mirror[2]) - pose.x; pose.headingRad = Math.PI - pose.headingRad; }
      else { pose.y = 2 * Number(mirror[2]) - pose.y; pose.headingRad = -pose.headingRad; }
    }
    if (poses.has(match[1])) throw Error('Duplicate pose declaration: ' + match[1]);
    poses.set(match[1], pose);
  }

  function readPaths(body) {
    const points = [];
    if (graphFile && /public\s+Path\b/.test(body)) {
      const expression = body.match(/public\s+Path\s+\w+\s*\(\s*\)\s*\{\s*return\s+([^;]+);\s*\}/)?.[1];
      const calls = expression?.replace(/Paths\.(line|curve)\s*\([^()]*\)\s*\.(linear|constant|tangent)\s*\([^()]*\)/g,'edge').trim();
      if (!(calls === 'edge' || /^Paths\.path\(\s*edge(?:\s*,\s*edge)*\s*\)$/.test(calls))) throw Error('Unsupported Pedro graph path expression.');
    }
    let previousEnd;
    for (const match of body.matchAll(/Paths\.(line|curve)\s*\(([^()]*)\)/g)) {
      const references = match[2].split(',').map(value => value.trim());
      if (references.length < 2 || (match[1] === 'line' && references.length !== 2)) throw new Error('Invalid Pedro path arguments.');
      const entries = references.map(reference => {
        const pose = poses.get(reference);
        if (!pose) throw new Error(`Unknown pose reference: ${reference}.`);
        return { ...pose, poseReference: reference, controlPoints: [] };
      });
      if (previousEnd && previousEnd !== references[0]) throw new Error('A segment contains disconnected paths.');
      if (!points.length) points.push(entries[0]);
      const end = entries[entries.length - 1];
      end.controlPoints = entries.slice(1, -1);
      const interpolation = body.slice(match.index + match[0].length).match(/^\s*\.(linear|tangent|constant)\s*\(([^()]*)\)/);
      const mode = interpolation?.[1] || 'tangent';
      if (graphFile && mode === 'linear' && interpolation[2].replace(/\s/g,'') !== [references[0],references.at(-1)].join(',')) throw Error('Unsupported linear heading references.');
      if (mode !== 'linear') end.headingMode = mode;
      if (mode === 'constant') {
        const argument = interpolation[2].trim();
        const heading = poses.has(argument) ? poses.get(argument).headingRad : Number(argument);
        if (!argument || !Number.isFinite(heading)) throw new Error(`Unsupported constant heading: ${argument}.`);
        if (Math.abs(heading - end.headingRad) > 1e-9) end.constantHeadingRad = heading;
      }
      points.push(end);
      previousEnd = references[references.length - 1];
    }
    return points;
  }

  const segments = [];
  const groupPattern = /\/\/ plannerSegment=([^\r\n]+)\r?\n([\s\S]*?)\/\/ endPlannerSegment/g;
  for (const match of text.matchAll(groupPattern)) {
    const metadata = JSON.parse(match[1]);
    const points = readPaths(match[2]);
    const single = match[2].match(/\/\/ plannerSingle=(\w+)/);
    if (single && !points.length && poses.has(single[1])) points.push({ ...poses.get(single[1]), poseReference: single[1], controlPoints: [] });
    if (!points.length) {
      for (const declaration of match[2].matchAll(posePattern)) {
        if (!/role=control\b/.test(declaration[0])) points.push({ ...poses.get(declaration[1]), controlPoints: [] });
      }
    }
    segments.push({ name: String(metadata.name || metadata.method || 'Segment'), color: metadata.color, points });
  }
  if (segments.length) return segments;
  // Accept generated methods with planner comments removed as well.
  for (const match of text.matchAll(/public\s+Path\s+(\w+)\s*\(\s*\)\s*\{([^{}]*)\}/g)) {
    const points = readPaths(match[2]);
    if (points.length) segments.push({ name: match[1], points });
  }
  if (!segments.length) throw new Error('No supported Pedro segment methods found.');
  return segments;
}

function number(value) {
  if (!Number.isFinite(Number(value))) throw new Error('Cannot export a non-finite pose coordinate.');
  return Number(value).toFixed(9);
}
