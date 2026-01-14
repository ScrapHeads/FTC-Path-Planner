import { els } from './els.js';
import {
  state,
  setPreviewEnabled,
  setPreviewIndex,
  stepPreview,
  getVisibleWaypointCount,
  pushHistory,
  undo,
  redo
} from './state.js';
import { layout, pxToField, fieldToImagePx } from './layout.js';
import { draw } from './draw.js';
import { normalize } from './utils.js';
import { updateAxesUI } from './els.js';
import { doExport } from './io_export.js';

export function initUI() {
  // Axes toggle
  els.axesFtc.addEventListener('change', () => {
    updateAxesUI();
    syncSelectedUI();
    updateTable();
    draw();
  });
  updateAxesUI();

  // Heading wrap toggle (±180 / ±π vs full)
  if (els.headingWrap) {
    els.headingWrap.addEventListener('change', () => {
      state.headingWrapHalf = !!els.headingWrap.checked;
      syncSelectedUI();
      updateTable();
      draw();
    });
    els.headingWrap.checked = !!state.headingWrapHalf;
  }

  // Panels
  installPreviewControls();
  installTransformControls(); // Mirror/Rotate panel

  // Undo
  els.undoBtn.addEventListener('click', () => {
    if (undo()) {
      clampPreviewAfterChange();
      refreshPreviewUI();
      syncSelectedUI();
      updateTable();
      draw();
    }
  });

  // Redo (hard-coded in index.html)
  els.redoBtn.addEventListener('click', () => {
    if (redo()) {
      clampPreviewAfterChange();
      refreshPreviewUI();
      syncSelectedUI();
      updateTable();
      draw();
    }
  });

  // Delete selected
  els.deleteBtn.addEventListener('click', () => {
    if (state.selected >= 0) {
      pushHistory();
      state.paths[state.activePath].points.splice(state.selected, 1);
      state.selected = Math.min(state.selected, state.paths[state.activePath].points.length - 1);
      clampPreviewAfterChange();
      refreshPreviewUI();
      syncSelectedUI();
      updateTable();
      draw();
    }
  });

  // Clear all
  els.clearBtn.addEventListener('click', () => {
    if (confirm('Clear selected path\'s points?')) {
      const path = state.paths[state.activePath];
      if (path.points.length) pushHistory();
      path.points = [];
      state.selected = -1;
      if (path.previewEnabled) path.previewIndex = -1;
      refreshPreviewUI();
      syncSelectedUI();
      updateTable();
      doExport();
      draw();
    }
  });

  els.clearAllBtn.addEventListener('click', () => {
    if (confirm('Clear all paths\' points?')) {
      state.paths.forEach(path => {
        if (path.points.length) pushHistory();
        path.points = [];
        path.previewIndex = -1;
      });
      state.selected = -1;
      refreshPreviewUI();
      syncSelectedUI();
      updateTable();
      doExport();
      draw();
    }
  });

  // Direct pose editing (blocked if locked)
  els.selXIn.addEventListener('change', () => {
    const path = state.paths[state.activePath];
    if (state.selected < 0 || !state.imgLoaded) return;
    if (path.points[state.selected].locked) return;
    pushHistory();
    const X = parseFloat(els.selXIn.value || '0');
    const Y = getSelY();
    const ip = fieldToImagePx(X, Y);
    path.points[state.selected].xPx = ip.x;
    path.points[state.selected].yPx = ip.y;
    updateTable();
    draw();
  });

  els.selYIn.addEventListener('change', () => {
    const path = state.paths[state.activePath];
    if (state.selected < 0 || !state.imgLoaded) return;
    if (path.points[state.selected].locked) return;
    pushHistory();
    const X = getSelX();
    const Y = parseFloat(els.selYIn.value || '0');
    const ip = fieldToImagePx(X, Y);
    path.points[state.selected].xPx = ip.x;
    path.points[state.selected].yPx = ip.y;
    updateTable();
    draw();
  });

  els.headingDeg.addEventListener('change', () => {
    const path = state.paths[state.activePath];
    if (state.selected < 0) return;
    if (path.points[state.selected].locked) return;
    pushHistory();
    const deg = parseFloat(els.headingDeg.value || '0');
    // Accept either form; we convert to radians then normalize internal storage
    const rad = deg * Math.PI / 180;
    path.points[state.selected].headingRad = normalize(rad);
    updateTable();
    draw();
  });

  els.path1Btn.addEventListener('click', () => {
    setActivePath(0);
  });

  els.path2Btn.addEventListener('click', () => {
    setActivePath(1);
  });

  els.path3Btn.addEventListener('click', () => {
    setActivePath(2);
  });

  els.path4Btn.addEventListener('click', () => {
    setActivePath(3);
  });

  // Robot footprint options
  els.robotLen.addEventListener('change', draw);
  els.robotWid.addEventListener('change', draw);
  els.boxRotate.addEventListener('change', draw);
}

export function setActivePath(idx) {
  state.activePath = idx;
  state.selected = -1;
  syncSelectedUI();
  // Highlight the selected path button, remove highlight from others
  [els.path1Btn, els.path2Btn, els.path3Btn, els.path4Btn].forEach((btn, i) => {
    if (btn) btn.classList.toggle(`active-path${i}`, i === idx);
  });
  refreshPreviewUI();
  draw();
  doExport();
  updateTable();
}

function installPreviewControls() {
  const path = state.paths[state.activePath];

  const left = document.querySelector('.left');
  const wrap = document.createElement('div');
  wrap.className = 'panel-group';
  wrap.style.marginTop = '10px';
  wrap.innerHTML = `
    <h2>Preview / Step-through</h2>
    <label class="row">
      <div class="custom-checkbox-wrapper">
        <input type="checkbox" id="previewToggle" class="hidden-checkbox" checked>
        <label for="previewToggle" class="custom-checkbox-label">
          <span class="custom-checkbox-box"></span>
          Enable preview
        </label>
      </div>
    </label>
    <div class="row">
      <button id="previewPrev" title="Previous [">Prev</button>
      <button id="previewNext" title="Next ]">Next</button>
      <button id="previewAll"  title="Show all \\ ">All</button>
      <button id="previewNone" title="Show none">None</button>
    </div>
    <div class="row">
      <input type="range" id="previewSlider" min="-1" max="-1" value="-1" step="1" style="width:100%">
    </div>
    <label class="row">
      <div class="custom-checkbox-wrapper">
        <input type="checkbox" id="dimFutureToggle" class="hidden-checkbox" checked>
        <label for="dimFutureToggle" class="custom-checkbox-label">
          <span class="custom-checkbox-box"></span>
          Dim future points
        </label>
      </div>
    </label>
    <small id="previewStatus" class="small"></small>
  `;
  // Place above "2) Waypoints"
  left.insertBefore(wrap, left.querySelector('h2:nth-of-type(2)'));

  const toggle = wrap.querySelector('#previewToggle');
  const prev = wrap.querySelector('#previewPrev');
  const next = wrap.querySelector('#previewNext');
  const allBtn = wrap.querySelector('#previewAll');
  const noneBtn = wrap.querySelector('#previewNone');
  const slider = wrap.querySelector('#previewSlider');
  const status = wrap.querySelector('#previewStatus');
  const dimChk = wrap.querySelector('#dimFutureToggle');

  toggle.addEventListener('change', () => {
    setPreviewEnabled(toggle.checked);
    if (toggle.checked && path.previewIndex < 0) setPreviewIndex(path.points.length - 1);
    refreshPreviewUI(); draw();
  });

  prev.addEventListener('click', () => { stepPreview(-1); refreshPreviewUI(); draw(); });
  next.addEventListener('click', () => { stepPreview(+1); refreshPreviewUI(); draw(); });
  allBtn.addEventListener('click', () => { setPreviewEnabled(true); setPreviewIndex(path.points.length - 1); refreshPreviewUI(); draw(); });
  noneBtn.addEventListener('click', () => { setPreviewEnabled(true); setPreviewIndex(-1); refreshPreviewUI(); draw(); });

  slider.addEventListener('input', () => {
    setPreviewIndex(parseInt(slider.value, 10));
    refreshPreviewUI(); draw();
  });

  dimChk.addEventListener('change', () => { state.dimFuture = dimChk.checked; draw(); });

  function _refresh() {
    const path = state.paths[state.activePath];
    slider.min = String(-1);
    slider.max = String(Math.max(-1, path.points.length - 1));
    slider.value = String(path.previewIndex);
    console.log('Preview UI refreshed');
    toggle.checked = path.previewEnabled;
    dimChk.checked = state.dimFuture;
    const vis = getVisibleWaypointCount();
    status.textContent = path.previewEnabled
      ? `Showing ${vis} of ${path.points.length} points (index ${path.previewIndex})`
      : `Preview disabled • ${path.points.length} points`;
  }
  refreshPreviewUI = _refresh;
  _refresh();
}

function installTransformControls() {
  const left = document.querySelector('.left');
  const wrap = document.createElement('div');
  wrap.className = 'panel-group';
  wrap.style.marginTop = '10px';
  wrap.innerHTML = `
    <h2>Transform (Mirror / Rotate)</h2>
    <div class="row">
      <button id="flipXBtn" title="Mirror across X axis (Y→-Y)">Mirror X</button>
      <button id="flipYBtn" title="Mirror across Y axis (X→-X)">Mirror Y</button>
    </div>
    <div class="row">
      <button id="rotCCWBtn" title="Rotate +90°">⟲ 90°</button>
      <button id="rotCWBtn"  title="Rotate -90°">⟳ 90°</button>
      <button id="rot180Btn" title="Rotate 180°">180°</button>
    </div>
    <small class="small">Transforms use current origin/axes and apply to all points.</small>
  `;
  // Place just below Preview panel (above "2) Waypoints")
  const anchor = left.querySelector('h2:nth-of-type(2)');
  left.insertBefore(wrap, anchor);

  const flipXBtn = wrap.querySelector('#flipXBtn');
  const flipYBtn = wrap.querySelector('#flipYBtn');
  const rotCCWBtn = wrap.querySelector('#rotCCWBtn');
  const rotCWBtn = wrap.querySelector('#rotCWBtn');
  const rot180Btn = wrap.querySelector('#rot180Btn');

  flipXBtn.addEventListener('click', () => { applyTransform('mirrorX'); });
  flipYBtn.addEventListener('click', () => { applyTransform('mirrorY'); });
  rotCCWBtn.addEventListener('click', () => { applyTransform('rotCCW'); });
  rotCWBtn.addEventListener('click', () => { applyTransform('rotCW'); });
  rot180Btn.addEventListener('click', () => { applyTransform('rot180'); });
}

// Will be set in installPreviewControls
let refreshPreviewUI = () => { };

export function updateTable() {
  els.pointRows.innerHTML = '';
  const path = state.paths[state.activePath];
  path.points.forEach((p, i) => {
    const { imgRect } = layout();
    const cx = imgRect.x + p.xPx * (imgRect.w / state.img.width);
    const cy = imgRect.y + p.yPx * (imgRect.h / state.img.height);
    const f = pxToField(cx, cy);
    const tr = document.createElement('tr');
    const degStr = formatDeg(p.headingRad).toFixed(1);
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${f.x.toFixed(2)}</td>
      <td>${f.y.toFixed(2)}</td>
      <td>${degStr}</td>
      <td>
        <div class="custom-checkbox-wrapper">
          <input type="checkbox" id="lock${i}" class="hidden-checkbox lock" data-idx="${i}" ${p.locked ? 'checked' : ''}>
          <label for="lock${i}" class="custom-checkbox-label">
            <span class="custom-checkbox-box"></span>
            lock
          </label>
        </div>
      </td>
      <td>
        <button class="sel" data-idx="${i}">Select</button>
        <button class="up" data-idx="${i}">▲</button>
        <button class="down" data-idx="${i}">▼</button>
      </td>`;
    if (i === state.selected) tr.style.background = '#0f1722';
    els.pointRows.appendChild(tr);
  });

  // Lock toggles
  els.pointRows.querySelectorAll('input.lock').forEach(inp => {
    inp.onchange = () => {
      const i = parseInt(inp.dataset.idx, 10);
      path.points[i].locked = inp.checked;
      draw();
    };
  });

  // Row actions
  els.pointRows.querySelectorAll('button.sel').forEach(btn => {
    btn.onclick = () => {
      state.selected = parseInt(btn.dataset.idx, 10);
      syncSelectedUI();
      draw();
    };
  });

  els.pointRows.querySelectorAll('button.up').forEach(btn => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i > 0) {
        pushHistory();
        swap(state.paths[state.activePath].points, i, i - 1);
        state.selected = (state.selected === i ? i - 1 : state.selected === i - 1 ? i : state.selected);
        clampPreviewAfterChange();
        refreshPreviewUI();
        updateTable();
        draw();
      }
    };
  });

  els.pointRows.querySelectorAll('button.down').forEach(btn => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.idx, 10);
      if (i < state.paths[state.activePath].points.length - 1) {
        pushHistory();
        swap(state.paths[state.activePath].points, i, i + 1);
        state.selected = (state.selected === i ? i + 1 : state.selected === i + 1 ? i : state.selected);
        clampPreviewAfterChange();
        refreshPreviewUI();
        updateTable();
        draw();
      }
    };
  });
}

export function syncSelectedUI() {
  if (state.selected < 0 || !state.imgLoaded) {
    els.selXIn.value = '';
    els.selYIn.value = '';
    els.headingDeg.value = '';
    return;
  }

  const { imgRect } = layout();
  const path = state.paths[state.activePath];
  const p = path.points[state.selected];
  const cx = imgRect.x + p.xPx * (imgRect.w / state.img.width);
  const cy = imgRect.y + p.yPx * (imgRect.h / state.img.height);
  const f = pxToField(cx, cy);
  els.selXIn.value = f.x.toFixed(2);
  els.selYIn.value = f.y.toFixed(2);
  els.headingDeg.value = formatDeg(p.headingRad).toFixed(1);
}

// ------------------------
// Transform helpers
// ------------------------
function applyTransform(kind) {
  const point = state.paths[state.activePath];
  if (!state.imgLoaded || point.points.length === 0) return;

  console.log('Applying transform:', kind);
  pushHistory();

  const { imgRect } = layout();
  // Map all points: image→canvas→field, transform, field→image
  point.points = point.points.map(p => {
    // image px -> canvas px
    const cx = imgRect.x + p.xPx * (imgRect.w / state.img.width);
    const cy = imgRect.y + p.yPx * (imgRect.h / state.img.height);

    // canvas px -> field (X,Y)
    const f = pxToField(cx, cy);
    const t = transformFieldPose(f.x, f.y, p.headingRad, kind);

    // field -> image px
    const ip = fieldToImagePx(t.x, t.y);
    return { xPx: ip.x, yPx: ip.y, headingRad: normalize(t.h), locked: p.locked };
  });

  // Keep selection & preview valid
  state.selected = Math.min(state.selected, point.points.length - 1);
  clampPreviewAfterChange();

  syncSelectedUI();
  updateTable();
  draw();
}

function transformFieldPose(x, y, h, kind) {
  switch (kind) {
    case 'mirrorX':   // flip across X axis: (x, y)->(x, -y), θ'=-θ
      return { x: x, y: -y, h: -h };
    case 'mirrorY':   // flip across Y axis: (x, y)->(-x, y), θ'=π-θ
      return { x: -x, y: y, h: Math.PI - h };
    case 'rotCCW':    // +90° CCW: (x, y)->(-y, x), θ'=θ+π/2
      return { x: -y, y: x, h: h + Math.PI / 2 };
    case 'rotCW':     // -90° CW: (x, y)->(y, -x), θ'=θ-π/2
      return { x: y, y: -x, h: h - Math.PI / 2 };
    case 'rot180':    // 180°: (x, y)->(-x, -y), θ'=θ+π
      return { x: -x, y: -y, h: h + Math.PI };
    default:
      return { x, y, h };
  }
}

function clampPreviewAfterChange() {
  if (state.previewEnabled && state.previewIndex > state.paths[state.activePath].points.length - 1) {
    state.previewIndex = state.paths[state.activePath].points.length - 1;
  }
}

function swap(arr, i, j) {
  const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
}
function getSelX() { return parseFloat(els.selXIn.value || '0'); }
function getSelY() { return parseFloat(els.selYIn.value || '0'); }

// Format degrees based on wrapping preference
function formatDeg(rad) {
  if (state.headingWrapHalf) {
    // -180…+180
    let d = (normalize(rad) * 180 / Math.PI);
    return d;
  } else {
    // 0…360
    let d = (rad * 180 / Math.PI) % 360;
    if (d < 0) d += 360;
    return d;
  }
}
