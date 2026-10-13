import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { deflateSync } from 'node:zlib';

const sourceDirectory = path.resolve(process.argv[2] || 'assets/latte/animations/walk/frames-v11');
const destination = path.resolve(process.argv[3] || 'assets/latte/previews/walk-normal-v1.png');
const delayMilliseconds = Number(process.argv[4] || 80);
const expectedFrames = Number(process.argv[5] || 16);

if (!Number.isInteger(delayMilliseconds) || delayMilliseconds < 20 || delayMilliseconds > 2000) {
  throw new Error('Frame delay must be an integer between 20 and 2000 milliseconds.');
}

const signature = Buffer.from('89504e470d0a1a0a', 'hex');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

function parsePng(png, filename) {
  if (!png.subarray(0, 8).equals(signature)) {
    throw new Error(`Not a PNG: ${filename}`);
  }

  let ihdr;
  const idat = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') ihdr = Buffer.from(data);
    if (type === 'IDAT') idat.push(Buffer.from(data));
    offset += length + 12;
  }

  if (!ihdr || idat.length === 0) {
    throw new Error(`PNG is missing IHDR or IDAT chunks: ${filename}`);
  }
  return { ihdr, imageData: Buffer.concat(idat) };
}

const filenames = (await readdir(sourceDirectory))
  .filter((filename) => /^frame-\d+\.png$/i.test(filename))
  .sort();

if (filenames.length !== expectedFrames) {
  throw new Error(`Expected ${expectedFrames} frames, found ${filenames.length}.`);
}

const frames = await Promise.all(filenames.map(async (filename) => (
  parsePng(await readFile(path.join(sourceDirectory, filename)), filename)
)));
const referenceIhdr = frames[0].ihdr;
for (const [index, frame] of frames.entries()) {
  if (!frame.ihdr.equals(referenceIhdr)) {
    throw new Error(`Frame ${index + 1} does not match the first frame's PNG format.`);
  }
}

const width = referenceIhdr.readUInt32BE(0);
const height = referenceIhdr.readUInt32BE(4);
const animationControl = Buffer.alloc(8);
animationControl.writeUInt32BE(frames.length, 0);
animationControl.writeUInt32BE(0, 4);

const parts = [signature, chunk('IHDR', referenceIhdr), chunk('acTL', animationControl)];
let sequence = 0;

for (const [index, frame] of frames.entries()) {
  const frameControl = Buffer.alloc(26);
  frameControl.writeUInt32BE(sequence++, 0);
  frameControl.writeUInt32BE(width, 4);
  frameControl.writeUInt32BE(height, 8);
  frameControl.writeUInt32BE(0, 12);
  frameControl.writeUInt32BE(0, 16);
  frameControl.writeUInt16BE(delayMilliseconds, 20);
  frameControl.writeUInt16BE(1000, 22);
  frameControl[24] = 0;
  frameControl[25] = 0;
  parts.push(chunk('fcTL', frameControl));

  if (index === 0) {
    parts.push(chunk('IDAT', frame.imageData));
  } else {
    const frameData = Buffer.alloc(4 + frame.imageData.length);
    frameData.writeUInt32BE(sequence++, 0);
    frame.imageData.copy(frameData, 4);
    parts.push(chunk('fdAT', frameData));
  }
}

parts.push(chunk('IEND', Buffer.alloc(0)));
await writeFile(destination, Buffer.concat(parts));
console.log(JSON.stringify({ delayMilliseconds, destination, frames: frames.length, height, width }, null, 2));

