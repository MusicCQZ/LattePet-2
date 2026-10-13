const fs = require('node:fs/promises');
const path = require('node:path');

async function removeSignatureDirectories(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const entryPath = path.join(directory, entry.name);
    if (entry.name === '_CodeSignature') {
      await fs.rm(entryPath, { recursive: true, force: true });
      continue;
    }

    await removeSignatureDirectories(entryPath);
  }
}

/**
 * Electron 44.5.1's x64 and arm64 macOS archives do not contain the same
 * prebuilt CodeResources files.  Universal merging requires matching trees,
 * so remove only those disposable prebuilt signatures from each temporary
 * slice.  Electron Forge signs the merged application afterwards.
 */
async function stripPrebuiltMacSignatures({ buildPath, platform }) {
  if (platform !== 'darwin') return;
  await removeSignatureDirectories(path.join(buildPath, 'Electron.app'));
}

module.exports = {
  removeSignatureDirectories,
  stripPrebuiltMacSignatures,
};
