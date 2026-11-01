import test from 'node:test';
import assert from 'node:assert/strict';

import { convertDistance, fromMeters, toMeters } from '../js/units.js';
import {
  canonicalToHeading,
  fieldToImageCoordinates,
  headingToCanonical,
  imageToFieldCoordinates,
  transformFieldPose
} from '../js/coordinates.js';
import { addControlPoint, createAnchor, evaluateBezier } from '../js/path_model.js';
import {
  javaPackageFromDirectoryHandle,
  javaPackageFromFolderPath,
  suggestJavaFolderPath
} from '../js/java_package.js';

const FIELD_144_M = toMeters(144, 'in');

test('all supported units describe the same 144 inch field', () => {
  assert.equal(convertDistance(144, 'in', 'ft'), 12);
  assert.equal(convertDistance(144, 'in', 'cm'), 365.76);
  assert.ok(Math.abs(convertDistance(12, 'ft', 'in') - 144) < 1e-9);
  assert.ok(Math.abs(fromMeters(toMeters(3.6576, 'm'), 'in') - 144) < 1e-9);
});

test('Pedro bottom-left coordinates map all image corners correctly', () => {
  const common = {
    imageWidth: 1600,
    imageHeight: 1600,
    fieldWidthM: FIELD_144_M,
    fieldHeightM: FIELD_144_M,
    unit: 'in',
    origin: 'bottomLeft',
    coordinateSystem: 'pedro'
  };
  assert.deepEqual(imageToFieldCoordinates({ ...common, imageX: 0, imageY: 1600 }), { x: 0, y: 0 });
  assert.deepEqual(imageToFieldCoordinates({ ...common, imageX: 1600, imageY: 0 }), { x: 144, y: 144 });
  assert.deepEqual(imageToFieldCoordinates({ ...common, imageX: 800, imageY: 800 }), { x: 72, y: 72 });
});

test('field/image transforms round trip for every coordinate system and origin', () => {
  for (const coordinateSystem of ['ftc', 'pedro', 'image']) {
    for (const origin of ['center', 'bottomLeft', 'topLeft']) {
      const common = {
        imageWidth: 1600,
        imageHeight: 1600,
        fieldWidthM: FIELD_144_M,
        fieldHeightM: FIELD_144_M,
        unit: 'in',
        origin,
        coordinateSystem
      };
      const field = imageToFieldCoordinates({ ...common, imageX: 437.25, imageY: 912.5 });
      const image = fieldToImageCoordinates({ ...common, ...field });
      assert.ok(Math.abs(image.x - 437.25) < 1e-9);
      assert.ok(Math.abs(image.y - 912.5) < 1e-9);
    }
  }
});

test('Pedro path transforms use the field center for every origin', () => {
  const expectedImagePoints = {
    mirrorX: { x: 200, y: 1200 },
    mirrorY: { x: 1400, y: 400 },
    rotCCW: { x: 400, y: 1400 },
    rotCW: { x: 1200, y: 200 },
    rot180: { x: 1400, y: 1200 }
  };

  for (const origin of ['center', 'bottomLeft', 'topLeft']) {
    const common = {
      imageWidth: 1600,
      imageHeight: 1600,
      fieldWidthM: FIELD_144_M,
      fieldHeightM: FIELD_144_M,
      unit: 'in',
      origin,
      coordinateSystem: 'pedro'
    };
    const point = imageToFieldCoordinates({ ...common, imageX: 200, imageY: 400 });
    const pivot = imageToFieldCoordinates({ ...common, imageX: 800, imageY: 800 });

    for (const [kind, expected] of Object.entries(expectedImagePoints)) {
      const transformed = transformFieldPose(point.x, point.y, 0, kind, pivot);
      const image = fieldToImageCoordinates({ ...common, x: transformed.x, y: transformed.y });
      assert.ok(Math.abs(image.x - expected.x) < 1e-9, `${origin} ${kind} x`);
      assert.ok(Math.abs(image.y - expected.y) < 1e-9, `${origin} ${kind} y`);
      assert.ok(image.x >= 0 && image.x <= 1600, `${origin} ${kind} stays within field width`);
      assert.ok(image.y >= 0 && image.y <= 1600, `${origin} ${kind} stays within field height`);
    }
  }
});

test('heading conversions preserve physical orientation', () => {
  const ftcHeading = 0;
  const canonical = headingToCanonical(ftcHeading, 'ftc');
  assert.equal(canonical, Math.PI / 2);
  assert.equal(canonicalToHeading(canonical, 'pedro'), Math.PI / 2);
  assert.equal(canonicalToHeading(canonical, 'image'), -Math.PI / 2);
});

test('Bezier evaluation handles line, quadratic, and cubic segments', () => {
  const start = createAnchor(0, 0);
  const end = createAnchor(10, 0);
  assert.deepEqual(evaluateBezier(start, [], end, 0.5), { x: 5, y: 0 });
  assert.deepEqual(evaluateBezier(start, [{ xPx: 5, yPx: 10 }], end, 0.5), { x: 5, y: 5 });
  assert.deepEqual(
    evaluateBezier(start, [{ xPx: 0, yPx: 10 }, { xPx: 10, yPx: 10 }], end, 0.5),
    { x: 5, y: 7.5 }
  );
});

test('segments accept no more than two control points', () => {
  const path = { points: [createAnchor(0, 0), createAnchor(12, 12)] };
  assert.equal(addControlPoint(path, 1), 0);
  assert.equal(addControlPoint(path, 1), 1);
  assert.equal(addControlPoint(path, 1), -1);
  assert.equal(path.points[1].controlPoints.length, 2);
});

test('Java packages always use the FTC teamcode prefix and the path beneath teamcode', () => {
  assert.equal(
    javaPackageFromFolderPath('org\\firstinspires\\ftc\\teamcode\\opmodes\\autos\\paths'),
    'org.firstinspires.ftc.teamcode.opmodes.autos.paths'
  );
  assert.equal(
    javaPackageFromFolderPath('C:\\repo\\TeamCode\\src\\main\\java\\org\\firstinspires\\ftc\\teamcode\\auto\\paths'),
    'org.firstinspires.ftc.teamcode.auto.paths'
  );
  assert.equal(
    javaPackageFromFolderPath('/repo/TeamCode/src/test/java/org/firstinspires/ftc/teamcode/generated'),
    'org.firstinspires.ftc.teamcode.generated'
  );
  assert.equal(javaPackageFromFolderPath('auto/paths'), 'org.firstinspires.ftc.teamcode.auto.paths');
  assert.equal(
    javaPackageFromFolderPath('org.firstinspires.ftc.teamcode.auto.paths'),
    'org.firstinspires.ftc.teamcode.auto.paths'
  );
  assert.equal(javaPackageFromFolderPath('teamcode'), 'org.firstinspires.ftc.teamcode');
  assert.equal(javaPackageFromFolderPath('TeamCode/src/main/java'), null);
  assert.equal(javaPackageFromFolderPath('/repo/src/main/java/com/example/generated'), null);
  assert.equal(javaPackageFromFolderPath('C:/unrecognized/path'), null);
});

test('folder selection auto-fills its name and retains an explicitly supplied relative parent path', () => {
  assert.equal(suggestJavaFolderPath('', 'generated'), 'generated');
  assert.equal(
    suggestJavaFolderPath('auto/paths', 'generated'),
    'auto/generated'
  );
});

test('selected Java folders reveal their complete package through existing source files', async () => {
  const directoryHandle = {
    async *values() {
      yield {
        kind: 'file',
        name: 'ExamplePath.java',
        async getFile() {
          return {
            async text() {
              return 'package org.firstinspires.ftc.teamcode.opmodes.autos.paths;\n\npublic class ExamplePath {}';
            }
          };
        }
      };
    }
  };

  assert.equal(
    await javaPackageFromDirectoryHandle(directoryHandle),
    'org.firstinspires.ftc.teamcode.opmodes.autos.paths'
  );
});

test('empty selected folders do not invent an incomplete package', async () => {
  const emptyDirectoryHandle = {
    async *values() {}
  };
  assert.equal(await javaPackageFromDirectoryHandle(emptyDirectoryHandle), null);
});
