import { canvas } from './els.js';
import { state } from './state.js';
import { fromMeters } from './units.js';
import {
  fieldToImageCoordinates,
  headingToCanonical,
  imageToFieldCoordinates
} from './coordinates.js';

export function setCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const dpi = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpi));
  const height = Math.max(1, Math.round(rect.height * dpi));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

export function getFieldDimensions(unit = state.fieldConfig.measurementUnit) {
  return {
    width: fromMeters(state.fieldConfig.fieldWidthM, unit),
    height: fromMeters(state.fieldConfig.fieldHeightM, unit)
  };
}

// Kept for existing drawing code. This is horizontal image pixels per displayed field unit.
export function pxPerFieldSize() {
  if (!state.imgLoaded) return 1;
  const width = getFieldDimensions().width || 1;
  return state.img.width / width;
}

let frameLayout = null;

// All coordinate conversions in a draw share a single DOM measurement.
export function withCanvasLayout(render) {
  const previous = frameLayout;
  frameLayout = calculateLayout();
  try { return render(frameLayout); }
  finally { frameLayout = previous; }
}

export function layout() {
  return frameLayout || calculateLayout();
}

function calculateLayout() {
  const cw = canvas.width;
  const ch = canvas.height;
  if (!state.imgLoaded) {
    const w = cw * 0.8;
    const h = ch * 0.8;
    return { imgRect: { x: (cw - w) / 2, y: (ch - h) / 2, w, h }, imgToCanvas: 1 };
  }

  const iw = state.img.width;
  const ih = state.img.height;
  // Fit in CSS pixels, then convert each axis into backing-buffer pixels.
  // This also corrects fractional layout sizes and device-pixel rounding.
  const rect = canvas.getBoundingClientRect?.();
  const displayWidth = rect?.width || cw;
  const displayHeight = rect?.height || ch;
  const scale = Math.min(displayWidth / iw, displayHeight / ih) * 0.98;
  const w = iw * scale * cw / displayWidth;
  const h = ih * scale * ch / displayHeight;
  return {
    imgRect: { x: (cw - w) / 2, y: (ch - h) / 2, w, h },
    imgToCanvas: scale * cw / displayWidth
  };
}

export function pxToField(cx, cy, options = {}) {
  const imagePoint = canvasToImagePx(cx, cy);
  return imagePxToField(imagePoint.x, imagePoint.y, options);
}

export function imagePxToField(ix, iy, options = {}) {
  const iw = state.img.width || 1;
  const ih = state.img.height || 1;
  return imageToFieldCoordinates({
    imageX: ix,
    imageY: iy,
    imageWidth: iw,
    imageHeight: ih,
    fieldWidthM: state.fieldConfig.fieldWidthM,
    fieldHeightM: state.fieldConfig.fieldHeightM,
    coordinateSystem: options.coordinateSystem || state.fieldConfig.coordinateSystem,
    origin: options.origin || state.fieldConfig.origin,
    unit: options.unit || state.fieldConfig.measurementUnit
  });
}

export function fieldToImagePx(x, y, options = {}) {
  return fieldToImageCoordinates({
    x,
    y,
    imageWidth: state.img.width || 1,
    imageHeight: state.img.height || 1,
    fieldWidthM: state.fieldConfig.fieldWidthM,
    fieldHeightM: state.fieldConfig.fieldHeightM,
    coordinateSystem: options.coordinateSystem || state.fieldConfig.coordinateSystem,
    origin: options.origin || state.fieldConfig.origin,
    unit: options.unit || state.fieldConfig.measurementUnit
  });
}

export function imagePxToCanvas(ix, iy) {
  const { imgRect } = layout();
  return {
    x: imgRect.x + ix * (imgRect.w / (state.img.width || 1)),
    y: imgRect.y + iy * (imgRect.h / (state.img.height || 1))
  };
}

export function fieldToCanvas(x, y, options = {}) {
  const point = fieldToImagePx(x, y, options);
  return imagePxToCanvas(point.x, point.y);
}

export function canvasToImagePx(cx, cy) {
  const { imgRect } = layout();
  return {
    x: (cx - imgRect.x) * ((state.img.width || 1) / imgRect.w),
    y: (cy - imgRect.y) * ((state.img.height || 1) / imgRect.h)
  };
}

export function headingToCanvasAngle(heading, coordinateSystem = state.fieldConfig.coordinateSystem) {
  return -headingToCanonical(heading, coordinateSystem);
}
