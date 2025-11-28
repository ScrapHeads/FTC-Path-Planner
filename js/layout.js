import { els, canvas, toMeters } from './els.js';
import { state } from './state.js';

export function setCanvasSize(){
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const dpi = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(w * dpi));
  canvas.height = Math.max(240, Math.floor(h * dpi));
}

export function pxPerFieldSize(){
  if(!state.imgLoaded) return 1;
  const fieldM = els.fieldSize.value || '3.66';
  const side = Math.min(state.img.width, state.img.height);
  return side / fieldM;
}

// field padding meters (true in image px)
const PAD_M = 0.3;

export function layout(){
  const cw = canvas.width, ch = canvas.height;
  if(!state.imgLoaded){
    const w = cw*0.8, h = ch*0.8, x=(cw-w)/2, y=(ch-h)/2;
    return { imgRect:{x,y,w,h}, imgToCanvas:1 };
  }
  const iw = state.img.width, ih = state.img.height;
  const M = PAD_M;
  const scale = Math.min(cw/(iw+2*M), ch/(ih+2*M));
  const w = iw*scale, h = ih*scale, x=(cw-w)/2, y=(ch-h)/2;
  return { imgRect:{x,y,w,h}, imgToCanvas:scale };
}

export function pxToField(cx, cy){
  const {imgRect} = layout();
  const ix = (cx - imgRect.x) * (state.img.width / imgRect.w);
  const iy = (cy - imgRect.y) * (state.img.height / imgRect.h);
  const ppfs = pxPerFieldSize();
  const iw = state.img.width, ih = state.img.height;
  const origin = els.originSelect.value;
  const ftc = els.axesFtc.checked;
  let X, Y;
  if(ftc){
    if(origin === 'center'){
      X = -(iy - ih/2) / ppfs;
      Y = -(ix - iw/2) / ppfs;
    } else if(origin === 'topLeft'){
      X = -iy / ppfs;
      Y = -ix / ppfs;
    } else {
      X = -(iy - ih) / ppfs;
      Y = -ix / ppfs;
    }
  } else {
    if(origin === 'center'){
      X =  (ix - iw/2) / ppfs;
      Y =  (iy - ih/2) / ppfs;
    } else if(origin === 'topLeft'){
      X =  ix / ppfs;
      Y =  iy / ppfs;
    } else {
      X =  ix / ppfs;
      Y =  (iy - ih) / ppfs;
    }
  }
  return { x:X, y:Y };
}

export function fieldToImagePx(X, Y){
  const ppfs = pxPerFieldSize();
  const iw = state.img.width, ih = state.img.height;
  const origin = els.originSelect.value;
  const ftc = els.axesFtc.checked;
  let ix, iy;
  if(ftc){
    if(origin === 'center'){
      ix = (-Y)*ppfs + iw/2;
      iy = (-X)*ppfs + ih/2;
    } else if(origin === 'topLeft'){
      ix = (-Y)*ppfs;
      iy = (-X)*ppfs;
    } else {
      ix = (-Y)*ppfs;
      iy = ih - X*ppfs;
    }
  } else {
    if(origin === 'center'){
      ix = X*ppfs + iw/2;
      iy = Y*ppfs + ih/2;
    } else if(origin === 'topLeft'){
      ix = X*ppfs;
      iy = Y*ppfs;
    } else {
      ix = X*ppfs;
      iy = Y*ppfs + ih;
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
