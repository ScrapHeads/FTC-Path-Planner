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
  coordinateSystem: document.getElementById('coordinateSystem'),
  thX: document.getElementById('thX'),
  thY: document.getElementById('thY'),

  // Waypoints + table
  pointRows: document.getElementById('pointRows'),
  undoBtn: document.getElementById('undoBtn'),
  redoBtn: document.getElementById('redoBtn'),  
  deleteBtn: document.getElementById('deleteBtn'),
  clearBtn: document.getElementById('clearBtn'),
  clearAllBtn: document.getElementById('clearAllBtn'),
  loadBtn: document.getElementById('loadBtn'),

  // Direct pose edits
  selXIn: document.getElementById('selXIn'),
  selYIn: document.getElementById('selYIn'),
  headingDeg: document.getElementById('headingDeg'),

  // Heading wrapping
  headingWrap: document.getElementById('headingWrap'),

  // Setting the paths
  path1Btn: document.getElementById('path1'),
  path2Btn: document.getElementById('path2'),
  path3Btn: document.getElementById('path3'),
  path4Btn: document.getElementById('path4'),
  legacyPathControls: document.getElementById('legacyPathControls'),
  segmentControls: document.getElementById('segmentControls'),
  segmentSelect: document.getElementById('segmentSelect'),
  segmentUp: document.getElementById('segmentUp'),
  segmentDown: document.getElementById('segmentDown'),
  pointSegmentTarget: document.getElementById('pointSegmentTarget'),
  movePointSegment: document.getElementById('movePointSegment'),
  pointAsSegment: document.getElementById('pointAsSegment'),
  pointMoveStatus: document.getElementById('pointMoveStatus'),
  segmentName: document.getElementById('segmentName'),
  segmentHeadingMode: document.getElementById('segmentHeadingMode'),
  pointHeadingMode: document.getElementById('pointHeadingMode'),
  segmentStatus: document.getElementById('segmentStatus'),
  addSegment: document.getElementById('addSegment'),
  splitSegment: document.getElementById('splitSegment'),
  deleteSegment: document.getElementById('deleteSegment'),

  // Export UI
  javaType: document.getElementById('javaType'),
  exportKind: document.getElementById('exportKind'),
  exportFileType: document.getElementById('exportFileType'),
  exportFolderPath: document.getElementById('exportFolderPath'),
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

export function updateAxesUI(){
  if(!els.thX || !els.thY) return;
  const system = els.coordinateSystem?.value || 'ftc';
  if(system === 'ftc'){
    els.thX.textContent = 'X fwd (+)';
    els.thY.textContent = 'Y left (+)';
  } else if(system === 'pedro') {
    els.thX.textContent = 'X right (+)';
    els.thY.textContent = 'Y up (+)';
  } else {
    els.thX.textContent = 'X right (+)';
    els.thY.textContent = 'Y down (+)';
  }
}

export function getMeasurementUnit() {
  return els.measurementUnit?.value || 'm';
}

export function isPedroPathingSelected() {
  return els.javaType?.value === 'pedro';
}

export { toMeters, fromMeters } from './units.js';
