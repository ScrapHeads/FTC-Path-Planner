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
import { createAnchor, addControlPoint, removeAnchor, removeControlPoint, MAX_PATH_POINTS, getHeadingMode, setHeadingMode } from './path_model.js';
import { addPathSegment, canRemovePathSegment, canSplitPathSegment, ensurePathSegments, getSegmentPoints, removePathSegment, splitPathSegment } from './segment_model.js';
import { transformFieldPose } from './coordinates.js';
import { bindGraph, focusRejoin, canStartSegment, startSegment, graphWarnings, migrateGraph, prepareFork, appendAnchor, duplicateSection, rejoin, validTargets, canExtend, prune, deletionSet, insertMidpoint, selectRoute, focusedRoute, outgoing, startId } from './branch_graph.js';
import { previewCount } from './state.js';
import { planSegmentReorder, planPointMove, planPointAsSegment, focusPointSegment } from './segment_model.js';
import { collisionReport } from './collision_state.js';

let refreshPreviewUI = () => {};

export function initUI() {
  installFieldConfigurationHandlers();
  installPreviewControls();
  installTransformControls();
  installSegmentControls();

  els.javaType?.addEventListener('change', () => {
    if (state.paths[state.activePath].graph) els.javaType.value = 'pedro';
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
  document.getElementById('addHandle').addEventListener('click', () => addConnectionControl());

  els.clearBtn.addEventListener('click', () => {
    const path = state.paths[state.activePath];
    if ((!path.points.length && !path.segments?.length) || !confirm("Clear selected path's points and segments?")) return;
    pushHistory();
    delete path.graph;
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
      delete path.graph;
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

  els.autoSelect.addEventListener('change', () => setActivePath(els.autoSelect.selectedIndex));

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
  if (state.paths[state.activePath].graph && !isPedroPathingSelected()) { els.javaType.value = 'pedro'; els.javaType.dispatchEvent(new Event('change')); }
  if (!preserveSelection) clearSelection();
  els.autoSelect.selectedIndex = state.activePath;
  refreshAll();
}

export function setActiveSegment(index, pointIndex = -1) {
  const path = state.paths[state.activePath];
  const segments = ensurePathSegments(path);
  path.activeSegment = Number.isInteger(index) ? Math.max(-1, Math.min(index, segments.length - 1)) : -1;
  if (path.graph && segments[index]) {
    selectRoute(path.graph,segments[index]);
    setPreviewIndex(path.previewIndex);
  }
  clearSelection();
  state.selected = focusRejoin(path, pointIndex);
  refreshAll();
}

function beginForkPlacement(path, draft) {
  cancelForkPlacement();
  const notice = document.getElementById('placementNotice');
  const message = document.getElementById('placementMessage');
  const controller = new AbortController();
  state.branchPlacement = { ...draft, path, controller };
  notice.hidden = false;
  message.textContent = draft.main
    ? '1 of 2 · Click the field to place the Main point.'
    : 'Click the field to place the Branch point. The existing route continues from the fork.';
  const canvas = document.getElementById('canvas');
  canvas.focus({preventScroll:true});
  notice.scrollIntoView({block:'nearest'});
  // Leaving placement for another editor action discards the uncommitted draft.
  const leave = event => {
    if (event.target !== canvas && !notice.contains(event.target)) cancelForkPlacement();
  };
  for (const type of ['pointerdown','focusin','click','change','drop'])
    document.addEventListener(type, leave, {capture:true, signal:controller.signal});
}

export function cancelForkPlacement() {
  if (!state.branchPlacement) return;
  state.branchPlacement.controller.abort();
  state.branchPlacement = null;
  document.getElementById('placementNotice').hidden = true;
  draw();
}

export function placeForkPoint(x, y) {
  const draft = state.branchPlacement;
  if (!draft) return;
  if (draft.path !== state.paths[state.activePath]) { cancelForkPlacement(); return; }
  const point = createAnchor(x, y, draft.anchor.headingRad);
  if (draft.main && !draft.mainPoint) {
    appendAnchor(draft.graph, draft.main, point);
    draft.mainPoint = point;
    document.getElementById('placementMessage').textContent = '2 of 2 · Click the field to place the Branch point.';
    draw();
    return;
  }
  appendAnchor(draft.graph, draft.branch, point);
  selectRoute(draft.graph, draft.branch);
  const changes = { activeSegment: draft.graph.sections.indexOf(draft.branch) };
  bindGraph(changes, draft.graph);
  pushHistory();
  Object.assign(draft.path, changes);
  state.selected = draft.path.points.findLastIndex(p => p.segmentId === draft.branch.id);
  state.selectedControl = null;
  cancelForkPlacement();
  refreshAll();
}

function installSegmentControls() {
  document.getElementById('cancelPlacement').addEventListener('click', cancelForkPlacement);
  document.getElementById('branchActions')?.addEventListener('click', event => {
    const action = event.target.dataset.branch;
    if (!action) return;
    const path = state.paths[state.activePath];
    const selected = state.selectedControl ? null : path.points[state.selected];
    try {
      const graph = structuredClone(migrateGraph(path));
      let s = graph.sections[path.activeSegment] || graph.sections.find(s => s.id === selected?.segmentId);
      const local = selected && getSegmentPoints(path,selected.segmentId).indexOf(selected);
      const owner = graph.sections.find(part => part.id === selected?.segmentId);
      const id = owner?.steps[local]?.anchorId;
      if (action === 'fork') {
        if (!id) throw Error('Select an anchor first.');
        beginForkPlacement(path, prepareFork(graph,owner,id));
        return;
      } else if (action === 'insert') {
        if (!id) throw Error('Select the destination of a connection.');
        insertMidpoint(graph,owner,local);
        s = owner;
      } else if (!s) throw Error('Select a section first.');
      else if (action === 'finish') {
        if (s.steps.length < 2 || outgoing(graph,s.steps.at(-1).anchorId).length || graph.sections.some(other => other !== s && other.steps.at(-1)?.anchorId === s.steps.at(-1).anchorId)) throw Error('Choose a branch with its own ending.');
        s.finished = !s.finished;
      }
      else if (action === 'duplicate') s = duplicateSection(graph,s);
      else if (action === 'join') rejoin(graph,s,document.getElementById('joinTarget').value);
      else if (action === 'delete') {
        const removed = deletionSet(graph,s);
        if (removed.size > 1 && !confirm('Also delete ' + (removed.size-1) + ' downstream sections?')) return;
        graph.sections = graph.sections.filter(part => !removed.has(part));
        prune(graph);
        s = graph.sections[0];
      }
      pushHistory();
      if (!s) { delete path.graph; path.points = []; path.segments = []; path.activeSegment = -1; }
      else { path.activeSegment = graph.sections.indexOf(s); selectRoute(graph,s); bindGraph(path,graph); }
      clearSelection();
      if (action === 'join') state.selected = focusRejoin(path,path.points.findLastIndex(p => p.segmentId === s.id));
      refreshAll();
    } catch (error) { els.segmentStatus.textContent = error.message; }
  });
  document.getElementById('sectionColor')?.addEventListener('change', event => {
    const path = state.paths[state.activePath], section = path.segments[path.activeSegment];
    if (section) { pushHistory(); section.color = event.target.value; refreshAll(); }
  });
  document.getElementById('allBranches')?.addEventListener('change', event => {
    state.paths[state.activePath].compareBranches = event.target.checked; draw();
  });
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
  document.getElementById('insertAfter')?.addEventListener('change', event => {
    setActiveSegment(state.paths[state.activePath].activeSegment, Number(event.target.value));
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
    if (path.graph) {
      const point = path.points[state.selected];
      const owner = path.segments.find(s => s.id === point?.segmentId);
      if (state.selectedControl || !canStartSegment(path.graph,owner,point?.anchorId)) return;
      pushHistory();
      const next = startSegment(path.graph,owner,point.anchorId);
      bindGraph(path);
      setActiveSegment(path.segments.indexOf(next), path.points.findIndex(p => p.segmentId === next.id));
      return;
    }
    if (state.selectedControl || !canSplitPathSegment(path, state.selected)) return;
    pushHistory();
    splitPathSegment(path, state.selected);
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
  const path = state.paths[state.activePath];
  if (path.graph) {
    pushHistory();
    const s = path.segments.splice(path.activeSegment,1)[0];
    path.activeSegment += delta;
    path.segments.splice(path.activeSegment,0,s); bindGraph(path); clearSelection(); refreshAll(); return;
  }
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
  els.autoSelect.selectedIndex = state.activePath;
  els.segmentControls.hidden = !pedro;

  if (!pedro) return;
  const path = state.paths[state.activePath];
  const segments = ensurePathSegments(path);
  const graph = path.graph;
  const compare = document.getElementById('allBranches');
  if (compare) { compare.checked = !!path.compareBranches; compare.disabled = !graph; }
  const browser = document.getElementById('routeChoices');
  if (browser?.replaceChildren && document.querySelector?.('[data-branch="join"]')) {
    browser.replaceChildren();
    if (graph) for (const s of focusedRoute(graph,segments[path.activeSegment])) {
      const options = outgoing(graph,startId(s));
      if (options.length < 2) continue;
      const field = document.createElement('select');
      field.setAttribute('aria-label','Route at ' + startId(s));
      options.forEach(option => field.add(new Option(option.name,option.id)));
      field.value = s.id;
      field.onchange = () => setActiveSegment(segments.findIndex(part => part.id === field.value));
      const label = document.createElement('label');
      label.textContent = 'Fork at ' + startId(s);
      label.append(field);
      browser.append(label);
    }
    const active = segments[path.activeSegment];
    const color = document.getElementById('sectionColor');
    color.disabled = !active;
    const sectionColor = active?.color || path.color;
    color.value = /^#[0-9a-f]{6}$/i.test(sectionColor) ? sectionColor : '#38bdf8';
    color.parentElement.hidden = !active;
    const placement = document.getElementById('insertAfter');
    placement.parentElement.hidden = !active || active.finished;
    if (!placement.parentElement.hidden) {
      const sharedEnd = graph && active.steps.length > 1 && !canExtend(graph, active);
      const anchors = getSegmentPoints(path, active.id).map(point => ({index: path.points.indexOf(point)}));
      if (sharedEnd) anchors.pop();
      placement.replaceChildren(new Option(sharedEnd ? 'Before shared junction' : 'Section end','-1'),
        ...anchors.map(({index}) => new Option('Anchor ' + (index + 1),String(index))));
      placement.value = anchors.some(({index}) => index === state.selected) && !state.selectedControl ? String(state.selected) : '-1';
    }
    const finish = document.querySelector('[data-branch="finish"]');
    finish.textContent = active?.finished ? 'Extend ending' : 'Finish independently';
    finish.disabled = !active || getSegmentPoints(path,active.id).length < 2 || !!graph && (outgoing(graph,active.steps.at(-1)?.anchorId).length > 0 || graph.sections.some(other => other !== active && other.steps.at(-1)?.anchorId === active.steps.at(-1)?.anchorId));
    els.segmentControls.classList.toggle('graph-editing',!!graph);
    const target = document.getElementById('joinTarget');
    const previous = target.value;
    target.replaceChildren(...(graph ? validTargets(graph,segments[path.activeSegment]) : []).map(a => {
      const p = path.points.find(p => p.anchorId === a.id);
      const part = segments.find(s => s.id === p.segmentId);
      return new Option(part.name + ' · Anchor ' + (path.points.indexOf(p) + 1), a.id);
    }));
    if ([...target.options].some(o => o.value === previous)) target.value = previous;
    const unavailable = !target.options.length;
    target.disabled = unavailable;
    document.querySelector('[data-branch="join"]').disabled = unavailable;
    const hint = document.getElementById('joinHint');
    hint.hidden = !unavailable;
    if (unavailable) {
      target.add(new Option('No available target', ''));
      if (!graph) hint.textContent = 'Select an anchor and choose Branch from anchor first.';
      else if (!active?.steps.length) hint.textContent = 'Select a branch with a starting anchor.';
      else if (active.finished) hint.textContent = 'Choose Extend ending to reopen this branch.';
      else if (active.steps.length > 1 && outgoing(graph,active.steps.at(-1).anchorId).length)
        hint.textContent = 'This section continues into another section. Select the ending you want to rejoin from.';
      else if (active.steps.length > 1 && graph.sections.some(s => s !== active && s.steps.at(-1)?.anchorId === active.steps.at(-1).anchorId))
        hint.textContent = 'This ending is already shared.';
      else hint.textContent = 'No other anchor can be reached without looping back. Add a downstream anchor on the other route first.';
    }
  }
  const allOption = document.createElement('option');
  allOption.value = '-1';
  allOption.disabled = !!graph;
  allOption.textContent = 'All segments';
  els.segmentSelect.replaceChildren(allOption, ...segments.map((segment, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    const depth = graph ? focusedRoute(graph,segment).slice(0,focusedRoute(graph,segment).indexOf(segment)+1).filter(s => outgoing(graph,startId(s)).length > 1).length : 0;
    option.textContent = `${'　'.repeat(depth)}${segment.name} (${getSegmentPoints(path, segment.id).length} points)`;
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
  els.pointMoveStatus.textContent = '';
  const segment = segments[path.activeSegment];
  const modes = new Set(segment ? getSegmentPoints(path, segment.id).slice(1).map(getHeadingMode) : []);
  els.segmentHeadingMode.disabled = modes.size === 0;
  els.segmentHeadingMode.value = modes.size > 1 ? 'mixed' : [...modes][0] || 'linear';
  els.pointHeadingMode.disabled = !selectedPoint || state.selected <= 0 || !!selectedPoint.breakBefore;
  els.pointHeadingMode.value = getHeadingMode(selectedPoint);
  els.segmentName.disabled = !segment;
  els.segmentName.value = segment?.name || '';
  els.segmentName.placeholder = segment ? 'Collect samples' : 'Select a segment to rename';
  const count = graph?.anchors.length ?? path.points.length;
  document.getElementById('anchorCount').textContent = count + ' / ' + MAX_PATH_POINTS + ' anchors';
  const messages = graph ? graphWarnings(graph) : [];
  if (count >= MAX_PATH_POINTS) messages.push('Point limit reached.');
  if (segment?.finished) messages.unshift('Independent ending.');
  els.segmentStatus.textContent = messages.join('\n');
  els.splitSegment.disabled = !!state.selectedControl || !canSplitPathSegment(path, state.selected);
  els.deleteSegment.disabled = !canRemovePathSegment(path, path.activeSegment);
  if (graph) {
    const owner = segments.find(s => s.id === selectedPoint?.segmentId);
    els.splitSegment.disabled = !canStartSegment(graph,owner,selectedPoint?.anchorId);
    for (const el of [els.pointAsSegment,els.movePointSegment,els.deleteSegment,els.addSegment]) el.disabled = true;
  }
  els.deleteSegment.title = !segment ? 'Select a segment to remove its label.' : segments.length <= 1 ? 'Keep at least one segment in this path.' : els.deleteSegment.disabled ? 'Disconnected routes need separate segment labels.' : 'Keep the points and merge this label into its neighbor.';
}

function installPreviewControls() {
  const panel = document.createElement('div');
  panel.className = 'panel-group';
  panel.innerHTML = `

    <label class="row">
      <span class="custom-checkbox-wrapper">
        <input type="checkbox" id="previewToggle" class="hidden-checkbox">
        <label for="previewToggle" class="custom-checkbox-label">
          <span class="custom-checkbox-box"></span>Enable preview
        </label>
      </span>
    </label>
    <p class="small">Select All segments to see the full path step-through.</p>
    <div class="row">
      <button id="previewPrev">Prev</button>
      <button id="previewNext">Next</button>
      <button id="previewAll">All</button>
      <button id="previewNone">None</button>
    </div>
    <div class="row"><input type="range" aria-label="Preview step" id="previewSlider" min="-1" max="-1" value="-1" step="1"></div>
    <label class="row">
      <span class="custom-checkbox-wrapper">
        <input type="checkbox" id="dimFutureToggle" class="hidden-checkbox" checked>
        <label for="dimFutureToggle" class="custom-checkbox-label">
          <span class="custom-checkbox-box"></span>Dim future points
        </label>
      </span>
    </label>
    <small id="previewStatus" class="small"></small>`;
  document.getElementById('previewPanel').append(panel);

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
    slider.max = String(Math.max(-1, previewCount(path) - 1));
    slider.value = String(path.previewIndex);
    toggle.checked = path.previewEnabled;
    dimFuture.checked = state.dimFuture;
    status.textContent = path.previewEnabled
      ? `Showing ${getVisibleWaypointCount()} of ${previewCount(path)} anchors`
      : `Preview disabled • ${path.points.length} anchors`;
  };
  refreshPreviewUI();
}

function installTransformControls() {
  const panel = document.createElement('div');
  panel.className = 'panel-group';
  panel.innerHTML = `
    <h3>Path tools</h3>
    <div class="row">
      <button data-transform="mirrorX">Mirror X</button>
      <button data-transform="mirrorY">Mirror Y</button>
    </div>
    <div class="row">
      <button data-transform="rotCCW">↶ 90°</button>
      <button data-transform="rotCW">↷ 90°</button>
      <button data-transform="rot180">180°</button>
    </div>`;
  document.getElementById('transforms').append(panel);
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

export function addConnectionControl(pointIndex = state.selected) {
  const path = state.paths[state.activePath];
  const point = path.points[pointIndex];
  if (!isPedroPathingSelected() || !point || pointIndex < 1 || point.breakBefore ||
      (point.controlPoints?.length || 0) >= 2) return false;
  pushHistory();
  const controlIndex = addControlPoint(path, pointIndex);
  state.selected = pointIndex;
  state.selectedControl = { pointIndex, controlIndex };
  focusPointSegment(path, pointIndex, true);
  refreshAll();
  return true;
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
      if (isPedroPathingSelected()) {
        state.selected = focusRejoin(path,state.selected);
        focusPointSegment(path,state.selected);
      }
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
      if (isPedroPathingSelected()) focusPointSegment(path, state.selected, true);
      refreshAll();
    });
  });
  els.pointRows.querySelectorAll('.add-control').forEach(button => {
    button.addEventListener('click', () => addConnectionControl(Number(button.dataset.point)));
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
  if (path.graph) {
    const p = path.points[index], q = path.points[target];
    if (!q || q.segmentId !== p.segmentId) return;
    const s = path.segments.find(s => s.id === p.segmentId);
    const i = s.steps.findIndex(item => item.anchorId === p.anchorId), j = i + direction;
    if (Math.min(i,j) < 1 || Math.max(i,j) >= s.steps.length-1) return;
    pushHistory();
    [s.steps[i],s.steps[j]] = [s.steps[j],s.steps[i]];
    bindGraph(path); state.selected = target; refreshAll(); return;
  }
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
  const transformedPoints = path.points.map(point => {
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
  if (path.graph) transformedPoints.forEach((point,i) => Object.assign(path.points[i],point));
  else path.points = transformedPoints;
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


function formatDeg(rad) {
  if (state.headingWrapHalf) return normalize(rad) * 180 / Math.PI;
  let degrees = (rad * 180 / Math.PI) % 360;
  if (degrees < 0) degrees += 360;
  return degrees;
}
