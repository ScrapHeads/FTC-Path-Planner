import { els } from './els.js';
import { state } from './state.js';
import { imagePxToField } from './layout.js';
import { findCompactConfig, getFieldMetadata, headingToCanonical } from './field_config.js';
import { normalize, sanitizeJavaIdent, sanitizeFileBase, mimeForName, wrapRadFull } from './utils.js';
import { buildPedroJavaSegments, PEDRO_IMPORTS } from './pedro_java.js';
import { MAX_PATH_POINTS, getHeadingMode, headingSettings } from './path_model.js';
import { saveExport } from './io_save.js';
import { ensurePathSegments, getSegmentPoints, samePose } from './segment_model.js';
import {
  javaPackageFromDirectoryHandle,
  javaPackageFromFolderPath,
  suggestJavaFolderPath
} from './java_package.js';

export function initExport() {
  els.exportBtn.addEventListener('click', doExport);
  els.copyBtn.addEventListener('click', () => {
    doExport();
    const text = els.output.textContent || '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      els.copyBtn.textContent = 'Copied!';
      setTimeout(() => { els.copyBtn.textContent = 'Copy to clipboard'; }, 1000);
    });
  });

  const updateExportControls = () => {
    const pedro = els.javaType.value === 'pedro';
    for (const option of els.exportKind.options) {
      option.disabled = pedro ? option.value !== 'posefactory' : ['posefactory', 'pathchain'].includes(option.value);
    }
    if (pedro) els.exportKind.value = 'posefactory';
    else if (['posefactory', 'pathchain'].includes(els.exportKind.value)) els.exportKind.value = 'list';
    doExport();
  };
  els.javaType.addEventListener('change', updateExportControls);
  els.exportKind.addEventListener('change', updateExportControls);
  els.exportFileType.addEventListener('change', updateExportControls);
  els.className.addEventListener('input', () => {
    state.paths[state.activePath].className = els.className.value;
    doExport();
  });
  els.exportFolderPath?.addEventListener('input', syncPackageFromFolderPath);
  updateExportControls();

  els.chooseDirBtn?.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      alert('Your browser does not support choosing a folder. Use "Save to file" instead.');
      return;
    }
    try {
      state.chosenDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const exposedPath = typeof state.chosenDirHandle.path === 'string'
        ? state.chosenDirHandle.path
        : '';
      const detectedPackage = exposedPath
        ? null
        : await javaPackageFromDirectoryHandle(state.chosenDirHandle);
      const currentFolderPath = (els.exportFolderPath?.value || '').trim();
      const selectedPath = exposedPath || detectedPackage || (currentFolderPath
        ? suggestJavaFolderPath(currentFolderPath, state.chosenDirHandle.name)
        : '');
      if (els.exportFolderPath) {
        if (!selectedPath) {
          els.exportFolderPath.setCustomValidity(
            'The browser hid this folder\'s parent path. Enter its Java path to set the full package.'
          );
          els.exportFolderPath.focus();
          alert(
            'Folder selected for saving, but its complete package could not be detected. ' +
            'Enter the Java folder path below; completely empty folders do not expose their parent path in browsers.'
          );
          return;
        }
        els.exportFolderPath.value = selectedPath;
        if (!syncPackageFromFolderPath()) {
          state.chosenDirHandle = null;
          alert('The selected path does not map to a valid Java package folder.');
          return;
        }
      }
      els.chooseDirBtn.textContent = 'Folder selected';
      setTimeout(() => { els.chooseDirBtn.textContent = 'Choose folder…'; }, 1200);
    } catch (error) {
      if (error.name !== 'AbortError') console.error(error);
    }
  });

  els.saveFileBtn?.addEventListener('click', async () => {
    doExport();
    const payload = els.output._exportPayload;
    if (!payload) return;
    try {
      const result = await saveExport(payload, state.chosenDirHandle);
      els.saveFileBtn.textContent = result === 'saved' ? 'Saved' : 'Download started';
      setTimeout(() => { els.saveFileBtn.textContent = 'Save to file…'; }, 1200);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(error);
        alert(`Save failed: ${error.message}`);
      }
    }
  });
}

export function doExport() {
  if (!els.output) return;
  const config = {
    library: els.javaType.value,
    format: els.exportKind.value,
    fileType: els.exportFileType.value,
    packageName: resolvePackageName(),
    className: (els.className.value || 'AutoPath').trim()
  };
  if (config.library === 'pedro') {
    config.format = 'posefactory';
    config.segments = collectSegmentData();
  } else if (['posefactory', 'pathchain'].includes(config.format)) config.format = 'list';
  const pedroCoordinates = config.library === 'pedro' || config.format === 'pathchain';
  const pathData = config.format === 'posefactory' ? [] : collectPathData(pedroCoordinates);
  const artifacts = buildExportArtifacts(pathData, config);
  els.output.textContent = artifacts.preview;
  els.output._exportPayload = {
    content: artifacts.content,
    suggestedName: artifacts.suggestedName,
    mime: mimeForName(artifacts.suggestedName)
  };
}

function syncPackageFromFolderPath() {
  if (!els.exportFolderPath) return false;
  const packageName = resolvePackageName();
  if (packageName === null) {
    return false;
  }
  doExport();
  return true;
}

function resolvePackageName() {
  const folderPath = (els.exportFolderPath?.value || '').trim();
  if (!folderPath) {
    els.exportFolderPath?.setCustomValidity('');
    return '';
  }

  const packageName = javaPackageFromFolderPath(folderPath);
  if (packageName === null) {
    els.exportFolderPath.setCustomValidity('Use a Java folder such as org\\firstinspires\\ftc\\teamcode\\auto\\paths.');
    return null;
  }

  els.exportFolderPath.setCustomValidity('');
  state.chosenDirPath = folderPath;
  return packageName;
}

export function collectSegmentData(path = state.paths[state.activePath]) {
  return ensurePathSegments(path).map(segment => {
    const points = collectPathData(true, { points: getSegmentPoints(path, segment.id) });
    if (points[0]) points[0].controlPoints = [];
    return { name: segment.name, color: segment.color || path.color, points };
  });
}

export function collectPathData(pedroCoordinates = false, path = state.paths[state.activePath]) {
  const options = pedroCoordinates
    ? { unit: 'in', origin: 'bottomLeft', coordinateSystem: 'pedro' }
    : {};
  return path.points.map((point, index) => {
    const field = imagePxToField(point.xPx, point.yPx, options);
    const rawHeading = pedroCoordinates
      ? headingToCanonical(point.headingRad, state.fieldConfig.coordinateSystem)
      : point.headingRad;
    const heading = formatHeadingRad(rawHeading);
    return {
      index,
      x: field.x,
      y: field.y,
      headingRad: heading,
      ...(pedroCoordinates ? headingSettings({ ...point, constantHeadingRad: Number.isFinite(point.constantHeadingRad)
        ? formatHeadingRad(headingToCanonical(point.constantHeadingRad, state.fieldConfig.coordinateSystem)) : undefined }) : {}),
      locked: !!point.locked,
      controlPoints: (pedroCoordinates ? point.controlPoints || [] : []).map((control, controlIndex) => {
        const controlField = imagePxToField(control.xPx, control.yPx, options);
        return {
          index: controlIndex,
          x: controlField.x,
          y: controlField.y,
          locked: !!control.locked
        };
      })
    };
  });
}

export function buildExportArtifacts(pathData, config) {
  if (config.library === 'pedro' && config.format === 'posefactory') {
    return buildSegmentExport(config.segments || [{ name: 'Segment 1', color: '#7dd3fc', points: pathData }], config);
  }
  const supportsControls = config.library === 'pedro' || config.format === 'pathchain';
  if (!supportsControls) {
    pathData = pathData.map(point => ({ ...point, controlPoints: [] }));
  }
  const className = sanitizeJavaIdent(config.className || 'AutoPath');
  const fileBase = sanitizeFileBase(config.className || 'AutoPath');
  const metadata = buildMetadata(config);

  if (config.fileType === 'json') {
    const content = JSON.stringify({
      meta: metadata,
      poses: pathData.map(point => ({
        x: point.x,
        y: point.y,
        headingRad: point.headingRad,
        locked: point.locked,
        controlPoints: point.controlPoints.map(control => ({
          x: control.x,
          y: control.y,
          locked: control.locked
        }))
      }))
    }, null, 2);
    return { content, preview: content, suggestedName: `${fileBase}.json` };
  }

  if (config.fileType === 'csv') {
    const lines = metadataCommentLines(metadata, '# ');
    lines.push('role,anchor_index,control_index,x,y,heading_rad,heading_deg,locked');
    pathData.forEach(point => {
      lines.push([
        'anchor', point.index, '', fixed(point.x, 6), fixed(point.y, 6),
        fixed(point.headingRad, 9), fixed(point.headingRad * 180 / Math.PI, 6), point.locked
      ].join(','));
      point.controlPoints.forEach(control => {
        lines.push([
          'control', point.index, control.index, fixed(control.x, 6), fixed(control.y, 6), '', '', control.locked
        ].join(','));
      });
    });
    const content = lines.join('\n');
    return { content, preview: content, suggestedName: `${fileBase}.csv` };
  }

  const javaConfig = getJavaExportConfig(config.library);
  const plannerComments = buildPlannerDataComments(pathData, metadata);
  const javaBody = config.format === 'pathchain'
    ? buildPedroPathChain(pathData, config.fileType === 'java-class')
    : buildPoseCollection(pathData, config, javaConfig);
  const imports = javaConfig.imports.map(name => `import ${name};`).join('\n');

  if (config.fileType === 'java-snippet') {
    const content = `${plannerComments}\n${imports}\n\n${javaBody}\n`;
    return { content, preview: content, suggestedName: `${fileBase}.java.txt` };
  }

  const packageLine = config.packageName ? `package ${config.packageName};\n\n` : '';
  const content = `${packageLine}${plannerComments}\n${imports}\n\npublic final class ${className} {
    private ${className}() {}

${indent(javaBody, 4)}
}
`;
  return { content, preview: content, suggestedName: `${className}.java` };
}

function buildSegmentExport(segments, config) {
  let pointCount = 0;
  let previousEnd;
  for (const segment of segments) {
    pointCount += segment.points.length - (samePose(previousEnd, segment.points[0]) ? 1 : 0);
    if (segment.points.length) previousEnd = segment.points[segment.points.length - 1];
  }
  if (pointCount > MAX_PATH_POINTS) throw new Error(`A path cannot contain more than ${MAX_PATH_POINTS} anchor points across its segments.`);
  const metadata = buildMetadata(config);
  const className = sanitizeJavaIdent(config.className || 'AutoPath');
  const fileBase = sanitizeFileBase(config.className || 'AutoPath');
  if (config.fileType === 'json') {
    const content = JSON.stringify({ meta: metadata, segments: segments.map(segment => ({ name: segment.name, color: segment.color, poses: segment.points })) }, null, 2);
    return { content, preview: content, suggestedName: `${fileBase}.json` };
  }
  if (config.fileType === 'csv') {
    const lines = metadataCommentLines(metadata, '# ');
    lines.push('segment_index,segment_name,segment_color,role,anchor_index,control_index,x,y,heading_rad,heading_deg,locked,heading_mode,constant_heading_rad');
    const row = values => values.map(csvCell).join(',');
    segments.forEach((segment, segmentIndex) => {
      const prefix = [segmentIndex, segment.name, segment.color || ''];
      if (!segment.points.length) lines.push(row([...prefix, 'segment', '', '', '', '', '', '', '', '', '']));
      segment.points.forEach((point, index) => {
        lines.push(row([...prefix, 'anchor', index, '', fixed(point.x, 9), fixed(point.y, 9), fixed(point.headingRad, 12), fixed(point.headingRad * 180 / Math.PI, 9), !!point.locked, getHeadingMode(point), point.constantHeadingRad ?? '']));
        (point.controlPoints || []).forEach((control, controlIndex) => {
          lines.push(row([...prefix, 'control', index, controlIndex, fixed(control.x, 9), fixed(control.y, 9), '', '', !!control.locked, '', '']));
        });
      });
    });
    const content = lines.join('\n');
    return { content, preview: content, suggestedName: `${fileBase}.csv` };
  }
  const comments = metadataCommentLines(metadata, '// ').join('\n');
  const imports = PEDRO_IMPORTS.map(name => `import ${name};`).join('\n');
  const body = buildPedroJavaSegments(segments);
  if (config.fileType === 'java-snippet') {
    const content = `${comments}\n${imports}\n\n${body}\n`;
    return { content, preview: content, suggestedName: `${fileBase}.java.txt` };
  }
  const packageLine = config.packageName ? `package ${config.packageName};\n\n` : '';
  const content = `${packageLine}${comments}\n${imports}\n\npublic final class ${className} {\n${indent(body, 4)}\n}\n`;
  return { content, preview: content, suggestedName: `${className}.java` };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildPoseCollection(pathData, config, javaConfig) {
  const entries = [];
  pathData.forEach(point => {
    if (config.library === 'pedro' && point.index > 0) {
      point.controlPoints.forEach(control => {
        entries.push({
          expression: javaConfig.poseConstructor(control.x, control.y, 0, true),
          comment: `role=control anchor=${point.index} control=${control.index} locked=${control.locked}`
        });
      });
    }
    entries.push({
      expression: javaConfig.poseConstructor(point.x, point.y, point.headingRad, false),
      comment: `role=anchor anchor=${point.index} locked=${point.locked}`
    });
  });

  const typeName = javaConfig.typeName;
  const poseLines = entries.map((entry, index) =>
    `${entry.expression}${index < entries.length - 1 ? ',' : ''} // ${entry.comment}`
  ).join('\n');
  const declarationPrefix = config.fileType === 'java-class' ? 'public static final ' : '';
  const variableName = config.fileType === 'java-class' ? 'PATH' : 'path';
  if (config.format === 'array') {
    return `${declarationPrefix}${typeName}[] ${variableName} = new ${typeName}[]{\n${indent(poseLines, 4)}\n};`;
  }
  return `${declarationPrefix}List<${typeName}> ${variableName} = Arrays.asList(\n${indent(poseLines, 4)}\n);`;
}

function buildPedroPathChain(pathData, forClass) {
  const builderLines = [];
  for (let index = 1; index < pathData.length; index++) {
    const start = pathData[index - 1];
    const end = pathData[index];
    const controls = end.controlPoints;
    const curveType = controls.length ? 'BezierCurve' : 'BezierLine';
    const poses = [
      { expression: `new Pose(${fixed(start.x)}, ${fixed(start.y)})`, locked: start.locked },
      ...controls.map(control => ({
        expression: `new Pose(${fixed(control.x)}, ${fixed(control.y)})`,
        locked: control.locked
      })),
      { expression: `new Pose(${fixed(end.x)}, ${fixed(end.y)})`, locked: end.locked }
    ].map((pose, poseIndex, entries) =>
      `${pose.expression}${poseIndex < entries.length - 1 ? ',' : ''} // locked=${pose.locked}`
    ).join('\n');
    builderLines.push(`.addPath(new ${curveType}(\n${indent(poses, 4)}\n))`);
    builderLines.push(`.setLinearHeadingInterpolation(${fixed(start.headingRad, 9)}, ${fixed(end.headingRad, 9)})`);
  }
  const chain = `follower.pathBuilder()\n${indent(builderLines.join('\n'), 4)}\n    .build()`;
  if (forClass) {
    return `public static PathChain buildPath(Follower follower) {\n    return ${chain};\n}`;
  }
  return `PathChain path = ${chain};`;
}

function getJavaExportConfig(library) {
  if (library === 'pedro') {
    return {
      typeName: 'Pose',
      imports: [
        'java.util.Arrays', 'java.util.List',
        'com.pedropathing.geometry.Pose', 'com.pedropathing.geometry.BezierLine',
        'com.pedropathing.geometry.BezierCurve', 'com.pedropathing.follower.Follower',
        'com.pedropathing.paths.PathChain'
      ],
      poseConstructor: (x, y, heading, control) => control
        ? `new Pose(${fixed(x)}, ${fixed(y)})`
        : `new Pose(${fixed(x)}, ${fixed(y)}, ${fixed(heading, 9)})`
    };
  }
  if (library === 'ftclib') {
    return {
      typeName: 'Pose2d',
      imports: ['java.util.Arrays', 'java.util.List', 'com.arcrobotics.ftclib.geometry.Pose2d', 'com.arcrobotics.ftclib.geometry.Rotation2d'],
      poseConstructor: (x, y, heading) => `new Pose2d(${fixed(x)}, ${fixed(y)}, new Rotation2d(${fixed(heading, 9)}))`
    };
  }
  if (library === 'RilLib') {
    return {
      typeName: 'Pose2d',
      imports: ['java.util.Arrays', 'java.util.List', 'org.firstinspires.ftc.teamcode.RilLib.Math.Geometry.Pose2d', 'org.firstinspires.ftc.teamcode.RilLib.Math.Geometry.Rotation2d'],
      poseConstructor: (x, y, heading) => `new Pose2d(${fixed(x)}, ${fixed(y)}, new Rotation2d(${fixed(heading, 9)}))`
    };
  }
  return {
    typeName: 'Pose2d',
    imports: ['java.util.Arrays', 'java.util.List', 'com.acmerobotics.roadrunner.Pose2d'],
    poseConstructor: (x, y, heading) => `new Pose2d(${fixed(x)}, ${fixed(y)}, ${fixed(heading, 9)})`
  };
}

function buildMetadata(config) {
  const field = getFieldMetadata();
  const pedro = config.library === 'pedro' || config.format === 'pathchain';
  return {
    schemaVersion: config.format === 'posefactory' ? 3 : 2,
    ...(config.format === 'posefactory' ? { className: sanitizeJavaIdent(config.className || 'AutoPath') } : {}),
    library: config.library,
    format: config.format,
    headingWrapHalf: state.headingWrapHalf,
    ...field,
    dataMeasurementUnit: pedro ? 'in' : field.measurementUnit,
    dataOrigin: pedro ? 'bottomLeft' : field.origin,
    dataCoordinateSystem: pedro ? 'pedro' : field.coordinateSystem
  };
}

function buildPlannerDataComments(pathData, metadata) {
  const lines = metadataCommentLines(metadata, '// ');
  const compactConfig = findCompactConfig(metadata);
  const isPedroJava = metadata.library === 'pedro' || metadata.format === 'pathchain';
  if (compactConfig || isPedroJava) return lines.join('\n');

  pathData.forEach(point => {
    lines.push(`// plannerPoint=anchor|${point.index}|${point.x}|${point.y}|${point.headingRad}|${point.locked}`);
    point.controlPoints.forEach(control => {
      lines.push(`// plannerPoint=control|${point.index}|${control.index}|${control.x}|${control.y}|${control.locked}`);
    });
  });
  return lines.join('\n');
}

function metadataCommentLines(metadata, prefix) {
  const compactConfig = findCompactConfig(metadata);
  if (compactConfig) return [`${prefix}config=${compactConfig}`];
  return Object.entries(metadata).map(([key, value]) => `${prefix}${key}=${value}`);
}

function formatHeadingRad(heading) {
  const normalized = normalize(heading);
  return state.headingWrapHalf ? normalized : wrapRadFull(normalized);
}

function fixed(value, digits = 3) {
  return Number(value || 0).toFixed(digits);
}

function indent(text, spaces) {
  const padding = ' '.repeat(spaces);
  return String(text).split('\n').map(line => padding + line).join('\n');
}
