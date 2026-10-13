import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { inflateSync } from 'node:zlib';

const projectRoot = path.resolve(import.meta.dirname, '..');
const files = [
  'forge.config.js',
  'src/automatic-motion.js',
  'src/main.js',
  'src/preload.js',
  'src/renderer/interaction-mapping.js',
  'src/renderer/renderer.js',
  'src/toy.js',
  'src/nest.js',
  'src/renderer/walk-timing.js',
  'src/window-position.js',
  'scripts/smoke-runtime.mjs',
  'scripts/strip-macos-signatures.cjs',
];

for (const file of files) {
  const absolutePath = path.join(projectRoot, file);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${file}`);
  }
  execFileSync(process.execPath, ['--check', absolutePath], { stdio: 'inherit' });
}

const requiredAssets = [
  'assets/latte/previews/latte-base-normalized-v2.png',
  'src/renderer/index.html',
  'src/renderer/styles.css',
  'README.md',
  '.github/workflows/macos-build.yml',
  'src/toy.html',
  'src/nest.html',
];

for (const file of requiredAssets) {
  if (!existsSync(path.join(projectRoot, file))) {
    throw new Error(`Missing required asset: ${file}`);
  }
}

const stylesheet = await readFile(path.join(projectRoot, 'src/renderer/styles.css'), 'utf8');
const petImageRule = stylesheet.match(/^\.pet-image\s*\{([^}]*)\}/ms)?.[1] || '';
if (!petImageRule.includes('height: 100%;') || !petImageRule.includes('object-position: center bottom;')) {
  throw new Error('Pet images must render in a fixed-height, bottom-aligned container.');
}
if (stylesheet.includes('scale(1.006)')
  || stylesheet.includes('scale(1.025)')
  || stylesheet.includes('scale(1.018)')) {
  throw new Error('Pet keyframe animations must not introduce hidden zoom changes.');
}
if (stylesheet.includes('--pet-frame-scale') || petImageRule.includes('transform: scale(')) {
  throw new Error('Pet actions must not apply action-specific image scaling.');
}

const mainSource = await readFile(path.join(projectRoot, 'src/main.js'), 'utf8');
if (!mainSource.includes('const FIXED_SCALE = 0.8;')
  || mainSource.includes('function setScale(')
  || mainSource.includes("label: '大小'")) {
  throw new Error('The desktop pet must stay fixed at 80% with no size-changing menu.');
}
if (mainSource.includes('outfit')
  || mainSource.includes('衣柜')
  || mainSource.includes('冬衣')
  || mainSource.includes('羽绒服')) {
  throw new Error('Clothing state and tray controls must be removed from the main process.');
}
if (!mainSource.includes('function createBallWindow()')
  || !mainSource.includes('function createNestWindow()')
  || !mainSource.includes('function startPetTravel(request)')
  || !mainSource.includes('function moveAccessoryWindow(window, position, size)')
  || mainSource.includes('ballWindow.setPosition(')
  || mainSource.includes('nestWindow.setPosition(')) {
  throw new Error('Desktop-wide ball, movable nest, and immutable pet travel must be wired in the main process.');
}

const macosWorkflow = await readFile(
  path.join(projectRoot, '.github', 'workflows', 'macos-build.yml'),
  'utf8',
);
if (!macosWorkflow.includes('runs-on: macos-14')
  || !macosWorkflow.includes('npm run make:mac')
  || !macosWorkflow.includes('actions/upload-artifact@v4')) {
  throw new Error('The macOS CI workflow must build and upload universal Latte Pet distributables.');
}

const forgeConfigSource = await readFile(path.join(projectRoot, 'forge.config.js'), 'utf8');
if (!forgeConfigSource.includes('afterExtract: [stripPrebuiltMacSignatures]')
  || !forgeConfigSource.includes("identity: '-'")) {
  throw new Error('Universal macOS builds must normalize prebuilt signatures and re-sign the merged app.');
}

const rendererSource = await readFile(path.join(projectRoot, 'src/renderer/renderer.js'), 'utf8');
const frameSequenceSource = rendererSource.match(
  /async function playFrameSequence[\s\S]*?\n}\n\nasync function playClickReaction/,
)?.[0] || '';
if (!frameSequenceSource
  || frameSequenceSource.includes('setFrameScale')
  || frameSequenceSource.includes('scales')) {
  throw new Error('The generic frame player must never modify visual scale between frames.');
}
if (rendererSource.includes('outfit') || rendererSource.includes('assets.outfits')) {
  throw new Error('The renderer must not retain clothing state or clothing asset branches.');
}
if (rendererSource.includes('setFrameScale')
  || rendererSource.includes('--pet-frame-scale')
  || rendererSource.includes('.renderScale')) {
  throw new Error('The renderer must keep one fixed visual scale in every animation state.');
}
if (!rendererSource.includes('async function giveTreat()')
  || !rendererSource.includes('async function takeFetch(point)')
  || !rendererSource.includes('function beginNestSleep()')
  || !rendererSource.includes('async function wakeFromNest()')) {
  throw new Error('Feed, fetch, nest sleep, and wake interactions must be present in the renderer.');
}
if (!rendererSource.includes('handleWindowVisibilityChanged')
  || !rendererSource.includes('petApi.onVisibilityChanged')) {
  throw new Error('The renderer must reset animation state when the pet is hidden or shown.');
}
const preloadSource = await readFile(path.join(projectRoot, 'src/preload.js'), 'utf8');
if (!mainSource.includes("sendVisibilityToRenderer(false)")
  || !mainSource.includes("sendVisibilityToRenderer(true)")
  || !preloadSource.includes('onVisibilityChanged')) {
  throw new Error('The main and renderer processes must synchronize pet visibility.');
}

const manifestPath = path.join(projectRoot, 'assets/latte/animations/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const expectedFrameCounts = {
  click: 6,
  idleBlink: 6,
  idleEarTail: 6,
  idleSniff: 6,
  pawWave: 6,
  sleep: 8,
  wake: 3,
  feed: 9,
  stretch: 10,
  tailLook: 10,
  walk: 16,
};
if (manifest.version < 2 || manifest.anchor?.vertical !== 'bottom') {
  throw new Error('Animation manifest must declare the stable bottom anchor.');
}
if (typeof manifest.baseImage !== 'string' || 'outfits' in manifest) {
  throw new Error('Animation manifest must expose one base image and no clothing collection.');
}

if (manifest.animations.walk.frameDuration !== 110) {
  throw new Error('The 16-frame walk must use a 1760ms cycle with a 110ms frame duration.');
}
if (manifest.animations.walk.speed !== 70) {
  throw new Error('Walk speed must remain calibrated to 70 pixels per second at 100% scale.');
}
if (manifest.animations.walk.styleReference
  !== '../../assets/latte/previews/latte-base-normalized-v2.png') {
  throw new Error('Walk frames must reference the geometry-normalized static Latte image.');
}
if (manifest.animations.walk.transitionFrameDuration !== 140) {
  throw new Error('Walk transitions must use the reviewed 140ms timing.');
}
if (manifest.animations.walk.startFrames?.length !== 3
  || manifest.animations.walk.stopFrames?.length !== 4) {
  throw new Error('Walk must declare the complete start and stop transition sequences.');
}
if ('startFrameScales' in manifest.animations.walk
  || 'stopFrameScales' in manifest.animations.walk) {
  throw new Error('Walk transitions must use one immutable action scale, not per-frame zoom values.');
}
if (manifest.animations.sleep.frameDuration * manifest.animations.sleep.frames.length !== 2240) {
  throw new Error('The expanded sleep loop must preserve the reviewed 2240ms breathing cycle.');
}
if (manifest.animations.wake?.frameDuration !== 380 || manifest.animations.feed?.frameDuration !== 260) {
  throw new Error('Wake and feed interactions must retain their reviewed, readable timing.');
}
if (manifest.animations.stretch.frameDuration !== 160) {
  throw new Error('The expanded stretch must use the reviewed 160ms frame timing.');
}
for (const idleName of ['idleBlink', 'idleSniff', 'idleEarTail']) {
  if (manifest.animations[idleName]?.styleReference
    !== '../../assets/latte/previews/latte-base-normalized-v2.png') {
    throw new Error(`${idleName} must use the geometry-normalized static Latte image as its style reference.`);
  }
}
for (const interactionName of ['pawWave', 'tailLook']) {
  if (manifest.animations[interactionName]?.styleReference
    !== '../../assets/latte/previews/latte-base-normalized-v2.png') {
    throw new Error(`${interactionName} must use the geometry-normalized static Latte image as its style reference.`);
  }
}

for (const [name, expectedCount] of Object.entries(expectedFrameCounts)) {
  if (manifest.animations[name]?.frames.length !== expectedCount) {
    throw new Error(`Animation ${name} must declare ${expectedCount} frames.`);
  }
  if ('renderScale' in manifest.animations[name]) {
    throw new Error(`Animation ${name} must not declare an action-specific render scale.`);
  }
}

const declaredAssets = [
  manifest.baseImage,
  ...Object.values(manifest.animations).flatMap((animation) => (
    Object.values(animation).flatMap((value) => (
      Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
    ))
  )),
];

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceAbove = Math.abs(estimate - above);
  const distanceUpperLeft = Math.abs(estimate - upperLeft);
  if (distanceLeft <= distanceAbove && distanceLeft <= distanceUpperLeft) {
    return left;
  }
  return distanceAbove <= distanceUpperLeft ? above : upperLeft;
}

function getAlphaBounds(png, asset) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  const interlaceMethod = png[28];
  const bytesPerPixel = colorType === 6 ? 4 : 2;
  if (bitDepth !== 8 || interlaceMethod !== 0 || ![4, 6].includes(colorType)) {
    throw new Error(`Anchor validation does not support this PNG encoding: ${asset}`);
  }

  const idatChunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      idatChunks.push(png.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }

  const decompressed = inflateSync(Buffer.concat(idatChunks));
  const stride = width * bytesPerPixel;
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const filter = decompressed[sourceOffset];
    sourceOffset += 1;
    const scanline = Buffer.alloc(stride);
    for (let index = 0; index < stride; index += 1) {
      const raw = decompressed[sourceOffset + index];
      const left = index >= bytesPerPixel ? scanline[index - bytesPerPixel] : 0;
      const above = previous[index];
      const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter in: ${asset}`);
      scanline[index] = (raw + predictor) & 0xff;
    }

    for (let alphaIndex = bytesPerPixel - 1; alphaIndex < stride; alphaIndex += bytesPerPixel) {
      if (scanline[alphaIndex] >= 8) {
        const x = Math.floor(alphaIndex / bytesPerPixel);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    previous = scanline;
    sourceOffset += stride;
  }

  return {
    bottomMargin: height - 1 - maxY,
    diagonal: Math.hypot(maxX - minX + 1, maxY - minY + 1),
    height: maxY - minY + 1,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX + 1,
  };
}

const normalizedWalkGeometry = [];
const normalizedClickGeometry = [];
const normalizedActionGeometry = [];
const normalizedInteractionGeometry = [];
const normalizedFeedGeometry = [];

for (const asset of declaredAssets) {
  const normalizedAsset = asset.replace(/^\.\.\/\.\.\//, '');
  const absoluteAsset = path.join(projectRoot, normalizedAsset);
  if (!existsSync(absoluteAsset)) {
    throw new Error(`Manifest references a missing asset: ${asset}`);
  }

  const png = await readFile(absoluteAsset);
  const pngSignature = '89504e470d0a1a0a';
  if (png.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error(`Asset is not a valid PNG: ${asset}`);
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png[25];
  if (width === 0 || height === 0 || ![4, 6].includes(colorType)) {
    throw new Error(`Asset must be a non-empty PNG with an alpha channel: ${asset}`);
  }

  if (asset.includes('/animations/')) {
    const bounds = getAlphaBounds(png, asset);
    if (Math.abs(bounds.bottomMargin - manifest.anchor.bottomMargin) > 1) {
      throw new Error(`Animation frame does not match the declared bottom anchor: ${asset}`);
    }
    if (asset.includes('/walk/frames-v29/') || asset.includes('/walk/transition-v9/')) {
      if (width !== 592 || height !== 444) {
        throw new Error(`Walk frame must use the shared 592x444 display canvas: ${asset}`);
      }
      if (bounds.minX <= 0 || bounds.maxX >= width - 1) {
        throw new Error(`Walk frame must keep transparent horizontal safety padding: ${asset}`);
      }
      normalizedWalkGeometry.push({
        asset,
        diagonal: bounds.diagonal,
        visualArea: bounds.width * bounds.height,
      });
    }
    if (asset.includes('/click/frames-v4/')) {
      if (width !== 592 || height !== 444) {
        throw new Error(`Click frame must use the shared 592x444 display canvas: ${asset}`);
      }
      if (bounds.minX <= 0 || bounds.maxX >= width - 1) {
        throw new Error(`Click frame must keep transparent horizontal safety padding: ${asset}`);
      }
      normalizedClickGeometry.push({
        asset,
        diagonal: bounds.diagonal,
        visualArea: bounds.width * bounds.height,
      });
    }
    if (asset.includes('/idle-') && (width !== 592 || height !== 444)) {
      throw new Error(`Idle animation frame must use the shared 592x444 display canvas: ${asset}`);
    }
    if (asset.includes('/sleep/frames-v4/') && (width !== 592 || height !== 444)) {
      throw new Error(`Sleep frame must use the shared 592x444 display canvas: ${asset}`);
    }
    if (asset.includes('/stretch/frames-v4/') && (width !== 592 || height !== 444)) {
      throw new Error(`Stretch frame must use the shared 592x444 canvas: ${asset}`);
    }
    if ((asset.includes('/paw-wave/frames-v1/') || asset.includes('/tail-look/frames-v1/'))
      && (width !== 592 || height !== 444)) {
      throw new Error(`Interaction frame must use the shared 592x444 canvas: ${asset}`);
    }
    if (asset.includes('/paw-wave/frames-v1/') || asset.includes('/tail-look/frames-v1/')) {
      if (bounds.minX <= 0 || bounds.maxX >= width - 1) {
        throw new Error(`Interaction frame must keep transparent horizontal safety padding: ${asset}`);
      }
      normalizedInteractionGeometry.push({ asset, diagonal: bounds.diagonal });
    }
    if (asset.includes('/feed/frames-v1/')) {
      if (width !== 592 || height !== 444) {
        throw new Error(`Feed frame must use the shared 592x444 display canvas: ${asset}`);
      }
      normalizedFeedGeometry.push({ asset, ...bounds });
    }
    if ([
      '/click/frames-v4/',
      '/walk/frames-v29/',
      '/walk/transition-v9/',
      '/sleep/frames-v4/',
      '/wake/frames-v1/',
      '/stretch/frames-v4/',
      '/idle-blink/frames-v2/',
      '/idle-sniff/frames-v2/',
      '/idle-ear-tail/frames-v2/',
    ].some((segment) => asset.includes(segment))) {
      if (width !== 592 || height !== 444) {
        throw new Error(`Animation frame must use the shared 592x444 display canvas: ${asset}`);
      }
      normalizedActionGeometry.push({
        asset,
        diagonal: bounds.diagonal,
      });
    }
  }

  if (asset.endsWith('/latte-base-normalized-v2.png')) {
    const bounds = getAlphaBounds(png, asset);
    if (width !== 592 || height !== 444 || bounds.bottomMargin !== manifest.anchor.bottomMargin) {
      throw new Error('The normalized static Latte image must use the walk display canvas and baseline.');
    }
    normalizedWalkGeometry.push({
      asset,
      diagonal: bounds.diagonal,
      visualArea: bounds.width * bounds.height,
    });
    normalizedClickGeometry.push({
      asset,
      diagonal: bounds.diagonal,
      visualArea: bounds.width * bounds.height,
    });
    normalizedActionGeometry.push({
      asset,
      diagonal: bounds.diagonal,
    });
  }
}

const uniqueNormalizedWalkGeometry = [
  ...new Map(normalizedWalkGeometry.map((entry) => [entry.asset, entry])).values(),
];
if (uniqueNormalizedWalkGeometry.length !== 23) {
  throw new Error('The normalized static, transition, and 16 walk frames must all be validated.');
}
const diagonals = uniqueNormalizedWalkGeometry.map(({ diagonal }) => diagonal);
if (Math.max(...diagonals) - Math.min(...diagonals) > 5) {
  throw new Error('Static, transition, and walk frames must retain one stable visual size.');
}
const visualAreas = uniqueNormalizedWalkGeometry.map(({ visualArea }) => visualArea);
if (Math.max(...visualAreas) / Math.min(...visualAreas) > 1.1) {
  throw new Error('Static, transition, and walk frames must retain one stable visual area.');
}

const uniqueNormalizedClickGeometry = [
  ...new Map(normalizedClickGeometry.map((entry) => [entry.asset, entry])).values(),
];
if (uniqueNormalizedClickGeometry.length !== 7) {
  throw new Error('The normalized static image and all six click frames must be validated.');
}
const clickDiagonals = uniqueNormalizedClickGeometry.map(({ diagonal }) => diagonal);
if (Math.max(...clickDiagonals) - Math.min(...clickDiagonals) > 5) {
  throw new Error('Static and click frames must retain one stable visual size.');
}
const clickVisualAreas = uniqueNormalizedClickGeometry.map(({ visualArea }) => visualArea);
if (Math.max(...clickVisualAreas) / Math.min(...clickVisualAreas) > 1.02) {
  throw new Error('Static and click frames must retain one stable visual area.');
}

const uniqueNormalizedActionGeometry = [
  ...new Map(normalizedActionGeometry.map((entry) => [entry.asset, entry])).values(),
];
if (uniqueNormalizedActionGeometry.length !== 67) {
  throw new Error('The static image and every production animation frame must be geometry-normalized.');
}
const actionDiagonals = uniqueNormalizedActionGeometry.map(({ diagonal }) => diagonal);
if (Math.max(...actionDiagonals) - Math.min(...actionDiagonals) > 10) {
  throw new Error('No production action may visually enlarge Latte beyond the shared size tolerance.');
}

const uniqueFeedGeometry = [
  ...new Map(normalizedFeedGeometry.map((entry) => [entry.asset, entry])).values(),
];
if (uniqueFeedGeometry.length !== 1
  || uniqueFeedGeometry[0].height < 390
  || uniqueFeedGeometry[0].height > 430
  || uniqueFeedGeometry[0].width < 310
  || uniqueFeedGeometry[0].width > 380) {
  throw new Error('The seated waiting frame must keep a stable baseline and a natural full-body proportion.');
}

const uniqueInteractionGeometry = [
  ...new Map(normalizedInteractionGeometry.map((entry) => [entry.asset, entry])).values(),
];
if (uniqueInteractionGeometry.length !== 16) {
  throw new Error('The two interactive response sequences must declare all prepared frames.');
}
for (const [name, expectedFrame] of [['pawWave', 5], ['tailLook', 9]]) {
  const animation = manifest.animations[name];
  const first = animation.frames[0];
  const last = animation.frames.at(-1);
  if (!first.endsWith('frame-01.png') || !last.endsWith(`frame-${String(expectedFrame + 1).padStart(2, '0')}.png`)) {
    throw new Error(`${name} must retain a complete start-to-recovery response sequence.`);
  }
}

console.log('Syntax and required-file checks passed.');
