import { els, canvas } from './els.js';
import { state } from './state.js';

export function setCanvasSize(){
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const dpi = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(w * dpi));
  canvas.height = Math.max(240, Math.floor(h * dpi));
}

export function pxPerInch(){
  if(!state.imgLoaded) return 1;
  const fieldIn = parseFloat(els.fieldInches.value || '144');
  const side = Math.min(state.img.width, state.img.height);
  return side / fieldIn;
}

// field padding inches (inch-true in image px)
const PAD_IN = 12;

export function layout(){
  const cw = canvas.width, ch = canvas.height;
  if(!state.imgLoaded){
    const w = cw*0.8, h = ch*0.8, x=(cw-w)/2, y=(ch-h)/2;
    return { imgRect:{x,y,w,h}, imgToCanvas:1 };
  }
  const iw = state.img.width, ih = state.img.height;
  const M = PAD_IN * pxPerInch();
  const scale = Math.min(cw/(iw+2*M), ch/(ih+2*M));
  const w = iw*scale, h = ih*scale, x=(cw-w)/2, y=(ch-h)/2;
  return { imgRect:{x,y,w,h}, imgToCanvas:scale };
}

export function pxToField(cx, cy){
  const {imgRect} = layout();
  const ix = (cx - imgRect.x) * (state.img.width / imgRect.w);
  const iy = (cy - imgRect.y) * (state.img.height / imgRect.h);
  const ppi = pxPerInch();
  const iw = state.img.width, ih = state.img.height;
  const origin = els.originSelect.value;

  const ftc = els.axesFtc.checked;
  let X, Y;
  if(ftc){
    if(origin === 'center'){
      X = -(iy - ih/2) / ppi;
      Y = -(ix - iw/2) / ppi;
    } else if(origin === 'topLeft'){
      X = -iy / ppi;
      Y = -ix / ppi;
    } else {
      X = -(iy - ih) / ppi;
      Y = -ix / ppi;
    }
  } else {
    if(origin === 'center'){
      X =  (ix - iw/2) / ppi;
      Y =  (iy - ih/2) / ppi;
    } else if(origin === 'topLeft'){
      X =  ix / ppi;
      Y =  iy / ppi;
    } else {
      X =  ix / ppi;
      Y =  (iy - ih) / ppi;
    }
  }
  return { x:X, y:Y };
}

export function fieldToImagePx(X, Y){
  const ppi = pxPerInch();
  const iw = state.img.width, ih = state.img.height;
  const origin = els.originSelect.value;
  const ftc = els.axesFtc.checked;

  let ix, iy;
  if(ftc){
    if(origin === 'center'){
      ix = (-Y)*ppi + iw/2;
      iy = (-X)*ppi + ih/2;
    } else if(origin === 'topLeft'){
      ix = (-Y)*ppi;
      iy = (-X)*ppi;
    } else {
      ix = (-Y)*ppi;
      iy = ih - X*ppi;
    }
  } else {
    if(origin === 'center'){
      ix = X*ppi + iw/2;
      iy = Y*ppi + ih/2;
    } else if(origin === 'topLeft'){
      ix = X*ppi;
      iy = Y*ppi;
    } else {
      ix = X*ppi;
      iy = Y*ppi + ih;
    }
  }
  return { x:ix, y:iy };
}

export function fieldToCanvas(X, Y){
  const {imgRect} = layout();
  const ip = fieldToImagePx(X, Y);
  const cx = imgRect.x + ip.x * (imgRect.w / state.img.width);
  const cy = imgRect.y + ip.y * (imgRect.h / state.img.height);
  return { x:cx, y:cy };
}

export function canvasToImagePx(cx, cy){
  const {imgRect} = layout();
  return {
    x: (cx - imgRect.x) * (state.img.width / imgRect.w),
    y: (cy - imgRect.y) * (state.img.height / imgRect.h)
  };
}
