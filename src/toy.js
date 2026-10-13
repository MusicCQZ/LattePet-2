'use strict';

const ball = document.querySelector('#toy-ball');
let pointer = null;
const DRAG_THRESHOLD = 4;

function finish(event) {
  if (!pointer) return;
  if (ball.hasPointerCapture(event.pointerId)) ball.releasePointerCapture(event.pointerId);
  window.latteToy.endDrag({ moved: pointer.moved });
  pointer = null;
}

ball.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  ball.setPointerCapture(event.pointerId);
  pointer = { moved: false, screenX: event.screenX, screenY: event.screenY };
  window.latteToy.startDrag();
});

ball.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  const delta = { x: event.screenX - pointer.screenX, y: event.screenY - pointer.screenY };
  if (Math.hypot(delta.x, delta.y) >= DRAG_THRESHOLD) pointer.moved = true;
  window.latteToy.moveDrag(delta);
});

ball.addEventListener('pointerup', finish);
ball.addEventListener('pointercancel', finish);
document.addEventListener('contextmenu', (event) => event.preventDefault());
