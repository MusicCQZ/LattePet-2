'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseReaction,
  getInteractionRegion,
} = require('../src/renderer/interaction-mapping.js');

test('maps the painted Latte body regions and rejects transparent margins', () => {
  assert.equal(getInteractionRegion({ x: 0.255, y: 0.275 }), 'head');
  assert.equal(getInteractionRegion({ x: 0.54, y: 0.58 }), 'body');
  assert.equal(getInteractionRegion({ x: 0.275, y: 0.855 }), 'frontPaw');
  assert.equal(getInteractionRegion({ x: 0.765, y: 0.295 }), 'tail');
  assert.equal(getInteractionRegion({ x: 0.03, y: 0.03 }), null);
  assert.equal(getInteractionRegion({ x: 1.1, y: 0.2 }), null);
});

test('mirrors painted interaction regions when Latte changes walking direction', () => {
  assert.equal(
    getInteractionRegion({ x: 1 - 0.255, y: 0.275 }, { facingLeft: true }),
    'head',
  );
  assert.equal(
    getInteractionRegion({ x: 1 - 0.765, y: 0.295 }, { facingLeft: true }),
    'tail',
  );
});

test('does not immediately repeat a reaction when alternatives exist', () => {
  const choices = [{ id: 'blink' }, { id: 'ear-flick' }];
  assert.equal(chooseReaction(choices, 'blink', () => 0).id, 'ear-flick');
  assert.equal(chooseReaction([{ id: 'wave' }], 'wave', () => 0).id, 'wave');
  assert.equal(chooseReaction([], null), null);
});
