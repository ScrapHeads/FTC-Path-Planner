import { state } from './state.js';
import { collisionReport } from './collision_state.js';
import { isPedroPathingSelected } from './els.js';
import { focusedRoute } from './branch_graph.js';
import { sectionDiagram, positionNode, routeOutline } from './route_diagram.js';
import { saveAppState } from './persistence.js';
import { doExport } from './io_export.js';

const byId = id => document.getElementById(id);
const prefs = () => state.workspaceView;
function slot() {
  const view = prefs().slots[state.activePath] ||= { positions: {}, orientation: 'vertical' };
  if (view.orientation !== 'vertical') {
    // Convert dragged positions from the former 220-by-70 horizontal layout.
    for (const point of Object.values(view.positions)) {
      const {x, y} = point;
      point.x = y * 190 / 70;
      point.y = x * 80 / 220;
    }
    delete view.camera;
    view.orientation = 'vertical';
  }
  return view;
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const width = 158, height = 42;
let lastDiagram, diagram, selectSection, gesture, ready = false;

function svg(tag, attrs, parent, content) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  if (content !== undefined) el.textContent = content;
  parent.append(el);
  return el;
}

function fit(nodes) {
  const box = byId('diagram').getBoundingClientRect();
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const left = Math.min(...xs), top = Math.min(...ys);
  const w = Math.max(...xs) - left + width, h = Math.max(...ys) - top + height;
  const k = Math.max(0.02, Math.min(1.2, (box.width - 28) / w, (box.height - 16) / h));
  return { k, x: (box.width - w*k)/2 - left*k, y: (box.height - h*k)/2 - top*k };
}

function paint() {
  const scene = byId('graphScene');
  const focus = document.activeElement?.getAttribute('data-key');
  scene.replaceChildren();
  if (!diagram.nodes.length) return;
  const nodes = diagram.nodes.map(n => ({ ...n, ...slot().positions[n.id] }));
  const {x,y,k} = slot().camera || fit(nodes);
  scene.setAttribute('transform', 'translate('+x+' '+y+') scale('+k+')');
  const lookup = new Map(nodes.map(n => [n.id,n]));
  for (const e of diagram.edges) {
    const a = lookup.get(e.from), b = lookup.get(e.to);
    const x1 = a.x + width / 2, y1 = a.y + height;
    const x2 = b.x + width / 2, y2 = b.y;
    const midY = (y1 + y2) / 2;
    const d = `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
    svg('path',{d, class:'wire', 'marker-end':'url(#arrow)'},scene);
    svg('path',{d, class:'wire-hit', tabindex:0, role:'button', 'data-key':'edge'+a.index+'-'+b.index,
      'aria-label':a.name+' to '+b.name+', select junction', 'data-index':b.index, 'data-point':e.point},scene);
  }
  for (const n of nodes) {
    const group = svg('g',{transform:'translate('+n.x+' '+n.y+')',class:'section-node'+(n.active?' active':'')+(n.dim?' dim':''),
      role:'button',tabindex:0,'aria-pressed':n.active,'aria-label':n.name+(n.collision?', collision':''),'data-key':'node'+n.index,'data-index':n.index},scene);
    svg('title',{},group,n.name+(n.collision?' · Collision':''));
    svg('rect',{width,height,rx:6},group);
    svg('rect',{x:0,y:7,width:4,height:height-14,rx:2,fill:n.color},group);
    const limit = n.collision ? 14 : 18;
    svg('text',{x:12,y:26},group,n.name.length>limit?n.name.slice(0,limit-1)+'…':n.name);
    if(n.collision) svg('text',{x:width-19,y:26,class:'warning'},group,'⚠');
  }
  if (focus) [...scene.querySelectorAll('[data-key]')].find(el=>el.dataset.key===focus)?.focus({preventScroll:true});
}

export function refreshWorkspace() {
  if (!ready) return;
  const path=state.paths[state.activePath], point=path.points[state.selected];
  const control=state.selectedControl, section=path.segments?.[path.activeSegment];
  const pedro=isPedroPathingSelected();
  byId('chooseField').hidden=state.imgLoaded;
  byId('poseControls').hidden=!point;
  byId('headingDeg').parentElement.hidden=!!control;
  byId('editorHint').hidden=!!point || !!section && pedro;
  const library = byId('javaType').value;
  byId('inspectorMode').textContent = {rr:'RoadRunner', ftclib:'FTCLib', RilLib:'RilLib', pedro:'Pedro'}[library] || '';
  byId('sectionFields').hidden = !section;
  byId('connectionControls').hidden = !pedro || !point || !!control || state.selected < 1 || point.breakBefore;
  byId('pointTransfer').hidden = !pedro || !!path.graph || !point || !!control || byId('pointSegmentTarget').disabled;
  byId('deleteBtn').textContent = control ? 'Delete control' : 'Delete anchor';
  byId('selectionTitle').textContent=control?'Bézier control '+(control.controlIndex+1):'Anchor '+(state.selected+1);
  byId('inspectorLock').checked=!!(control?point?.controlPoints[control.controlIndex]:point)?.locked;
  byId('addHandle').hidden=!pedro || !point || !!control || state.selected<1 || point.breakBefore || point.controlPoints.length>=2;
  for(const el of document.querySelectorAll('[data-selection="anchor"]')) el.hidden=!point || !!control;
  byId('allBranches').parentElement.hidden=!path.graph;
  byId('previewButton').textContent=path.previewEnabled?'Preview · '+(path.previewIndex+1):'Preview';
  const warning=byId('collisionStatus').classList.contains('collision-warning');
  byId('collisionButton').textContent=warning?'Collision warning':state.exclusionSettings.checkingEnabled?'Collisions':'Collisions off';
  byId('collisionButton').classList.toggle('warning',warning);

  diagram=pedro?sectionDiagram(path,collisionReport().paths[state.activePath]):{nodes:[],edges:[]};
  const route=path.graph?focusedRoute(path.graph,section):[];
  const order=[...new Set(route.flatMap(s=>s.steps.map(p=>p.anchorId)))];
  const visible=new Set(order.slice(0,path.previewIndex+1));
  for(const n of diagram.nodes) {
    n.active=n.index===path.activeSegment;
    n.dim=path.graph && !path.compareBranches && !route.some(s=>s.id===n.id) ||
      path.previewEnabled && !n.keys.some(id=>path.graph?visible.has(id):id<=path.previewIndex);
  }
  renderNavigator(path);
  if(prefs().collapsed || prefs().tab==='table') return;
  byId('emptyGraph').hidden=!!diagram.nodes.length;
  const signature=JSON.stringify([state.activePath,diagram]);
  if(signature!==lastDiagram){lastDiagram=signature;paint();}
}

function panels() {
  const p=prefs(), table=p.tab==='table';
  byId('routesPanel').hidden = !!p.routesClosed;
  byId('routesToggle').setAttribute('aria-expanded', !p.routesClosed);
  byId('inspectorDivider').hidden = !!p.inspectorClosed;
  byId('inspector').hidden=!!p.inspectorClosed;
  byId('inspectToggle').setAttribute('aria-expanded',!p.inspectorClosed);
  byId('dockBody').hidden=!!p.collapsed;
  byId('dockToggle').textContent=p.collapsed?'Expand':'Collapse';
  byId('dockToggle').setAttribute('aria-label',p.collapsed?'Expand panel':'Collapse panel');
  byId('dockToggle').setAttribute('aria-expanded',!p.collapsed);
  byId('graphTab').setAttribute('aria-pressed',!table);
  byId('tableTab').setAttribute('aria-pressed',table);
  byId('graphPanel').hidden=table;
  byId('tablePanel').hidden=!table;
  byId('dock').style.setProperty('--panel-height',(p.height||180)+'px');
  lastDiagram=null;
  refreshWorkspace();
}

function zoom(factor) {
  if(!diagram?.nodes.length) return;
  const nodes=diagram.nodes.map(n=>({...n,...slot().positions[n.id]}));
  const c=slot().camera || fit(nodes), box=byId('diagram').getBoundingClientRect();
  const k=clamp(c.k*factor,0.02,4), ratio=k/c.k;
  slot().camera={k,x:box.width/2+(c.x-box.width/2)*ratio,y:box.height/2+(c.y-box.height/2)*ratio};
  paint();
}

export function initWorkspace(onSelect) {
  selectSection=onSelect;
  const p=prefs();
  if(p.inspectorClosed===undefined) p.inspectorClosed=matchMedia('(max-width: 760px)').matches;
  p.routesClosed ??= matchMedia('(max-width: 760px)').matches;
  p.collapsed ??= true;
  initPreviewWindow(p);
  initInspectorWidth(p);
  byId('routesToggle').onclick = () => { p.routesClosed = !p.routesClosed; panels(); };
  for (const mode of ['routes', 'points']) {
    byId(mode + 'Tab').onclick = () => { p.navigator = mode; refreshWorkspace(); };
  }
  byId('routeList').onclick = event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.point !== undefined) {
      byId('pointRows').querySelector('.select-anchor[data-point="' + button.dataset.point + '"]')?.click();
    } else selectSection(Number(button.dataset.section));
  };
  for (const button of document.querySelectorAll('[data-dialog]')) {
    button.onclick = () => {
      const dialog = byId(button.dataset.dialog);
      if (dialog.id === 'exportDialog') doExport();
      dialog.showModal();
    };
  }
  byId('inspectToggle').onclick=()=>{p.inspectorClosed=!p.inspectorClosed;panels();};
  byId('dockToggle').onclick=()=>{p.collapsed=!p.collapsed;panels();};
  for(const tab of ['graph','table']) byId(tab+'Tab').onclick=()=>{p.tab=tab;p.collapsed=false;panels();};
  const resize=height=>{p.height=clamp(height,90,Math.max(120,innerHeight*0.46));panels();};
  const divider=byId('divider');
  divider.onkeydown=e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();resize((p.height||180)+(e.key==='ArrowUp'?16:-16));}};
  divider.onpointerdown=e=>{divider.setPointerCapture(e.pointerId);const start=e.clientY,h=byId('dockBody').offsetHeight;
    divider.onpointermove=ev=>resize(h+start-ev.clientY);};
  divider.onlostpointercapture=()=>{divider.onpointermove=null;saveAppState();};
  byId('fitGraph').onclick=()=>{delete slot().camera;paint();};
  byId('autoLayout').onclick=()=>{slot().positions={};delete slot().camera;paint();};
  byId('zoomIn').onclick=()=>zoom(1.25);
  byId('zoomOut').onclick=()=>zoom(0.8);
  const graph=byId('diagram');
  const activate=el=>{if(el)selectSection(Number(el.dataset.index),el.hasAttribute('data-point')?Number(el.dataset.point):-1);};
  graph.onkeydown=e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();activate(e.target.closest('[data-index]'));}
    if(e.key.startsWith('Arrow') && diagram.nodes.length){
      e.preventDefault();
      const c=slot().camera ||= fit(diagram.nodes.map(n=>({...n,...slot().positions[n.id]})));
      c.x+=({ArrowLeft:24,ArrowRight:-24}[e.key]||0);c.y+=({ArrowUp:24,ArrowDown:-24}[e.key]||0);paint();
    }
  };
  graph.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15);},{passive:false});
  graph.onpointerdown=e=>{
    if(e.button!==0 || !diagram.nodes.length)return;
    if (document.activeElement?.matches('input, textarea, select')) document.activeElement.blur();
    const target=e.target.closest('[data-index]');
    const nodes=diagram.nodes.map(n=>({...n,...slot().positions[n.id]}));
    const camera=slot().camera || fit(nodes);
    gesture={target,node:target?.matches('.section-node')?nodes[Number(target.dataset.index)]:null,
      camera,x:e.clientX,y:e.clientY,moved:false};
    graph.setPointerCapture(e.pointerId);
  };
  graph.onpointermove=e=>{
    if(!gesture)return;
    const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
    if(!gesture.moved && Math.hypot(dx,dy)<4)return;
    gesture.moved=true;
    const {node,camera}=gesture;
    slot().camera={...camera};
    if(node)slot().positions=positionNode(slot().positions,node.id,node.x+dx/camera.k,node.y+dy/camera.k);
    else {slot().camera.x+=dx;slot().camera.y+=dy;}
    paint();
  };
  graph.onpointerup=()=>{if(gesture && !gesture.moved)activate(gesture.target);gesture=null;saveAppState();};
  graph.onlostpointercapture=()=>{gesture=null;};
  const tableAction=(anchor,control)=>{
    const s=state.selectedControl;
    const selector=(s?control:anchor)+'[data-point="'+state.selected+'"]'+(s?'[data-control="'+s.controlIndex+'"]':'');
    byId('pointRows').querySelector(selector)?.click();
  };
  byId('inspectorLock').onchange=()=>tableAction('.anchor-lock','.control-lock');
  new ResizeObserver(()=>{if(diagram?.nodes.length && !slot().camera)paint();}).observe(graph);
  ready=true;panels();
}

let lastNavigator;
function renderNavigator(path) {
  const points = prefs().navigator === 'points';
  byId('pointsTab').setAttribute('aria-pressed', points);
  byId('routesTab').setAttribute('aria-pressed', !points);
  const signature = JSON.stringify([points, state.activePath, path.activeSegment, state.selected,
    diagram.nodes.map(n => [n.id, n.name, n.color, n.collision]), diagram.edges,
    points ? path.points.map(p => p.segmentId) : null]);
  if (signature === lastNavigator) return;
  lastNavigator = signature;
  const list = byId('routeList');
  const focusKey = document.activeElement?.dataset.navKey;
  const fragment = document.createDocumentFragment();
  function row(text, active, depth, key) {
    const button = document.createElement('button');
    button.textContent = text;
    button.dataset.navKey = key;
    button.style.setProperty('--depth', Math.min(depth, 6));
    button.setAttribute('aria-pressed', active);
    fragment.append(button);
    return button;
  }
  if (points) {
    const names = new Map(diagram.nodes.map(n => [n.id, n.name]));
    path.points.forEach((point, index) => {
      const button = row('Anchor ' + (index + 1), index === state.selected, 0, 'p' + index);
      button.dataset.point = index;
      const section = names.get(point.segmentId);
      if (section) {
        const detail = document.createElement('small');
        detail.textContent = section;
        button.append(detail);
      }
    });
  } else {
    const lookup = new Map(diagram.nodes.map(n => [n.id, n]));
    for (const item of routeOutline(diagram)) {
      const n = lookup.get(item.id);
      const button = row(n.name, n.active, item.depth, 's' + n.index);
      button.dataset.section = n.index;
      button.style.setProperty('--route-color', n.color);
      if (item.joined) button.title = 'Shared continuation';
      if (n.collision) {
        const badge = document.createElement('span');
        badge.textContent = '⚠';
        badge.className = 'warning';
        badge.setAttribute('aria-label', 'Collision');
        button.append(badge);
      }
    }
  }
  if (!fragment.childNodes.length) {
    const hint = document.createElement('p');
    hint.textContent = points ? 'Press N over the field to add an anchor.' : 'Named Pedro sections appear here. Open Points to browse anchors.';
    fragment.append(hint);
  }
  list.replaceChildren(fragment);
  if (focusKey) list.querySelector('[data-nav-key="' + focusKey + '"]')?.focus({preventScroll:true});
}

function bindDrag(handle, start) {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const move = start(event);
    handle.setPointerCapture(event.pointerId);
    handle.onpointermove = move;
    handle.onlostpointercapture = () => {
      handle.onpointermove = null;
      saveAppState();
    };
  });
}

function initInspectorWidth(p) {
  const handle = byId('inspectorDivider');
  const inspector = byId('inspector');
  function resize(width) {
    p.inspectorWidth = clamp(width, 260, Math.min(760, innerWidth * 0.48));
    inspector.style.setProperty('--inspector-width', p.inspectorWidth + 'px');
    handle.setAttribute('aria-valuenow', Math.round(p.inspectorWidth));
  }
  if (Number.isFinite(p.inspectorWidth)) inspector.style.setProperty('--inspector-width', p.inspectorWidth + 'px');
  bindDrag(handle, event => {
    const start = event.clientX, width = inspector.offsetWidth;
    return next => resize(width + start - next.clientX);
  });
  handle.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    resize(inspector.offsetWidth + (event.key === 'ArrowLeft' ? 16 : -16));
  };
}

function initPreviewWindow(p) {
  const panel = byId('previewPanel'), handle = byId('previewTitle'), toggle = byId('previewButton');
  function position(x, y) {
    const left = clamp(x, 0, innerWidth - panel.offsetWidth);
    const top = clamp(y, 0, innerHeight - panel.offsetHeight);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    return {left, top};
  }
  function open(show) {
    panel.hidden = !show;
    toggle.setAttribute('aria-expanded', show);
    if (show) {
      const origin = toggle.getBoundingClientRect();
      position(p.previewPosition?.left ?? origin.left, p.previewPosition?.top ?? origin.bottom + 8);
      handle.focus({preventScroll:true});
    } else toggle.focus({preventScroll:true});
  }
  toggle.onclick = () => open(panel.hidden);
  byId('closePreview').onclick = () => open(false);
  bindDrag(handle, event => {
    const dx = event.clientX - panel.offsetLeft, dy = event.clientY - panel.offsetTop;
    return next => { p.previewPosition = position(next.clientX - dx, next.clientY - dy); };
  });
  handle.onkeydown = event => {
    const offsets = {ArrowLeft:[-16,0], ArrowRight:[16,0], ArrowUp:[0,-16], ArrowDown:[0,16]};
    const delta = offsets[event.key];
    if (!delta) return;
    event.preventDefault();
    p.previewPosition = position(panel.offsetLeft + delta[0], panel.offsetTop + delta[1]);
  };
  panel.onkeydown = event => { if (event.key === 'Escape') open(false); };
  window.addEventListener('resize', () => {
    if (!panel.hidden) position(panel.offsetLeft, panel.offsetTop);
  });
}
