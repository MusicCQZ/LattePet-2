'use strict';

const mode = document.body.dataset.mode || 'loop';
const canvas = document.querySelector('#preview');
const context = canvas.getContext('2d');
const status = document.querySelector('.status');
const frameDuration = 110;
const transitionDuration = 140;
const frameCount = 16;
const loopDuration = frameDuration * frameCount;
const baseWindowSpeed = 70;
const previewSourceScale = 320 / 444;
const runtimeSourceScale = 0.6704;
const previewSpeed = baseWindowSpeed * previewSourceScale / runtimeSourceScale;
const groundY = 445;
const walkSources = Array.from({ length: frameCount }, (_, index) => (
  `../animations/walk/frames-v27/frame-${String(index + 1).padStart(2, '0')}.png`
));
const transitionSources = Array.from({ length: 6 }, (_, index) => (
  `../animations/walk/transition-v7/frame-${String(index + 1).padStart(2, '0')}.png`
));
const idleSource = './latte-base-preview-v1.png';
const startScales = [1.55, 1.3, 1.1];
const stopFrameIndices = [2, 3, 4, 5];
const stopScales = [1.1, 1.28, 1.48, 1.6];
const limbInfo = {
  LF: { color: '#00a6ff', label: 'LF 左前腿（近侧）' },
  RF: { color: '#61c7f2', label: 'RF 右前腿（远侧）' },
  LH: { color: '#ff7a00', label: 'LH 左后腿（近侧）' },
  RH: { color: '#e2a400', label: 'RH 右后腿（远侧）' },
};
const gaitFrames = [
  { phase: 'LH 落地', LF: [335, 395, 'swing'], RF: [266, 439, 'stance'], LH: [151, 439, 'stance'], RH: [64, 439, 'stance'] },
  { phase: 'LH 承重', LF: [344, 404, 'swing'], RF: [254, 439, 'stance'], LH: [145, 439, 'stance'], RH: [72, 433, 'toeoff'] },
  { phase: 'RH 抬脚', LF: [353, 420, 'swing'], RF: [242, 439, 'stance'], LH: [137, 439, 'stance'], RH: [92, 412, 'swing'] },
  { phase: 'LF 准备落地', LF: [357, 433, 'swing'], RF: [235, 431, 'toeoff'], LH: [126, 439, 'stance'], RH: [116, 394, 'swing'] },
  { phase: 'LF 落地', LF: [347, 439, 'stance'], RF: [243, 412, 'swing'], LH: [114, 439, 'stance'], RH: [144, 386, 'swing'] },
  { phase: 'LF 承重', LF: [336, 439, 'stance'], RF: [260, 394, 'swing'], LH: [101, 439, 'stance'], RH: [166, 388, 'swing'] },
  { phase: 'RH 前摆', LF: [322, 439, 'stance'], RF: [282, 384, 'swing'], LH: [88, 439, 'stance'], RH: [181, 400, 'swing'] },
  { phase: 'LH 蹬地', LF: [310, 439, 'stance'], RF: [305, 386, 'swing'], LH: [75, 433, 'toeoff'], RH: [184, 421, 'swing'] },
  { phase: 'RH 落地', LF: [298, 439, 'stance'], RF: [328, 398, 'swing'], LH: [70, 421, 'swing'], RH: [176, 439, 'stance'] },
  { phase: 'RH 承重', LF: [286, 439, 'stance'], RF: [346, 414, 'swing'], LH: [90, 399, 'swing'], RH: [164, 439, 'stance'] },
  { phase: 'LH 抬脚', LF: [274, 439, 'stance'], RF: [354, 430, 'swing'], LH: [116, 388, 'swing'], RH: [151, 439, 'stance'] },
  { phase: 'RF 准备落地', LF: [268, 431, 'toeoff'], RF: [350, 436, 'swing'], LH: [142, 386, 'swing'], RH: [137, 439, 'stance'] },
  { phase: 'RF 落地', LF: [282, 407, 'swing'], RF: [340, 439, 'stance'], LH: [166, 397, 'swing'], RH: [122, 439, 'stance'] },
  { phase: 'RF 承重', LF: [300, 390, 'swing'], RF: [322, 439, 'stance'], LH: [178, 414, 'swing'], RH: [105, 439, 'stance'] },
  { phase: 'LH 前摆', LF: [319, 386, 'swing'], RF: [302, 439, 'stance'], LH: [170, 430, 'swing'], RH: [86, 439, 'stance'] },
  { phase: '循环接缝', LF: [330, 390, 'swing'], RF: [283, 439, 'stance'], LH: [160, 436, 'swing'], RH: [70, 439, 'stance'] },
];

let walkImages = [];
let transitionImages = [];
let idleImage;
let startedAt = 0;
let debugFrame = 0;
let debugPlaying = mode === 'debug';
let previousTimestamp = 0;

window.walkPreviewState = {
  frameCount,
  frameDuration,
  frameIndex: 0,
  mode,
  ready: false,
};

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', reject, { once: true });
    image.src = source;
  });
}

function clearStage() {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.strokeStyle = 'rgba(126, 83, 49, .32)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, groundY + 1);
  context.lineTo(canvas.width, groundY + 1);
  context.stroke();
  context.restore();
}

function drawCanvasSprite(image, centerX, renderScale = 1.1, canvasSize = 320) {
  const size = canvasSize * renderScale;
  const left = centerX - size / 2;
  const top = groundY - (439 / 444) * size;
  context.drawImage(image, left, top, size, size);
  return { left, size, top };
}

function drawIdle(centerX) {
  const height = 300;
  const width = height * idleImage.naturalWidth / idleImage.naturalHeight;
  const left = centerX - width / 2;
  const top = groundY - height * (1074 / 1087);
  context.drawImage(idleImage, left, top, width, height);
}

function setStatus(text) {
  if (status) status.textContent = text;
}

function drawLoop(timestamp) {
  const elapsed = timestamp - startedAt;
  const frameIndex = Math.floor(elapsed / frameDuration) % frameCount;
  clearStage();
  drawCanvasSprite(walkImages[frameIndex], canvas.width / 2);
  setStatus(`第 ${frameIndex + 1} / 16 帧 · 110 ms/帧 · 完整周期 1760 ms · ${gaitFrames[frameIndex].phase}`);
  window.walkPreviewState.frameIndex = frameIndex;
}

function drawForward(timestamp) {
  const elapsed = timestamp - startedAt;
  const frameIndex = Math.floor(elapsed / frameDuration) % frameCount;
  const usableWidth = canvas.width - 260;
  const x = 130 + ((elapsed / 1000) * previewSpeed) % usableWidth;
  clearStage();
  for (let guide = 80; guide < canvas.width; guide += 120) {
    context.fillStyle = 'rgba(102, 78, 58, .18)';
    context.fillRect(guide, groundY - 8, 2, 16);
  }
  drawCanvasSprite(walkImages[frameIndex], x);
  setStatus(`第 ${frameIndex + 1} / 16 帧 · 预览平移 ${previewSpeed.toFixed(1)} px/s · 程序基准 ${baseWindowSpeed} px/s`);
  window.walkPreviewState.frameIndex = frameIndex;
}

function drawTransition(timestamp) {
  const idleHold = 900;
  const startTotal = transitionDuration * 3;
  const walkTotal = loopDuration * 2;
  const stopTotal = transitionDuration * 4;
  const total = idleHold * 2 + startTotal + walkTotal + stopTotal;
  const time = (timestamp - startedAt) % total;
  const movementStart = idleHold + transitionDuration * 2;
  const movementStop = idleHold + startTotal + walkTotal + transitionDuration * 2;
  const movingTime = Math.max(0, Math.min(time, movementStop) - movementStart);
  const x = 260 + movingTime / 1000 * previewSpeed;
  clearStage();

  if (time < idleHold) {
    drawIdle(260);
    setStatus('站立 · 等待开始');
  } else if (time < idleHold + startTotal) {
    const local = time - idleHold;
    const index = Math.min(2, Math.floor(local / transitionDuration));
    drawCanvasSprite(transitionImages[index], x, startScales[index]);
    setStatus(`起步 ${index + 1} / 3 · 转身、低头、迈出第一步`);
  } else if (time < idleHold + startTotal + walkTotal) {
    const local = time - idleHold - startTotal;
    const frameIndex = Math.floor(local / frameDuration) % frameCount;
    drawCanvasSprite(walkImages[frameIndex], x);
    setStatus(`持续行走 · 第 ${frameIndex + 1} / 16 帧`);
    window.walkPreviewState.frameIndex = frameIndex;
  } else if (time < idleHold + startTotal + walkTotal + stopTotal) {
    const local = time - idleHold - startTotal - walkTotal;
    const index = Math.min(3, Math.floor(local / transitionDuration));
    drawCanvasSprite(transitionImages[stopFrameIndices[index]], x, stopScales[index]);
    setStatus(`停步 ${index + 1} / 4 · 收步、稳定支撑、抬头站定`);
  } else {
    drawIdle(x);
    setStatus('站立 · 停步完成');
  }
}

function transformPaw(point, placement) {
  return {
    x: placement.left + point[0] / 444 * placement.size,
    y: placement.top + point[1] / 444 * placement.size,
  };
}

function drawDebugFrame(frameIndex) {
  clearStage();
  const placement = drawCanvasSprite(walkImages[frameIndex], canvas.width / 2);
  const current = gaitFrames[frameIndex];

  context.save();
  for (const [limb, info] of Object.entries(limbInfo)) {
    context.strokeStyle = info.color;
    context.lineWidth = 2;
    context.globalAlpha = 0.32;
    context.beginPath();
    gaitFrames.forEach((frame, index) => {
      const point = transformPaw(frame[limb], placement);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
    context.globalAlpha = 1;

    const point = transformPaw(current[limb], placement);
    const contact = current[limb][2] === 'stance';
    context.fillStyle = contact ? info.color : '#fff';
    context.strokeStyle = info.color;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(point.x, point.y, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.font = 'bold 15px Segoe UI, sans-serif';
    context.fillStyle = info.color;
    context.fillText(`${limb} ${contact ? '接地' : current[limb][2] === 'toeoff' ? '蹬地' : '摆动'}`, point.x + 11, point.y - 10);
  }
  context.restore();

  setStatus(`第 ${frameIndex + 1} / 16 帧 · ${current.phase} · 实心圆=接地，空心圆=离地/蹬地`);
  window.walkPreviewState.frameIndex = frameIndex;
}

function animate(timestamp) {
  if (!startedAt) startedAt = timestamp;
  if (mode === 'loop') drawLoop(timestamp);
  else if (mode === 'forward') drawForward(timestamp);
  else if (mode === 'transition') drawTransition(timestamp);
  else if (mode === 'debug') {
    if (debugPlaying && timestamp - previousTimestamp >= 260) {
      debugFrame = (debugFrame + 1) % frameCount;
      previousTimestamp = timestamp;
    }
    drawDebugFrame(debugFrame);
  }
  requestAnimationFrame(animate);
}

function bindDebugControls() {
  const toggleButton = document.querySelector('[data-action="toggle"]');
  if (toggleButton && debugPlaying) toggleButton.textContent = '暂停慢放';
  document.querySelector('[data-action="previous"]')?.addEventListener('click', () => {
    debugPlaying = false;
    debugFrame = (debugFrame + frameCount - 1) % frameCount;
  });
  document.querySelector('[data-action="next"]')?.addEventListener('click', () => {
    debugPlaying = false;
    debugFrame = (debugFrame + 1) % frameCount;
  });
  toggleButton?.addEventListener('click', (event) => {
    debugPlaying = !debugPlaying;
    event.currentTarget.textContent = debugPlaying ? '暂停慢放' : '慢速播放';
  });
  document.querySelector('[data-action="first"]')?.addEventListener('click', () => {
    debugPlaying = false;
    debugFrame = 0;
  });
}

Promise.all([
  Promise.all(walkSources.map(loadImage)),
  Promise.all(transitionSources.map(loadImage)),
  loadImage(idleSource),
]).then(([loadedWalk, loadedTransitions, loadedIdle]) => {
  walkImages = loadedWalk;
  transitionImages = loadedTransitions;
  idleImage = loadedIdle;
  bindDebugControls();
  window.walkPreviewState.ready = true;
  requestAnimationFrame(animate);
});
