'use strict';

const stage = document.querySelector('.stage');
const preview = document.querySelector('#preview');
const status = document.querySelector('.status');
const frameDuration = Number(stage.dataset.frameDuration);
const frameCount = 16;
const frameSources = Array.from({ length: frameCount }, (_, index) => (
  `../animations/walk/frames-v11/frame-${String(index + 1).padStart(2, '0')}.png`
));
const context = preview.getContext('2d');
let frameImages = [];
let previousFrame = -1;
let startedAt = 0;

window.walkPreviewState = {
  frameCount,
  frameDuration,
  frameIndex: 0,
  ready: false,
};

async function preloadFrames() {
  frameImages = await Promise.all(frameSources.map((source) => new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', reject, { once: true });
    image.src = source;
  })));
}

function animate(timestamp) {
  if (!startedAt) startedAt = timestamp;
  const frameIndex = Math.floor((timestamp - startedAt) / frameDuration) % frameCount;
  if (frameIndex !== previousFrame) {
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(frameImages[frameIndex], 0, 0, preview.width, preview.height);
    status.textContent = `第 ${frameIndex + 1} / ${frameCount} 帧 · ${frameDuration} ms/帧 · 完整周期 ${frameDuration * frameCount} ms`;
    window.walkPreviewState.frameIndex = frameIndex;
    previousFrame = frameIndex;
  }
  requestAnimationFrame(animate);
}

preloadFrames().then(() => {
  window.walkPreviewState.ready = true;
  requestAnimationFrame(animate);
});
