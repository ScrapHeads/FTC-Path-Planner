// Shared mutable state
export const PATH_COLORS = ['#666666', '#FD3DB5', '#81c784', '#ffb74d']; // silver, magenta, green, orange

export const state = {
  // Up to 4 path objects, each with its own metadata and points
  paths: [
    {
      name: "Path 1",
      color: PATH_COLORS[0],
      points: [],
      previewEnabled: false,
      previewIndex: -1,
    },
    {
      name: "Path 2",
      color: PATH_COLORS[1],
      points: [],
      previewEnabled: false,
      previewIndex: -1,
    },
    {
      name: "Path 3",
      color: PATH_COLORS[2],
      points: [],
      previewEnabled: false,
      previewIndex: -1,
    },
    {
      name: "Path 4",
      color: PATH_COLORS[3],
      points: [],
      previewEnabled: false,
      previewIndex: -1,
    }
  ],
  activePath: 0, // Index of the currently selected path

  img: new Image(),
  imgLoaded: false,

  selected: -1,
  lastMouse: { x:0, y:0 },
  dragMode: null,
  chosenDirHandle: null,

  // Heading wrapping (off = 0..360 / 0..2π, on = ±180 / ±π)
  headingWrapHalf: false,

  // History
  _history: [],
  _future: [],
  _histMax: 100,

  // Measure tool
  measureActive: false,
  measureStart: { x:0, y:0 },
  measureEnd:   { x:0, y:0 },

  // Mini HUD
  hudVisible: true,

  // Hover label
  hoverActive: false,
  hoverPos: { x:0, y:0 },
  _hoverTimer: null
};

// ---- Preview helpers ----
export function setPreviewEnabled(on){
  const path = state.paths[state.activePath];
  path.previewEnabled = !!on;
  if (!on) path.previewIndex = path.points.length - 1;
}

export function setPreviewIndex(idx){
  const path = state.paths[state.activePath];
  if (!path.points.length) { path.previewIndex = -1; return; }
  path.previewIndex = Math.max(-1, Math.min(idx, path.points.length - 1));
}

export function stepPreview(delta){ setPreviewIndex(state.paths[state.activePath].previewIndex + delta); }

export function getVisibleWaypointCount(){
  const path = state.paths[state.activePath];
  if (!path.previewEnabled) return path.points.length;
  return Math.max(0, path.previewIndex + 1);
}

// ---- History helpers ----
function snapshot(){
  return {
    paths: state.paths.map(path => ({
      name: path.name,
      color: path.color,
      points: path.points.map(p => ({
        xPx:+p.xPx, yPx:+p.yPx, headingRad:+p.headingRad, locked: !!p.locked
      })),
      previewEnabled: !!path.previewEnabled,
      previewIndex: path.previewIndex
    })),
    activePath: state.activePath,
    headingWrapHalf: state.headingWrapHalf
  };
}

function restore(snap){
  state.paths = snap.paths.map(path => ({
    name: path.name,
    color: path.color,
    points: path.points.map(p => ({
      xPx:+p.xPx, yPx:+p.yPx, headingRad:+p.headingRad, locked: !!p.locked
    })),
    previewEnabled: !!path.previewEnabled,
    previewIndex: path.previewIndex
  }));
  state.activePath = Math.max(0, Math.min(snap.activePath ?? 0, state.paths.length - 1));
  state.selected = -1;
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
