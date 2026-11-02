import { els, canvas } from './els.js';
import { setCanvasSize } from './layout.js';
import { draw } from './draw.js';
import { initUI, setActivePath, updateTable } from './ui.js';
import { initInteractions } from './interactions.js';
import { initImageIO, loadImage } from './io_image.js';
import { initExport } from './io_export.js';
import { initImport } from './io_import.js';
import { initFieldConfigUI } from './field_config.js';
import { initExclusionBox } from './exclusion_zone.js';
import { state } from './state.js';
import { initPersistence, readUploadedMap, restoreAppState, restoreControls } from './persistence.js';

// Boot order matters a bit: UI labels, image IO, interactions, import/export, first draw.
async function boot(){
  const saved = restoreAppState();
  setCanvasSize();
  initFieldConfigUI();
  restoreControls(saved?.controls);
  initUI();
  initImageIO();
  initInteractions();
  initExclusionBox(() => { updateTable(); draw(); });
  initImport();
  initExport();
  setActivePath(state.activePath, { preserveSelection: true });
  const source = state.imageSource;
  if (source) {
    let objectUrl;
    try {
      if (source.kind === 'upload') {
        const file = await readUploadedMap();
        if (file) objectUrl = URL.createObjectURL(file);
      }
      await loadImage(objectUrl || (source.kind === 'url' ? source.url : ''), source.kind === 'url', null, { source });
    } catch (error) {
      console.warn('The saved map could not be restored.', error);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
  // Loading a map synchronizes preset controls; restore the user's overrides
  // afterwards, especially the library, format, and uncommitted field edits.
  restoreControls(saved?.controls);
  els.javaType.dispatchEvent(new Event('change'));
  restoreControls(saved?.controls);
  initPersistence();
  requestAnimationFrame(draw);
}

window.addEventListener('resize', ()=>{ setCanvasSize(); draw(); });

// Panel contents, wrapping text and nested disclosures can resize the field
// without a window resize. Keep the drawing buffer synchronized in every case.
const canvasResizeObserver = new ResizeObserver(() => { setCanvasSize(); draw(); });
canvasResizeObserver.observe(canvas);

boot();
