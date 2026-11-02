import { els, updateAxesUI, isPedroPathingSelected } from './els.js';
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
import { imagePxToField, fieldToImagePx } from './layout.js';
import { draw } from './draw.js';
import { normalize } from './utils.js';
import {
  setCoordinateSystem,
  setFieldSizeFromDisplay,
  setMeasurementUnit,
  setOrigin,
  setRobotDimensionsFromDisplay,
  syncConfigUI
} from './field_config.js';
import { addControlPoint, removeAnchor, removeControlPoint, MAX_PATH_POINTS, getHeadingMode, setHeadingMode } from './path_model.js';
import { addPathSegment, canRemovePathSegment, canSplitPathSegment, ensurePathSegments, getSegmentPoints, removePathSegment, segmentMethodNames, splitPathSegment } from './segment_model.js';
import { transformFieldPose } from './coordinates.js';
import { planSegmentReorder, planPointMove, planPointAsSegment } from './segment_model.js';
import { collisionReport } from './collision_state.js';

let refreshPreviewUI = () => {};

export function initUI() {
  installFieldConfigurationHandlers();
  installPreviewControls();
  installTransformControls();
  installSegmentControls();

  els.javaType?.addEventListener('change', () => {
    if (!isPedroPathingSelected()) state.selectedControl = null;
    refreshAll();
  });

  els.headingWrap?.addEventListener('change', () => {
    state.headingWrapHalf = !!els.headingWrap.checked;
    refreshAll();
  });
  if (els.headingWrap) els.headingWrap.checked = state.headingWrapHalf;

  els.undoBtn.addEventListener('click', () => {
    if (undo()) refreshAfterHistory();
  });
  els.redoBtn.addEventListener('click', () => {
    if (redo()) refreshAfterHistory();
  });
  els.deleteBtn.addEventListener('click', deleteSelectedEntity);

  els.clearBtn.addEventListener('click', () => {
    const path = state.paths[state.activePath];
    if ((!path.points.length && !path.segments?.length) || !confirm("Clear selected path's points and segments?")) return;
    pushHistory();
    path.points = [];
    path.segments = [];
    path.activeSegment = -1;
    path.previewIndex = -1;
    clearSelection();
    refreshAll();
  });

  els.clearAllBtn.addEventListener('click', () => {
    if (!state.paths.some(path => path.points.length || path.segments?.length) || !confirm("Clear all paths' points and segments?")) return;
    pushHistory();
    state.paths.forEach(path => {
      path.points = [];
      path.segments = [];
      path.activeSegment = -1;
      path.previewIndex = -1;
    });
    clearSelection();
    refreshAll();
  });

  els.selXIn.addEventListener('change', () => updateSelectedPosition('x'));
  els.selYIn.addEventListener('change', () => updateSelectedPosition('y'));
  els.headingDeg.addEventListener('change', () => {
    const path = state.paths[state.activePath];
    const point = path.points[state.selected];
    if (!point || point.locked || state.selectedControl) return;
    pushHistory();
    point.headingRad = normalize(Number(els.headingDeg.value || 0) * Math.PI / 180);
    refreshAll();
  });

  [els.path1Btn, els.path2Btn, els.path3Btn, els.path4Btn].forEach((button, index) => {
    button?.addEventListener('click', () => setActivePath(index));
  });

  const updateRobot = () => {
    setRobotDimensionsFromDisplay(els.robotLen.value, els.robotWid.value);
    refreshAll();
  };
  els.robotLen.addEventListener('change', updateRobot);
  els.robotWid.addEventListener('change', updateRobot);
  els.boxRotate.addEventListener('change', draw);
}

function installFieldConfigurationHandlers() {
  els.coordinateSystem.addEventListener('change', () => {
    pushHistory();
    setCoordinateSystem(els.coordinateSystem.value);
    syncConfigUI();
    updateAxesUI();
    refreshAll();
  });
  updateAxesUI();

  els.measurementUnit.addEventListener('change', () => {
    setMeasurementUnit(els.measurementUnit.value);
    refreshAll();
  });

  els.fieldSize.addEventListener('change', () => {
    setFieldSizeFromDisplay(els.fieldSize.value);
    syncConfigUI();
    refreshAll();
  });

  els.originSelect.addEventListener('change', () => {
    setOrigin(els.originSelect.value);
    syncConfigUI();
    refreshAll();
  });
}

export function setActivePath(index, { preserveSelection = false } = {}) {
  state.activePath = Math.max(0, Math.min(index, state.paths.length - 1));
  els.className.value = state.paths[state.activePath].className || 'AutoPath';
  if (!preserveSelection) clearSelection();
  [els.path1Btn, els.path2Btn, els.path3Btn, els.path4Btn].forEach((button, buttonIndex) => {
    button?.classList.toggle(`active-path${buttonIndex}`, buttonIndex === state.activePath);
  });
  refreshAll();
}

export function setActiveSegment(index) {
  const path = state.paths[state.activePath];
  const segments = ensurePathSegments(path);
  path.activeSegment = Number.isInteger(index) ? Math.max(-1, Math.min(index, segments.length - 1)) : -1;
  clearSelection();
  refreshAll();
}

function installSegmentControls() {
  els.segmentHeadingMode.addEventListener('change', () => {
    const path = state.paths[state.activePath];
    const segment = ensurePathSegments(path)[path.activeSegment];
    if (!segment) return;
    const points = getSegmentPoints(path, segment.id).slice(1);
    if (!points.length) return;
    pushHistory();
    points.forEach(point => setHeadingMode(point, els.segmentHeadingMode.value));
    refreshAll();
  });
  els.pointHeadingMode.addEventListener('change', () => {
    const path = state.paths[state.activePath];
    const point = path.points[state.selected];
    if (state.selectedControl || state.selected <= 0 || !point || point.breakBefore) return;
    pushHistory();
    setHeadingMode(point, els.pointHeadingMode.value);
    refreshAll();
  });
  els.pointAsSegment.addEventListener('click', () => {
    if (state.selectedControl) return;
    applySegmentEdit(path => planPointAsSegment(path, state.selected));
  });
  els.segmentUp.addEventListener('click', () => reorderSelectedSegment(-1));
  els.segmentDown.addEventListener('click', () => reorderSelectedSegment(1));
  els.movePointSegment.addEventListener('click', () => {
    if (state.selectedControl) return;
    applySegmentEdit(path => planPointMove(path, state.selected, els.pointSegmentTarget.value));
  });
  els.segmentSelect.addEventListener('change', () => setActiveSegment(Number(els.segmentSelect.value)));
  els.segmentName.addEventListener('change', () => {
    const path = state.paths[state.activePath];
    const name = els.segmentName.value.trim();
    const segment = ensurePathSegments(path)[path.activeSegment];
    if (!segment || !name || name === segment.name) { refreshSegmentControls(); return; }
    pushHistory();
    segment.name = name;
    refreshAll();
  });
  els.addSegment.addEventListener('click', () => {
    pushHistory();
    addPathSegment(state.paths[state.activePath]);
    clearSelection();
    refreshAll();
  });
  els.splitSegment.addEventListener('click', () => {
    const path = state.paths[state.activePath];
    if (state.selectedControl || !canSplitPathSegment(path, state.selected)) return;
    pushHistory();
    splitPathSegment(path, state.selected);
    clearSelection();
    refreshAll();
  });
  els.deleteSegment.addEventListener('click', () => {
    const path = state.paths[state.activePath];
    if (!canRemovePathSegment(path, path.activeSegment)) return;
    pushHistory();
    removePathSegment(path, path.activeSegment);
    clearSelection();
    refreshAll();
  });
}

function reorderSelectedSegment(delta) {
  applySegmentEdit(path => planSegmentReorder(path, path.activeSegment, path.activeSegment + delta));
}

function applySegmentEdit(planEdit) {
  const path = state.paths[state.activePath];
  try {
    const plan = planEdit(path);
    if (!plan) return;
    pushHistory();
    Object.assign(path, plan.changes);
    state.selected = plan.selectedIndex;
    state.selectedControl = null;
    refreshAll();
  } catch (error) {
    els.pointMoveStatus.textContent = error.message;
  }
}

export function refreshSegmentControls() {
  if (!els.segmentSelect?.replaceChildren) return;
  const pedro = isPedroPathingSelected();
  els.legacyPathControls.hidden = false;
  els.segmentControls.hidden = !pedro;
  [els.path1Btn, els.path2Btn, els.path3Btn, els.path4Btn].forEach((button, index) => {
    button.disabled = index >= state.paths.length;
    button.classList.toggle(`active-path${index}`, index === state.activePath);
  });
  if (!pedro) return;
  const path = state.paths[state.activePath];
  const segments = ensurePathSegments(path);
  const allOption = document.createElement('option');
  allOption.value = '-1';
  allOption.textContent = 'All segments';
  els.segmentSelect.replaceChildren(allOption, ...segments.map((segment, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${segment.name} (${getSegmentPoints(path, segment.id).length} points)`;
    const report = collisionReport().paths[state.activePath];
    if (getSegmentPoints(path, segment.id).some(point => {
      const pointIndex = path.points.indexOf(point);
      return report.anchors[pointIndex]?.length || (point.segmentId === segment.id && report.connections[pointIndex]?.length);
    })) {
      option.textContent += ' — collision';
      if (option.style) option.style.color = '#ef4444';
    }
    return option;
  }));
  els.segmentSelect.value = String(path.activeSegment);
  els.segmentUp.disabled = path.activeSegment <= 0;
  els.segmentDown.disabled = path.activeSegment < 0 || path.activeSegment >= segments.length - 1;
  const selectedPoint = state.selectedControl ? null : path.points[state.selected];
  els.pointAsSegment.disabled = !selectedPoint;
  const previousTarget = els.pointSegmentTarget.value;
  const targets = segments.filter(candidate => candidate.id !== selectedPoint?.segmentId);
  els.pointSegmentTarget.replaceChildren(...targets.map(candidate => {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = candidate.name;
    return option;
  }));
  els.pointSegmentTarget.value = targets.some(candidate => candidate.id === previousTarget)
    ? previousTarget : targets[0]?.id || '';
  els.pointSegmentTarget.disabled = !selectedPoint || targets.length === 0;
  els.movePointSegment.disabled = els.pointSegmentTarget.disabled;
  const owner = segments.find(candidate => candidate.id === selectedPoint?.segmentId);
  els.pointMoveStatus.textContent = selectedPoint
    ? `Selected point ${state.selected + 1} in ${owner.name}. Moves to the end of the destination segment.`
    : 'Select an anchor on the field or in the table to move it.';
  const segment = segments[path.activeSegment];
  const modes = new Set(segment ? getSegmentPoints(path, segment.id).slice(1).map(getHeadingMode) : []);
  els.segmentHeadingMode.disabled = modes.size === 0;
  els.segmentHeadingMode.value = modes.size > 1 ? 'mixed' : [...modes][0] || 'linear';
  els.pointHeadingMode.disabled = !selectedPoint || state.selected <= 0 || !!selectedPoint.breakBefore;
  els.pointHeadingMode.value = getHeadingMode(selectedPoint);
  els.segmentName.disabled = !segment;
  els.segmentName.value = segment?.name || '';
  els.segmentName.placeholder = segment ? 'Collect samples' : 'Select a segment to rename';
  const method = segmentMethodNames(segments)[path.activeSegment];
  const detail = !segment ? 'Showing all segments. New points append to the last segment.'
    : getSegmentPoints(path, segment.id).length >= 2 ? `Exports as ${method}()` : 'Add at least two anchors to export a path method.';
  els.segmentStatus.textContent = `${path.name}: ${path.points.length}/${MAX_PATH_POINTS} anchor points across all segments. ${detail}${path.points.length >= MAX_PATH_POINTS ? ' Point limit reached.' : ''}`;
  els.splitSegment.disabled = !!state.selectedControl || !canSplitPathSegment(path, state.selected);
  els.deleteSegment.disabled = !canRemovePathSegment(path, path.activeSegment);
  els.deleteSegment.title = !segment ? 'Select a segment to remove its label.' : segments.length <= 1 ? 'Keep at least one segment in this path.' : els.deleteSegment.disabled ? 'Disconnected routes need separate segment labels.' : 'Keep the points and merge this label into its neighbor.';
}

function installPreviewControls() {
  const left = document.querySelector('.left');
  const waypointHeading = findWaypointHeading(left);
  const panel = document.createElement('div');
  panel.className = 'panel-group';
  panel.innerHTML = `
    <h2>Preview / Step-through</h2>
    <label class="row">
      <span class="custom-checkbox-wrapper">
        <input type="checkbox" id="previewToggle" class="hidden-checkbox">
        <label for="previewToggle" class="custom-checkbox-label">
          <span class="custom-checkbox-box"></span>Enable preview
        </label>
      </span>
    </label>
    <div class="row">
      <button id="previewPrev">Prev</button>
      <button id="previewNext">Next</button>
      <button id="previewAll">All</button>
      <button id="previewNone">None</button>
    </div>
    <div class="row"><input type="range" id="previewSlider" min="-1" max="-1" value="-1" step="1"></div>
    <label class="row">
      <span class="custom-checkbox-wrapper">
        <input type="checkbox" id="dimFutureToggle" class="hidden-checkbox" checked>
        <label for="dimFutureToggle" class="custom-checkbox-label">
          <span class="custom-checkbox-box"></span>Dim future points
        </label>
      </span>
    </label>
    <small id="previewStatus" class="small"></small>`;
  left.insertBefore(panel, waypointHeading);

  const toggle = panel.querySelector('#previewToggle');
  const slider = panel.querySelector('#previewSlider');
  const status = panel.querySelector('#previewStatus');
  const dimFuture = panel.querySelector('#dimFutureToggle');

  toggle.addEventListener('change', () => {
    const path = state.paths[state.activePath];
    setPreviewEnabled(toggle.checked);
    if (toggle.checked && path.previewIndex < 0) setPreviewIndex(path.points.length - 1);
    refreshPreviewUI();
    draw();
  });
  panel.querySelector('#previewPrev').addEventListener('click', () => { stepPreview(-1); refreshPreviewUI(); draw(); });
  panel.querySelector('#previewNext').addEventListener('click', () => { stepPreview(1); refreshPreviewUI(); draw(); });
  panel.querySelector('#previewAll').addEventListener('click', () => {
    setPreviewEnabled(true);
    setPreviewIndex(state.paths[state.activePath].points.length - 1);
    refreshPreviewUI(); draw();
  });
  panel.querySelector('#previewNone').addEventListener('click', () => {
    setPreviewEnabled(true);
    setPreviewIndex(-1);
    refreshPreviewUI(); draw();
  });
  slider.addEventListener('input', () => {
    setPreviewIndex(Number(slider.value));
    refreshPreviewUI(); draw();
  });
  dimFuture.addEventListener('change', () => {
    state.dimFuture = dimFuture.checked;
    draw();
  });

  refreshPreviewUI = () => {
    const path = state.paths[state.activePath];
    slider.max = String(Math.max(-1, path.points.length - 1));
    slider.value = String(path.previewIndex);
    toggle.checked = path.previewEnabled;
    dimFuture.checked = state.dimFuture;
    status.textContent = path.previewEnabled
      ? `Showing ${getVisibleWaypointCount()} of ${path.points.length} anchors`
      : `Preview disabled • ${path.points.length} anchors`;
  };
  refreshPreviewUI();
}

function installTransformControls() {
  const left = document.querySelector('.left');
  const waypointHeading = findWaypointHeading(left);
  const panel = document.createElement('div');
  panel.className = 'panel-group';
  panel.innerHTML = `
    <h2>Transform (Mirror / Rotate)</h2>
    <div class="row">
      <button data-transform="mirrorX">Mirror X</button>
      <button data-transform="mirrorY">Mirror Y</button>
    </div>
    <div class="row">
      <button data-transform="rotCCW">↶ 90°</button>
      <button data-transform="rotCW">↷ 90°</button>
      <button data-transform="rot180">180°</button>
    </div>
    <small class="small">Transforms apply to anchors and control points.</small>`;
  left.insertBefore(panel, waypointHeading);
  panel.querySelectorAll('[data-transform]').forEach(button => {
    button.addEventListener('click', () => applyTransform(button.dataset.transform));
  });
}

export function updateTable() {
  refreshSegmentControls();
  els.pointRows.innerHTML = '';
  const path = state.paths[state.activePath];
  const controlsEnabled = isPedroPathingSelected();
  const segments = controlsEnabled ? ensurePathSegments(path) : null;
  const segment = segments?.[path.activeSegment];
  const activePoints = segment ? new Set(getSegmentPoints(path, segment.id)) : null;
  const collision = collisionReport().paths[state.activePath];

  path.points.forEach((point, pointIndex) => {
    point.controlPoints ||= [];
    const field = imagePxToField(point.xPx, point.yPx);
    const row = document.createElement('tr');
    const zoneIds = new Set([...(collision.anchors[pointIndex] || []), ...(collision.connections[pointIndex] || []).map(hit => hit.zoneId)]);
    if (zoneIds.size) {
      row.classList.add('collision-row');
      row.title = `Collision: ${[...zoneIds].map(id => state.exclusionZones.find(zone => zone.id === id)?.name || id).join(', ')}`;
    }
    if (activePoints?.has(point)) row.classList.add('active-segment-row');
    else if (activePoints) row.classList.add('dimmed-segment-row');
    if (pointIndex === state.selected && !state.selectedControl) row.classList.add('selected-row');
    row.innerHTML = `
      <td>${pointIndex + 1}</td>
      <td>${field.x.toFixed(2)}</td>
      <td>${field.y.toFixed(2)}</td>
      <td>${formatDeg(point.headingRad).toFixed(1)}${controlsEnabled && pointIndex > 0 && !point.breakBefore ? `<br><small>${getHeadingMode(point)}</small>` : ''}</td>
      <td>
        ${checkboxMarkup(`anchor-lock-${state.activePath}-${pointIndex}`, 'anchor-lock', point.locked, { point: pointIndex })}
        ${controlsEnabled && pointIndex > 0 && !point.breakBefore && point.controlPoints.length < 2 ? `<button class="add-control" data-point="${pointIndex}">+ Control</button>` : ''}
      </td>
      <td>
        <button class="select-anchor" data-point="${pointIndex}">Select</button>
        <button class="move-up" data-point="${pointIndex}" ${pointIndex === 0 ? 'disabled' : ''}>▲</button>
        <button class="move-down" data-point="${pointIndex}" ${pointIndex === path.points.length - 1 ? 'disabled' : ''}>▼</button>
      </td>`;
    els.pointRows.appendChild(row);

    if (controlsEnabled) point.controlPoints.forEach((control, controlIndex) => {
      const controlField = imagePxToField(control.xPx, control.yPx);
      const controlRow = document.createElement('tr');
      controlRow.className = 'control-row';
      if (segment && point.segmentId !== segment.id) controlRow.classList.add('dimmed-segment-row');
      if (state.selectedControl?.pointIndex === pointIndex && state.selectedControl?.controlIndex === controlIndex) {
        controlRow.classList.add('selected-row');
      }
      controlRow.innerHTML = `
        <td>↳ C${controlIndex + 1}</td>
        <td>${controlField.x.toFixed(2)}</td>
        <td>${controlField.y.toFixed(2)}</td>
        <td>—</td>
        <td>${checkboxMarkup(`control-lock-${state.activePath}-${pointIndex}-${controlIndex}`, 'control-lock', control.locked, { point: pointIndex, control: controlIndex })}</td>
        <td>
          <button class="select-control" data-point="${pointIndex}" data-control="${controlIndex}">Select</button>
          <button class="delete-control" data-point="${pointIndex}" data-control="${controlIndex}">Delete</button>
        </td>`;
      els.pointRows.appendChild(controlRow);
    });
  });

  bindTableActions(path);
}

function bindTableActions(path) {
  els.pointRows.querySelectorAll('.anchor-lock').forEach(input => {
    input.addEventListener('change', () => {
      pushHistory();
      path.points[Number(input.dataset.point)].locked = input.checked;
      draw();
    });
  });
  els.pointRows.querySelectorAll('.control-lock').forEach(input => {
    input.addEventListener('change', () => {
      pushHistory();
      path.points[Number(input.dataset.point)].controlPoints[Number(input.dataset.control)].locked = input.checked;
      draw();
    });
  });
  els.pointRows.querySelectorAll('.select-anchor').forEach(button => {
    button.addEventListener('click', () => {
      state.selected = Number(button.dataset.point);
      state.selectedControl = null;
      refreshAll();
    });
  });
  els.pointRows.querySelectorAll('.select-control').forEach(button => {
    button.addEventListener('click', () => {
      state.selected = Number(button.dataset.point);
      state.selectedControl = {
        pointIndex: Number(button.dataset.point),
        controlIndex: Number(button.dataset.control)
      };
      refreshAll();
    });
  });
  els.pointRows.querySelectorAll('.add-control').forEach(button => {
    button.addEventListener('click', () => {
      if (!isPedroPathingSelected()) return;
      const pointIndex = Number(button.dataset.point);
      pushHistory();
      const controlIndex = addControlPoint(path, pointIndex);
      if (controlIndex >= 0) {
        state.selected = pointIndex;
        state.selectedControl = { pointIndex, controlIndex };
      }
      refreshAll();
    });
  });
  els.pointRows.querySelectorAll('.delete-control').forEach(button => {
    button.addEventListener('click', () => {
      const pointIndex = Number(button.dataset.point);
      const controlIndex = Number(button.dataset.control);
      if (path.points[pointIndex].controlPoints[controlIndex]?.locked) return;
      pushHistory();
      removeControlPoint(path, pointIndex, controlIndex);
      state.selectedControl = null;
      refreshAll();
    });
  });
  els.pointRows.querySelectorAll('.move-up').forEach(button => {
    button.addEventListener('click', () => moveAnchor(path, Number(button.dataset.point), -1));
  });
  els.pointRows.querySelectorAll('.move-down').forEach(button => {
    button.addEventListener('click', () => moveAnchor(path, Number(button.dataset.point), 1));
  });
}

// Coordinate cells can update without rebuilding every row and event listener.
export function refreshDraggedRow() {
  if (!els.pointRows.querySelector) return;
  const path = state.paths[state.activePath];
  const pointIndex = state.selectedControl?.pointIndex ?? state.selected;
  const point = path.points[pointIndex];
  if (!point) return;
  const selection = state.selectedControl;
  const entity = selection ? point.controlPoints[selection.controlIndex] : point;
  const button = selection
    ? els.pointRows.querySelector(`.select-control[data-point="${pointIndex}"][data-control="${selection.controlIndex}"]`)
    : els.pointRows.querySelector(`.select-anchor[data-point="${pointIndex}"]`);
  const cells = button?.closest('tr')?.cells;
  if (!cells || !entity) return;
  const field = imagePxToField(entity.xPx, entity.yPx);
  const x = field.x.toFixed(2), y = field.y.toFixed(2);
  if (cells[1].textContent !== x) cells[1].textContent = x;
  if (cells[2].textContent !== y) cells[2].textContent = y;
  if (!selection) {
    const heading = `${formatDeg(point.headingRad).toFixed(1)}${isPedroPathingSelected() && pointIndex > 0 && !point.breakBefore ? `<br><small>${getHeadingMode(point)}</small>` : ''}`;
    if (cells[3].innerHTML !== heading) cells[3].innerHTML = heading;
  }
}

export function syncSelectedUI() {
  const path = state.paths[state.activePath];
  const entity = getSelectedEntity(path);
  if (!entity || !state.imgLoaded) {
    els.selXIn.value = '';
    els.selYIn.value = '';
    els.headingDeg.value = '';
    els.headingDeg.disabled = false;
    return;
  }
  const field = imagePxToField(entity.xPx, entity.yPx);
  els.selXIn.value = field.x.toFixed(2);
  els.selYIn.value = field.y.toFixed(2);
  els.headingDeg.disabled = !!state.selectedControl;
  els.headingDeg.value = state.selectedControl ? '' : formatDeg(entity.headingRad).toFixed(1);
}

function updateSelectedPosition(changedAxis) {
  if (!state.imgLoaded) return;
  const path = state.paths[state.activePath];
  const entity = getSelectedEntity(path);
  if (!entity || entity.locked) return;
  const current = imagePxToField(entity.xPx, entity.yPx);
  const x = changedAxis === 'x' ? Number(els.selXIn.value || 0) : current.x;
  const y = changedAxis === 'y' ? Number(els.selYIn.value || 0) : current.y;
  const imagePoint = fieldToImagePx(x, y);
  pushHistory();
  entity.xPx = imagePoint.x;
  entity.yPx = imagePoint.y;
  refreshAll();
}

function deleteSelectedEntity() {
  const path = state.paths[state.activePath];
  if (state.selectedControl) {
    const { pointIndex, controlIndex } = state.selectedControl;
    if (path.points[pointIndex]?.controlPoints?.[controlIndex]?.locked) return;
    pushHistory();
    removeControlPoint(path, pointIndex, controlIndex);
    state.selectedControl = null;
  } else if (state.selected >= 0) {
    if (path.points[state.selected]?.locked) return;
    pushHistory();
    removeAnchor(path, state.selected);
    state.selected = Math.min(state.selected, path.points.length - 1);
  } else return;
  clampPreviewAfterChange();
  refreshAll();
}

function moveAnchor(path, index, direction) {
  const target = index + direction;
  if (target < 0 || target >= path.points.length) return;
  pushHistory();
  const memberships = path.points.map(point => ({ segmentId: point.segmentId, breakBefore: point.breakBefore }));
  [path.points[index], path.points[target]] = [path.points[target], path.points[index]];
  path.points.forEach((point, i) => Object.assign(point, memberships[i]));
  if (path.points[0]) path.points[0].controlPoints = [];
  state.selected = state.selected === index ? target : state.selected === target ? index : state.selected;
  state.selectedControl = null;
  refreshAll();
}

function applyTransform(kind) {
  const path = state.paths[state.activePath];
  if (!state.imgLoaded || !path.points.length) return;
  pushHistory();
  const pivot = imagePxToField(state.img.width / 2, state.img.height / 2);
  path.points = path.points.map(point => {
    const field = imagePxToField(point.xPx, point.yPx);
    const transformed = transformFieldPose(field.x, field.y, point.headingRad, kind, pivot);
    const image = fieldToImagePx(transformed.x, transformed.y);
    return {
      ...point,
      xPx: image.x,
      yPx: image.y,
      headingRad: normalize(transformed.heading),
      ...(Number.isFinite(point.constantHeadingRad) ? {
        constantHeadingRad: normalize(transformFieldPose(field.x, field.y, point.constantHeadingRad, kind, pivot).heading)
      } : {}),
      controlPoints: (point.controlPoints || []).map(control => {
        const controlField = imagePxToField(control.xPx, control.yPx);
        const transformedControl = transformFieldPose(controlField.x, controlField.y, 0, kind, pivot);
        const controlImage = fieldToImagePx(transformedControl.x, transformedControl.y);
        return { ...control, xPx: controlImage.x, yPx: controlImage.y };
      })
    };
  });
  refreshAll();
}

function refreshAfterHistory() {
  els.className.value = state.paths[state.activePath].className || 'AutoPath';
  syncConfigUI();
  updateAxesUI();
  clampPreviewAfterChange();
  refreshAll();
}

function refreshAll() {
  refreshPreviewUI();
  syncSelectedUI();
  updateTable();
  draw();
}

function clampPreviewAfterChange() {
  const path = state.paths[state.activePath];
  if (path.previewIndex > path.points.length - 1) path.previewIndex = path.points.length - 1;
}

function clearSelection() {
  state.selected = -1;
  state.selectedControl = null;
}

function getSelectedEntity(path) {
  if (state.selectedControl) {
    return path.points[state.selectedControl.pointIndex]?.controlPoints?.[state.selectedControl.controlIndex] || null;
  }
  return path.points[state.selected] || null;
}

function checkboxMarkup(id, className, checked, data) {
  const attrs = Object.entries(data).map(([key, value]) => `data-${key}="${value}"`).join(' ');
  return `<span class="custom-checkbox-wrapper">
    <input type="checkbox" id="${id}" class="hidden-checkbox ${className}" ${attrs} ${checked ? 'checked' : ''}>
    <label for="${id}" class="custom-checkbox-label"><span class="custom-checkbox-box"></span>lock</label>
  </span>`;
}

function findWaypointHeading(left) {
  return [...left.querySelectorAll(':scope > h2')].find(heading => heading.textContent.includes('2) Waypoints'));
}

function formatDeg(rad) {
  if (state.headingWrapHalf) return normalize(rad) * 180 / Math.PI;
  let degrees = (rad * 180 / Math.PI) % 360;
  if (degrees < 0) degrees += 360;
  return degrees;
}
