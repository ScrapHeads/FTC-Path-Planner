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
import { appendAnchor, bindGraph, canExtend, focusRejoin, extendRejoinedEnd, incoming, outgoing, focusedRoute } from './branch_graph.js';
import { createAnchor, removeAnchor, removeControlPoint, MAX_PATH_POINTS } from './path_model.js';
import { addPathSegment, ensurePathSegments, focusPointSegment, getSegmentPoints, pointInsertionIndex } from './segment_model.js';
import { addConnectionControl, cancelForkPlacement, placeForkPoint, updateTable, syncSelectedUI, refreshDraggedRow } from './ui.js';
import { startExclusionBox, moveExclusionBox, finishExclusionBox, isExclusionDrawingEnabled } from './exclusion_zone.js';

let pendingDragFrame = null;
function renderDragFrame() {
  pendingDragFrame = null;
  if (!state.dragMode) return;
  syncSelectedUI();
  refreshDraggedRow();
  draw({ updateExport: false });
}
function scheduleDragFrame() {
  if (pendingDragFrame !== null) return;
  if (typeof requestAnimationFrame === 'function') pendingDragFrame = requestAnimationFrame(renderDragFrame);
  else renderDragFrame();
}

function selectFieldHit(path, hit) {
  let index = hit.pointIndex ?? hit.index;
  const control = hit.type === 'control';
  if (isPedroPathingSelected()) {
    if (!control) index = focusRejoin(path, index);
    focusPointSegment(path, index, control);
  }
  state.selected = index;
  state.selectedControl = control ? { pointIndex: index, controlIndex: hit.controlIndex } : null;
}

export function initInteractions() {
  let overlapPress = null;
  window.addEventListener('blur', () => { overlapPress = null; });
  canvas.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    overlapPress = null;
    if (document.activeElement?.matches?.('input, textarea, select')) document.activeElement.blur();
    const mouse = mousePos(event);
    state.lastMouse = mouse;
    if (state.branchPlacement) {
      event.preventDefault();
      if (pointWithinImage(mouse, layout().imgRect)) {
        const point = canvasToImagePx(mouse.x, mouse.y);
        placeForkPoint(point.x, point.y);
      }
      return;
    }
    const path = state.paths[state.activePath];
    const hits = hitTest(mouse.x, mouse.y);
    state.dragMode = null;
    if (!hits.length) return;
    const selected = hits.find(hit => {
      if (hit.type === 'control') return state.selectedControl?.pointIndex === hit.pointIndex &&
        state.selectedControl.controlIndex === hit.controlIndex;
      if (hit.type === 'empty' || state.selectedControl) return false;
      return hit.index === state.selected || (path.graph &&
        path.points[hit.index].anchorId === path.points[state.selected]?.anchorId);
    });
    const hit = selected || hits[0];
    if (hit.type === 'empty') {
      if (isExclusionDrawingEnabled()) {
        startExclusionBox(mouse);
        state.dragMode = 'exclusion-box';
        event.preventDefault();
      }
    } else {
      selectFieldHit(path, hit);
      if (selected) {
        const point = path.points[state.selected];
        const entity = hit.type === 'control' ? point.controlPoints[hit.controlIndex] : point;
        const mode = { point: 'move-point', handle: 'rotate', control: 'move-control' }[hit.type];
        if (hits.length > 1) {
          // Use stable waypoint order even when selecting a different active section
          // changes the draw order. Keep the current entity until click vs drag is known.
          hits.sort((a,b) => (a.pointIndex ?? a.index) - (b.pointIndex ?? b.index) ||
            (a.controlIndex ?? -1) - (b.controlIndex ?? -1));
          overlapPress = { path, mouse, next: hits[(hits.indexOf(hit)+1) % hits.length], mode, entity };
        } else if (!entity.locked) {
          pushHistory();
          state.dragMode = mode;
        }
      }
    }

    syncSelectedUI();
    updateTable();
    draw();
  });

  window.addEventListener('mousemove', event => {
    const mouse = mousePos(event);
    state.lastMouse = mouse;
    if (overlapPress) {
      const press = overlapPress;
      if (Math.hypot(mouse.x-press.mouse.x, mouse.y-press.mouse.y) < 3*(window.devicePixelRatio || 1)) return;
      overlapPress = null;
      if (press.path === state.paths[state.activePath] && !press.entity.locked) {
        pushHistory();
        state.dragMode = press.mode;
      }
    }
    handleHoverIdle(mouse);
    if (!state.dragMode) return;
    if (state.dragMode === 'exclusion-box') {
      moveExclusionBox(mouse);
      scheduleDragFrame();
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

    scheduleDragFrame();
  });

  window.addEventListener('mouseleave', () => {
    state.hoverActive = false;
    if (state._hoverTimer) clearTimeout(state._hoverTimer);
    state._hoverTimer = null;
    draw();
  });

  window.addEventListener('mouseup', event => {
    if (overlapPress && event.button !== undefined && event.button !== 0) return;
    if (overlapPress) {
      const {path,next} = overlapPress;
      overlapPress = null;
      if (path === state.paths[state.activePath]) {
        selectFieldHit(path,next);
        syncSelectedUI(); updateTable(); draw();
      }
    }
    const wasDragging = !!state.dragMode;
    if (pendingDragFrame !== null) {
      cancelAnimationFrame(pendingDragFrame);
      pendingDragFrame = null;
    }
    if (state.dragMode === 'exclusion-box') {
      moveExclusionBox(mousePos(event));
      finishExclusionBox();
    }
    state.dragMode = null;
    if (wasDragging) { syncSelectedUI(); updateTable(); draw(); }
  });

  window.addEventListener('keydown', event => {
    overlapPress = null;
    if (state.branchPlacement) {
      if (event.key === 'Escape') cancelForkPlacement();
      return;
    }
    if (document.querySelector?.('dialog[open], [popover]:popover-open')) return;
    if (event.key.toLowerCase() === 'c') {
      const target = document.activeElement;
      if (!event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey &&
          !['INPUT','TEXTAREA','SELECT'].includes(target?.tagName) && !target?.isContentEditable &&
          !event.target?.closest?.('#previewPanel') && addConnectionControl()) event.preventDefault();
      return;
    }
    // Section selection leaves keyboard focus in the sidebar. Let N place at the
    // field cursor without requiring a click that could select a different section.
    const sectionPicker = event.target?.closest?.('#segmentSelect, #insertAfter, #routeChoices select');
    const navigator = event.target?.closest?.('#routesPanel');
    if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey &&
        (sectionPicker || navigator) && canvas.matches?.(':hover') &&
        !document.querySelector?.('select:open') &&
        (sectionPicker || !event.target.closest('input, textarea, select'))) {
      event.preventDefault();
      addPointAtCursor();
      return;
    }
    if (event.target?.closest?.('#dock, #previewPanel, #routesPanel, #inspectorDivider')) return;
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
  if (!state.imgLoaded || (path.graph?.anchors.length ?? path.points.length) >= MAX_PATH_POINTS) return;
  const { imgRect } = layout();
  const within = pointWithinImage(state.lastMouse, imgRect);
  const canvasPoint = within
    ? state.lastMouse
    : { x: imgRect.x + imgRect.w / 2, y: imgRect.y + imgRect.h / 2 };
  const imagePoint = canvasToImagePx(canvasPoint.x, canvasPoint.y);
  let segments = ensurePathSegments(path);
  const pedro = isPedroPathingSelected();
  if (path.graph && !state.selectedControl) state.selected = focusRejoin(path,state.selected);
  const activeSegment = pedro ? segments[path.activeSegment] : null;
  const section = path.graph && activeSegment;
  if (path.graph && !section) return;
  const anchor = state.selectedControl ? null : path.points[state.selected];
  const atRejoin = section && anchor && incoming(path.graph,anchor.anchorId).length > 1;
  const extendSharedEnd = atRejoin && !outgoing(path.graph,anchor.anchorId).length;
  if (section?.finished && !atRejoin) {
    els.segmentStatus.textContent = 'Choose Extend ending to add more anchors.';
    return;
  }
  // A shared junction stays last in this section and first in its continuations.
  const sectionEnd = pedro ? pointInsertionIndex(path) : path.points.length;
  const sharedEnd = section && !canExtend(path.graph, section);
  const hasInsertionAnchor = anchor && (!activeSegment || getSegmentPoints(path, activeSegment.id).includes(anchor));
  let insertionIndex = sectionEnd - (sharedEnd ? 1 : 0);
  if (hasInsertionAnchor) {
    if (sharedEnd && !extendSharedEnd && state.selected + 1 === sectionEnd) {
      els.segmentStatus.textContent = 'To insert after this junction, select the outgoing section and its first anchor.';
      return;
    }
    insertionIndex = state.selected + 1;
  }
  const heading = insertionIndex > 0 ? path.points[insertionIndex - 1].headingRad : 0;

  pushHistory();
  const point = createAnchor(imagePoint.x, imagePoint.y, heading);
  if (!segments.length) {
    addPathSegment(path);
    segments = path.segments;
  }
  point.segmentId = activeSegment?.id || (hasInsertionAnchor ? anchor.segmentId : null) ||
    (pedro ? segments.at(-1).id : path.points.at(-1)?.segmentId || segments[0].id);
  if (extendSharedEnd) {
    state.selected = extendRejoinedEnd(path,anchor.anchorId,point);
  } else if (path.graph) {
    const localIndex = section.steps.length - (sectionEnd - insertionIndex);
    appendAnchor(path.graph, section, point, localIndex);
    bindGraph(path);
    state.selected = insertionIndex;
  } else {
    path.points.splice(insertionIndex, 0, point);
    state.selected = insertionIndex;
  }
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
  if (!source || (path.graph?.anchors.length ?? path.points.length) >= MAX_PATH_POINTS) return;
  ensurePathSegments(path);
  pushHistory();
  const duplicate = createAnchor(source.xPx, source.yPx, source.headingRad, false, source.controlPoints, source.headingMode, source.constantHeadingRad);
  duplicate.segmentId = source.segmentId;
  if (path.graph) {
    const s = path.segments.find(s => s.id === source.segmentId);
    const index = s.steps.findIndex(p => p.anchorId === source.anchorId);
    if (index === s.steps.length - 1 && !canExtend(path.graph,s)) return;
    appendAnchor(path.graph,s,duplicate,index+1);
    bindGraph(path);
  } else path.points.splice(state.selected + 1, 0, duplicate);
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
  const hits = [];
  if (!state.imgLoaded) return hits;
  const path = state.paths[state.activePath];
  const dpi = window.devicePixelRatio || 1;
  const radius = 10 * dpi;

  if (isPedroPathingSelected()) {
    for (let pointIndex = path.points.length - 1; pointIndex >= 1; pointIndex--) {
      if (state.selected !== pointIndex) continue;
      const controls = path.points[pointIndex].controlPoints || [];
      for (let controlIndex = controls.length - 1; controlIndex >= 0; controlIndex--) {
        const canvasPoint = imagePxToCanvas(controls[controlIndex].xPx, controls[controlIndex].yPx);
        if (Math.hypot(canvasX - canvasPoint.x, canvasY - canvasPoint.y) <= radius) {
          hits.push({ type: 'control', pointIndex, controlIndex });
        }
      }
    }
  }

  const indices = path.points.map((_,index) => index).reverse();
  let visible;
  if (path.graph) {
    const active = path.segments[path.activeSegment];
    visible = new Set(focusedRoute(path.graph,active).map(s => s.id));
    indices.sort((a,b) => Number(path.points[b].segmentId === active.id) - Number(path.points[a].segmentId === active.id));
  }
  const anchors = new Set();
  for (const index of indices) {
    const point = path.points[index];
    if (visible && !path.compareBranches && !visible.has(point.segmentId)) continue;
    const canvasPoint = imagePxToCanvas(point.xPx, point.yPx);
    const angle = headingToCanvasAngle(point.headingRad);
    const handle = {
      x: canvasPoint.x + Math.cos(angle) * 28 * dpi,
      y: canvasPoint.y + Math.sin(angle) * 28 * dpi
    };
    if (index === state.selected && !state.selectedControl && Math.hypot(canvasX - handle.x, canvasY - handle.y) <= radius) hits.push({ type: 'handle', index });
    const id = point.anchorId ?? index;
    if (!anchors.has(id) && Math.hypot(canvasX - canvasPoint.x, canvasY - canvasPoint.y) <= radius) {
      hits.push({ type: 'point', index });
      anchors.add(id);
    }
  }

  const { imgRect } = layout();
  if (!hits.length && pointWithinImage({ x: canvasX, y: canvasY }, imgRect)) hits.push({ type: 'empty' });
  return hits;
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
  const scaleX = rect.width ? canvas.width / rect.width : window.devicePixelRatio || 1;
  const scaleY = rect.height ? canvas.height / rect.height : window.devicePixelRatio || 1;
  return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
}

function pointWithinImage(point, imgRect) {
  return point.x >= imgRect.x && point.x <= imgRect.x + imgRect.w &&
    point.y >= imgRect.y && point.y <= imgRect.y + imgRect.h;
}

function handleHoverIdle(mouse) {
  const wasVisible = state.hoverActive;
  state.hoverPos = mouse;
  state.hoverActive = false;
  if (state._hoverTimer) clearTimeout(state._hoverTimer);
  if (state.dragMode) return;
  const { imgRect } = layout();
  if (wasVisible) draw();
  if (!state.imgLoaded || !pointWithinImage(mouse, imgRect)) {
    return;
  }
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
