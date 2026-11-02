import test from 'node:test';
import assert from 'node:assert/strict';
import { footprintGap, connectionPose, connectionCollisions, pathCollisions } from '../js/collision.js';
import { defaultZones, normalizeZones, zoneDocument, readZoneDocument, buildJavaZones, parseImportedZones } from '../js/exclusion_model.js';

const obstacle = (minX, minY, maxX, maxY, enabled = true) => ({ id: 'obstacle', name: 'Obstacle', enabled, minX, minY, maxX, maxY });
const point = (x, y, headingRad = 0, extra = {}) => ({ x, y, headingRad, ...extra });

test('robot collisions use oriented rectangular footprints and include touching', () => {
  const zone = obstacle(4, -1, 5, 1);
  assert.ok(footprintGap(point(0, 0), zone, 8, 2) <= 0);
  assert.ok(footprintGap(point(0, 0, Math.PI / 2), zone, 8, 2) > 0);
  assert.ok(footprintGap(point(0, 0), obstacle(4.1, -1, 5, 1), 8, 2) > 0);
  assert.ok(footprintGap(point(0, 0), obstacle(4.1, -1, 5, 1), 8, 2, 0.1) <= 1e-8);
});

test('rectangle SAT detects corner-only overlap rather than just robot centers', () => {
  assert.ok(footprintGap(point(0, 0, Math.PI / 4), obstacle(1.9, 1.9, 2.2, 2.2), 6, 1) <= 0);
  assert.ok(footprintGap(point(0, 0, Math.PI / 4), obstacle(2, -2, 3, -1), 6, 1) > 0);
});

test('linear heading follows the shortest wrap across 360 degrees', () => {
  const pose = connectionPose(point(0, 0, 350 * Math.PI / 180), point(10, 0, 10 * Math.PI / 180), 0.5);
  assert.ok(Math.abs(Math.sin(pose.headingRad)) < 1e-10);
});

test('constant uses destination or imported fixed heading and tangent uses curve derivatives', () => {
  const start = point(0, 0, 0), end = point(10, 10, 1, { headingMode: 'constant' });
  assert.equal(connectionPose(start, end, 0).headingRad, 1);
  end.constantHeadingRad = 2;
  assert.equal(connectionPose(start, end, 0.5).headingRad, 2);
  end.headingMode = 'tangent'; end.controlPoints = [point(10, 0)];
  assert.ok(Math.abs(connectionPose(start, end, 0).headingRad) < 1e-10);
  assert.ok(Math.abs(connectionPose(start, end, 1).headingRad - Math.PI / 2) < 1e-10);
});

test('adaptive checking catches a thin obstacle between coarse sample positions', () => {
  const hits = connectionCollisions(point(0, 0), point(100, 0), [obstacle(12.345, -0.001, 12.346, 0.001)], 0.001, 0.001);
  assert.ok(hits.some(hit => hit.from <= 0.12346 && hit.to >= 0.12345));
});

test('curve collisions are detected away from its anchor-to-anchor chord', () => {
  const start = point(0, 0), end = point(20, 0, 0, { controlPoints: [point(10, 20)], headingMode: 'tangent' });
  assert.ok(connectionCollisions(start, end, [obstacle(9, 9, 11, 11)], 1, 1).length > 0);
  assert.equal(connectionCollisions(start, end, [obstacle(9, 20, 11, 21)], 1, 1).length, 0);
});

test('rotation can collide midway although the endpoint footprints clear the obstacle', () => {
  const zone = obstacle(2.2, 2.2, 2.4, 2.4), start = point(0, 0), end = point(0, 0, Math.PI / 2);
  assert.ok(footprintGap(start, zone, 8, 1) > 0);
  assert.ok(footprintGap(end, zone, 8, 1) > 0);
  assert.ok(connectionCollisions(start, end, [zone], 8, 1).length > 0);
});

test('checking ignores disabled zones, skips disconnected spans and checks isolated anchors', () => {
  const points = [point(0, 0), point(20, 0, 0, { breakBefore: true })];
  assert.deepEqual(pathCollisions(points, [obstacle(9, -1, 11, 1)], 1, 1).connections, {});
  assert.ok(pathCollisions([point(10, 0)], [obstacle(9, -1, 11, 1)], 1, 1).anchors[0].length);
  assert.equal(connectionCollisions(point(0, 0), point(20, 0), [obstacle(9, -1, 11, 1, false)], 1, 1).length, 0);
});

test('starting anchor collision uses the expected constant heading, not its stored pose heading', () => {
  const result = pathCollisions([point(0, 0, 0), point(0, 10, Math.PI / 2, { headingMode: 'constant' })], [obstacle(3, -1, 4, 1)], 8, 1);
  assert.equal(result.anchors[0].length, 0);
});

test('stationary tangent curves finish without false collisions from their bounding circle', () => {
  const result = connectionCollisions(point(0, 0), point(0, 0, 0, { headingMode: 'tangent' }), [obstacle(2, 2, 3, 3)], 8, 1);
  assert.equal(result.length, 0);
});

test('Bio Buzz defaults retain supplied precision and are editable copies', () => {
  const zones = defaultZones();
  assert.equal(zones[0].minX, 46.729208312026394);
  assert.equal(zones[1].maxY, 92.64234577657943);
  zones[0].minX = 1;
  assert.equal(defaultZones()[0].minX, 46.729208312026394);
});

test('zone validation normalizes corners and rejects degenerate or invalid imports', () => {
  assert.equal(normalizeZones([obstacle(10, 10, 0, 0)])[0].minX, 0);
  assert.throws(() => normalizeZones([obstacle(0, 0, 0, 1)]), /positive/);
  assert.throws(() => normalizeZones([obstacle(NaN, 0, 1, 1)]), /finite/);
  assert.throws(() => readZoneDocument({ version: 1, unit: 'm' }), /coordinate/);
});

test('runnable Java includes enabled zones only, while metadata restores disabled entries', () => {
  const zones = defaultZones(); zones[1].enabled = false;
  const document = zoneDocument(zones, { checkingEnabled: true, marginIn: 0.5 });
  const java = buildJavaZones(zones);
  assert.equal((java.match(/new ExclusionZone\(/g) || []).length, 1);
  const imported = parseImportedZones({ exclusionZones: JSON.stringify(document) }, java);
  assert.deepEqual(imported.zones, zones);
  assert.equal(imported.marginIn, 0.5);
  const edited = parseImportedZones({ exclusionZones: document }, java.replace('46.729208312026394', '40'));
  assert.equal(edited.zones[0].minX, 40, 'executable coordinates take precedence over stale metadata');
  assert.equal(parseImportedZones({}, 'public class NoZones {}'), null);
  assert.deepEqual(parseImportedZones({}, buildJavaZones([])).zones, []);
  assert.throws(() => parseImportedZones({}, 'new ExclusionZone(a, 0, 10, 10)'), /numeric/);
  assert.throws(() => parseImportedZones({}, 'ExclusionZone[] EXCLUSION_ZONES = { someOtherVariable };'), /literal/);
});

test('adaptive swept checks cover dense reference collisions across all three heading modes', () => {
  for (const headingMode of ['linear', 'constant', 'tangent']) {
    for (const controls of [[], [point(40, 80)], [point(80, 80), point(-40, 80)]]) {
      const start = point(0, 0, 2.8), end = point(40, 10, -2.8, { headingMode, controlPoints: controls });
      const reference = connectionPose(start, end, 0.3719);
      const zone = obstacle(reference.x - 0.01, reference.y - 0.01, reference.x + 0.01, reference.y + 0.01);
      const hits = connectionCollisions(start, end, [zone], 8, 2);
      assert.ok(hits.length);
      for (let index = 0; index <= 500; index++) {
        const t = index / 500;
        if (footprintGap(connectionPose(start, end, t), zone, 8, 2) <= 0) {
          assert.ok(hits.some(hit => hit.from <= t + 1e-10 && hit.to >= t - 1e-10), `missed ${headingMode} collision at t=${t}`);
        }
      }
    }
  }
});

test('incremental collision checks reuse unchanged edges and invalidate edited curves', () => {
  const points = Array.from({ length: 6 }, (_, index) => point(index * 10, index % 2 ? 5 : 0, index / 10,
    { controlPoints: index ? [point(index * 10 - 5, 10)] : [] }));
  const zones = [obstacle(18, 0, 22, 10)];
  const cache = {};
  pathCollisions(points, zones, 4, 2, 0, cache);
  const unchanged = cache.connections.get(5), edited = cache.connections.get(2);
  points[2].controlPoints[0].y = 25;
  const updated = pathCollisions(points, zones, 4, 2, 0, cache);
  assert.deepEqual(updated, pathCollisions(points, zones, 4, 2));
  assert.equal(cache.connections.get(5), unchanged);
  assert.notEqual(cache.connections.get(2), edited);
  points[2].headingMode = 'tangent';
  assert.deepEqual(pathCollisions(points, zones, 4, 2, 0, cache), pathCollisions(points, zones, 4, 2));
  points[3].x += 8;
  assert.deepEqual(pathCollisions(points, zones, 4, 2, 0, cache), pathCollisions(points, zones, 4, 2));
});

test('collision caches stay correct after zone, footprint, clearance, and connectivity edits', () => {
  const points = [point(0, 0), point(20, 0), point(30, 10)], zones = [obstacle(9, -1, 11, 1)];
  const cache = {};
  pathCollisions(points, zones, 4, 2, 0, cache);
  zones[0].enabled = false;
  assert.deepEqual(pathCollisions(points, zones, 4, 2, 0, cache), pathCollisions(points, zones, 4, 2));
  zones[0].enabled = true; zones[0].minY = 3; zones[0].maxY = 5;
  assert.deepEqual(pathCollisions(points, zones, 8, 6, 1, cache), pathCollisions(points, zones, 8, 6, 1));
  points[1].breakBefore = true;
  assert.deepEqual(pathCollisions(points, zones, 8, 6, 1, cache), pathCollisions(points, zones, 8, 6, 1));
  points.splice(1, 1);
  assert.deepEqual(pathCollisions(points, zones, 8, 6, 1, cache), pathCollisions(points, zones, 8, 6, 1));
});
