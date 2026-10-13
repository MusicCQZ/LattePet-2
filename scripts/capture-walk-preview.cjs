'use strict';

const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const source = path.resolve(process.argv[2]);
const destination = path.resolve(process.argv[3]);
const delayMilliseconds = Number(process.argv[4] || 500);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    show: true,
    skipTaskbar: true,
    x: -10000,
    y: -10000,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  try {
    await window.loadFile(source);
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 10000;
      const poll = () => {
        if (window.walkPreviewState?.ready) resolve();
        else if (performance.now() > deadline) reject(new Error('Preview did not become ready.'));
        else setTimeout(poll, 25);
      };
      poll();
    })`);
    await delay(delayMilliseconds);
    const image = await window.webContents.capturePage();
    await writeFile(destination, image.toPNG());
    console.log(JSON.stringify({ delayMilliseconds, destination, source }, null, 2));
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
