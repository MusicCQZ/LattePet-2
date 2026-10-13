'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow } = require('electron');

const input = path.resolve(process.argv[2] || 'images/video.mp4');
const frameCount = Number(process.argv[3] || 16);
const outputDirectory = path.resolve(process.argv[4] || 'images/video-frames');

if (!fs.existsSync(input)) {
  throw new Error(`Video does not exist: ${input}`);
}
if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > 60) {
  throw new Error('Frame count must be an integer between 2 and 60.');
}
if (fs.existsSync(outputDirectory)) {
  throw new Error(`Output directory already exists: ${outputDirectory}`);
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    height: 360,
    show: false,
    width: 640,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  try {
    const videoUrl = pathToFileURL(input).href;
    const html = `<!doctype html><meta charset="utf-8"><video id="video" muted preload="auto" src=${JSON.stringify(videoUrl)}></video>`;
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const metadata = await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const video = document.querySelector('#video');
        const finish = () => resolve({
          duration: video.duration,
          height: video.videoHeight,
          width: video.videoWidth,
        });
        if (video.readyState >= 1) finish();
        else {
          video.addEventListener('loadedmetadata', finish, { once: true });
          video.addEventListener('error', () => reject(new Error('Video metadata could not be loaded.')), { once: true });
        }
      })
    `);

    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
      throw new Error('Video duration is invalid.');
    }

    fs.mkdirSync(outputDirectory, { recursive: false });
    const targetWidth = Math.min(metadata.width, 720);
    const targetHeight = Math.round(metadata.height * targetWidth / metadata.width);
    const frames = [];

    for (let index = 0; index < frameCount; index += 1) {
      const time = metadata.duration * (index + 0.5) / frameCount;
      const dataUrl = await window.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const video = document.querySelector('#video');
          const capture = () => {
            const canvas = document.createElement('canvas');
            canvas.width = ${targetWidth};
            canvas.height = ${targetHeight};
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/png'));
          };
          const complete = () => setTimeout(capture, 80);
          video.addEventListener('seeked', complete, { once: true });
          video.addEventListener('error', () => reject(new Error('Video seek failed.')), { once: true });
          video.currentTime = ${time};
        })
      `);

      const destination = path.join(outputDirectory, `frame-${String(index + 1).padStart(2, '0')}.png`);
      fs.writeFileSync(destination, Buffer.from(dataUrl.split(',')[1], 'base64'));
      frames.push({ file: path.basename(destination), time });
    }

    fs.writeFileSync(
      path.join(outputDirectory, 'metadata.json'),
      `${JSON.stringify({ ...metadata, frames }, null, 2)}\n`,
      'utf8',
    );
    console.log(JSON.stringify({ ...metadata, frameCount, outputDirectory }, null, 2));
  } finally {
    window.destroy();
    app.quit();
  }
});
