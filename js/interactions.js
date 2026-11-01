import { els, canvas, isPedroPathingSelected } from './els.js';
import {
  state,
  setPreviewEnabled,
  stepPreview,
  setPreviewIndex,
  pushHistory,
  undo,
  redo
} from './state.js';
import { draw } from './draw.js';
import {
  layout,
  canvasToImagePx,
  pxToField,
  fieldToImagePx,
  headingToCanvasAngle,
  imagePxToCanvas
} from './layout.js';
import { normalize } from './utils.js';
import { canonicalToHeading, syncConfigUI } from './field_config.js';
import { fromMeters, toMeters } from './units.js';
import { createAnchor, removeAnchor, removeControlPoint, MAX_PATH_POINTS } from './path_model.js';
import { addPathSegment, ensurePathSegments, getSegmentPoints, pointInsertionIndex } from './segment_model.js';
import { updateTable, syncSelectedUI } from './ui.js';
import { startExclusionBox, moveExclusionBox, isExclusionDrawingEnabled } from './exclusion_zone.js';

export function initInteractions() {
  canvas.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    const mouse = mousePos(event);
    state.lastMouse = mouse;
    const hit = hitTest(mouse.x, mouse.y);
    const path = state.paths[state.activePath];
    state.dragMode = null;

    if (!hit) return;
    if (isPedroPathingSelected() && ['point', 'handle', 'control'].includes(hit.type)) {
      const point = path.points[hit.pointIndex ?? hit.index];
      const segments = ensurePathSegments(path);
      const current = segments[path.activeSegment];
      // Shared anchors keep the current segment when possible. Controls belong
      // to the incoming connection, so they always select that connection's owner.
      if (hit.type === 'control' || !current || !getSegmentPoints(path, current.id).includes(point)) {
        path.activeSegment = segments.findIndex(segment => segment.id === point.segmentId);
      }
    }
    if (hit.type === 'empty' && state.imgLoaded && isExclusionDrawingEnabled()) {
      startExclusionBox(mouse);
      state.dragMode = 'exclusion-box';
      event.preventDefault();
    } else if (hit.type === 'control') {
      state.selected = hit.pointIndex;
      state.selectedControl = { pointIndex: hit.pointIndex, controlIndex: hit.controlIndex };
      const control = path.points[hit.pointIndex].controlPoints[hit.controlIndex];
      if (!control.locked) {
        pushHistory();
        state.dragMode = 'move-control';
      }
    } else if (hit.type === 'handle') {
      state.selected = hit.index;
      state.selectedControl = null;
      if (!path.points[hit.index].locked) {
        pushHistory();
        state.dragMode = 'rotate';
      }
    } else if (hit.type === 'point') {
      state.selected = hit.index;
      state.selectedControl = null;
      if (!path.points[hit.index].locked) {
        pushHistory();
        state.dragMode = 'move-point';
      }
    }

    syncSelectedUI();
    updateTable();
    draw();
  });

  window.addEventListener('mousemove', event => {
    const mouse = mousePos(event);
    state.lastMouse = mouse;
    handleHoverIdle(mouse);
    if (!state.dragMode) return;
    if (state.dragMode === 'exclusion-box') {
      moveExclusionBox(mouse);
      draw();
      return;
    }

    const path = state.paths[state.activePath];
    if (state.dragMode === 'move-point') {
      const point = path.points[state.selected];
      if (!point || point.locked) return;
      const imagePoint = getDraggedImagePoint(mouse, event.shiftKey);
      point.xPx = imagePoint.x;
      point.yPx = imagePoint.y;
    } else if (state.dragMode === 'move-control') {
      const selection = state.selectedControl;
      const control = selection && path.points[selection.pointIndex]?.controlPoints?.[selection.controlIndex];
      if (!control || control.locked) return;
      const imagePoint = getDraggedImagePoint(mouse, event.shiftKey);
      control.xPx = imagePoint.x;
      control.yPx = imagePoint.y;
    } else if (state.dragMode === 'rotate') {
      const point = path.points[state.selected];
      if (!point || point.locked) return;
      const center = imagePxToCanvas(point.xPx, point.yPx);
      const canvasAngle = Math.atan2(mouse.y - center.y, mouse.x - center.x);
      let heading = canonicalToHeading(-canvasAngle, state.fieldConfig.coordinateSystem);
      const snap = event.shiftKey ? Math.PI / 12 : (event.altKey ? Math.PI / 36 : 0);
      if (snap) heading = Math.round(heading / snap) * snap;
      point.headingRad = normalize(heading);
    }

    syncSelectedUI();
    updateTable();
    draw();
  });

  window.addEventListener('mouseleave', () => {
    state.hoverActive = false;
    if (state._hoverTimer) clearTimeout(state._hoverTimer);
    state._hoverTimer = null;
    draw();
  });

  window.addEventListener('mouseup', event => {
    if (state.dragMode === 'exclusion-box') {
      moveExclusionBox(mousePos(event));
      draw();
    }
    state.dragMode = null;
  });

  window.addEventListener('keydown', event => {
    const tag = document.activeElement?.tagName || '';
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    const path = state.paths[state.activePath];

    if (event.ctrlKey && !typing) {
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (undo()) refreshAfterHistory();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        if (redo()) refreshAfterHistory();
        return;
      }
      if (key === 'd' && state.selected >= 0 && !state.selectedControl) {
        event.preventDefault();
        duplicateSelectedAnchor(path);
        return;
      }
    }

    if (!typing && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      addPointAtCursor();
      return;
    }

    if (!typing && event.key === 'Delete') {
      deleteSelection(path);
      return;
    }

    if (!typing && state.selected >= 0 && !state.selectedControl && ['q', 'e'].includes(event.key.toLowerCase())) {
      const point = path.points[state.selected];
      if (!point || point.locked) return;
      const direction = event.key.toLowerCase() === 'q' ? 1 : -1;
      const degrees = event.shiftKey ? 15 : 5;
      pushHistory();
      point.headingRad = normalize(point.headingRad + direction * degrees * Math.PI / 180);
      syncSelectedUI();
      updateTable();
      draw();
      return;
    }

    if (typing) return;
    if (event.key.toLowerCase() === 'p') {
      setPreviewEnabled(!path.previewEnabled);
      if (path.previewEnabled && path.previewIndex < 0) setPreviewIndex(path.points.length - 1);
    } else if (event.key === ']') {
      stepPreview(1);
    } else if (event.key === '[') {
      stepPreview(-1);
    } else if (event.key === '\\') {
      setPreviewEnabled(true);
      setPreviewIndex(path.points.length - 1);
    } else if (event.key === '/') {
      setPreviewEnabled(true);
      setPreviewIndex(-1);
    } else if (event.key.toLowerCase() === 'h') {
      state.hudVisible = !state.hudVisible;
    } else {
      return;
    }
    draw();
  });
}

function addPointAtCursor() {
  const path = state.paths[state.activePath];
  if (!state.imgLoaded || path.points.length >= MAX_PATH_POINTS) return;
  const { imgRect } = layout();
  const within = pointWithinImage(state.lastMouse, imgRect);
  const canvasPoint = within
    ? state.lastMouse
    : { x: imgRect.x + imgRect.w / 2, y: imgRect.y + imgRect.h / 2 };
  const imagePoint = canvasToImagePx(canvasPoint.x, canvasPoint.y);
  let segments = ensurePathSegments(path);
  const insertionIndex = isPedroPathingSelected() ? pointInsertionIndex(path) : path.points.length;
  const heading = insertionIndex > 0 ? path.points[insertionIndex - 1].headingRad : 0;

  pushHistory();
  const point = createAnchor(imagePoint.x, imagePoint.y, heading);
  if (!segments.length) {
    addPathSegment(path);
    segments = path.segments;
  }
  point.segmentId = isPedroPathingSelected()
    ? (segments[path.activeSegment] || segments[segments.length - 1]).id
    : path.points[path.points.length - 1]?.segmentId || segments[0].id;
  path.points.splice(insertionIndex, 0, point);
  state.selected = insertionIndex;
  state.selectedControl = null;
  if (path.previewEnabled && path.previewIndex === path.points.length - 2) {
    path.previewIndex = path.points.length - 1;
  }
  syncSelectedUI();
  updateTable();
  draw();
}

function duplicateSelectedAnchor(path) {
  const source = path.points[state.selected];
  if (!source || path.points.length >= MAX_PATH_POINTS) return;
  ensurePathSegments(path);
  pushHistory();
  const duplicate = createAnchor(source.xPx, source.yPx, source.headingRad, false, source.controlPoints, source.headingMode, source.constantHeadingRad);
  duplicate.segmentId = source.segmentId;
  path.points.splice(state.selected + 1, 0, duplicate);
  state.selected += 1;
  state.selectedControl = null;
  syncSelectedUI();
  updateTable();
  draw();
}

function deleteSelection(path) {
  if (state.selectedControl) {
    const { pointIndex, controlIndex } = state.selectedControl;
    const control = path.points[pointIndex]?.controlPoints?.[controlIndex];
    if (!control || control.locked) return;
    pushHistory();
    removeControlPoint(path, pointIndex, controlIndex);
    state.selectedControl = null;
  } else if (state.selected >= 0) {
    if (path.points[state.selected]?.locked) return;
    pushHistory();
    removeAnchor(path, state.selected);
    state.selected = Math.min(state.selected, path.points.length - 1);
  } else {
    return;
  }
  if (path.previewEnabled && path.previewIndex > path.points.length - 1) path.previewIndex = path.points.length - 1;
  syncSelectedUI();
  updateTable();
  draw();
}

function hitTest(canvasX, canvasY) {
  if (!state.imgLoaded) return null;
  const path = state.paths[state.activePath];
  const dpi = window.devicePixelRatio || 1;
  const radius = 10 * dpi;

  if (isPedroPathingSelected()) {
    for (let pointIndex = path.points.length - 1; pointIndex >= 1; pointIndex--) {
      const controls = path.points[pointIndex].controlPoints || [];
      for (let controlIndex = controls.length - 1; controlIndex >= 0; controlIndex--) {
        const canvasPoint = imagePxToCanvas(controls[controlIndex].xPx, controls[controlIndex].yPx);
        if (Math.hypot(canvasX - canvasPoint.x, canvasY - canvasPoint.y) <= radius) {
          return { type: 'control', pointIndex, controlIndex };
        }
      }
    }
  }

  for (let index = path.points.length - 1; index >= 0; index--) {
    const point = path.points[index];
    const canvasPoint = imagePxToCanvas(point.xPx, point.yPx);
    const angle = headingToCanvasAngle(point.headingRad);
    const handle = {
      x: canvasPoint.x + Math.cos(angle) * 28 * dpi,
      y: canvasPoint.y + Math.sin(angle) * 28 * dpi
    };
    if (Math.hypot(canvasX - handle.x, canvasY - handle.y) <= radius) return { type: 'handle', index };
    if (Math.hypot(canvasX - canvasPoint.x, canvasY - canvasPoint.y) <= radius) return { type: 'point', index };
  }

  const { imgRect } = layout();
  return pointWithinImage({ x: canvasX, y: canvasY }, imgRect) ? { type: 'empty' } : null;
}

function getDraggedImagePoint(canvasPoint, snap) {
  if (!snap) return canvasToImagePx(canvasPoint.x, canvasPoint.y);
  const field = pxToField(canvasPoint.x, canvasPoint.y);
  const step = fromMeters(toMeters(0.5, 'in'), state.fieldConfig.measurementUnit);
  return fieldToImagePx(
    Math.round(field.x / step) * step,
    Math.round(field.y / step) * step
  );
}

function mousePos(event) {
  const rect = canvas.getBoundingClientRect();
  const dpi = window.devicePixelRatio || 1;
  return { x: (event.clientX - rect.left) * dpi, y: (event.clientY - rect.top) * dpi };
}

function pointWithinImage(point, imgRect) {
  return point.x >= imgRect.x && point.x <= imgRect.x + imgRect.w &&
    point.y >= imgRect.y && point.y <= imgRect.y + imgRect.h;
}

function handleHoverIdle(mouse) {
  state.hoverPos = mouse;
  state.hoverActive = false;
  if (state._hoverTimer) clearTimeout(state._hoverTimer);
  const { imgRect } = layout();
  if (!state.imgLoaded || !pointWithinImage(mouse, imgRect)) {
    draw();
    return;
  }
  draw();
  state._hoverTimer = setTimeout(() => {
    state.hoverActive = true;
    draw();
  }, 500);
}

function refreshAfterHistory() {
  els.className.value = state.paths[state.activePath].className || 'AutoPath';
  syncConfigUI();
  syncSelectedUI();
  updateTable();
  draw();
}
