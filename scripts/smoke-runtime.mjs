import { spawn } from 'node:child_process';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

if (process.platform !== 'win32') {
  console.log('Windows runtime smoke test skipped on this platform.');
  process.exit(0);
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const executable = path.join(projectRoot, 'out', 'Latte Pet-win32-x64', 'LattePet.exe');
await access(executable);

const temporaryRoot = await realpath(os.tmpdir());
const profileDirectory = await mkdtemp(path.join(temporaryRoot, 'latte-pet-smoke-'));
const debuggingPort = 9333;
let appProcess;
let socket;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getDebugTarget(predicate = (target) => target.type === 'page') {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
      const targets = await response.json();
      const page = targets.find(predicate);
      if (page?.webSocketDebuggerUrl) {
        return page;
      }
    } catch {
      // Electron has not opened the debugging endpoint yet.
    }
    await delay(250);
  }
  throw new Error('Timed out waiting for the Electron renderer debug target.');
}

function createCdpClient(webSocketUrl) {
  const webSocket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    webSocket.addEventListener('open', resolve, { once: true });
    webSocket.addEventListener('error', reject, { once: true });
  });

  webSocket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
  });

  return {
    ready,
    socket: webSocket,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { reject, resolve });
        webSocket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || 'Renderer evaluation failed.');
  }
  return response.result.value;
}

async function assertRenderer(client, label, expression) {
  const passed = await evaluate(client, expression);
  if (!passed) {
    throw new Error(`Runtime smoke assertion failed: ${label}`);
  }
  console.log(`PASS ${label}`);
}

async function waitForRenderer(client, expression, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) {
      return;
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for renderer state: ${expression}`);
}

async function tapPetAtNormalizedPoint(client, x, y) {
  return evaluate(client, `(() => {
    const button = document.querySelector('#pet-button');
    const image = document.querySelector('#pet-image');
    const rect = image.getBoundingClientRect();
    const clientX = rect.left + rect.width * ${JSON.stringify(x)};
    const clientY = rect.top + rect.height * ${JSON.stringify(y)};
    const region = getClickedInteractionRegion({ clientX, clientY });
    const eventOptions = {
      bubbles: true,
      button: 0,
      clientX,
      clientY,
      pointerId: 42,
      screenX: clientX,
      screenY: clientY,
    };
    button.dispatchEvent(new PointerEvent('pointerdown', { ...eventOptions, buttons: 1 }));
    button.dispatchEvent(new PointerEvent('pointerup', { ...eventOptions, buttons: 0 }));
    return region;
  })()`);
}

async function dragPetBy(client, x, y, deltaX, deltaY) {
  return evaluate(client, `(() => {
    const button = document.querySelector('#pet-button');
    const image = document.querySelector('#pet-image');
    const rect = image.getBoundingClientRect();
    const clientX = rect.left + rect.width * ${JSON.stringify(x)};
    const clientY = rect.top + rect.height * ${JSON.stringify(y)};
    const eventOptions = {
      bubbles: true,
      button: 0,
      clientX,
      clientY,
      pointerId: 43,
      screenX: clientX,
      screenY: clientY,
    };
    button.dispatchEvent(new PointerEvent('pointerdown', { ...eventOptions, buttons: 1 }));
    button.dispatchEvent(new PointerEvent('pointermove', {
      ...eventOptions,
      buttons: 1,
      clientX: clientX + ${JSON.stringify(deltaX)},
      clientY: clientY + ${JSON.stringify(deltaY)},
      screenX: clientX + ${JSON.stringify(deltaX)},
      screenY: clientY + ${JSON.stringify(deltaY)},
    }));
    button.dispatchEvent(new PointerEvent('pointerup', {
      ...eventOptions,
      buttons: 0,
      clientX: clientX + ${JSON.stringify(deltaX)},
      clientY: clientY + ${JSON.stringify(deltaY)},
      screenX: clientX + ${JSON.stringify(deltaX)},
      screenY: clientY + ${JSON.stringify(deltaY)},
    }));
    return { interactionInFlight, pointerState };
  })()`);
}

try {
  appProcess = spawn(
    executable,
    [
      `--remote-debugging-port=${debuggingPort}`,
      `--user-data-dir=${profileDirectory}`,
    ],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '',
      },
      stdio: 'ignore',
      windowsHide: false,
    },
  );

  const target = await getDebugTarget();
  const client = createCdpClient(target.webSocketDebuggerUrl);
  socket = client.socket;
  await client.ready;
  await client.send('Runtime.enable');
  await waitForRenderer(
    client,
    `typeof isWindowVisible !== 'undefined' && typeof assets !== 'undefined' && isWindowVisible && Boolean(assets.animations.walk)`,
  );

  await assertRenderer(
    client,
    'base pet image loaded',
    `document.querySelector('#pet-image').complete && document.querySelector('#pet-image').naturalWidth > 0`,
  );

  await assertRenderer(
    client,
    'pet uses the compact visual size',
    `(() => { const stage = document.querySelector('.pet-stage').getBoundingClientRect(); const pet = document.querySelector('#pet-button').getBoundingClientRect(); return pet.width <= stage.width * 0.81 && pet.height <= stage.height * 0.73; })()`,
  );

  await assertRenderer(
    client,
    'pet is fixed at the 80 percent size',
    `currentState.scale === 0.8 && window.innerWidth === 312 && window.innerHeight === 264`,
  );

  await assertRenderer(
    client,
    'clothing feature is absent from runtime state',
    `!('outfit' in currentState) && !('outfits' in assets) && typeof assets.baseImage === 'string'`,
  );

  await assertRenderer(
    client,
    'dialogue set contains only the new Latte lines',
    `JSON.stringify(phrases) === JSON.stringify([
      '你刚才打开的，是零食袋吗？',
      '我就尝一口，用小狗的那种一口。',
      '拿铁今天这么乖，应该加餐吧？',
      '你去哪儿？拿铁也要去。',
      '出去转一圈嘛，就一小圈。',
      '这条路我喜欢，明天还走。',
      '我都把爪爪给你了，你陪我一下嘛。',
    ])`,
  );

  await evaluate(client, `cancelAnimation(); void giveTreat(); true`);
  await waitForRenderer(
    client,
    `!document.querySelector('#snack').hidden && document.querySelector('#pet-image').src.includes('/animations/feed/frames-v1/')`,
  );
  await assertRenderer(
    client,
    'feeding uses a stable seated waiting frame and a separate biscuit control',
    `(() => { const image = document.querySelector('#pet-image'); const snack = document.querySelector('#snack'); return image.naturalWidth === 592 && image.naturalHeight === 444 && !snack.hidden && !document.querySelector('#pet-button').style.getPropertyValue('--pet-frame-scale'); })()`,
  );
  await waitForRenderer(client, `document.querySelector('#snack').hidden && !companionActionInFlight`, 5000);

  await evaluate(client, `petApi.requestHome(); true`);
  await waitForRenderer(
    client,
    `isNestSleeping && document.querySelector('#pet-image').src.includes('/animations/sleep/frames-v4/')`,
    8000,
  );
  await assertRenderer(
    client,
    'moving nest starts a persistent home sleep without changing layout size',
    `currentState.nest?.visible === true && window.innerWidth === 312 && window.innerHeight === 264 && document.querySelector('#pet-image').naturalWidth === 592 && document.querySelector('#pet-image').naturalHeight === 444`,
  );
  await evaluate(client, `void wakeFromNest(); true`);
  await waitForRenderer(
    client,
    `document.querySelector('#pet-image').src.includes('/animations/wake/frames-v1/frame-02.png')`,
    3000,
  );
  await waitForRenderer(client, `!isNestSleeping && !companionActionInFlight`, 3000);

  await evaluate(client, `petApi.finishFetch({ point: { x: window.screenX + window.innerWidth + 60, y: window.screenY + 80 } }); true`);
  const ballTarget = await getDebugTarget(
    (target) => target.type === 'page' && target.url.includes('toy.html'),
  );
  const ballClient = createCdpClient(ballTarget.webSocketDebuggerUrl);
  await ballClient.ready;
  await ballClient.send('Runtime.enable');
  await evaluate(ballClient, `(() => {
    window.latteToy.startDrag();
    for (let index = 1; index <= 180; index += 1) {
      window.latteToy.moveDrag({ x: index, y: Math.round(index / 3) });
    }
    window.latteToy.endDrag({ moved: false });
    return true;
  })()`);
  await delay(300);
  await assertRenderer(
    ballClient,
    'long ball drag keeps its immutable 48 pixel window size',
    `window.innerWidth === 48 && window.innerHeight === 48 && document.querySelector('#toy-ball').getBoundingClientRect().width === 48 && document.querySelector('#toy-ball').getBoundingClientRect().height === 48`,
  );
  ballClient.socket.close();

  await evaluate(client, `(() => { window.__latteOriginalRandom = Math.random; Math.random = () => 0.9; void takeFetch({ x: window.screenX + window.innerWidth / 2 + 36, y: window.screenY + window.innerHeight / 2 }); return true; })()`);
  await waitForRenderer(client, `!document.querySelector('#carried-ball').hidden`, 5000);
  await assertRenderer(
    client,
    'fetch carries the desktop ball with no image or layout scaling',
    `document.querySelector('#pet-image').naturalWidth === 592 && document.querySelector('#pet-image').naturalHeight === 444 && !document.querySelector('#pet-button').style.getPropertyValue('--pet-frame-scale') && window.innerWidth === 312 && window.innerHeight === 264`,
  );
  await waitForRenderer(client, `companionActionInFlight === false && document.querySelector('#carried-ball').hidden`, 6000);
  await evaluate(client, `Math.random = window.__latteOriginalRandom; delete window.__latteOriginalRandom; true`);

  const headRegion = await tapPetAtNormalizedPoint(client, 0.255, 0.275);
  if (headRegion !== 'head') {
    throw new Error(`Runtime smoke assertion failed: head hit map (${headRegion})`);
  }
  await waitForRenderer(
    client,
    `document.querySelector('#pet-button').classList.contains('is-interacting')`,
  );
  await assertRenderer(
    client,
    'head click starts a stable interaction sprite',
    `(() => { const source = document.querySelector('#pet-image').src; return (source.includes('/animations/idle-blink/frames-v2/') || source.includes('/animations/idle-ear-tail/frames-v2/')) && document.querySelector('#pet-image').naturalWidth === 592 && document.querySelector('#pet-image').naturalHeight === 444 && !document.querySelector('#pet-button').style.getPropertyValue('--pet-frame-scale'); })()`,
  );
  await assertRenderer(
    client,
    'head interaction uses a snack-related line',
    `['你刚才打开的，是零食袋吗？', '我就尝一口，用小狗的那种一口。'].includes(document.querySelector('#speech-bubble').textContent)`,
  );
  await waitForRenderer(client, `!interactionInFlight`, 3000);

  for (const [label, x, y, expectedRegion, expectedSource, expectedPhrase] of [
    ['body click', 0.545, 0.57, 'body', /\/animations\/(stretch|idle-ear-tail)\//, '拿铁今天这么乖，应该加餐吧？'],
    ['front-paw click', 0.275, 0.855, 'frontPaw', /\/animations\/paw-wave\//, '我都把爪爪给你了，你陪我一下嘛。'],
    ['tail click', 0.765, 0.295, 'tail', /\/animations\/tail-look\//, '你去哪儿？拿铁也要去。'],
  ]) {
    const region = await tapPetAtNormalizedPoint(client, x, y);
    if (region !== expectedRegion) {
      throw new Error(`Runtime smoke assertion failed: ${label} hit map (${region})`);
    }
    await waitForRenderer(client, `document.querySelector('#pet-button').classList.contains('is-interacting')`);
    const source = await evaluate(client, `document.querySelector('#pet-image').src`);
    if (!expectedSource.test(source)) {
      throw new Error(`Runtime smoke assertion failed: ${label} source (${source})`);
    }
    const phrase = await evaluate(client, `document.querySelector('#speech-bubble').textContent`);
    if (phrase !== expectedPhrase) {
      throw new Error(`Runtime smoke assertion failed: ${label} dialogue (${phrase})`);
    }
    await waitForRenderer(client, `!interactionInFlight`, 4000);
    console.log(`PASS ${label} starts its mapped interaction`);
  }

  const transparentRegion = await tapPetAtNormalizedPoint(client, 0.03, 0.03);
  await delay(100);
  if (transparentRegion !== null || await evaluate(client, `interactionInFlight`)) {
    throw new Error(`Runtime smoke assertion failed: transparent area triggered interaction (${transparentRegion})`);
  }
  console.log('PASS transparent image margins do not trigger interactions');

  await evaluate(client, `recentInteractionTaps = []; rapidReactionCooldownUntil = 0; rapidReactionQueued = false`);
  await tapPetAtNormalizedPoint(client, 0.255, 0.275);
  await tapPetAtNormalizedPoint(client, 0.255, 0.275);
  await tapPetAtNormalizedPoint(client, 0.255, 0.275);
  await waitForRenderer(
    client,
    `document.querySelector('#pet-image').src.includes('/animations/click/frames-v4/')`,
    4000,
  );
  await waitForRenderer(client, `!interactionInFlight`, 5000);
  await assertRenderer(
    client,
    'rapid taps queue one curious-tilt response',
    `rapidReactionQueued === false && recentInteractionTaps.length === 0 && !document.querySelector('#pet-button').classList.contains('is-interacting')`,
  );

  const dragResult = await dragPetBy(client, 0.545, 0.57, 9, 0);
  if (dragResult.interactionInFlight || dragResult.pointerState !== null) {
    throw new Error(`Runtime smoke assertion failed: drag was mistaken for interaction (${JSON.stringify(dragResult)})`);
  }
  console.log('PASS drag release does not trigger an interaction');

  await evaluate(client, `cancelAnimation(); void takeWalk({ manual: true }); true`);
  const walkLayoutBefore = await evaluate(client, `({
    buttonHeight: document.querySelector('#pet-button').clientHeight,
    buttonWidth: document.querySelector('#pet-button').clientWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  })`);
  await waitForRenderer(
    client,
    `document.querySelector('#pet-image').src.includes('/animations/walk/transition-v9/') && document.querySelector('#pet-button').classList.contains('is-walking')`,
  );
  const walkStartState = await evaluate(client, `({
    className: document.querySelector('#pet-button').className,
    image: document.querySelector('#pet-image').src,
    inlineScale: document.querySelector('#pet-button').style.getPropertyValue('--pet-frame-scale'),
    isWindowVisible,
    renderScaleDeclared: 'renderScale' in assets.animations.walk,
    frameCount: assets.animations.walk.frames.length,
    startCount: assets.animations.walk.startFrames.length,
    stopCount: assets.animations.walk.stopFrames.length,
    frameDuration: assets.animations.walk.frameDuration,
    speed: assets.animations.walk.speed,
  })`);
  if (!walkStartState.image.includes('/animations/walk/transition-v9/')
    || !walkStartState.className.includes('is-walking')
    || walkStartState.inlineScale
    || walkStartState.renderScaleDeclared
    || walkStartState.frameCount !== 16
    || walkStartState.startCount !== 3
    || walkStartState.stopCount !== 4
    || walkStartState.frameDuration !== 110
    || walkStartState.speed !== 70) {
    throw new Error(`Runtime smoke assertion failed: walk sprite animation active (${JSON.stringify(walkStartState)})`);
  }
  console.log('PASS walk sprite animation active');
  await assertRenderer(
    client,
    'manual walk uses a walking-related line',
    `['你去哪儿？拿铁也要去。', '出去转一圈嘛，就一小圈。', '这条路我喜欢，明天还走。'].includes(document.querySelector('#speech-bubble').textContent)`,
  );

  await delay(520);
  const walkProgressState = await evaluate(client, `({
    source: document.querySelector('#pet-image').src,
    className: document.querySelector('#pet-button').className,
    animationToken,
    isWindowVisible,
    screenX: window.screenX,
  })`);
  if (walkProgressState.source.includes('/previews/latte-base-normalized-v2.png')) {
    throw new Error(`Walk returned to idle before its cycle completed: ${JSON.stringify(walkProgressState)}`);
  }
  const firstWalkFrame = walkProgressState.source;
  const firstWalkX = walkProgressState.screenX;
  await waitForRenderer(
    client,
    `document.querySelector('#pet-image').src !== ${JSON.stringify(firstWalkFrame)}`,
  );
  await waitForRenderer(client, `window.screenX !== ${JSON.stringify(firstWalkX)}`);
  console.log('PASS walk frames and position advance independently');

  await delay(800);
  const walkLayoutDuringMovement = await evaluate(client, `({
    buttonHeight: document.querySelector('#pet-button').clientHeight,
    buttonWidth: document.querySelector('#pet-button').clientWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  })`);
  if (JSON.stringify(walkLayoutDuringMovement) !== JSON.stringify(walkLayoutBefore)) {
    throw new Error(`Walk changed immutable window or image layout dimensions: ${JSON.stringify({
      before: walkLayoutBefore,
      during: walkLayoutDuringMovement,
    })}`);
  }
  console.log('PASS walk keeps the immutable window and image layout dimensions');

  const walkingHeadX = await evaluate(
    client,
    `document.querySelector('#pet-button').classList.contains('is-facing-left') ? 0.745 : 0.255`,
  );
  const walkingInteractionRegion = await tapPetAtNormalizedPoint(client, walkingHeadX, 0.275);
  if (walkingInteractionRegion !== 'head') {
    throw new Error(`Runtime smoke assertion failed: walking head hit map (${walkingInteractionRegion})`);
  }
  await waitForRenderer(client, `document.querySelector('#pet-button').classList.contains('is-interacting')`, 4000);
  await waitForRenderer(
    client,
    `!interactionInFlight && document.querySelector('#pet-button').classList.contains('is-walking')`,
    6000,
  );
  const layoutAfterWalkingInteraction = await evaluate(client, `({
    buttonHeight: document.querySelector('#pet-button').clientHeight,
    buttonWidth: document.querySelector('#pet-button').clientWidth,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  })`);
  if (JSON.stringify(layoutAfterWalkingInteraction) !== JSON.stringify(walkLayoutBefore)) {
    throw new Error(`Walking interaction changed immutable dimensions: ${JSON.stringify({
      before: walkLayoutBefore,
      after: layoutAfterWalkingInteraction,
    })}`);
  }
  console.log('PASS walking click stops, responds, resumes, and preserves layout');

  const transitionScaleState = await evaluate(client, `(async () => {
    cancelAnimation();
    const animation = assets.animations.walk;
    const token = animationToken;
    const samples = [];
    beginFrameAnimation('is-walking');
    await playFrameSequence({
      frameDuration: 24,
      frames: [...animation.startFrames, ...animation.stopFrames],
      onFrame() {
        const transform = getComputedStyle(document.querySelector('#pet-image')).transform;
        const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
        samples.push(Math.hypot(matrix.a, matrix.b));
      },
    }, token);
    return { samples };
  })()`);
  if (transitionScaleState.samples.length === 0
    || transitionScaleState.samples.some((scale) => Math.abs(scale - 1) > 0.001)) {
    throw new Error(`Walk transition changed visual scale: ${JSON.stringify(transitionScaleState)}`);
  }
  console.log('PASS walk start and stop keep the fixed visual scale');

  await evaluate(client, `handleWindowVisibilityChanged(false)`);
  await assertRenderer(
    client,
    'hiding resets the active walk to the base image',
    `!isWindowVisible && document.querySelector('#pet-image').src.includes('/previews/latte-base-normalized-v2.png') && !document.querySelector('#pet-button').classList.contains('is-frame-animation') && !document.querySelector('#pet-button').classList.contains('is-walking') && autonomousTimer === null`,
  );
  await evaluate(client, `handleWindowVisibilityChanged(true)`);
  await evaluate(client, `void takeWalk({ manual: true }); true`);
  await waitForRenderer(
    client,
    `document.querySelector('#pet-button').classList.contains('is-walking')`,
  );
  await assertRenderer(
    client,
    'walk after hide and show does not zoom',
    `(() => { const image = document.querySelector('#pet-image'); const transform = getComputedStyle(image).transform; const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform); return isWindowVisible && document.querySelector('#pet-button').classList.contains('is-walking') && Math.abs(Math.hypot(matrix.a, matrix.b) - 1) < 0.001; })()`,
  );

  await evaluate(client, `cancelAnimation(); void takeNap({ manual: true }); true`);
  await waitForRenderer(
    client,
    `document.querySelector('#pet-image').src.includes('/animations/sleep/frames-v4/')`,
  );
  const sleepState = await evaluate(client, `({
    source: document.querySelector('#pet-image').src,
    hasAnimation: Boolean(assets.animations.sleep),
    classes: document.querySelector('#pet-button').className,
    frameCount: assets.animations.sleep.frames.length,
    frameDuration: assets.animations.sleep.frameDuration,
    imageHeight: document.querySelector('#pet-image').naturalHeight,
    imageWidth: document.querySelector('#pet-image').naturalWidth,
  })`);
  if (!sleepState.source.includes('/animations/sleep/frames-v4/')
    || sleepState.frameCount !== 8
    || sleepState.frameDuration !== 280
    || sleepState.imageWidth !== 592
    || sleepState.imageHeight !== 444) {
    throw new Error(`Runtime smoke assertion failed: sleep sprite animation active (${JSON.stringify(sleepState)})`);
  }
  console.log('PASS sleep sprite animation active');

  await evaluate(client, `cancelAnimation(); void takeStretch({ manual: true }); true`);
  await waitForRenderer(
    client,
    `document.querySelector('#pet-image').src.includes('/animations/stretch/frames-v4/')`,
  );
  await assertRenderer(
    client,
    'stretch sprite animation active',
    `document.querySelector('#pet-image').src.includes('/animations/stretch/frames-v4/') && document.querySelector('#pet-image').naturalWidth === 592 && document.querySelector('#pet-image').naturalHeight === 444 && !document.querySelector('#pet-button').style.getPropertyValue('--pet-frame-scale') && assets.animations.stretch.frames.length === 10 && assets.animations.stretch.frameDuration === 160`,
  );

  for (const [animationName, directory] of [
    ['idleBlink', 'idle-blink'],
    ['idleSniff', 'idle-sniff'],
    ['idleEarTail', 'idle-ear-tail'],
  ]) {
    await evaluate(client, `cancelAnimation(); void playIdleAction('${animationName}'); true`);
    await waitForRenderer(
      client,
      `document.querySelector('#pet-image').src.includes('/animations/${directory}/frames-v2/')`,
    );
    await assertRenderer(
      client,
      `${animationName} idle animation active`,
      `document.querySelector('#pet-image').src.includes('/animations/${directory}/frames-v2/') && document.querySelector('#pet-image').naturalWidth === 592 && document.querySelector('#pet-image').naturalHeight === 444 && document.querySelector('#pet-button').classList.contains('is-idle-action') && !document.querySelector('#pet-button').style.getPropertyValue('--pet-frame-scale') && !('renderScale' in assets.animations.${animationName}) && assets.animations.${animationName}.frames.length === 6`,
    );
  }

  await evaluate(client, `cancelAnimation()`);
  console.log('Runtime smoke test passed.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close();
  }
  if (appProcess && !appProcess.killed) {
    appProcess.kill();
    await Promise.race([
      new Promise((resolve) => appProcess.once('exit', resolve)),
      delay(2000),
    ]);
  }

  const resolvedProfile = path.resolve(profileDirectory);
  const safePrefix = `${path.resolve(temporaryRoot)}${path.sep}`;
  if (resolvedProfile.startsWith(safePrefix)) {
    try {
      await rm(resolvedProfile, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 200,
      });
    } catch (error) {
      console.warn(`Temporary smoke profile could not be removed yet: ${error.message}`);
    }
  }
}
