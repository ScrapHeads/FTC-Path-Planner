import { ctx, dpi } from './els.js';
import { state, pushHistory } from './state.js';
import { canvasToImagePx, imagePxToField, fieldToCanvas } from './layout.js';
import { saveAppState } from './persistence.js';
import { defaultZones, normalizeZones } from './exclusion_model.js';
import { collisionReport } from './collision_state.js';

const OPTIONS = { unit: 'in', origin: 'bottomLeft', coordinateSystem: 'pedro' };
const element = id => document.getElementById(id);
let renderedZones;
let renderedZoneArray;
let refreshEditor = () => {};
export function isExclusionDrawingEnabled() { return !!element('exclusionEnabled')?.checked; }
export function startExclusionBox(mouse) {
  const point = boundedPoint(mouse);
  state.exclusionBox = { start: point, end: point };
}
export function moveExclusionBox(mouse) { if (state.exclusionBox) state.exclusionBox.end = boundedPoint(mouse); }
function boundedPoint(mouse) {
  const point = canvasToImagePx(mouse.x, mouse.y);
  return { x: Math.max(0, Math.min(state.img.width, point.x)), y: Math.max(0, Math.min(state.img.height, point.y)) };
}
function draftZone() {
  const box = state.exclusionBox;
  if (!box || !state.imgLoaded) return null;
  const a = imagePxToField(box.start.x, box.start.y, OPTIONS), b = imagePxToField(box.end.x, box.end.y, OPTIONS);
  if (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) return null;
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}
function nextId() { let n = 1; while (state.exclusionZones.some(zone => zone.id === `zone${n}`)) n++; return `zone${n}`; }
export function finishExclusionBox() {
  const zone = draftZone();
  if (zone && state.exclusionZones.length < 100) {
    pushHistory(); state.exclusionZones.push({ ...zone, id: nextId(), name: `Zone ${state.exclusionZones.length + 1}`, enabled: true });
  }
  state.exclusionBox = null; refreshEditor();
}
export function drawExclusionBox() {
  if (state.imgLoaded) {
    for (const zone of state.exclusionZones) drawZone(zone);
    const draft = draftZone();
    if (draft) drawZone({ ...draft, name: 'New zone', enabled: true });
  }
  const draft = draftZone(), output = element('exclusionOutput'), copy = element('copyExclusionBtn');
  if (output) output.value = draft ? `new ExclusionZone(${draft.minX}, ${draft.minY}, ${draft.maxX}, ${draft.maxY})` : '';
  if (copy) copy.disabled = !draft && !state.exclusionZones.length;
  refreshEditor();
}
function drawZone(zone) {
  const p = fieldToCanvas(zone.minX, zone.maxY, OPTIONS), q = fieldToCanvas(zone.maxX, zone.minY, OPTIONS);
  ctx.save();
  ctx.fillStyle = zone.enabled ? 'rgba(255,190,60,0.22)' : 'rgba(148,163,184,0.08)';
  ctx.strokeStyle = zone.enabled ? '#ffca62' : '#94a3b8'; ctx.lineWidth = 2 * dpi;
  if (!zone.enabled) ctx.setLineDash([5 * dpi, 4 * dpi]);
  ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y); ctx.strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
  ctx.font = `${11 * dpi}px sans-serif`; ctx.fillStyle = zone.enabled ? '#ffca62' : '#94a3b8';
  ctx.fillText(`${zone.name}${zone.enabled ? '' : ' (disabled)'}`, p.x + 4 * dpi, Math.max(13 * dpi, p.y - 5 * dpi)); ctx.restore();
}
export function initExclusionBox(draw) {
  const list = element('exclusionZoneList');
  const panel = element('exclusionPanel');
  panel.open = state.exclusionPanelOpen !== false;
  panel.addEventListener('toggle', event => {
    if (event.target !== panel) return;
    state.exclusionPanelOpen = panel.open;
    saveAppState();
  });
  refreshEditor = () => {
    if (!list?.replaceChildren) return;
    element('collisionEnabled').checked = state.exclusionSettings.checkingEnabled;
    element('exportExclusionZones').checked = state.exclusionSettings.exportEnabled;
    if (document.activeElement !== element('zoneMargin')) element('zoneMargin').value = state.exclusionSettings.marginIn;
    const report = collisionReport();
    const names = id => state.exclusionZones.find(zone => zone.id === id)?.name || id;
    const details = report.paths.flatMap((path, index) => {
      const ids = new Set([...path.anchors.flat(), ...Object.values(path.connections).flat().map(hit => hit.zoneId)]);
      return ids.size ? [`${state.paths[index].name}: ${[...ids].map(names).join(', ')}`] : [];
    });
    element('collisionStatus').textContent = !state.exclusionSettings.checkingEnabled ? 'Collision checking is off. Zones remain saved.'
      : !state.imgLoaded ? 'Load a field image to check collisions.' : details.length ? `Collision warning — ${details.join('; ')}` : 'No collisions detected with enabled zones.';
    element('collisionStatus').classList.toggle('collision-warning', details.length > 0 && report.active);
    const summary = element('exclusionSummaryStatus');
    summary.textContent = `(${state.exclusionZones.length})${details.length && report.active ? ' — collision warning' : ''}`;
    summary.classList.toggle('collision-warning', details.length > 0 && report.active);
    const signature = JSON.stringify(state.exclusionZones);
    if (signature === renderedZones && renderedZoneArray === state.exclusionZones) return;
    renderedZones = signature;
    renderedZoneArray = state.exclusionZones;
    list.replaceChildren(...state.exclusionZones.map((zone, index) => {
      const row = document.createElement('div'); row.className = 'zone-editor';
      const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = zone.enabled;
      enabled.setAttribute('aria-label', `Enable zone ${index + 1}`);
      enabled.addEventListener('change', () => { pushHistory(); zone.enabled = enabled.checked; draw(); });
      const name = document.createElement('input'); name.type = 'text'; name.value = zone.name; name.maxLength = 120;
      name.setAttribute('aria-label', `Zone ${index + 1} name`);
      name.addEventListener('change', () => { pushHistory(); zone.name = name.value.trim() || `Zone ${index + 1}`; draw(); });
      const remove = document.createElement('button'); remove.textContent = 'Delete'; remove.setAttribute('aria-label', `Delete zone ${index + 1}`);
      remove.addEventListener('click', () => { pushHistory(); state.exclusionZones.splice(index, 1); draw(); });
      row.append(enabled, name, remove);
      const fields = document.createElement('div'); fields.className = 'zone-coordinates';
      for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
        const label = document.createElement('label'); label.textContent = key;
        const input = document.createElement('input'); input.type = 'number'; input.step = 'any'; input.value = zone[key]; input.setAttribute('aria-label', `Zone ${index + 1} ${key} in inches`);
        input.addEventListener('change', () => {
          try {
            if (input.value.trim() === '') throw new Error('Enter a coordinate.');
            const updated = normalizeZones([{ ...zone, [key]: Number(input.value) }])[0];
            input.setCustomValidity(''); pushHistory(); Object.assign(zone, updated); draw();
          } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
        });
        label.appendChild(input); fields.appendChild(label);
      }
      row.appendChild(fields); return row;
    }));
  };
  element('exclusionEnabled').addEventListener('change', () => { state.exclusionBox = null; state.dragMode = null; draw(); });
  element('clearExclusionBtn').addEventListener('click', () => {
    if (!state.exclusionZones.length || !confirm('Delete all exclusion zones?')) return;
    pushHistory(); state.exclusionZones = []; state.exclusionBox = null; state.exclusionSettings.biobuzzInitialized = true; draw();
  });
  element('resetExclusionBtn').addEventListener('click', () => {
    if (!confirm('Replace the current zones with the two Bio Buzz defaults?')) return;
    pushHistory(); state.exclusionZones = defaultZones(); state.exclusionSettings.biobuzzInitialized = true; draw();
  });
  element('addExclusionBtn').addEventListener('click', () => {
    if (state.exclusionZones.length >= 100) return;
    pushHistory(); state.exclusionZones.push({ id: nextId(), name: `Zone ${state.exclusionZones.length + 1}`, enabled: true, minX: 66, minY: 66, maxX: 78, maxY: 78 }); draw();
  });
  for (const [id, key] of [['collisionEnabled', 'checkingEnabled'], ['exportExclusionZones', 'exportEnabled']]) {
    element(id).addEventListener('change', () => { pushHistory(); state.exclusionSettings[key] = element(id).checked; draw(); });
  }
  element('zoneMargin').addEventListener('change', () => {
    const input = element('zoneMargin'), value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value) || value < 0 || value > 144) { input.setCustomValidity('Use a clearance from 0 to 144 inches.'); input.reportValidity(); return; }
    input.setCustomValidity(''); pushHistory(); state.exclusionSettings.marginIn = value; draw();
  });
  element('copyExclusionBtn').addEventListener('click', async () => {
    const zones = draftZone() ? [draftZone()] : state.exclusionZones.filter(zone => zone.enabled);
    const text = zones.map(zone => `new ExclusionZone(${zone.minX}, ${zone.minY}, ${zone.maxX}, ${zone.maxY})`).join(',\n');
    try { await navigator.clipboard.writeText(text); }
    catch { element('exclusionOutput').value = text; element('exclusionOutput').focus(); element('exclusionOutput').select(); }
  });
  refreshEditor();
}
