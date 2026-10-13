'use strict';

const nest = document.querySelector('#pet-nest');
let pointer = null;
const DRAG_THRESHOLD = 4;

function finish(event) {
  if (!pointer) return;
  if (nest.hasPointerCapture(event.pointerId)) nest.releasePointerCapture(event.pointerId);
  const moved = pointer.moved;
  window.latteNest.endDrag();
  pointer = null;
  if (!moved) window.latteNest.activate();
}

nest.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  nest.setPointerCapture(event.pointerId);
  pointer = { moved: false, screenX: event.screenX, screenY: event.screenY };
  window.latteNest.startDrag();
});

nest.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  const delta = { x: event.screenX - pointer.screenX, y: event.screenY - pointer.screenY };
  if (Math.hypot(delta.x, delta.y) >= DRAG_THRESHOLD) pointer.moved = true;
  window.latteNest.moveDrag(delta);
});

nest.addEventListener('pointerup', finish);
nest.addEventListener('pointercancel', finish);
document.addEventListener('contextmenu', (event) => event.preventDefault());
