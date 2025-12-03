import { els } from './els.js';
import { state } from './state.js';
import { fieldToImagePx } from './layout.js';
import { updateTable, syncSelectedUI } from './ui.js';
import { draw } from './draw.js';
import { pushHistory } from './state.js';
import { doExport } from './io_export.js';

export function initImport() {
  els.loadBtn.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.csv,.java,.txt,application/json,text/plain,text/csv';
    inp.onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const name = file.name.toLowerCase();
      const text = await file.text();
      try {
        pushHistory();
        await importWaypointsFromText(text, name);
        state.selected = state.points.length ? 0 : -1;
        syncSelectedUI(); updateTable(); draw();
      } catch (err) {
        console.error(err);
        alert('Could not load waypoints: ' + err.message);
      }
    };
    inp.click();
  });
}

async function importWaypointsFromText(text, filename) {
  if (!state.imgLoaded) {
    throw new Error('Load a field image first so points can be placed correctly.');
  }

  const ext = filename.split('.').pop();
  const lower = text.toLowerCase();

  // -------- JSON --------
  if (ext === 'json' || lower.trim().startsWith('{')) {
    els.exportFileType.value = 'json';
    const obj = JSON.parse(text);

    // Metadata: read from meta{} (preferred) or top-level fallback
    const meta = obj?.meta || {};
    const wrapVal = (meta.headingWrapHalf ?? obj?.headingWrapHalf);
    if (wrapVal !== undefined) {
      state.headingWrapHalf = !!wrapVal;
      if (els.headingWrap) els.headingWrap.checked = state.headingWrapHalf;
    }
    if (meta.fieldSize !== undefined) els.fieldSize.value = String(+meta.fieldSize);
    if (meta.robotLen !== undefined) els.robotLen.value = String(+meta.robotLen);
    if (meta.robotWid !== undefined) els.robotWid.value = String(+meta.robotWid);
    if (meta.measurementUnit !== undefined && els.measurementUnit) els.measurementUnit.value = meta.measurementUnit;

    if (Array.isArray(obj?.poses)) {
      // poses with headingRad and optional locked
      const poses = obj.poses.map(p => ({ x: +p.x, y: +p.y, h: +p.headingRad, locked: !!p.locked }));
      loadPosesIntoPoints(poses);
      return;
    }

    if (Array.isArray(obj?.points)) {
      // image-space points (legacy)
      state.points = obj.points.map(p => ({ xPx: +p.xPx, yPx: +p.yPx, headingRad: +p.headingRad || 0, locked: !!p.locked }));
      return;
    }

    if (Array.isArray(obj) && obj.length && ('x' in obj[0]) && ('y' in obj[0])) {
      const poses = obj.map(p => ({ x: +p.x, y: +p.y, h: +(p.headingRad || p.h || 0), locked: !!p.locked }));
      loadPosesIntoPoints(poses);
      return;
    }

    throw new Error('Unrecognized JSON structure.');
  }

  // -------- CSV --------
  if (ext === 'csv') {
    els.exportFileType.value = 'csv';
    const rawLines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!rawLines.length) throw new Error('CSV is empty.');

    // Comment metadata (e.g. "# key=value")
    let i = 0;
    while (i < rawLines.length && rawLines[i].startsWith('#')) {
      const line = rawLines[i];
      const kv = /#\s*([\w]+)\s*=\s*([^#\s]+)/.exec(line);
      if (kv) {
        const key = kv[1].toLowerCase();
        const val = kv[2];
        if (key === 'headingwraphalf') {
          state.headingWrapHalf = (String(val).toLowerCase() === 'true');
          if (els.headingWrap) els.headingWrap.checked = state.headingWrapHalf;
        } else if (key === 'fieldsize') {
          els.fieldSize.value = String(+val);
        } else if (key === 'robotlen') {
          els.robotLen.value = String(+val);
        } else if (key === 'robotwid') {
          els.robotWid.value = String(+val);
        } else if (key === 'measurementunit' && els.measurementUnit) {
          els.measurementUnit.value = val;
        }
      }
      i++;
    }

    const lines = rawLines.slice(i);
    if (!lines.length) throw new Error('CSV has no data rows.');

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const hasHeader = /x|y|heading/.test(lines[0].toLowerCase());
    const rows = lines.slice(hasHeader ? 1 : 0).map(r => r.split(',').map(v => v.trim()));

    const col = (name) => header.indexOf(name);

    const poses = rows.map(cols => {
      let x, y, hr, hd, locked = false;
      if (hasHeader) {
        const xi = col('x_in'); const yi = col('y_in');
        const xr = col('x'); const yr = col('y');
        const hri = col('heading_rad'); const hdi = col('heading_deg');
        const li = col('locked');
        x = parseFloat(cols[(xi >= 0 ? xi : xr >= 0 ? xr : 1)] ?? '0');
        y = parseFloat(cols[(yi >= 0 ? yi : yr >= 0 ? yr : 2)] ?? '0');
        hr = cols[(hri >= 0 ? hri : 3)];
        hd = cols[(hdi >= 0 ? hdi : 4)];
        if (li >= 0) locked = /^true$/i.test(cols[li]);
      } else {
        x = parseFloat(cols[1] ?? cols[0]);
        y = parseFloat(cols[2] ?? cols[1]);
        hr = cols[3];
        hd = cols[4];
        locked = /^true$/i.test(cols[5] || 'false');
      }
      const h = hr != null && hr !== '' ? parseFloat(hr) : (hd != null && hd !== '' ? parseFloat(hd) * Math.PI / 180 : 0);
      return { x, y, h, locked };
    });
    loadPosesIntoPoints(poses);
    return;
  }

  // -------- Java / TXT --------
  if (ext === 'java' || ext === 'txt' || lower.includes('pose2d')) {
    els.exportFileType.value = ext === 'java' ? 'java-class' : 'java-snippet';
    // ---------------------------
    // Header metadata extraction
    // ---------------------------
    const getKV = (k) => {
      const m = text.match(new RegExp(`${k}\\s*=\\s*([^\\n\\r]+)`, 'i'));
      return m ? m[1].trim() : undefined;
    };

    const wrap = getKV('headingWrapHalf');
    const fs = getKV('fieldSize');
    const rlen = getKV('robotLen');
    const rwid = getKV('robotWid');
    const munit = getKV('measurementUnit');
    const pkgMatch = text.match(/package\s+([\w\.]+)\s*;/);
    const classMatch = text.match(/class\s+(\w+)/);
    const importMatch = text.match(/import\s+([\w\.]+Pose2d)/);
    const arrayMatch = text.match(/public\s+static\s+final\s+Pose2d\[\]\s+PATH\s*=\s*new\s+Pose2d\[\]/);
    const listMatch = text.match(/public\s+static\s+final\s+List<Pose2d>\s+PATH\s*=\s*Arrays\.asList|List<Pose2d>\s+path\s*=\s*Arrays\.asList/);

    if (wrap !== undefined) {
      state.headingWrapHalf = (wrap.toLowerCase() === 'true');
      if (els.headingWrap) els.headingWrap.checked = state.headingWrapHalf;
    }
    if (fs !== undefined) els.fieldSize.value = String(+fs);
    if (rlen !== undefined) els.robotLen.value = String(+rlen);
    if (rwid !== undefined) els.robotWid.value = String(+rwid);
    if (munit !== undefined && els.measurementUnit) els.measurementUnit.value = munit;
    if (pkgMatch && els.packageName) els.packageName.value = pkgMatch[1];
    if (classMatch && els.className) els.className.value = classMatch[1];
    // Format detection: prefer explicit format, else detect by variable type
    if (arrayMatch && els.exportKind) {
      els.exportKind.value = 'array';
    } else if (listMatch && els.exportKind) {
      els.exportKind.value = 'list';
    }
    if (importMatch && els.javaType) {
      const imp = importMatch[1];
      if (imp.includes('acmerobotics')) els.javaType.value = 'rr';
      else if (imp.includes('ftclib')) els.javaType.value = 'ftclib';
      else if (imp.includes('RilLib')) els.javaType.value = 'RilLib';
    }

    // ----------------------------------------
    // Pose2d line parser
    // ----------------------------------------
    const poses = [];
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      // Only process lines that include a Pose2d constructor
      if (!/new\s+Pose2d\s*\(/.test(line)) continue;

      // Extract everything inside parentheses
      const inside = line.match(/new\s+Pose2d\s*\(([^)]*)\)/);
      if (!inside) continue;

      // Split by commas -> expect [x, y, rotation]
      const [xStr, yStr, rotStr] = inside[1].split(',').map(s => s.trim());

      const x = parseFloat(xStr);
      const y = parseFloat(yStr);

      // Parse rotation (either numeric or new Rotation2d(...))
      let h = 0;
      const rotMatch = rotStr?.match(/new\s*Rotation2d\s*\(\s*([-+]?\d*\.?\d+)\s*\)?/);
      
      if (rotMatch) {
        h = parseFloat(rotMatch[1]);
      } else if (rotStr) {
        h = parseFloat(rotStr);
      }

      // Check for locked=true/false in the same line or trailing comment
      const lockedMatch = line.match(/locked\s*=\s*(true|false)/i);
      const locked = lockedMatch ? lockedMatch[1].toLowerCase() === 'true' : false;

      // Only push if valid numbers
      if (Number.isFinite(x) && Number.isFinite(y)) {
        poses.push({ x, y, h: Number.isFinite(h) ? h : 0, locked });
      }
    }

    // ----------------------------------------
    // Validation and conversion
    // ----------------------------------------
    if (!poses.length) throw new Error('No Pose2d entries found in Java file.');
    loadPosesIntoPoints(poses);
    return;
  }

  throw new Error('Unsupported file type.');
}

function loadPosesIntoPoints(poses) {
  state.points = poses.map(p => {
    const ip = fieldToImagePx(p.x, p.y);
    return { xPx: ip.x, yPx: ip.y, headingRad: +p.h || 0, locked: !!p.locked };
  });
  console.log('Imported poses:', poses);
  doExport();
}
