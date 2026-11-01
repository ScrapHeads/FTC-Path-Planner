import { fromMeters, toMeters } from './units.js';

export function imageToFieldCoordinates({
  imageX,
  imageY,
  imageWidth,
  imageHeight,
  fieldWidthM,
  fieldHeightM,
  unit = 'm',
  origin = 'center',
  coordinateSystem = 'ftc'
}) {
  const canonicalX = (imageX / imageWidth) * fieldWidthM;
  const canonicalY = ((imageHeight - imageY) / imageHeight) * fieldHeightM;
  const offset = originOffset(origin, fieldWidthM, fieldHeightM);
  const dx = canonicalX - offset.x;
  const dy = canonicalY - offset.y;

  let xM;
  let yM;
  if (coordinateSystem === 'ftc') {
    xM = dy;
    yM = -dx;
  } else if (coordinateSystem === 'image') {
    xM = dx;
    yM = -dy;
  } else {
    xM = dx;
    yM = dy;
  }
  return { x: fromMeters(xM, unit), y: fromMeters(yM, unit) };
}

export function fieldToImageCoordinates({
  x,
  y,
  imageWidth,
  imageHeight,
  fieldWidthM,
  fieldHeightM,
  unit = 'm',
  origin = 'center',
  coordinateSystem = 'ftc'
}) {
  const xM = toMeters(x, unit);
  const yM = toMeters(y, unit);
  const offset = originOffset(origin, fieldWidthM, fieldHeightM);
  let dx;
  let dy;
  if (coordinateSystem === 'ftc') {
    dx = -yM;
    dy = xM;
  } else if (coordinateSystem === 'image') {
    dx = xM;
    dy = -yM;
  } else {
    dx = xM;
    dy = yM;
  }
  return {
    x: ((dx + offset.x) / fieldWidthM) * imageWidth,
    y: (1 - (dy + offset.y) / fieldHeightM) * imageHeight
  };
}

export function headingToCanonical(heading, coordinateSystem = 'ftc') {
  if (coordinateSystem === 'ftc') return normalizeAngle(heading + Math.PI / 2);
  if (coordinateSystem === 'image') return normalizeAngle(-heading);
  return normalizeAngle(heading);
}

export function canonicalToHeading(canonical, coordinateSystem = 'ftc') {
  if (coordinateSystem === 'ftc') return normalizeAngle(canonical - Math.PI / 2);
  if (coordinateSystem === 'image') return normalizeAngle(-canonical);
  return normalizeAngle(canonical);
}

export function normalizeAngle(angle) {
  let value = Number(angle) || 0;
  while (value <= -Math.PI) value += Math.PI * 2;
  while (value > Math.PI) value -= Math.PI * 2;
  return value;
}

export function transformFieldPose(x, y, heading, kind, pivot = { x: 0, y: 0 }) {
  const dx = x - pivot.x;
  const dy = y - pivot.y;

  if (kind === 'mirrorX') return { x, y: pivot.y - dy, heading: -heading };
  if (kind === 'mirrorY') return { x: pivot.x - dx, y, heading: Math.PI - heading };
  if (kind === 'rotCCW') {
    return { x: pivot.x - dy, y: pivot.y + dx, heading: heading + Math.PI / 2 };
  }
  if (kind === 'rotCW') {
    return { x: pivot.x + dy, y: pivot.y - dx, heading: heading - Math.PI / 2 };
  }
  if (kind === 'rot180') {
    return { x: pivot.x - dx, y: pivot.y - dy, heading: heading + Math.PI };
  }
  return { x, y, heading };
}

function originOffset(origin, widthM, heightM) {
  if (origin === 'center') return { x: widthM / 2, y: heightM / 2 };
  if (origin === 'topLeft') return { x: 0, y: heightM };
  return { x: 0, y: 0 };
}
