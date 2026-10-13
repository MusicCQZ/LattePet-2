'use strict';

(function exposeWalkTiming(root, factory) {
  const timing = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = timing;
  } else {
    root.LatteWalkTiming = Object.freeze(timing);
  }
}(typeof window === 'undefined' ? globalThis : window, () => {
  function getFrameIndex(elapsedMilliseconds, frameDuration, frameCount) {
    if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) return 0;
    if (!Number.isFinite(frameDuration) || frameDuration <= 0) return 0;
    if (!Number.isInteger(frameCount) || frameCount <= 0) return 0;
    return Math.floor(elapsedMilliseconds / frameDuration) % frameCount;
  }

  function getCycleDuration(frameDuration, frameCount) {
    if (!Number.isFinite(frameDuration) || frameDuration <= 0) return 0;
    if (!Number.isInteger(frameCount) || frameCount <= 0) return 0;
    return frameDuration * frameCount;
  }

  return { getCycleDuration, getFrameIndex };
}));
