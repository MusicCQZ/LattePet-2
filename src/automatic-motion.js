'use strict';

function createAutomaticMotion({ direction, now, speed }) {
  const normalizedDirection = Number(direction) < 0 ? -1 : 1;
  const normalizedSpeed = Number(speed);
  const timestamp = Number(now);
  if (!Number.isFinite(normalizedSpeed) || normalizedSpeed <= 0 || normalizedSpeed > 200) {
    throw new RangeError('Automatic movement speed must be between 0 and 200 pixels per second.');
  }
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Automatic movement requires a finite timestamp.');
  }

  return {
    direction: normalizedDirection,
    lastTimestamp: timestamp,
    remainder: 0,
    speed: normalizedSpeed,
  };
}

function advanceAutomaticMotion(state, now, maximumDelta = 24) {
  const timestamp = Number(now);
  if (!state || !Number.isFinite(timestamp) || timestamp <= state.lastTimestamp) {
    return 0;
  }

  const elapsedSeconds = (timestamp - state.lastTimestamp) / 1000;
  state.lastTimestamp = timestamp;
  const distance = state.remainder + state.direction * state.speed * elapsedSeconds;
  const wholePixels = Math.trunc(distance);
  const delta = Math.sign(wholePixels) * Math.min(Math.abs(wholePixels), maximumDelta);
  state.remainder = distance - delta;
  return delta;
}

function reverseAutomaticMotion(state, now) {
  state.direction *= -1;
  state.lastTimestamp = Number.isFinite(Number(now)) ? Number(now) : state.lastTimestamp;
  state.remainder = 0;
  return state.direction;
}

module.exports = {
  advanceAutomaticMotion,
  createAutomaticMotion,
  reverseAutomaticMotion,
};
