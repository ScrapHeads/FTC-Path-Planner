// DOM elements, canvas, ctx, dpi, simple UI helpers
export const canvas = document.getElementById('canvas');
export const ctx = canvas.getContext('2d');
export const dpi = window.devicePixelRatio || 1;

export const els = {
  // Image + config
  imgInput: document.getElementById('imgInput'),
  sampleSelect: document.getElementById('sampleSelect'),
  fieldSize: document.getElementById('fieldSize'),
  measurementUnit: document.getElementById('measurementsUnit'),
  originSelect: document.getElementById('originSelect'),
  axesFtc: document.getElementById('axesFtc'),
  axesText: document.getElementById('axesText'),
  thX: document.getElementById('thX'),
  thY: document.getElementById('thY'),

  // Waypoints + table
  pointRows: document.getElementById('pointRows'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),  
  deleteBtn: document.getElementById('deleteBtn'),
  clearBtn: document.getElementById('clearBtn'),
  loadBtn: document.getElementById('loadBtn'),

  // Direct pose edits
  selXIn: document.getElementById('selXIn'),
  selYIn: document.getElementById('selYIn'),
  headingDeg: document.getElementById('headingDeg'),

  // Heading wrapping
  headingWrap: document.getElementById('headingWrap'),

  // Export UI
  javaType: document.getElementById('javaType'),
  exportKind: document.getElementById('exportKind'),
  exportFileType: document.getElementById('exportFileType'),
  packageName: document.getElementById('packageName'),
  className: document.getElementById('className'),
  exportBtn: document.getElementById('exportBtn'),
  saveFileBtn: document.getElementById('saveFileBtn'),
  chooseDirBtn: document.getElementById('chooseDirBtn'),
  copyBtn: document.getElementById('copyBtn'),
  output: document.getElementById('output'),

  // Canvas + footprint
  dropZone: document.getElementById('dropZone'),
  robotLen: document.getElementById('robotLen'),
  robotWid: document.getElementById('robotWid'),
  boxRotate: document.getElementById('boxRotate'),
};

export function isFtc(){ return !!els.axesFtc?.checked; }

export function updateAxesUI(){
  if(!els.axesText || !els.thX || !els.thY) return;
  if(isFtc()){
    els.axesText.innerHTML = 'Axes toggle: <b>X+ forward</b>, <b>Y+ left</b>';
    els.thX.textContent = 'X fwd (+)';
    els.thY.textContent = 'Y left (+)';
  } else {
    els.axesText.innerHTML = 'Axes toggle: <b>X+ right</b>, <b>Y+ down</b>';
    els.thX.textContent = 'X right (+)';
    els.thY.textContent = 'Y down (+)';
  }
}

export function getMeasurementUnit() {
  // Returns the selected measurement unit (e.g., 'm', 'cm', 'in')
  return els.measurementUnit.value;
}

export function toMeters(value) {
  // Converts a value from the selected unit to meters
  const unit = getMeasurementUnit();
  if (unit === 'cm') return value / 100;
  if (unit === 'ft') return value * 3.28084;
  if (unit === 'in') return value * 0.0254;
  return value; // already meters
}

export function fromMeters(value, targetUnit) {
  // Converts a value in meters to the target unit
  if (targetUnit === 'cm') return value * 100;
  if (targetUnit === 'ft') return value * 3.28084;
  if (targetUnit === 'in') return value / 0.0254;
  return value; // already meters
}
