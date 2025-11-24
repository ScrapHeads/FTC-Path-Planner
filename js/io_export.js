import { els, getMeasurementUnit, toMeters } from './els.js';
import { state } from './state.js';
import { layout, pxToField } from './layout.js';
import { normalize, sanitizeJavaIdent, sanitizeFileBase, mimeForName, wrapRadFull } from './utils.js';

export function initExport() {
  els.exportBtn.addEventListener('click', () => doExport());
  els.copyBtn.addEventListener('click', () => {
    doExport();
    const txt = els.output.textContent || '';
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(() => {
      els.copyBtn.textContent = 'Copied!';
      setTimeout(() => els.copyBtn.textContent = 'Copy to clipboard', 1000);
    });
  });

  const toggleJavaFields = () => {
    const isJavaClass = els.exportFileType.value === 'java-class';
    els.className.disabled = false;
    els.packageName.disabled = !isJavaClass;
  };
  els.exportFileType.addEventListener('change', toggleJavaFields);
  toggleJavaFields();

  if (els.chooseDirBtn) {
    els.chooseDirBtn.addEventListener('click', async () => {
      if (!window.showDirectoryPicker) {
        alert('Your browser does not support choosing a folder. Use "Save to file…" instead.');
        return;
      }
      try {
        state.chosenDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        els.chooseDirBtn.textContent = 'Folder selected';
        setTimeout(() => els.chooseDirBtn.textContent = 'Choose folder…', 1200);
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
      }
    });
  }

  if (els.saveFileBtn) {
    els.saveFileBtn.addEventListener('click', async () => {
      doExport();
      const payload = els.output._exportPayload;
      if (!payload) { alert('Nothing to save. Click Preview first.'); return; }

      try {
        if (state.chosenDirHandle && (await verifyWritableDir(state.chosenDirHandle))) {
          await writeIntoDirectory(state.chosenDirHandle, payload.suggestedName, payload.content);
        } else if (window.showSaveFilePicker) {
          const fileHandle = await window.showSaveFilePicker({ suggestedName: payload.suggestedName });
          const w = await fileHandle.createWritable();
          await w.write(payload.content);
          await w.close();
        } else {
          const blob = new Blob([payload.content], { type: payload.mime });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = payload.suggestedName;
          a.click();
          URL.revokeObjectURL(a.href);
        }
        els.saveFileBtn.textContent = 'Saved';
        setTimeout(() => els.saveFileBtn.textContent = 'Save to file…', 1200);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
          alert('Save failed: ' + err.message);
        }
      }
    });
  }
}

async function verifyWritableDir(dirHandle) {
  if (!dirHandle.requestPermission) return true;
  const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return true;
  const p2 = await dirHandle.requestPermission({ mode: 'readwrite' });
  return p2 === 'granted';
}

async function writeIntoDirectory(dirHandle, filename, content) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const w = await fileHandle.createWritable();
  await w.write(content);
  await w.close();
}

export function doExport() {
  const fieldSize = els.fieldSize.value || '144';
  const robotLen = els.robotLen.value || '18';
  const robotWid = els.robotWid.value || '18';
  const measurementUnit = getMeasurementUnit();
  console.log('Exporting with measurement unit:', measurementUnit);

  const poses = state.points.map((p, i) => {
    const { imgRect } = layout();
    const cx = imgRect.x + p.xPx * (imgRect.w / state.img.width);
    const cy = imgRect.y + p.yPx * (imgRect.h / state.img.height);
    const f = pxToField(cx, cy);

    const hNorm = normalize(p.headingRad);
    const h = state.headingWrapHalf ? hNorm : wrapRadFull(hNorm);

    return { i, x: f.x, y: f.y, h, locked: !!p.locked };
  });

  const cfg = {
    lib: els.javaType.value,            // 'rr' | 'ftclib' | 'RilLib'
    kind: els.exportKind.value,         // 'list' | 'array'
    fileType: els.exportFileType.value, // 'java-class' | 'java-snippet' | 'json' | 'csv'
    pkg: (els.packageName?.value || '').trim(),
    cls: (els.className?.value || 'AutoPath').trim(),
    fieldSize, robotLen, robotWid,
    measurementUnit
  };

  const { content, preview, suggestedName } = buildExportArtifacts(poses, cfg);

  els.output.textContent = preview;
  els.output._exportPayload = { content, suggestedName, mime: mimeForName(suggestedName) };
}

function getJavaExportConfig(lib) {
  switch (lib) {
    case 'rr':
      return {
        imports: ['com.acmerobotics.roadrunner.geometry.Pose2d'],
        poseCtor: (x, y, h) => `new Pose2d(${x}, ${y}, ${h})`
      };
    case 'ftclib':
      return {
        imports: ['com.arcrobotics.ftclib.geometry.Pose2d'],
        poseCtor: (x, y, h) => `new Pose2d(${x}, ${y}, ${h})`
      };
    case 'RilLib':
      return {
        imports: [
          'org.firstinspires.ftc.teamcode.RilLib.Math.Geometry.Pose2d',
          'org.firstinspires.ftc.teamcode.RilLib.Math.Geometry.Rotation2d'
        ],
        poseCtor: (x, y, h) => `new Pose2d(${x}, ${y}, new Rotation2d(${h}))`
      };
    default:
      throw new Error('Unknown library: ' + lib);
  }
}

function buildExportArtifacts(poses, cfg) {
  const { imports, poseCtor } = getJavaExportConfig(cfg.lib);
  const importLines = imports.map(i => `import ${i};`).join('\n');

  const className = sanitizeJavaIdent(cfg.cls || 'AutoPath');
  const fileBase = sanitizeFileBase(cfg.cls || 'AutoPath');

  // ---------- JSON ----------
  if (cfg.fileType === 'json') {
    const content = JSON.stringify({
      meta: {
        library: cfg.lib,
        format: cfg.kind,
        headingWrapHalf: !!state.headingWrapHalf,
        fieldSize: +cfg.fieldSize,
        robotLen: +cfg.robotLen,
        robotWid: +cfg.robotWid,
        measurementUnit: cfg.measurementUnit
      },
      poses: poses.map(p => ({ x: +p.x, y: +p.y, headingRad: +p.h, locked: !!p.locked }))
    }, null, 2);
    return { content, preview: content, suggestedName: `${fileBase}.json` };
  }

  // ---------- CSV ----------
  if (cfg.fileType === 'csv') {
    const lines = [
      `# headingWrapHalf=${!!state.headingWrapHalf}`,
      `# fieldSize=${+cfg.fieldSize}`,
      `# robotLen=${+cfg.robotLen}`,
      `# robotWid=${+cfg.robotWid}`,
      `# measurementUnit=${cfg.measurementUnit}`,
      'index,x_m,y_m,heading_rad,heading_deg,locked'
    ];
    poses.forEach((p, i) => {
      let deg = p.h * 180 / Math.PI;
      if (!state.headingWrapHalf) {
        deg = deg % 360; if (deg < 0) deg += 360;
      } else {
        if (deg <= -180) deg += 360;
        if (deg > 180) deg -= 360;
      }
      lines.push([i + 1, p.x.toFixed(3), p.y.toFixed(3), p.h.toFixed(6), deg.toFixed(3), p.locked ? 'true' : 'false'].join(','));
    });
    const csv = lines.join('\n');
    return { content: csv, preview: csv, suggestedName: `${fileBase}.csv` };
  }

  // ---------- Java (snippet/class) ----------
  const headerComment =
    `// headingWrapHalf=${!!state.headingWrapHalf}\n// fieldSize=${+cfg.fieldSize}\n// robotLen=${+cfg.robotLen}\n// robotWid=${+cfg.robotWid}\n// measurementUnit=${cfg.measurementUnit}\n`;

  const mUnit = getMeasurementUnit();

  const poseLines = poses.map((p, idx) => {
    let deg = p.h * 180 / Math.PI;
    if (!state.headingWrapHalf) { deg = deg % 360; if (deg < 0) deg += 360; }
    else { if (deg <= -180) deg += 360; if (deg > 180) deg -= 360; }
    const degStr = deg.toFixed(1);
    const comma = (idx < poses.length - 1) ? ',' : '';
    const lockTag = p.locked ? ' locked=true' : '';
    return `    ${poseCtor(p.x.toFixed(3), p.y.toFixed(3), p.h.toFixed(6))}${comma}  // #${idx + 1}  x=${p.x.toFixed(3)}${mUnit}, y=${p.y.toFixed(3)}${mUnit}, θ=${degStr}°${lockTag}`;
  }).join('\n');

  const snippet = (cfg.kind === 'list')
    ? `${headerComment}import java.util.*;
${importLines};

List<Pose2d> path = Arrays.asList(
${poseLines}
);`
    : `${headerComment}${importLines};

Pose2d[] path = new Pose2d[]{
${poseLines}
};`;

  if (cfg.fileType === 'java-snippet') {
    return { content: snippet + '\n', preview: snippet, suggestedName: `${fileBase}.java.txt` };
  }

  // java-class
  const pkgLine = cfg.pkg ? `package ${cfg.pkg};\n\n` : '';
  const bodyDecl = (cfg.kind === 'list')
    ? 'public static final List<Pose2d> PATH = Arrays.asList(\n' + poseLines + '\n);'
    : 'public static final Pose2d[] PATH = new Pose2d[]{\n' + poseLines + '\n};';

  const javaClass = `${pkgLine}${headerComment}import java.util.*;
${importLines}

public final class ${className} {
    private ${className}() {}

    ${bodyDecl}
}
`;
  return { content: javaClass, preview: javaClass, suggestedName: `${className}.java` };
}
