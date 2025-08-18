import { els, canvas } from './els.js';
import {
  state,
  setPreviewEnabled, stepPreview, setPreviewIndex,
  pushHistory, undo, redo
} from './state.js';
import { draw } from './draw.js';
  import { layout, canvasToImagePx, pxToField, fieldToImagePx } from './layout.js';
import { normalize } from './utils.js';
import { updateTable, syncSelectedUI } from './ui.js';

export function initInteractions(){
  // Mouse down: select and start a drag (blocked if locked)
  canvas.addEventListener('mousedown', e=>{
    const m = mousePos(e); state.lastMouse = m;
    const hit = hitTest(m.x, m.y);
    if(hit && hit.type==='point'){
      if (state.points[hit.index].locked){
        state.selected = hit.index;
        state.dragMode = null;
        syncSelectedUI(); draw();
      } else {
        pushHistory();
        state.selected = hit.index;
        syncSelectedUI(); draw();
        state.dragMode = hit.handle ? 'rotate' : 'move';
      }
    } else {
      state.dragMode = null;
    }
  });

  // Mouse move: move/rotate if not locked; measure overlay; hover label timer
  window.addEventListener('mousemove', e=>{
    const m = mousePos(e); state.lastMouse = m;

    // Hover label: restart idle timer
    handleHoverIdle(m);

    // Measure tool: update with snapping
    if (state.measureActive){
      const snapIn = e.shiftKey ? 0.5 : 1.0;
      const startSnapped = snapCanvasToGrid(state.measureStart, snapIn);
      const endSnapped   = snapCanvasToGrid(m, snapIn);
      state.measureStart = startSnapped;
      state.measureEnd   = endSnapped;
      draw();
      return;
    }

    if(state.selected<0 || state.dragMode===null) return;
    if (state.points[state.selected].locked) return;

    if(state.dragMode==='move'){
      const imgPt = canvasToImagePx(m.x, m.y);
      if(e.shiftKey && state.imgLoaded){
        const {imgRect} = layout();
        const f = pxToField(
          imgRect.x + imgPt.x * (imgRect.w / state.img.width),
          imgRect.y + imgPt.y * (imgRect.h / state.img.height)
        );
        const Xs = Math.round(f.x / 0.5) * 0.5;
        const Ys = Math.round(f.y / 0.5) * 0.5;
        const ip = fieldToImagePx(Xs, Ys);
        state.points[state.selected].xPx = ip.x;
        state.points[state.selected].yPx = ip.y;
      } else {
        state.points[state.selected].xPx = imgPt.x;
        state.points[state.selected].yPx = imgPt.y;
      }
      syncSelectedUI(); updateTable(); draw();
    } else if(state.dragMode==='rotate'){
      const {imgRect} = layout();
      const p = state.points[state.selected];
      const cx = imgRect.x + p.xPx * (imgRect.w / state.img.width);
      const cy = imgRect.y + p.yPx * (imgRect.h / state.img.height);

      // Canvas angle: 0 along +X (right); increases CLOCKWISE because y is down
      const angCanvas = Math.atan2(m.y - cy, m.x - cx);

      // Convert to FIELD angle: 0 = North (up), CCW positive
      // θ_field = -angCanvas - π/2
      let angField = -angCanvas - Math.PI/2;

      // Snap (Shift=15°, Alt=5°) in FIELD frame
      const snap = e.shiftKey ? (15*Math.PI/180) : (e.altKey ? 5*Math.PI/180 : 0);
      if (snap) angField = Math.round(angField/snap)*snap;

      state.points[state.selected].headingRad = normalize(angField);
      els.headingDeg.value = formatDegForUI(state.points[state.selected].headingRad).toFixed(1);
      updateTable(); draw();
    }
  });

  window.addEventListener('mouseleave', ()=>{
    state.hoverActive = false;
    if (state._hoverTimer) { clearTimeout(state._hoverTimer); state._hoverTimer = null; }
    draw();
  });

  window.addEventListener('mouseup', ()=>{ state.dragMode=null; });

  // Keyboard
  window.addEventListener('keydown', e=>{
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT';

    // Measure start (hold M)
    if (!typing && (e.key==='m' || e.key==='M') && !state.measureActive){
      state.measureActive = true;
      const snapIn = e.shiftKey ? 0.5 : 1.0;
      state.measureStart = snapCanvasToGrid(state.lastMouse, snapIn);
      state.measureEnd   = state.measureStart;
      draw();
    }

    // Undo / Redo / Duplicate
    if (e.ctrlKey && !typing){
      if (e.key.toLowerCase() === 'z'){ e.preventDefault(); if (undo()){ syncSelectedUI(); updateTable(); draw(); } return; }
      if (e.key.toLowerCase() === 'y'){ e.preventDefault(); if (redo()){ syncSelectedUI(); updateTable(); draw(); } return; }
      if (e.key.toLowerCase() === 'd'){ // duplicate
        e.preventDefault();
        if (state.selected >= 0){
          pushHistory();
          const src = state.points[state.selected];
          const dup = { xPx:src.xPx, yPx:src.yPx, headingRad:src.headingRad, locked:false };
          state.points.splice(state.selected+1, 0, dup);
          state.selected = state.selected + 1;
          if (state.previewEnabled && state.previewIndex === state.points.length - 2) {
            state.previewIndex = state.points.length - 1;
          }
          syncSelectedUI(); updateTable(); draw();
        }
        return;
      }
    }

    if(e.key.toLowerCase()==='n' && !typing){
      e.preventDefault();
      if(state.imgLoaded) addPointAtCursor();
    }

    if(!typing && (e.key === 'Delete')){
      if (state.selected >= 0){
        pushHistory();
        state.points.splice(state.selected, 1);
        state.selected = Math.min(state.selected, state.points.length - 1);
        if (state.previewEnabled && state.previewIndex > state.points.length - 1){
          state.previewIndex = state.points.length - 1;
        }
        syncSelectedUI(); updateTable(); draw();
      }
    }

    // Q/E rotation: Q = CCW (+), E = CW (−)
    if(state.selected>=0 && (e.key.toLowerCase()==='q' || e.key.toLowerCase()==='e') && !typing){
      if (state.points[state.selected].locked) return;
      const dir = e.key.toLowerCase()==='q' ? +1 : -1;
      const base = e.shiftKey ? 15 : 5;
      const step = base * Math.PI/180;
      pushHistory();
      rotateSelected(dir*step); // CCW-positive in field
    }

    if(!typing){
      if(e.key === 'p' || e.key === 'P'){
        setPreviewEnabled(!state.previewEnabled);
        if (state.previewEnabled && state.previewIndex < 0) setPreviewIndex(state.points.length - 1);
        draw();
      } else if(e.key === ']'){
        stepPreview(+1); draw();
      } else if(e.key === '['){
        stepPreview(-1); draw();
      } else if(e.key === '\\'){
        setPreviewEnabled(true);
        setPreviewIndex(state.points.length - 1);
        draw();
      } else if(e.key === '/'){ // None
        setPreviewEnabled(true);
        setPreviewIndex(-1);
        draw();
      } else if(e.key === 'h' || e.key === 'H'){
        state.hudVisible = !state.hudVisible;
        draw();
      }
    }
  });

  window.addEventListener('keyup', e=>{
    if (state.measureActive && (e.key==='m' || e.key==='M')){
      state.measureActive = false;
      draw();
    }
  });
}

function addPointAtCursor(){
  if(!state.imgLoaded) return;
  const {imgRect} = layout();
  const within = state.lastMouse.x>=imgRect.x && state.lastMouse.x<=imgRect.x+imgRect.w &&
                 state.lastMouse.y>=imgRect.y && state.lastMouse.y<=imgRect.y+imgRect.h;
  const cx = within ? state.lastMouse.x : (imgRect.x + imgRect.w/2);
  const cy = within ? state.lastMouse.y : (imgRect.y + imgRect.h/2);
  const ip = canvasToImagePx(cx, cy);
  const initialHeading = state.selected>=0 ? state.points[state.selected].headingRad : 0;

  pushHistory();
  state.points.push({ xPx:ip.x, yPx:ip.y, headingRad:initialHeading, locked:false });
  state.selected = state.points.length-1;

  if (state.previewEnabled && state.previewIndex === state.points.length - 2) {
    state.previewIndex = state.points.length - 1;
  }

  syncSelectedUI(); updateTable(); draw();
}

function rotateSelected(dr){
  state.points[state.selected].headingRad = normalize(state.points[state.selected].headingRad + dr);
  els.headingDeg.value = formatDegForUI(state.points[state.selected].headingRad).toFixed(1);
  updateTable(); draw();
}

function hitTest(cx, cy){
  if(!state.imgLoaded) return null;
  const {imgRect} = layout();
  const within = cx>=imgRect.x && cx<=imgRect.x+imgRect.w && cy>=imgRect.y && cy<=imgRect.y+imgRect.h;
  for(let i=state.points.length-1;i>=0;i--){
    const p = state.points[i];
    const px = imgRect.x + p.xPx * (imgRect.w / state.img.width);
    const py = imgRect.y + p.yPx * (imgRect.h / state.img.height);

    const dx = cx - px, dy = cy - py;
    const dist = Math.hypot(dx,dy);
    if(dist < 10*(window.devicePixelRatio||1)){
      // Canvas angle corresponding to field heading: angC = -(θ + π/2)
      const angCanvas = -(p.headingRad + Math.PI/2);
      const hx = px + Math.cos(angCanvas) * 28*(window.devicePixelRatio||1);
      const hy = py + Math.sin(angCanvas) * 28*(window.devicePixelRatio||1);
      const hdist = Math.hypot(cx-hx, cy-hy);
      return { type:'point', index:i, handle:(hdist < 10*(window.devicePixelRatio||1)) };
    }
  }
  return within ? {type:'empty'} : null;
}

function mousePos(e){
  const r = canvas.getBoundingClientRect();
  const dpi = window.devicePixelRatio || 1;
  return { x:(e.clientX-r.left)*dpi, y:(e.clientY-r.top)*dpi };
}

// ---------- Helpers for snapping & hover ----------

function snapCanvasToGrid(canvasPt, inchStep){
  const f = pxToField(canvasPt.x, canvasPt.y);
  const xs = Math.round(f.x / inchStep) * inchStep;
  const ys = Math.round(f.y / inchStep) * inchStep;
  const ip = fieldToImagePx(xs, ys);
  const { imgRect } = layout();
  const cx = imgRect.x + ip.x * (imgRect.w / (state.img?.width || 1));
  const cy = imgRect.y + ip.y * (imgRect.h / (state.img?.height || 1));
  return { x: cx, y: cy };
}

function handleHoverIdle(m){
  state.hoverPos = m;
  state.hoverActive = false;

  if (state._hoverTimer) clearTimeout(state._hoverTimer);

  const { imgRect } = layout();
  const within = m.x>=imgRect.x && m.x<=imgRect.x+imgRect.w &&
                 m.y>=imgRect.y && m.y<=imgRect.y+imgRect.h;
  if (!within || !state.imgLoaded) {
    draw();
    return;
  }

  draw();

  state._hoverTimer = setTimeout(()=>{
    state.hoverActive = true;
    draw();
  }, 500);
}

// Degrees formatting for the Selected heading input
function formatDegForUI(rad){
  // Use UI’s wrap setting via state.headingWrapHalf (normalize already used for half-wrap)
  if (state.headingWrapHalf){
    let d = (normalize(rad) * 180 / Math.PI);
    return d;
  } else {
    let d = (rad * 180 / Math.PI) % 360;
    if (d < 0) d += 360;
    return d;
  }
}
