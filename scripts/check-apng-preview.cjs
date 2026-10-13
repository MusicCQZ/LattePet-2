'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

const previewPath = path.resolve(process.argv[2]);
const sampleInterval = Number(process.argv[3] || 100);
const sampleCount = Number(process.argv[4] || 20);

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    height: 500,
    show: true,
    skipTaskbar: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
    width: 500,
    x: -10000,
    y: -10000,
  });

  try {
    if (path.extname(previewPath).toLowerCase() === '.html') {
      await window.loadFile(previewPath);
    } else {
      const source = pathToFileURL(previewPath).href;
      const html = `<!doctype html><img id="preview" src=${JSON.stringify(source)}>`;
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    }
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const preview = document.querySelector('#preview');
      if (preview instanceof HTMLCanvasElement) {
        const deadline = performance.now() + 10000;
        const poll = () => {
          if (window.walkPreviewState?.ready) resolve();
          else if (performance.now() >= deadline) reject(new Error('Canvas preview did not become ready.'));
          else setTimeout(poll, 25);
        };
        poll();
      } else if (preview.complete && preview.naturalWidth) resolve();
      else {
        preview.addEventListener('load', resolve, { once: true });
        preview.addEventListener('error', reject, { once: true });
      }
    })`);

    const samples = [];
    const frameIndexes = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = await window.webContents.executeJavaScript(`(() => {
        const preview = document.querySelector('#preview');
        const canvas = preview instanceof HTMLCanvasElement ? preview : document.createElement('canvas');
        if (!(preview instanceof HTMLCanvasElement)) {
          canvas.width = preview.naturalWidth;
          canvas.height = preview.naturalHeight;
          canvas.getContext('2d').drawImage(preview, 0, 0);
        }
        const context = canvas.getContext('2d');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (let offset = 0; offset < pixels.length; offset += 16) {
          for (let channel = 0; channel < 4; channel += 1) {
            hash ^= pixels[offset + channel];
            hash = Math.imul(hash, 16777619);
          }
        }
        return { frameIndex: window.walkPreviewState?.frameIndex, hash: hash >>> 0 };
      })()`);
      samples.push(sample.hash);
      frameIndexes.push(sample.frameIndex);
      await delay(sampleInterval);
    }

    const uniqueFrames = new Set(samples).size;
    const uniqueFrameIndexes = new Set(frameIndexes).size;
    if (uniqueFrames < 3) {
      throw new Error(`Preview did not animate; only ${uniqueFrames} unique rendered frames were sampled.`);
    }
    if (uniqueFrameIndexes < 3) {
      throw new Error(`Preview scheduler did not advance; only ${uniqueFrameIndexes} indexes were sampled.`);
    }
    console.log(JSON.stringify({
      previewPath,
      sampleCount,
      sampleInterval,
      uniqueFrameIndexes,
      uniqueFrames,
    }, null, 2));
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
