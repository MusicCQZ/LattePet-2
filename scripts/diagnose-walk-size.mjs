import { spawn } from 'node:child_process';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

if (process.platform !== 'win32') {
  console.log('Walk-size runtime diagnosis requires the Windows packaged application.');
  process.exit(0);
}

const projectRoot = path.resolve(import.meta.dirname, '..');
const executable = path.join(projectRoot, 'out', 'Latte Pet-win32-x64', 'LattePet.exe');
const debuggingPort = 9335;
const repetitions = Number.parseInt(process.env.LATTE_WALK_DIAG_RUNS || '5', 10);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) {
  throw new Error('LATTE_WALK_DIAG_RUNS must be an integer from 1 to 5.');
}
await access(executable);

const temporaryRoot = await realpath(os.tmpdir());
const profileDirectory = await mkdtemp(path.join(temporaryRoot, 'latte-pet-walk-size-'));
let appProcess;
let socket;
let mainProcessOutput = '';

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getDebugTarget() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        return page;
      }
    } catch {
      // The Electron debugging endpoint has not started yet.
    }
    await delay(200);
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

function summarizeRanges(samples, property) {
  const values = samples.map((sample) => sample[property]).filter(Number.isFinite);
  return {
    max: Math.max(...values),
    min: Math.min(...values),
    spread: Math.max(...values) - Math.min(...values),
  };
}

async function getNativeWindowBounds(client, targetId) {
  try {
    const { windowId } = await client.send('Browser.getWindowForTarget', { targetId });
    return client.send('Browser.getWindowBounds', { windowId });
  } catch (error) {
    return { unavailable: error.message };
  }
}

try {
  appProcess = spawn(executable, [
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
  ], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', LATTE_SIZE_DEBUG: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  appProcess.stdout.on('data', (chunk) => { mainProcessOutput += chunk; });
  appProcess.stderr.on('data', (chunk) => { mainProcessOutput += chunk; });

  const target = await getDebugTarget();
  const client = createCdpClient(target.webSocketDebuggerUrl);
  socket = client.socket;
  await client.ready;
  await client.send('Runtime.enable');
  await waitForRenderer(
    client,
    `typeof takeWalk === 'function' && typeof assets !== 'undefined' && isWindowVisible`,
  );

  await evaluate(client, `
    (() => {
      const image = document.querySelector('#pet-image');
      const button = document.querySelector('#pet-button');
      const stage = document.querySelector('.pet-stage');
      const trace = { active: true, samples: [] };
      const scaleFrom = (transform) => {
        if (!transform || transform === 'none') return 1;
        const matrix = new DOMMatrixReadOnly(transform);
        return Math.hypot(matrix.a, matrix.b);
      };
      const walkFrame = () => {
        const source = image.src;
        const animation = assets.animations.walk;
        for (const [phase, frames] of [
          ['start', animation.startFrames || []],
          ['loop', animation.frames || []],
          ['stop', animation.stopFrames || []],
        ]) {
          const index = frames.findIndex((frame) => source.includes(frame.replace('../../', '')));
          if (index >= 0) return { index, phase };
        }
        return { index: -1, phase: 'idle' };
      };
      trace.record = (label) => {
        const imageStyle = getComputedStyle(image);
        const buttonStyle = getComputedStyle(button);
        const imageRect = image.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        const frame = walkFrame();
        trace.samples.push({
          actionState: button.className,
          animationToken,
          baseSource: assets.baseImage,
          buttonClientHeight: button.clientHeight,
          buttonClientWidth: button.clientWidth,
          buttonCssHeight: imageStyle.height,
          buttonCssWidth: imageStyle.width,
          buttonTransform: buttonStyle.transform,
          buttonTransformScale: scaleFrom(buttonStyle.transform),
          devicePixelRatio: window.devicePixelRatio,
          frameIndex: frame.index,
          framePhase: frame.phase,
          imageClientHeight: image.clientHeight,
          imageClientWidth: image.clientWidth,
          imageNaturalHeight: image.naturalHeight,
          imageNaturalWidth: image.naturalWidth,
          imageRectHeight: imageRect.height,
          imageRectWidth: imageRect.width,
          imageTransform: imageStyle.transform,
          imageTransformScale: scaleFrom(imageStyle.transform),
          label,
          outerHeight: window.outerHeight,
          outerWidth: window.outerWidth,
          source: image.src,
          stageClientHeight: stage.clientHeight,
          stageClientWidth: stage.clientWidth,
          stageRectHeight: stageRect.height,
          stageRectWidth: stageRect.width,
          time: performance.now(),
          userScale: currentState.scale,
          visualViewportScale: window.visualViewport?.scale ?? 1,
          windowInnerHeight: window.innerHeight,
          windowInnerWidth: window.innerWidth,
        });
      };
      const next = () => {
        if (!trace.active) return;
        trace.record('animation-frame');
        requestAnimationFrame(next);
      };
      trace.record('cold-start-idle');
      requestAnimationFrame(next);
      window.__latteWalkSizeTrace = trace;
      return trace.samples.at(-1);
    })()
  `);

  const nativeBounds = [];
  nativeBounds.push({ label: 'cold-start-idle', ...(await getNativeWindowBounds(client, target.id)) });

  for (let run = 1; run <= repetitions; run += 1) {
    await evaluate(client, `window.__latteWalkSizeTrace.record('walk-${run}-before')`);
    await evaluate(client, `takeWalk({ manual: true })`);
    await waitForRenderer(
      client,
      `document.querySelector('#pet-image').complete && document.querySelector('#pet-image').naturalWidth === 592 && document.querySelector('#pet-image').naturalHeight === 444`,
    );
    await evaluate(client, `window.__latteWalkSizeTrace.record('walk-${run}-after')`);
    nativeBounds.push({ label: `walk-${run}-after`, ...(await getNativeWindowBounds(client, target.id)) });
  }

  const dragBefore = await evaluate(client, `(() => {
    const image = document.querySelector('#pet-image');
    const button = document.querySelector('#pet-button');
    const rect = image.getBoundingClientRect();
    return [window.innerWidth, window.innerHeight, button.clientWidth, button.clientHeight, rect.width, rect.height];
  })()`);
  await evaluate(client, `petApi.startDrag(); petApi.moveDrag({ x: 48, y: 0 }); petApi.endDrag(); true`);
  await delay(200);
  const dragAfter = await evaluate(client, `(() => {
    const image = document.querySelector('#pet-image');
    const button = document.querySelector('#pet-button');
    const rect = image.getBoundingClientRect();
    return [window.innerWidth, window.innerHeight, button.clientWidth, button.clientHeight, rect.width, rect.height];
  })()`);

  const trace = await evaluate(client, `(() => {
    const trace = window.__latteWalkSizeTrace;
    trace.record('final-idle');
    trace.active = false;
    return trace.samples;
  })()`);
  const walkSamples = trace.filter((sample) => sample.framePhase !== 'idle');
  const perSource = Object.values(Object.groupBy(walkSamples, ({ source }) => source)).map((samples) => ({
    count: samples.length,
    source: samples[0].source.split('/').slice(-3).join('/'),
    ...summarizeRanges(samples, 'imageRectWidth'),
  }));
  const checkpoints = trace.filter((sample) => sample.label !== 'animation-frame');
  const walkRanges = {
    buttonClientHeight: summarizeRanges(walkSamples, 'buttonClientHeight'),
    buttonClientWidth: summarizeRanges(walkSamples, 'buttonClientWidth'),
    imageRectHeight: summarizeRanges(walkSamples, 'imageRectHeight'),
    imageRectWidth: summarizeRanges(walkSamples, 'imageRectWidth'),
    outerHeight: summarizeRanges(walkSamples, 'outerHeight'),
    outerWidth: summarizeRanges(walkSamples, 'outerWidth'),
    sameFrameImageRectWidthSpread: Math.max(...perSource.map(({ spread }) => spread)),
    stageClientHeight: summarizeRanges(walkSamples, 'stageClientHeight'),
    stageClientWidth: summarizeRanges(walkSamples, 'stageClientWidth'),
  };
  const assertions = {
    imageLayoutIsImmutable: walkRanges.imageRectHeight.spread === 0
      && walkRanges.imageRectWidth.spread === 0,
    // getBoundingClientRect includes the idle-breathe rotation after the walk
    // stops, so permit its harmless sub-pixel bounding-box variance here.
    // The viewport and CSS layout dimensions themselves must remain exact.
    dragPreservesLayout: dragBefore.slice(0, 4).every(
      (value, index) => value === dragAfter[index],
    )
      && Math.abs(dragAfter[4] - dragBefore[4]) < 0.1
      && Math.abs(dragAfter[5] - dragBefore[5]) < 0.1,
    sameFrameDoesNotGrow: walkRanges.sameFrameImageRectWidthSpread === 0,
    stageAndButtonAreImmutable: walkRanges.buttonClientHeight.spread === 0
      && walkRanges.buttonClientWidth.spread === 0
      && walkRanges.stageClientHeight.spread === 0
      && walkRanges.stageClientWidth.spread === 0,
    walkUsesOneSpriteCanvas: new Set(walkSamples.map((sample) => (
      `${sample.imageNaturalWidth}x${sample.imageNaturalHeight}`
    ))).size === 1,
  };
  const report = {
    assertions,
    checkpoints: checkpoints.map((sample) => ({
      actionState: sample.actionState,
      buttonClient: [sample.buttonClientWidth, sample.buttonClientHeight],
      frame: `${sample.framePhase}:${sample.frameIndex}`,
      imageNatural: [sample.imageNaturalWidth, sample.imageNaturalHeight],
      imageRect: [sample.imageRectWidth, sample.imageRectHeight],
      imageTransform: sample.imageTransform,
      label: sample.label,
      userScale: sample.userScale,
    })),
    drag: { after: dragAfter, before: dragBefore },
    nativeBounds,
    mainProcessSizeEvents: mainProcessOutput
      .split(/\r?\n/)
      .filter((line) => line.includes('latte-size-debug'))
      .map((line) => JSON.parse(line)),
    sampleCount: trace.length,
    uniqueNaturalSizes: [...new Set(trace.map((sample) => `${sample.imageNaturalWidth}x${sample.imageNaturalHeight}`))],
    uniqueScaleTuples: [...new Set(trace.map((sample) => `${sample.userScale}/${sample.imageTransformScale}/${sample.buttonTransformScale}/${sample.devicePixelRatio}/${sample.visualViewportScale}`))],
    walkRanges,
  };
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(assertions).some((passed) => !passed)) {
    throw new Error(`Walk-size diagnosis failed: ${JSON.stringify(assertions)}`);
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
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
    await rm(resolvedProfile, { force: true, maxRetries: 5, recursive: true, retryDelay: 200 });
  }
}
