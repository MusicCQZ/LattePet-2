'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  advanceAutomaticMotion,
  createAutomaticMotion,
  reverseAutomaticMotion,
} = require('../src/automatic-motion');
const { getCycleDuration, getFrameIndex } = require('../src/renderer/walk-timing');

test('maps elapsed time to one continuous 16-frame walk cycle', () => {
  assert.equal(getCycleDuration(110, 16), 1760);
  assert.equal(getFrameIndex(0, 110, 16), 0);
  assert.equal(getFrameIndex(109, 110, 16), 0);
  assert.equal(getFrameIndex(110, 110, 16), 1);
  assert.equal(getFrameIndex(1759, 110, 16), 15);
  assert.equal(getFrameIndex(1760, 110, 16), 0);
});

test('keeps window travel independent from animation frame changes', () => {
  const motion = createAutomaticMotion({ direction: 1, now: 0, speed: 62.5 });
  assert.equal(advanceAutomaticMotion(motion, 80), 5);
  assert.equal(advanceAutomaticMotion(motion, 160), 5);
  assert.equal(advanceAutomaticMotion(motion, 320), 10);
});

test('matches the calibrated 16-frame gait distance at 100% scale', () => {
  const motion = createAutomaticMotion({ direction: 1, now: 0, speed: 70 });
  let distance = 0;
  for (let frame = 1; frame <= 16; frame += 1) {
    distance += advanceAutomaticMotion(motion, frame * 110);
  }
  assert.equal(distance, 123);
  assert.ok(motion.remainder > 0.19 && motion.remainder < 0.21);
});

test('retains distance when a delayed tick exceeds the IPC safety step', () => {
  const motion = createAutomaticMotion({ direction: 1, now: 0, speed: 62.5 });
  assert.equal(advanceAutomaticMotion(motion, 400), 24);
  assert.equal(advanceAutomaticMotion(motion, 416), 2);
});

test('clears fractional carry when movement reverses at a screen edge', () => {
  const motion = createAutomaticMotion({ direction: 1, now: 0, speed: 62.5 });
  assert.equal(advanceAutomaticMotion(motion, 10), 0);
  assert.equal(reverseAutomaticMotion(motion, 10), -1);
  assert.equal(advanceAutomaticMotion(motion, 90), -5);
});
