const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { FileScanner } = require('../electron/file-scanner.js');

async function withTemporaryLibrary(callback) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexoip-scanner-'));
  try {
    await callback(directory);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

test('scanner indexes only supported files and never returns filesystem paths', async () => {
  await withTemporaryLibrary(async (directory) => {
    await fs.promises.mkdir(path.join(directory, 'nested'));
    await fs.promises.writeFile(path.join(directory, 'chair.glb'), 'glb');
    await fs.promises.writeFile(path.join(directory, 'nested', 'mesh.OBJ'), 'obj');
    await fs.promises.writeFile(path.join(directory, 'notes.txt'), 'not a model');

    const scanner = new FileScanner();
    const result = await scanner.scanDirectories([directory]);
    assert.deepEqual(result, { status: 'completed', count: 2, truncated: false });

    const models = scanner.listModels({ sortBy: 'name' });
    assert.equal(models.length, 2);
    assert.deepEqual(Object.keys(models[0]).sort(), ['extension', 'id', 'modifiedAt', 'name', 'size']);
    assert.equal(models.some((model) => Object.prototype.hasOwnProperty.call(model, 'path')), false);
    assert.match(models[0].id, /^[a-f0-9]{48}$/);
    assert.deepEqual(models.map((model) => model.name), ['chair.glb', 'mesh.OBJ']);

    const tree = scanner.getTree();
    assert.equal(JSON.stringify(tree).includes(directory), false);
    assert.equal(tree.filesCount, 2);
  });
});

test('scanner has no implicit roots and restores state after invalid input', async () => {
  const scanner = new FileScanner();
  await assert.rejects(scanner.scanDirectories(), /Choose between/);
  assert.deepEqual(scanner.getStatus(), {
    status: 'failed',
    isScanning: false,
    scannedDirectories: 0,
    foundModels: 0,
    skippedEntries: 0,
    selectedFolderCount: 0,
    truncated: false,
  });
});

test('dropped models are registered by explicit path and sidecars remain contained', async () => {
  await withTemporaryLibrary(async (directory) => {
    const modelPath = path.join(directory, 'scene.gltf');
    const sidecarPath = path.join(directory, 'textures', 'base-color.png');
    await fs.promises.mkdir(path.dirname(sidecarPath));
    await fs.promises.writeFile(modelPath, '{}');
    await fs.promises.writeFile(sidecarPath, 'png');

    const scanner = new FileScanner();
    const model = await scanner.registerDroppedPath(modelPath);
    assert.equal(scanner.getModelPath(model.id), await fs.promises.realpath(modelPath));
    assert.equal(await scanner.resolveModelAsset(model.id, 'asset'), await fs.promises.realpath(modelPath));
    assert.equal(await scanner.resolveModelAsset(model.id, 'textures/base-color.png'), await fs.promises.realpath(sidecarPath));
    assert.equal(await scanner.resolveModelAsset(model.id, '../outside.png'), null);
    assert.equal(await scanner.resolveModelAsset(model.id, 'textures/base-color.svg'), null);
  });
});
