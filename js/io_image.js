import { els } from './els.js';
import { state } from './state.js';
import { setCanvasSize } from './layout.js';
import { draw } from './draw.js';

export function initImageIO(){
  els.imgInput.addEventListener('change', e=>{
    const file = e.target.files[0]; if(!file) return;
    loadImage(URL.createObjectURL(file), false);
  });
  els.sampleSelect.addEventListener('change', e=>{
    if(!e.target.value) return;
    loadImage(e.target.value, true);
  });

  const dz = els.dropZone;
  ['dragenter','dragover'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.add('dragging'); }));
  ['dragleave','drop'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragging'); }));
  dz.addEventListener('drop', e=>{
    const file = e.dataTransfer.files && e.dataTransfer.files[0]; if(!file) return;
    loadImage(URL.createObjectURL(file), false);
  });
  ['dragover','drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); }));
}

export function loadImage(url, remote){
  state.img = new Image();
  if(remote) state.img.crossOrigin = 'anonymous';
  state.img.onload = ()=>{ state.imgLoaded = true; setCanvasSize(); draw(); };
  state.img.onerror = (e)=>{ state.imgLoaded = false; console.error('Image load error', e); alert('Could not load image'); draw(); };
  state.img.src = url;
}
