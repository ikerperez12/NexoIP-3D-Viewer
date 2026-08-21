import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { expect, test, vi } from 'vitest';
import { FileScanner, MAX_MODEL_BYTES } from '../electron/file-scanner.js';

const MINIMAL_GLTF = JSON.stringify({ asset: { version: '2.0' } });

function minimalGlb(binaryByteLength = 0) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }));
  const paddedJsonLength = Math.ceil(json.length / 4) * 4;
  const paddedBinaryLength = Math.ceil(binaryByteLength / 4) * 4;
  const includesBinaryChunk = paddedBinaryLength > 0;
  const byteLength = 20 + paddedJsonLength + (includesBinaryChunk ? 8 + paddedBinaryLength : 0);
  const bytes = Buffer.alloc(byteLength);
  bytes.writeUInt32LE(0x46546C67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(byteLength, 8);
  bytes.writeUInt32LE(paddedJsonLength, 12);
  bytes.writeUInt32LE(0x4E4F534A, 16);
  json.copy(bytes, 20);
  bytes.fill(0x20, 20 + json.length, 20 + paddedJsonLength);
  if (includesBinaryChunk) {
    const binaryChunkOffset = 20 + paddedJsonLength;
    bytes.writeUInt32LE(paddedBinaryLength, binaryChunkOffset);
    bytes.writeUInt32LE(0x004E4942, binaryChunkOffset + 4);
  }
  return bytes;
}

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
    await fs.promises.writeFile(modelPath, MINIMAL_GLTF);
    const originalStats = await fs.promises.stat(modelPath);
    const close = vi.fn(async () => undefined);
    let opened = false;
    let pathnameWasReplaced = false;
    const scanner = new FileScanner({
      openFile: async () => {
        if (!opened) {
          opened = true;
          await fs.promises.writeFile(modelPath, 'replacement');
          pathnameWasReplaced = true;
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
    expect(pathnameWasReplaced).toBe(true);
    expect(close).toHaveBeenCalled();
  });
});

test('registered drops share the 256 MiB safety cap and scans can be cooperatively cancelled', async () => {
  expect(MAX_MODEL_BYTES).toBe(256 * 1024 * 1024);
  await withTemporaryLibrary(async (directory) => {
    for (let index = 0; index < 200; index += 1) {
      await fs.promises.writeFile(path.join(directory, `model-${index}.glb`), minimalGlb());
    }

    const scanner = new FileScanner();
    const scan = scanner.scanDirectories([directory]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(scanner.cancelScan().cancelled).toBe(true);
    await expect(scan).resolves.toMatchObject({ status: 'cancelled' });
    expect(scanner.getStatus()).toMatchObject({ status: 'cancelled', isScanning: false });
  });
});

test('an oversized supported model is reported without truncating the rest of the library', async () => {
  await withTemporaryLibrary(async (directory) => {
    const oversizedModel = path.join(directory, 'oversized.glb');
    const supportedModel = path.join(directory, 'safe.glb');
    await Promise.all([
      fs.promises.writeFile(oversizedModel, minimalGlb()),
      fs.promises.writeFile(supportedModel, minimalGlb()),
    ]);
    await fs.promises.truncate(oversizedModel, MAX_MODEL_BYTES + 1);

    const scanner = new FileScanner();
    await expect(scanner.scanDirectories([directory])).resolves.toEqual({
      status: 'completed',
      count: 1,
      truncated: false,
    });
    expect(scanner.listModels().map((model) => model.name)).toEqual(['safe.glb']);
    expect(scanner.getStatus()).toMatchObject({
      skippedEntries: 1,
      oversizedModels: 1,
      foundModels: 1,
      truncated: false,
    });
  });
});
