import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickedDistance, projectedCircle } from '../ui/src/distance.ts';
import { defaultSchemaValue } from '../ui/src/schema.ts';

const center = { x: -103, y: -77, z: 2 };

test('distance picking measures tile radius from the referenced center and respects bounds', () => {
  const pick = { field: 'range', coordinate: center, distance: 15 };
  assert.equal(pickedDistance(pick, center), 0);
  assert.equal(pickedDistance(pick, { ...center, x: -100, y: -73 }), 5);
  assert.equal(pickedDistance({ ...pick, min: 2 }, center), 2);
  assert.equal(pickedDistance({ ...pick, max: 3 }, { ...center, x: -100, y: -73 }), 3);
  assert.equal(pickedDistance(pick, { ...center, x: -102, y: -76 }), 1);
});

test('preview projects a world circle into the isometric plane using integer projection coordinates', () => {
  const project = ({ x, y, z }) => {
    assert.ok([x, y, z].every(Number.isInteger));
    return { x: (x + y) * 38 + 120, y: (y - x) * 19 - z * 114 + 240 };
  };
  const points = projectedCircle(center, 5, project)
    .split(' ')
    .map((point) => point.split(',').map(Number));
  const origin = project(center);
  assert.equal(points.length, 96);
  assert.deepEqual(points[0], [origin.x + 190, origin.y - 95]);
  assert.deepEqual(points[24], [origin.x + 190, origin.y + 95]);
  for (const [x, y] of points) {
    const sum = (x - origin.x) / 38;
    const difference = (y - origin.y) / 19;
    assert.ok(Math.abs(Math.hypot((sum - difference) / 2, (sum + difference) / 2) - 5) < 1e-10);
  }
  const moved = projectedCircle(center, 5, (coordinate) => {
    const result = project(coordinate);
    return { x: result.x + 100, y: result.y - 50 };
  })
    .split(' ')[0]
    .split(',')
    .map(Number);
  assert.deepEqual(moved, [points[0][0] + 100, points[0][1] - 50]);
  assert.equal(new Set(projectedCircle(center, 0, project).split(' ')).size, 1);
});

test('new distance values remain numeric', () => {
  assert.equal(defaultSchemaValue('distance'), 0);
  assert.equal(defaultSchemaValue({ type: 'distance', min: 2 }), 2);
});
