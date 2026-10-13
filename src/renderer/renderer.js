'use strict';

const petApi = window.lattePet;
const petButton = document.querySelector('#pet-button');
const petImage = document.querySelector('#pet-image');
const speechBubble = document.querySelector('#speech-bubble');
const snack = document.querySelector('#snack');
const carriedBall = document.querySelector('#carried-ball');
const { getCycleDuration, getFrameIndex } = window.LatteWalkTiming;
const { chooseReaction, getInteractionRegion } = window.LatteInteractionMapping;

const fallbackAssets = {
  animations: {},
  baseImage: '../../assets/latte/previews/latte-base-normalized-v2.png',
};

const idleAnimationNames = Object.freeze(['idleBlink', 'idleSniff', 'idleEarTail']);
const interactionChoices = Object.freeze({
  head: Object.freeze([
    Object.freeze({ animation: 'idleBlink', id: 'head-blink' }),
    Object.freeze({ animation: 'idleEarTail', id: 'head-ear-flick' }),
  ]),
  body: Object.freeze([
    Object.freeze({ animation: 'stretch', id: 'body-stretch' }),
    Object.freeze({ animation: 'idleEarTail', id: 'body-tail-wag' }),
  ]),
  frontPaw: Object.freeze([
    Object.freeze({ animation: 'pawWave', id: 'front-paw-wave' }),
  ]),
  rapid: Object.freeze([
    Object.freeze({ animation: 'click', id: 'rapid-curious-tilt' }),
  ]),
  tail: Object.freeze([
    Object.freeze({ animation: 'tailLook', id: 'tail-look-and-wag' }),
  ]),
});
const DRAG_THRESHOLD_PIXELS = 5;
const RAPID_TAP_WINDOW_MILLISECONDS = 900;
const RAPID_TAP_COUNT = 3;

const phrases = Object.freeze([
  '你刚才打开的，是零食袋吗？',
  '我就尝一口，用小狗的那种一口。',
  '拿铁今天这么乖，应该加餐吧？',
  '你去哪儿？拿铁也要去。',
  '出去转一圈嘛，就一小圈。',
  '这条路我喜欢，明天还走。',
  '我都把爪爪给你了，你陪我一下嘛。',
]);
const phrasesByAction = Object.freeze({
  'body-stretch': Object.freeze([phrases[2]]),
  'body-tail-wag': Object.freeze([phrases[2]]),
  'front-paw-wave': Object.freeze([phrases[6]]),
  'head-blink': Object.freeze([phrases[0], phrases[1]]),
  'head-ear-flick': Object.freeze([phrases[0], phrases[1]]),
  'tail-look-and-wag': Object.freeze([phrases[3]]),
  walk: Object.freeze([phrases[3], phrases[4], phrases[5]]),
});

let animationToken = 0;
let assets = fallbackAssets;
let autonomousTimer = null;
let animationPreloadPromise = Promise.resolve();
let bubbleTimer = null;
let currentState = {
  autonomousBehaviors: true,
};
let lastPhrase = null;
let lastIdleAnimationIndex = -1;
let pointerState = null;
let walkDirection = 1;
let isWindowVisible = false;
let activeWalk = null;
let interactionInFlight = false;
let rapidReactionQueued = false;
let rapidReactionCooldownUntil = 0;
let recentInteractionTaps = [];
let companionActionInFlight = false;
let isNestSleeping = false;
let heldBallReturnPoint = null;
let snackTimer = null;
let travelWaiter = null;
let hasAppliedState = false;
const lastReactionByRegion = new Map();
const alphaHitCanvas = document.createElement('canvas');
const alphaHitContext = alphaHitCanvas.getContext('2d', { willReadFrequently: true });

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function choosePhrase(actionId) {
  const candidates = phrasesByAction[actionId] || phrases;
  const alternatives = candidates.filter((phrase) => phrase !== lastPhrase);
  const pool = alternatives.length > 0 ? alternatives : candidates;
  const phrase = pool[Math.floor(Math.random() * pool.length)];
  lastPhrase = phrase;
  return phrase;
}

function showSpeech(message, duration = 2200) {
  speechBubble.textContent = message;
  speechBubble.classList.add('is-visible');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    speechBubble.classList.remove('is-visible');
  }, duration);
}

function clearSnackTimer() {
  clearTimeout(snackTimer);
  snackTimer = null;
}

function showSnack() {
  clearSnackTimer();
  snack.hidden = false;
}

function hideSnack() {
  clearSnackTimer();
  snack.hidden = true;
}

function hideCarriedBall() {
  carriedBall.hidden = true;
  heldBallReturnPoint = null;
}

function resolveTravel(arrival) {
  if (!travelWaiter || travelWaiter.kind !== arrival?.kind) {
    return;
  }
  const { resolve, timer } = travelWaiter;
  clearTimeout(timer);
  travelWaiter = null;
  resolve(arrival);
}

function waitForTravel(kind) {
  if (travelWaiter) {
    clearTimeout(travelWaiter.timer);
    travelWaiter.resolve(null);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (travelWaiter?.timer === timer) {
        travelWaiter = null;
        resolve(null);
      }
    }, 30000);
    travelWaiter = { kind, resolve, timer };
  });
}

function getBaseSource() {
  return assets.baseImage || fallbackAssets.baseImage;
}

function setIdleImage() {
  petButton.classList.remove(
    'click-reaction',
    'is-facing-left',
    'is-frame-animation',
    'is-idle-action',
    'is-interacting',
    'is-sleeping',
    'is-walking',
  );
  petImage.src = getBaseSource();
}

function beginFrameAnimation(...classes) {
  petButton.classList.remove(
    'click-reaction',
    'is-facing-left',
    'is-idle-action',
    'is-interacting',
    'is-sleeping',
    'is-walking',
  );
  petButton.classList.add('is-frame-animation', ...classes);
}

function cancelAnimation({ restore = true, preserveCarry = false } = {}) {
  animationToken++;
  petApi.endAutomaticMove();
  if (!preserveCarry) {
    hideCarriedBall();
  }
  if (restore) {
    setIdleImage();
  }
}

function clearAutonomousTimer() {
  clearTimeout(autonomousTimer);
  autonomousTimer = null;
}

function scheduleAutonomousBehavior(delay) {
  clearAutonomousTimer();
  if (!isWindowVisible || !currentState.autonomousBehaviors) {
    return;
  }

  const nextDelay = delay ?? 24000 + Math.random() * 26000;
  autonomousTimer = setTimeout(runAutonomousBehavior, nextDelay);
}

function preloadAssets() {
  const sources = [
    assets.baseImage,
    ...Object.values(assets.animations || {}).flatMap((animation) => (
      Object.values(animation).flatMap((value) => (
        Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
      ))
    )),
  ].filter((source) => typeof source === 'string');

  animationPreloadPromise = Promise.allSettled(sources.map((source) => new Promise((resolve) => {
    const image = new Image();
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
    image.src = source;
    if (image.complete) resolve();
  })));
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function playFrameSequence({
  frameDuration,
  frames,
  onFrame,
}, token) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return token === animationToken;
  }

  const safeFrameDuration = Number.isFinite(Number(frameDuration))
    ? Math.max(1, Number(frameDuration))
    : 100;
  const totalDuration = safeFrameDuration * frames.length;
  const startedAt = performance.now();
  let previousFrameIndex = -1;

  while (token === animationToken) {
    const elapsed = performance.now() - startedAt;
    const frameIndex = Math.min(
      frames.length - 1,
      Math.floor(elapsed / safeFrameDuration),
    );

    if (frameIndex !== previousFrameIndex) {
      petImage.src = frames[frameIndex];
      onFrame?.(frameIndex);
      previousFrameIndex = frameIndex;
    }

    if (elapsed >= totalDuration) {
      return true;
    }
    await nextAnimationFrame();
  }

  return false;
}

async function playClickReaction() {
  return requestInteraction('head');
}

function getInteractionChoice(region) {
  const choices = interactionChoices[region] || [];
  const choice = chooseReaction(choices, lastReactionByRegion.get(region));
  if (choice) {
    lastReactionByRegion.set(region, choice.id);
  }
  return choice;
}

function recordInteractionTap() {
  const now = performance.now();
  recentInteractionTaps = recentInteractionTaps.filter(
    (timestamp) => now - timestamp <= RAPID_TAP_WINDOW_MILLISECONDS,
  );
  recentInteractionTaps.push(now);

  if (recentInteractionTaps.length < RAPID_TAP_COUNT || now < rapidReactionCooldownUntil) {
    return false;
  }

  recentInteractionTaps = [];
  rapidReactionCooldownUntil = now + RAPID_TAP_WINDOW_MILLISECONDS;
  rapidReactionQueued = true;
  return true;
}

function stopWalkForInteraction() {
  if (!activeWalk) {
    return Promise.resolve(null);
  }
  activeWalk.stopRequested = true;
  return activeWalk.finished;
}

async function playInteraction(choice) {
  const animation = assets.animations[choice?.animation];
  if (!animation) {
    return false;
  }

  cancelAnimation({ restore: false });
  const token = animationToken;
  beginFrameAnimation('is-interacting');
  showSpeech(
    choosePhrase(choice.id),
    Math.max(1200, animation.frameDuration * animation.frames.length),
  );
  const completed = await playFrameSequence(animation, token);
  if (completed && token === animationToken) {
    setIdleImage();
  }
  return completed && token === animationToken;
}

async function requestInteraction(region) {
  if (isNestSleeping) {
    await wakeFromNest();
    return;
  }
  if (companionActionInFlight) {
    return;
  }
  if (!interactionChoices[region]) {
    return;
  }

  const isRapidTap = recordInteractionTap();
  if (interactionInFlight) {
    return;
  }

  interactionInFlight = true;
  clearAutonomousTimer();
  const interruptedWalk = activeWalk
    ? { direction: walkDirection, manual: activeWalk.manual }
    : null;

  try {
    if (interruptedWalk) {
      await stopWalkForInteraction();
    }

    const firstChoice = isRapidTap
      ? getInteractionChoice('rapid')
      : getInteractionChoice(region);
    const completed = await playInteraction(firstChoice);

    if (completed && rapidReactionQueued && firstChoice?.id !== 'rapid-curious-tilt') {
      rapidReactionQueued = false;
      await playInteraction(getInteractionChoice('rapid'));
    } else if (firstChoice?.id === 'rapid-curious-tilt') {
      rapidReactionQueued = false;
    }
  } finally {
    interactionInFlight = false;
  }

  if (interruptedWalk && isWindowVisible) {
    void takeWalk({
      cycles: interruptedWalk.manual ? 3 : 2,
      direction: interruptedWalk.direction,
      manual: false,
    });
  } else {
    scheduleAutonomousBehavior();
  }
}

async function takeWalk({ cycles: requestedCycles, direction, manual = false } = {}) {
  clearAutonomousTimer();
  if (!assets.animations.walk) {
    scheduleAutonomousBehavior(12000);
    return;
  }

  cancelAnimation({ restore: false });
  const token = animationToken;
  const walkAnimation = assets.animations.walk;
  const cycles = Number.isInteger(requestedCycles) && requestedCycles > 0
    ? requestedCycles
    : (manual ? 6 : 4 + Math.floor(Math.random() * 4));
  walkDirection = direction === -1 || direction === 1
    ? direction
    : (Math.random() < 0.5 ? -1 : 1);
  const requestedSpeed = Number(walkAnimation.speed);
  const scaleMultiplier = Number.isFinite(Number(currentState.scale))
    ? Number(currentState.scale)
    : 1;
  const movementSpeed = (Number.isFinite(requestedSpeed) ? requestedSpeed : 70)
    * scaleMultiplier;

  await animationPreloadPromise;
  if (token !== animationToken) {
    return;
  }

  if (manual) {
    showSpeech(choosePhrase('walk'));
  }

  beginFrameAnimation('is-walking');
  petButton.classList.toggle('is-facing-left', walkDirection < 0);
  let resolveFinished;
  const walkRun = {
    finished: new Promise((resolve) => {
      resolveFinished = resolve;
    }),
    manual,
    stopRequested: false,
    token,
  };
  activeWalk = walkRun;
  let isMoving = false;

  const beginMoving = () => {
    if (isMoving || token !== animationToken) {
      return;
    }
    petApi.startAutomaticMove({ direction: walkDirection, speed: movementSpeed });
    isMoving = true;
  };

  const endMoving = () => {
    if (!isMoving) {
      return;
    }
    petApi.endAutomaticMove();
    isMoving = false;
  };

  try {
    const startFrames = walkAnimation.startFrames || [];
    const startCompleted = await playFrameSequence({
      frameDuration: walkAnimation.transitionFrameDuration,
      frames: startFrames,
      onFrame(frameIndex) {
        if (frameIndex === startFrames.length - 1) {
          beginMoving();
        }
      },
    }, token);
    if (!startCompleted || token !== animationToken) {
      return;
    }

    beginMoving();
    petImage.src = walkAnimation.frames[0];
    const cycleDuration = getCycleDuration(
      walkAnimation.frameDuration,
      walkAnimation.frames.length,
    );
    const totalDuration = cycleDuration * cycles;
    const startedAt = performance.now();
    let previousFrameIndex = 0;

    while (token === animationToken && !walkRun.stopRequested) {
      await nextAnimationFrame();
      if (token !== animationToken) {
        break;
      }
      const elapsed = performance.now() - startedAt;
      if (elapsed >= totalDuration) {
        break;
      }

      const frameIndex = getFrameIndex(
        elapsed,
        walkAnimation.frameDuration,
        walkAnimation.frames.length,
      );
      if (frameIndex !== previousFrameIndex) {
        petImage.src = walkAnimation.frames[frameIndex];
        previousFrameIndex = frameIndex;
      }
    }

    if (token === animationToken) {
      const stopFrames = walkAnimation.stopFrames || [];
      await playFrameSequence({
        frameDuration: walkAnimation.transitionFrameDuration,
        frames: stopFrames,
        onFrame(frameIndex) {
          if (frameIndex >= Math.min(2, stopFrames.length - 1)) {
            endMoving();
          }
        },
      }, token);
    }
  } finally {
    endMoving();
    if (activeWalk === walkRun) {
      activeWalk = null;
    }
    resolveFinished({
      cancelled: token !== animationToken,
      interrupted: walkRun.stopRequested,
    });
  }

  if (token === animationToken) {
    setIdleImage();
    if (!walkRun.stopRequested) {
      scheduleAutonomousBehavior();
    }
  }
}

async function takeNap({ manual = false } = {}) {
  clearAutonomousTimer();
  if (!assets.animations.sleep) {
    scheduleAutonomousBehavior(12000);
    return;
  }

  cancelAnimation({ restore: false });
  const token = animationToken;
  const sleepAnimation = assets.animations.sleep;
  const cycles = manual ? 7 : 4 + Math.floor(Math.random() * 3);
  beginFrameAnimation('is-sleeping');

  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const frame of sleepAnimation.frames) {
      if (token !== animationToken) {
        return;
      }
      petImage.src = frame;
      await wait(sleepAnimation.frameDuration);
    }
  }

  if (token === animationToken) {
    setIdleImage();
    scheduleAutonomousBehavior();
  }
}

async function takeStretch({ manual = false } = {}) {
  clearAutonomousTimer();
  if (!assets.animations.stretch) {
    scheduleAutonomousBehavior(12000);
    return;
  }

  cancelAnimation({ restore: false });
  const token = animationToken;
  const stretchAnimation = assets.animations.stretch;
  beginFrameAnimation();

  if (manual) {
    showSpeech(choosePhrase('body-stretch'));
  }

  for (const frame of stretchAnimation.frames) {
    if (token !== animationToken) {
      return;
    }
    petImage.src = frame;
    await wait(stretchAnimation.frameDuration);
  }

  if (token === animationToken) {
    setIdleImage();
    scheduleAutonomousBehavior();
  }
}

async function giveTreat() {
  const feedAnimation = assets.animations.feed;
  if (companionActionInFlight || interactionInFlight || !feedAnimation) {
    return;
  }

  companionActionInFlight = true;
  isNestSleeping = false;
  clearAutonomousTimer();
  cancelAnimation({ restore: false });
  const token = animationToken;
  showSnack();
  beginFrameAnimation('is-interacting');
  showSpeech(choosePhrase('head-blink'), feedAnimation.frameDuration * feedAnimation.frames.length);

  try {
    const completed = await playFrameSequence({
      ...feedAnimation,
      onFrame(frameIndex) {
        // The first four frames are the focused, seated wait.  Only then does
        // the biscuit disappear and the sniff/lick and tail-wag response run.
        if (frameIndex >= 4) {
          hideSnack();
        }
      },
    }, token);
    if (completed && token === animationToken) {
      setIdleImage();
    }
  } finally {
    if (token === animationToken) {
      hideSnack();
    }
    companionActionInFlight = false;
    if (token === animationToken) {
      scheduleAutonomousBehavior();
    }
  }
}

async function askForTreat() {
  const feedAnimation = assets.animations.feed;
  if (companionActionInFlight || interactionInFlight || !feedAnimation) {
    return;
  }

  companionActionInFlight = true;
  clearAutonomousTimer();
  cancelAnimation({ restore: false });
  const token = animationToken;
  showSnack();
  beginFrameAnimation('is-interacting');
  showSpeech(choosePhrase('head-blink'), 3400);

  const waitingFrames = feedAnimation.frames.slice(0, 4);
  const completed = await playFrameSequence({
    frameDuration: 300,
    frames: waitingFrames,
  }, token);
  companionActionInFlight = false;

  if (!completed || token !== animationToken) {
    return;
  }

  // Keep the cookie clickable for a short time: this is a genuine invitation
  // to feed Latte, rather than a speech-only autonomous event.
  petImage.src = waitingFrames.at(-1);
  snackTimer = setTimeout(() => {
    hideSnack();
    if (!interactionInFlight && !companionActionInFlight && !isNestSleeping) {
      setIdleImage();
      scheduleAutonomousBehavior();
    }
  }, 6200);
}

async function travelWithWalk({ kind, point, token }) {
  const walkAnimation = assets.animations.walk;
  if (!walkAnimation || !point || token !== animationToken) {
    return null;
  }

  const arrival = waitForTravel(kind);
  const currentCenterX = window.screenX + window.innerWidth / 2;
  walkDirection = point.x < currentCenterX ? -1 : 1;
  beginFrameAnimation('is-walking');
  petButton.classList.toggle('is-facing-left', walkDirection < 0);
  petApi.startTravel({ kind, point });

  let arrived = null;
  arrival.then((value) => {
    arrived = value;
  });
  let previousFrameIndex = -1;
  const startedAt = performance.now();
  while (token === animationToken && !arrived) {
    const frameIndex = getFrameIndex(
      performance.now() - startedAt,
      walkAnimation.frameDuration,
      walkAnimation.frames.length,
    );
    if (frameIndex !== previousFrameIndex) {
      petImage.src = walkAnimation.frames[frameIndex];
      previousFrameIndex = frameIndex;
    }
    await nextAnimationFrame();
  }

  return token === animationToken ? arrived : null;
}

async function takeFetch(point) {
  if (companionActionInFlight || interactionInFlight || !point) {
    return;
  }

  companionActionInFlight = true;
  isNestSleeping = false;
  hideSnack();
  clearAutonomousTimer();
  cancelAnimation({ restore: false });
  const token = animationToken;
  showSpeech(choosePhrase('walk'), 2300);

  try {
    const foundBall = await travelWithWalk({ kind: 'fetch', point, token });
    if (!foundBall || token !== animationToken) {
      return;
    }

    carriedBall.hidden = false;
    const returnArrival = waitForTravel('return-fetch');
    const returnPointPromise = returnArrival;
    petApi.returnFetch();
    let returned = null;
    let previousFrameIndex = -1;
    const walkAnimation = assets.animations.walk;
    const startedAt = performance.now();
    returnPointPromise.then((value) => {
      returned = value;
    });
    while (token === animationToken && !returned) {
      const frameIndex = getFrameIndex(
        performance.now() - startedAt,
        walkAnimation.frameDuration,
        walkAnimation.frames.length,
      );
      if (frameIndex !== previousFrameIndex) {
        petImage.src = walkAnimation.frames[frameIndex];
        previousFrameIndex = frameIndex;
      }
      await nextAnimationFrame();
    }
    if (!returned || token !== animationToken) {
      return;
    }

    heldBallReturnPoint = returned.point;
    beginFrameAnimation('is-interacting');
    await playFrameSequence({
      frameDuration: 180,
      frames: (assets.animations.tailLook?.frames || []).slice(0, 5),
    }, token);
    if (token !== animationToken) {
      return;
    }

    if (Math.random() < 0.28) {
      // Latte occasionally keeps the ball in her mouth and waits for a click.
      showSpeech('我都把爪爪给你了，你陪我一下嘛。', 3200);
      setIdleImage();
      carriedBall.hidden = false;
      return;
    }

    hideCarriedBall();
    petApi.finishFetch({ point: returned.point });
    setIdleImage();
  } finally {
    companionActionInFlight = false;
    if (token === animationToken && !isNestSleeping) {
      scheduleAutonomousBehavior();
    }
  }
}

async function releaseHeldBall() {
  if (!heldBallReturnPoint || companionActionInFlight) {
    return;
  }
  companionActionInFlight = true;
  const point = heldBallReturnPoint;
  hideCarriedBall();
  showSpeech('出去转一圈嘛，就一小圈。', 1800);
  await playFrameSequence({
    frameDuration: 150,
    frames: (assets.animations.idleEarTail?.frames || []).slice(0, 4),
  }, animationToken);
  petApi.finishFetch({ point });
  setIdleImage();
  companionActionInFlight = false;
  scheduleAutonomousBehavior();
}

function beginNestSleep() {
  const sleepAnimation = assets.animations.sleep;
  if (!sleepAnimation) {
    return;
  }
  isNestSleeping = true;
  const token = animationToken;
  beginFrameAnimation('is-sleeping');

  void (async () => {
    while (token === animationToken && isNestSleeping) {
      const completed = await playFrameSequence(sleepAnimation, token);
      if (!completed) {
        return;
      }
    }
  })();
}

async function goHome(point) {
  if (companionActionInFlight || interactionInFlight || !point) {
    return;
  }
  companionActionInFlight = true;
  clearAutonomousTimer();
  hideSnack();
  cancelAnimation({ restore: false });
  const token = animationToken;
  showSpeech(choosePhrase('walk'), 2100);

  try {
    const arrived = await travelWithWalk({ kind: 'home', point, token });
    if (arrived && token === animationToken) {
      beginNestSleep();
    }
  } finally {
    companionActionInFlight = false;
    if (token === animationToken && !isNestSleeping) {
      setIdleImage();
      scheduleAutonomousBehavior();
    }
  }
}

async function wakeFromNest() {
  const wakeAnimation = assets.animations.wake;
  if (!isNestSleeping || !wakeAnimation || companionActionInFlight) {
    return;
  }
  companionActionInFlight = true;
  isNestSleeping = false;
  clearAutonomousTimer();
  cancelAnimation({ restore: false });
  const token = animationToken;
  beginFrameAnimation('is-interacting');
  showSpeech(choosePhrase('head-blink'), wakeAnimation.frameDuration * wakeAnimation.frames.length);
  const completed = await playFrameSequence(wakeAnimation, token);
  if (completed && token === animationToken) {
    setIdleImage();
  }
  companionActionInFlight = false;
  if (token === animationToken) {
    scheduleAutonomousBehavior();
  }
}

function chooseIdleAnimationName() {
  const availableNames = idleAnimationNames.filter((name) => assets.animations[name]);
  if (availableNames.length === 0) {
    return null;
  }
  if (availableNames.length === 1) {
    lastIdleAnimationIndex = idleAnimationNames.indexOf(availableNames[0]);
    return availableNames[0];
  }

  let nextName;
  do {
    nextName = availableNames[Math.floor(Math.random() * availableNames.length)];
  } while (idleAnimationNames.indexOf(nextName) === lastIdleAnimationIndex);
  lastIdleAnimationIndex = idleAnimationNames.indexOf(nextName);
  return nextName;
}

async function playIdleAction(animationName = chooseIdleAnimationName()) {
  clearAutonomousTimer();
  const idleAnimation = assets.animations[animationName];
  if (!idleAnimation) {
    scheduleAutonomousBehavior(12000);
    return;
  }

  cancelAnimation({ restore: false });
  const token = animationToken;
  beginFrameAnimation('is-idle-action');
  const completed = await playFrameSequence(idleAnimation, token);

  if (completed && token === animationToken) {
    setIdleImage();
    scheduleAutonomousBehavior();
  }
}

async function runAutonomousBehavior() {
  if (pointerState || companionActionInFlight || interactionInFlight || isNestSleeping) {
    scheduleAutonomousBehavior(12000);
    return;
  }

  const choice = Math.random();
  const hour = new Date().getHours();
  const isNight = hour >= 20 || hour < 7;
  if (currentState.nest?.visible && (isNight ? choice < 0.32 : choice < 0.08)) {
    petApi.requestHome();
  } else if (choice < (isNight ? 0.43 : 0.13)) {
    await askForTreat();
  } else if (choice < 0.55) {
    await takeWalk();
  } else if (choice < 0.7) {
    await takeNap();
  } else if (choice < 0.8) {
    await takeStretch();
  } else {
    await playIdleAction();
  }
}

function applyState(state) {
  if (!state) {
    return;
  }

  const isInitialState = !hasAppliedState;
  currentState = {
    ...currentState,
    ...state,
  };
  if (isInitialState && state.assets) {
    assets = state.assets;
    preloadAssets();
  }
  document.title = `${currentState.name || '拿铁'}桌宠`;
  if (isInitialState) {
    hasAppliedState = true;
    clearAutonomousTimer();
    cancelAnimation({ restore: false });
    setIdleImage();
    scheduleAutonomousBehavior(10000);
  } else if (!currentState.autonomousBehaviors) {
    clearAutonomousTimer();
  }
}

function handleWindowVisibilityChanged(visible) {
  const nextVisible = visible === true;
  if (nextVisible === isWindowVisible) {
    return;
  }

  isWindowVisible = nextVisible;
  clearAutonomousTimer();
  pointerState = null;
  companionActionInFlight = false;
  isNestSleeping = false;
  hideSnack();
  hideCarriedBall();
  if (travelWaiter) {
    clearTimeout(travelWaiter.timer);
    travelWaiter.resolve(null);
    travelWaiter = null;
  }
  cancelAnimation();
  speechBubble.classList.remove('is-visible');

  if (isWindowVisible) {
    scheduleAutonomousBehavior(10000);
  }
}

function getNormalizedImagePoint(event) {
  const rect = petImage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || petImage.naturalWidth <= 0 || petImage.naturalHeight <= 0) {
    return null;
  }

  const sourceRatio = petImage.naturalWidth / petImage.naturalHeight;
  const boxRatio = rect.width / rect.height;
  const renderedWidth = boxRatio > sourceRatio ? rect.height * sourceRatio : rect.width;
  const renderedHeight = boxRatio > sourceRatio ? rect.height : rect.width / sourceRatio;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const x = (event.clientX - rect.left - offsetX) / renderedWidth;
  const y = (event.clientY - rect.top - offsetY) / renderedHeight;

  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return null;
  }
  return { x, y };
}

function isOpaqueImagePoint(point) {
  if (!point || !alphaHitContext || petImage.naturalWidth <= 0 || petImage.naturalHeight <= 0) {
    return false;
  }

  const sourceX = petButton.classList.contains('is-facing-left')
    ? Math.floor((1 - point.x) * (petImage.naturalWidth - 1))
    : Math.floor(point.x * (petImage.naturalWidth - 1));
  const sourceY = Math.floor(point.y * (petImage.naturalHeight - 1));
  alphaHitCanvas.width = petImage.naturalWidth;
  alphaHitCanvas.height = petImage.naturalHeight;
  alphaHitContext.clearRect(0, 0, alphaHitCanvas.width, alphaHitCanvas.height);

  try {
    alphaHitContext.drawImage(petImage, 0, 0);
    return alphaHitContext.getImageData(sourceX, sourceY, 1, 1).data[3] >= 16;
  } catch {
    return false;
  }
}

function getClickedInteractionRegion(event) {
  const point = getNormalizedImagePoint(event);
  if (!isOpaqueImagePoint(point)) {
    return null;
  }
  return getInteractionRegion(point, {
    facingLeft: petButton.classList.contains('is-facing-left'),
  });
}

function finishPointer(event, { allowInteraction = true } = {}) {
  if (!pointerState) {
    return;
  }

  const { dragStarted, moved } = pointerState;
  if (event && petButton.hasPointerCapture(event.pointerId)) {
    petButton.releasePointerCapture(event.pointerId);
  }
  pointerState = null;
  if (dragStarted) {
    petApi.endDrag();
  }

  if (moved) {
    scheduleAutonomousBehavior();
    return;
  }
  if (allowInteraction) {
    const region = getClickedInteractionRegion(event);
    if (region && heldBallReturnPoint) {
      void releaseHeldBall();
      return;
    }
    if (region && isNestSleeping) {
      void wakeFromNest();
      return;
    }
    if (region) {
      void requestInteraction(region);
    }
  }
}

petButton.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  try {
    petButton.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic/assistive pointer events are not always registered as active
    // pointers. The gesture can still be classified safely without capture.
  }
  pointerState = {
    dragStarted: false,
    moved: false,
    startX: event.screenX,
    startY: event.screenY,
  };
  petApi.startDrag();
});

petButton.addEventListener('pointermove', (event) => {
  if (!pointerState) {
    return;
  }

  const delta = {
    x: event.screenX - pointerState.startX,
    y: event.screenY - pointerState.startY,
  };

  if (Math.hypot(delta.x, delta.y) >= DRAG_THRESHOLD_PIXELS) {
    if (!pointerState.dragStarted) {
      pointerState.dragStarted = true;
      clearAutonomousTimer();
      cancelAnimation();
      petApi.startDrag();
    }
    pointerState.moved = true;
    petApi.moveDrag(delta);
  }
});

petButton.addEventListener('pointerup', finishPointer);
petButton.addEventListener('pointercancel', (event) => {
  finishPointer(event, { allowInteraction: false });
});

petButton.addEventListener('click', (event) => {
  if (event.detail === 0 && !companionActionInFlight && !isNestSleeping) {
    void playClickReaction();
  }
});

snack.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  void giveTreat();
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  petApi.showMenu();
});

petApi.onStateChanged(applyState);
petApi.onVisibilityChanged(handleWindowVisibilityChanged);
petApi.onAutomaticDirectionChanged((direction) => {
  if (direction !== -1 && direction !== 1) {
    return;
  }
  walkDirection = direction;
  if (petButton.classList.contains('is-walking')) {
    petButton.classList.toggle('is-facing-left', walkDirection < 0);
  }
});
petApi.onTravelArrived(resolveTravel);
petApi.onCommand((command) => {
  const type = typeof command === 'string' ? command : command?.type;
  if (type === 'walk') {
    void takeWalk({ manual: true });
  } else if (type === 'sleep') {
    void takeNap({ manual: true });
  } else if (type === 'stretch') {
    void takeStretch({ manual: true });
  } else if (type === 'feed') {
    void giveTreat();
  } else if (type === 'ball') {
    showSpeech('我都把爪爪给你了，你陪我一下嘛。', 2400);
  } else if (type === 'fetch') {
    void takeFetch(command.point);
  } else if (type === 'home') {
    void goHome(command.point);
  }
});

petApi.getState().then(applyState);
