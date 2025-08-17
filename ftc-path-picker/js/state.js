// Shared mutable state
export const state = {
  img: new Image(),
  imgLoaded: false,
  points: [],            // { xPx, yPx, headingRad, locked? } in IMAGE px
  selected: -1,
  lastMouse: { x:0, y:0 },
  dragMode: null,        // 'move' | 'rotate' | null
  chosenDirHandle: null, // File System Access API directory handle (Chromium)

  // Preview / step-through
  previewEnabled: false,
  previewIndex: -1,      // -1 = show none; otherwise 0..points.length-1
  dimFuture: true,

  // Heading wrapping (off = 0..360 / 0..2π, on = ±180 / ±π)
  headingWrapHalf: false,

  // History
  _history: [],
  _future: [],
  _histMax: 100,

  // Measure tool
  measureActive: false,      // true while holding 'M'
  measureStart: { x:0, y:0}, // canvas px (snapped while measuring)
  measureEnd:   { x:0, y:0}, // canvas px (snapped while measuring)

  // Mini HUD
  hudVisible: true,

  // Hover label
  hoverActive: false,        // true when mouse idle on field
  hoverPos: { x:0, y:0 },    // canvas px
  _hoverTimer: null          // internal timer handle
};

// ---- Preview helpers ----
export function setPreviewEnabled(on){
  state.previewEnabled = !!on;
  if (!on) state.previewIndex = state.points.length - 1;
}

export function setPreviewIndex(idx){
  if (!state.points.length) { state.previewIndex = -1; return; }
  state.previewIndex = Math.max(-1, Math.min(idx, state.points.length - 1));
}

export function stepPreview(delta){ setPreviewIndex(state.previewIndex + delta); }

export function getVisibleWaypointCount(){
  if (!state.previewEnabled) return state.points.length;
  return Math.max(0, state.previewIndex + 1);
}

// ---- History helpers ----
function snapshot(){
  return {
    points: state.points.map(p => ({
      xPx:+p.xPx, yPx:+p.yPx, headingRad:+p.headingRad, locked: !!p.locked
    })),
    selected: state.selected,
    previewEnabled: state.previewEnabled,
    previewIndex: state.previewIndex,
    headingWrapHalf: state.headingWrapHalf
  };
}

function restore(snap){
  state.points = snap.points.map(p => ({
    xPx:+p.xPx, yPx:+p.yPx, headingRad:+p.headingRad, locked: !!p.locked
  }));
  state.selected = Math.min(Math.max(-1, snap.selected ?? -1), state.points.length - 1);
  state.previewEnabled = !!snap.previewEnabled;
  state.previewIndex = Math.min(Math.max(-1, snap.previewIndex ?? -1), state.points.length - 1);
  state.headingWrapHalf = !!snap.headingWrapHalf;
}

export function pushHistory(){
  state._history.push(snapshot());
  if (state._history.length > state._histMax) state._history.shift();
  state._future.length = 0;
}

export function undo(){
  if (!state._history.length) return false;
  const current = snapshot();
  const prev = state._history.pop();
  state._future.push(current);
  restore(prev);
  return true;
}

export function redo(){
  if (!state._future.length) return false;
  const current = snapshot();
  const next = state._future.pop();
  state._history.push(current);
  restore(next);
  return true;
}
