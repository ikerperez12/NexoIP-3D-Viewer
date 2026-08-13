import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { expect, test, vi } from 'vitest';
import { FileScanner, MAX_MODEL_BYTES } from '../electron/file-scanner.js';

async function withTemporaryLibrary(callback) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexoip-scanner-runtime-'));
  try {
    await callback(directory);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

async function readStream(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('a model asset is served from the already verified handle when the pathname is concurrently replaced', async () => {
  await withTemporaryLibrary(async (directory) => {
    const modelPath = path.join(directory, 'scene.gltf');
    await fs.promises.writeFile(modelPath, 'original');
    const originalStats = await fs.promises.stat(modelPath);
    const close = vi.fn(async () => undefined);
    let opened = false;
    const scanner = new FileScanner({
      openFile: async () => {
        if (!opened) {
          opened = true;
          await fs.promises.writeFile(modelPath, 'replacement');
        }
        return {
          stat: async () => originalStats,
          createReadStream: () => Readable.from([Buffer.from('original')]),
          close,
        };
      },
    });

    const model = await scanner.registerDroppedPath(modelPath);
    const asset = await scanner.openModelAsset(model.id, 'asset');
    expect(asset).not.toBeNull();
    expect(await readStream(asset.stream)).toBe('original');
    expect(await fs.promises.readFile(modelPath, 'utf8')).toBe('replacement');
    expect(close).toHaveBeenCalled();
  });
});

test('registered drops share the 256 MiB safety cap and scans can be cooperatively cancelled', async () => {
  expect(MAX_MODEL_BYTES).toBe(256 * 1024 * 1024);
  await withTemporaryLibrary(async (directory) => {
    for (let index = 0; index < 200; index += 1) {
      await fs.promises.writeFile(path.join(directory, `model-${index}.glb`), 'x');
    }

    const scanner = new FileScanner();
    const scan = scanner.scanDirectories([directory]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(scanner.cancelScan().cancelled).toBe(true);
    await expect(scan).resolves.toMatchObject({ status: 'cancelled' });
    expect(scanner.getStatus()).toMatchObject({ status: 'cancelled', isScanning: false });
  });
});
