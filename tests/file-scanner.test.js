import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { FileScanner } from '../electron/file-scanner.js';

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
    expect(result).toEqual({ status: 'completed', count: 2, truncated: false });

    const models = scanner.listModels({ sortBy: 'name' });
    expect(models).toHaveLength(2);
    expect(Object.keys(models[0]).sort()).toEqual(['extension', 'id', 'modifiedAt', 'name', 'size']);
    expect(models.some((model) => Object.prototype.hasOwnProperty.call(model, 'path'))).toBe(false);
    expect(models[0].id).toMatch(/^[a-f0-9]{48}$/);
    expect(models.map((model) => model.name)).toEqual(['chair.glb', 'mesh.OBJ']);

    const tree = scanner.getTree();
    expect(JSON.stringify(tree).includes(directory)).toBe(false);
    expect(tree.filesCount).toBe(2);
  });
});

test('scanner has no implicit roots and restores state after invalid input', async () => {
  const scanner = new FileScanner();
  await expect(scanner.scanDirectories()).rejects.toThrow(/Choose between/);
  expect(scanner.getStatus()).toEqual({
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
    expect(scanner.getModelPath(model.id)).toBe(await fs.promises.realpath(modelPath));
    expect((await scanner.resolveModelAsset(model.id, 'asset')).toString()).toBe('{}');
    expect((await scanner.resolveModelAsset(model.id, 'textures/base-color.png')).toString()).toBe('png');
    expect(await scanner.resolveModelAsset(model.id, '../outside.png')).toBeNull();
    expect(await scanner.resolveModelAsset(model.id, 'textures/base-color.svg')).toBeNull();
  });
});

test('OBJ material sidecars are allowed but executable or document sidecars are denied', async () => {
  await withTemporaryLibrary(async (directory) => {
    const modelPath = path.join(directory, 'mesh.obj');
    const materialPath = path.join(directory, 'mesh.mtl');
    const deniedPath = path.join(directory, 'notes.txt');
    await Promise.all([
      fs.promises.writeFile(modelPath, 'mtllib mesh.mtl\nv 0 0 0\n'),
      fs.promises.writeFile(materialPath, 'newmtl Safe\nKd 1 1 1\n'),
      fs.promises.writeFile(deniedPath, 'private notes'),
    ]);

    const scanner = new FileScanner();
    const model = await scanner.registerDroppedPath(modelPath);
    expect((await scanner.resolveModelAsset(model.id, 'mesh.mtl')).toString()).toContain('newmtl Safe');
    expect(await scanner.resolveModelAsset(model.id, 'notes.txt')).toBeNull();
  });
});

test('a registered model cannot be served after its path resolves outside its approved root', async () => {
  await withTemporaryLibrary(async (directory) => {
    const modelPath = path.join(directory, 'scene.gltf');
    const outsideDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexoip-outside-'));
    const outsideModel = path.join(outsideDirectory, 'outside.gltf');
    await fs.promises.writeFile(modelPath, '{}');
    await fs.promises.writeFile(outsideModel, '{}');

    try {
      const scanner = new FileScanner();
      const model = await scanner.registerDroppedPath(modelPath);
      await fs.promises.rm(modelPath);
      try {
        await fs.promises.symlink(outsideModel, modelPath, 'file');
      } catch (error) {
        if (error?.code === 'EPERM') return;
        throw error;
      }

      expect(await scanner.resolveModelAsset(model.id, 'asset')).toBeNull();
    } finally {
      await fs.promises.rm(outsideDirectory, { recursive: true, force: true });
    }
  });
});
