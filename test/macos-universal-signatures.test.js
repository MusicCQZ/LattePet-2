const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { stripPrebuiltMacSignatures } = require('../scripts/strip-macos-signatures.cjs');

test('macOS universal preparation removes only disposable prebuilt signatures', async (t) => {
  const buildPath = await fs.mkdtemp(path.join(os.tmpdir(), 'latte-macos-signatures-'));
  t.after(() => fs.rm(buildPath, { recursive: true, force: true }));

  const signature = path.join(
    buildPath,
    'Electron.app',
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    '_CodeSignature',
    'CodeResources',
  );
  const executable = path.join(
    buildPath,
    'Electron.app',
    'Contents',
    'MacOS',
    'Electron',
  );
  await fs.mkdir(path.dirname(signature), { recursive: true });
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(signature, 'prebuilt signature');
  await fs.writeFile(executable, 'electron executable');

  await stripPrebuiltMacSignatures({ buildPath, platform: 'darwin' });

  await assert.rejects(fs.access(signature));
  assert.equal(await fs.readFile(executable, 'utf8'), 'electron executable');
});

test('non-macOS packaging leaves its files untouched', async (t) => {
  const buildPath = await fs.mkdtemp(path.join(os.tmpdir(), 'latte-macos-signatures-'));
  t.after(() => fs.rm(buildPath, { recursive: true, force: true }));

  const signature = path.join(buildPath, 'Electron.app', 'Contents', '_CodeSignature', 'CodeResources');
  await fs.mkdir(path.dirname(signature), { recursive: true });
  await fs.writeFile(signature, 'keep');

  await stripPrebuiltMacSignatures({ buildPath, platform: 'win32' });

  assert.equal(await fs.readFile(signature, 'utf8'), 'keep');
});
