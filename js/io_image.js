import { els, updateAxesUI } from './els.js';
import { state } from './state.js';
import { setCanvasSize } from './layout.js';
import { draw } from './draw.js';
import { applyPresetConfig, getPreset, getPresetSource, syncConfigUI } from './field_config.js';
import { syncSelectedUI, updateTable } from './ui.js';
import { saveUploadedMap, saveAfterImageLoad } from './persistence.js';

export function initImageIO() {
  els.imgInput.addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirmPreserveExistingPaths()) {
      event.target.value = '';
      return;
    }
    const normalizedGeometry = captureNormalizedGeometry();
    state.fieldConfig.presetId = '';
    if (els.sampleSelect) els.sampleSelect.value = '';
    const objectUrl = URL.createObjectURL(file);
    loadImage(objectUrl, false, () => restoreNormalizedGeometry(normalizedGeometry), { file })
      .catch(() => {}) // loadImage reports the error.
      .finally(() => URL.revokeObjectURL(objectUrl));
  });

  els.sampleSelect.addEventListener('change', async event => {
    const preset = getPreset(event.target.value);
    if (!preset) return;

    const hasPoints = state.paths.some(path => path.points.length > 0);
    if (hasPoints && !confirm('Change field preset and preserve the existing paths?')) {
      syncConfigUI();
      return;
    }

    const normalizedGeometry = captureNormalizedGeometry();
    applyPresetConfig(preset.id);
    els.javaType?.dispatchEvent(new Event('change'));
    try {
      await loadImage(preset.src, true, () => restoreNormalizedGeometry(normalizedGeometry));
    } catch {
      // loadImage already reports the user-facing error.
    }
  });

  const dz = els.dropZone;
  ['dragenter', 'dragover'].forEach(name => dz.addEventListener(name, event => {
    event.preventDefault();
    event.stopPropagation();
    dz.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(name => dz.addEventListener(name, event => {
    event.preventDefault();
    event.stopPropagation();
    dz.classList.remove('dragging');
  }));
  dz.addEventListener('drop', event => {
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    if (!confirmPreserveExistingPaths()) return;
    const normalizedGeometry = captureNormalizedGeometry();
    state.fieldConfig.presetId = '';
    if (els.sampleSelect) els.sampleSelect.value = '';
    const objectUrl = URL.createObjectURL(file);
    loadImage(objectUrl, false, () => restoreNormalizedGeometry(normalizedGeometry), { file })
      .catch(() => {}) // loadImage reports the error.
      .finally(() => URL.revokeObjectURL(objectUrl));
  });
  ['dragover', 'drop'].forEach(name => document.addEventListener(name, event => event.preventDefault()));
}

export function loadImage(url, remote = false, onLoad = null, options = {}) {
  return new Promise((resolve, reject) => {
    if (!url) {
      resolve(null);
      return;
    }
    const image = new Image();
    if (remote) image.crossOrigin = 'anonymous';
    image.onload = async () => {
      const uploaded = options.file ? await saveUploadedMap(options.file) : false;
      state.img = image;
      state.imgLoaded = true;
      state.imageSource = options.file
        ? (uploaded ? { kind: 'upload' } : null)
        : (options.source || { kind: 'url', url });
      if (typeof onLoad === 'function') onLoad(image);
      syncConfigUI();
      updateAxesUI();
      syncSelectedUI();
      updateTable();
      setCanvasSize();
      draw();
      saveAfterImageLoad();
      resolve(image);
    };
    image.onerror = error => {
      state.imgLoaded = false;
      console.error('Image load error', error);
      alert('Could not load image');
      draw();
      reject(new Error('Could not load image'));
    };
    image.src = url;
  });
}

export async function loadPresetImage(presetValue, onLoad = null) {
  const source = getPresetSource(presetValue);
  if (!source) return null;
  return loadImage(source, true, onLoad);
}

function captureNormalizedGeometry() {
  if (!state.imgLoaded || !state.img.width || !state.img.height) return null;
  return state.paths.map(path => path.points.map(point => ({
    point,
    x: point.xPx / state.img.width,
    y: point.yPx / state.img.height,
    controls: (point.controlPoints || []).map(control => ({
      control,
      x: control.xPx / state.img.width,
      y: control.yPx / state.img.height
    }))
  })));
}

function restoreNormalizedGeometry(snapshot) {
  if (!snapshot) return;
  snapshot.forEach(path => path.forEach(item => {
    item.point.xPx = item.x * state.img.width;
    item.point.yPx = item.y * state.img.height;
    item.controls.forEach(controlItem => {
      controlItem.control.xPx = controlItem.x * state.img.width;
      controlItem.control.yPx = controlItem.y * state.img.height;
    });
  }));
}

function confirmPreserveExistingPaths() {
  return !state.paths.some(path => path.points.length > 0) ||
    confirm('Change field image and preserve the existing paths?');
}
