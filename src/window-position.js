'use strict';

const BASE_WINDOW_SIZE = Object.freeze({ width: 390, height: 330 });
const ALLOWED_SCALES = Object.freeze([0.8, 1, 1.2]);

function normalizeScale(value) {
  const numericValue = Number(value);
  return ALLOWED_SCALES.includes(numericValue) ? numericValue : 1;
}

function getWindowSize(scale) {
  const safeScale = normalizeScale(scale);
  return {
    width: Math.round(BASE_WINDOW_SIZE.width * safeScale),
    height: Math.round(BASE_WINDOW_SIZE.height * safeScale),
  };
}

function clampPosition(position, size, workArea) {
  const maxX = workArea.x + Math.max(0, workArea.width - size.width);
  const maxY = workArea.y + Math.max(0, workArea.height - size.height);

  return {
    x: Math.round(Math.min(Math.max(position.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(position.y, workArea.y), maxY)),
  };
}

function getDefaultPosition(size, workArea, margin = 24) {
  return clampPosition(
    {
      x: workArea.x + workArea.width - size.width - margin,
      y: workArea.y + workArea.height - size.height - margin,
    },
    size,
    workArea,
  );
}

module.exports = {
  ALLOWED_SCALES,
  BASE_WINDOW_SIZE,
  clampPosition,
  getDefaultPosition,
  getWindowSize,
  normalizeScale,
};
