import { els } from './els.js';
import { state } from './state.js';
import { fieldToImagePx } from './layout.js';
import { updateTable, syncSelectedUI } from './ui.js';
import { draw } from './draw.js';
import { pushHistory } from './state.js';

export function initImport(){
  els.loadBtn.addEventListener('click', ()=>{
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.csv,.java,.txt,application/json,text/plain,text/csv';
    inp.onchange = async e=>{
      const file = e.target.files[0]; if(!file) return;
      const name = file.name.toLowerCase();
      const text = await file.text();
      try{
        pushHistory();
        await importWaypointsFromText(text, name);
        state.selected = state.points.length ? 0 : -1;
        syncSelectedUI(); updateTable(); draw();
      }catch(err){
        console.error(err);
        alert('Could not load waypoints: ' + err.message);
      }
    };
    inp.click();
  });
}

async function importWaypointsFromText(text, filename){
  if(!state.imgLoaded){
    throw new Error('Load a field image first so points can be placed correctly.');
  }

  const ext = filename.split('.').pop();
  const lower = text.toLowerCase();

  // -------- JSON --------
  if(ext==='json' || lower.trim().startsWith('{')){
    const obj = JSON.parse(text);

    // Metadata: read from meta{} (preferred) or top-level fallback
    const meta = obj?.meta || {};
    const wrapVal = (meta.headingWrapHalf ?? obj?.headingWrapHalf);
    if (wrapVal !== undefined){
      state.headingWrapHalf = !!wrapVal;
      if (els.headingWrap) els.headingWrap.checked = state.headingWrapHalf;
    }
    if (meta.fieldInches !== undefined)  els.fieldInches.value = String(+meta.fieldInches);
    if (meta.robotLenIn  !== undefined)  els.robotLenIn.value  = String(+meta.robotLenIn);
    if (meta.robotWidIn  !== undefined)  els.robotWidIn.value  = String(+meta.robotWidIn);

    if (Array.isArray(obj?.poses)) {
      // poses with headingRad and optional locked
      const poses = obj.poses.map(p => ({x:+p.x, y:+p.y, h:+p.headingRad, locked: !!p.locked}));
      loadPosesIntoPoints(poses);
      return;
    }

    if (Array.isArray(obj?.points)) {
      // image-space points (legacy)
      state.points = obj.points.map(p => ({xPx:+p.xPx, yPx:+p.yPx, headingRad:+p.headingRad||0, locked: !!p.locked}));
      return;
    }

    if (Array.isArray(obj) && obj.length && ('x' in obj[0]) && ('y' in obj[0])) {
      const poses = obj.map(p => ({x:+p.x, y:+p.y, h:+(p.headingRad||p.h||0), locked: !!p.locked}));
      loadPosesIntoPoints(poses);
      return;
    }

    throw new Error('Unrecognized JSON structure.');
  }

  // -------- CSV --------
  if(ext==='csv'){
    const rawLines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(!rawLines.length) throw new Error('CSV is empty.');

    // Comment metadata (e.g. "# key=value")
    let i = 0;
    while(i < rawLines.length && rawLines[i].startsWith('#')){
      const line = rawLines[i];
      const kv = /#\s*([\w]+)\s*=\s*([^#\s]+)/.exec(line);
      if (kv){
        const key = kv[1].toLowerCase();
        const val = kv[2];
        if (key === 'headingwraphalf'){
          state.headingWrapHalf = (String(val).toLowerCase() === 'true');
          if (els.headingWrap) els.headingWrap.checked = state.headingWrapHalf;
        } else if (key === 'fieldinches'){
          els.fieldInches.value = String(+val);
        } else if (key === 'robotlenin'){
          els.robotLenIn.value = String(+val);
        } else if (key === 'robotwidin'){
          els.robotWidIn.value = String(+val);
        }
      }
      i++;
    }

    const lines = rawLines.slice(i);
    if(!lines.length) throw new Error('CSV has no data rows.');

    const header = lines[0].split(',').map(h=>h.trim().toLowerCase());
    const hasHeader = /x|y|heading/.test(lines[0].toLowerCase());
    const rows = lines.slice(hasHeader ? 1 : 0).map(r => r.split(',').map(v=>v.trim()));

    const col = (name) => header.indexOf(name);

    const poses = rows.map(cols=>{
      let x, y, hr, hd, locked=false;
      if(hasHeader){
        const xi = col('x_in'); const yi = col('y_in');
        const xr = col('x');   const yr = col('y');
        const hri = col('heading_rad'); const hdi = col('heading_deg');
        const li = col('locked');
        x  = parseFloat(cols[(xi>=0?xi:xr>=0?xr:1)] ?? '0');
        y  = parseFloat(cols[(yi>=0?yi:yr>=0?yr:2)] ?? '0');
        hr = cols[(hri>=0?hri:3)];
        hd = cols[(hdi>=0?hdi:4)];
        if (li>=0) locked = /^true$/i.test(cols[li]);
      }else{
        x = parseFloat(cols[1] ?? cols[0]);
        y = parseFloat(cols[2] ?? cols[1]);
        hr = cols[3];
        hd = cols[4];
        locked = /^true$/i.test(cols[5] || 'false');
      }
      const h = hr!=null && hr!=='' ? parseFloat(hr) : (hd!=null && hd!=='' ? parseFloat(hd)*Math.PI/180 : 0);
      return {x, y, h, locked};
    });
    loadPosesIntoPoints(poses);
    return;
  }

  // -------- Java / TXT --------
  if(ext==='java' || ext==='txt' || lower.includes('pose2d')){
    // Header comments
    const getKV = (k) => {
      const m = text.match(new RegExp(`${k}\\s*=\\s*([^\\n\\r]+)`, 'i'));
      return m ? m[1].trim() : undefined;
    };
    const wrap = getKV('headingWrapHalf');
    const fin  = getKV('fieldInches');
    const rlen = getKV('robotLenIn');
    const rwid = getKV('robotWidIn');

    if (wrap !== undefined){
      state.headingWrapHalf = (wrap.toLowerCase() === 'true');
      if (els.headingWrap) els.headingWrap.checked = state.headingWrapHalf;
    }
    if (fin  !== undefined) els.fieldInches.value = String(+fin);
    if (rlen !== undefined) els.robotLenIn.value  = String(+rlen);
    if (rwid !== undefined) els.robotWidIn.value  = String(+rwid);

    // Pose lines
    const regex = /new\s+Pose2d\s*\(\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)\s*\).*?(locked\s*=\s*(true|false))?/g;
    const poses = [];
    let m;
    while((m = regex.exec(text)) !== null){
      const locked = m[5] ? (m[5].toLowerCase()==='true') : false;
      poses.push({x: parseFloat(m[1]), y: parseFloat(m[2]), h: parseFloat(m[3]), locked});
    }
    if(!poses.length) throw new Error('No Pose2d entries found in Java file.');
    loadPosesIntoPoints(poses);
    return;
  }

  throw new Error('Unsupported file type.');
}

function loadPosesIntoPoints(poses){
  state.points = poses.map(p=>{
    const ip = fieldToImagePx(p.x, p.y);
    return { xPx: ip.x, yPx: ip.y, headingRad: +p.h || 0, locked: !!p.locked };
  });
}
