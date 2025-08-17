import { els, canvas } from './els.js';
import { setCanvasSize } from './layout.js';
import { draw } from './draw.js';
import { initUI } from './ui.js';
import { initInteractions } from './interactions.js';
import { initImageIO } from './io_image.js';
import { initExport } from './io_export.js';
import { initImport } from './io_import.js';

// Boot order matters a bit: UI labels, image IO, interactions, import/export, first draw.
function boot(){
  setCanvasSize();
  initUI();
  initImageIO();
  initInteractions();
  initImport();
  initExport();
  requestAnimationFrame(draw);
}

window.addEventListener('resize', ()=>{ setCanvasSize(); draw(); });

boot();
