import { els, canvas, toMeters } from './els.js';
import { state } from './state.js';

export function setCanvasSize(){
  const wrap = canvas.parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const dpi = window.devicePixelRatio || 1;
  canvas.width = Math.max(320, Math.floor(w * dpi));
  canvas.height = Math.max(240, Math.floor(h * dpi));
}

export function pxPerMeter(){
  if(!state.imgLoaded) return 1;
  const fieldM = toMeters(parseFloat(els.fieldSize.value || '3.66'));
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
  const ppm = pxPerMeter();
  const iw = state.img.width, ih = state.img.height;
  const origin = els.originSelect.value;
  const ftc = els.axesFtc.checked;
  let X, Y;
  if(ftc){
    if(origin === 'center'){
      X = -(iy - ih/2) / ppm;
      Y = -(ix - iw/2) / ppm;
    } else if(origin === 'topLeft'){
      X = -iy / ppm;
      Y = -ix / ppm;
    } else {
      X = -(iy - ih) / ppm;
      Y = -ix / ppm;
    }
  } else {
    if(origin === 'center'){
      X =  (ix - iw/2) / ppm;
      Y =  (iy - ih/2) / ppm;
    } else if(origin === 'topLeft'){
      X =  ix / ppm;
      Y =  iy / ppm;
    } else {
      X =  ix / ppm;
      Y =  (iy - ih) / ppm;
    }
  }
  return { x:X, y:Y };
}

export function fieldToImagePx(X, Y){
  const ppm = pxPerMeter();
  const iw = state.img.width, ih = state.img.height;
  const origin = els.originSelect.value;
  const ftc = els.axesFtc.checked;
  let ix, iy;
  if(ftc){
    if(origin === 'center'){
      ix = (-Y)*ppm + iw/2;
      iy = (-X)*ppm + ih/2;
    } else if(origin === 'topLeft'){
      ix = (-Y)*ppm;
      iy = (-X)*ppm;
    } else {
      ix = (-Y)*ppm;
      iy = ih - X*ppm;
    }
  } else {
    if(origin === 'center'){
      ix = X*ppm + iw/2;
      iy = Y*ppm + ih/2;
    } else if(origin === 'topLeft'){
      ix = X*ppm;
      iy = Y*ppm;
    } else {
      ix = X*ppm;
      iy = Y*ppm + ih;
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
