'use strict';

(function exposeInteractionMapping(root, factory) {
  const mapping = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = mapping;
  }
  root.LatteInteractionMapping = Object.freeze(mapping);
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const regions = Object.freeze([
    Object.freeze({ name: 'head', x: 0.255, y: 0.275, radiusX: 0.205, radiusY: 0.245 }),
    Object.freeze({ name: 'frontPaw', x: 0.275, y: 0.855, radiusX: 0.155, radiusY: 0.16 }),
    Object.freeze({ name: 'tail', x: 0.765, y: 0.295, radiusX: 0.17, radiusY: 0.225 }),
    Object.freeze({ name: 'body', x: 0.545, y: 0.57, radiusX: 0.34, radiusY: 0.3 }),
  ]);

  function isInsideEllipse(point, region) {
    const horizontal = (point.x - region.x) / region.radiusX;
    const vertical = (point.y - region.y) / region.radiusY;
    return horizontal ** 2 + vertical ** 2 <= 1;
  }

  function getInteractionRegion(point, { facingLeft = false } = {}) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
      return null;
    }

    const logicalPoint = {
      x: facingLeft ? 1 - point.x : point.x,
      y: point.y,
    };
    return regions.find((region) => isInsideEllipse(logicalPoint, region))?.name || null;
  }

  function chooseReaction(choices, previousId, random = Math.random) {
    if (!Array.isArray(choices) || choices.length === 0) {
      return null;
    }
    const alternatives = choices.filter((choice) => choice.id !== previousId);
    const pool = alternatives.length > 0 ? alternatives : choices;
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    return pool[index];
  }

  return {
    chooseReaction,
    getInteractionRegion,
  };
}));
