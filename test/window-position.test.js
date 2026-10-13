'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clampPosition,
  getDefaultPosition,
  getWindowSize,
  normalizeScale,
} = require('../src/window-position');

test('normalizes unsupported scales to 100%', () => {
  assert.equal(normalizeScale(1.2), 1.2);
  assert.equal(normalizeScale('0.8'), 0.8);
  assert.equal(normalizeScale(1.1), 1);
});

test('calculates a scaled desktop-pet window size', () => {
  assert.deepEqual(getWindowSize(0.8), { width: 312, height: 264 });
  assert.deepEqual(getWindowSize(1.2), { width: 468, height: 396 });
});

test('keeps a window fully inside a normal work area', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 390, height: 330 };

  assert.deepEqual(clampPosition({ x: -40, y: -20 }, size, workArea), { x: 0, y: 0 });
  assert.deepEqual(clampPosition({ x: 1800, y: 900 }, size, workArea), { x: 1530, y: 710 });
  assert.deepEqual(clampPosition({ x: 500, y: 300 }, size, workArea), { x: 500, y: 300 });
});

test('supports displays with negative desktop coordinates', () => {
  const workArea = { x: -1440, y: -120, width: 1440, height: 900 };
  const size = { width: 390, height: 330 };

  assert.deepEqual(clampPosition({ x: -2000, y: -500 }, size, workArea), { x: -1440, y: -120 });
  assert.deepEqual(clampPosition({ x: 100, y: 900 }, size, workArea), { x: -390, y: 450 });
});

test('places the pet near the bottom-right corner by default', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 390, height: 330 };

  assert.deepEqual(getDefaultPosition(size, workArea, 24), { x: 1506, y: 686 });
});
