import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { FileScanner } from '../electron/file-scanner.js';

const MINIMAL_GLTF = JSON.stringify({ asset: { version: '2.0' } });
const MINIMAL_OBJ = 'o Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';

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

function minimalBinaryFbx() {
  return Buffer.concat([
    Buffer.from('Kaydara FBX Binary  \0\x1A\0', 'binary'),
    Buffer.alloc(8),
  ]);
}

function validModelContents(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.glb':
      return minimalGlb();
    case '.gltf':
      return MINIMAL_GLTF;
    case '.obj':
      return MINIMAL_OBJ;
    case '.stl':
      return 'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n';
    case '.fbx':
      return '; FBX 7.4.0 project file\nFBXHeaderExtension: {\n}\n';
    case '.ply':
      return 'ply\nformat ascii 1.0\nelement vertex 0\nend_header\n';
    case '.dae':
      return '<?xml version="1.0"?><COLLADA version="1.4.1"></COLLADA>';
    default:
      throw new TypeError(`No valid test model fixture for ${filePath}`);
  }
}

async function writeValidModel(filePath, contents = validModelContents(filePath)) {
  await fs.promises.writeFile(filePath, contents);
}

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
    await writeValidModel(path.join(directory, 'chair.glb'));
    await writeValidModel(path.join(directory, 'nested', 'mesh.OBJ'));
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

test('scanner rejects malformed extension-shaped candidates and accepts lightweight structural samples', async () => {
  await withTemporaryLibrary(async (directory) => {
    const validPaths = [
      path.join(directory, 'valid.glb'),
      path.join(directory, 'valid.gltf'),
      path.join(directory, 'valid.obj'),
      path.join(directory, 'valid.stl'),
      path.join(directory, 'valid.ply'),
      path.join(directory, 'valid-ascii.fbx'),
      path.join(directory, 'valid.dae'),
      path.join(directory, 'valid-binary.fbx'),
    ];
    await Promise.all([
      ...validPaths.slice(0, -1).map((filePath) => writeValidModel(filePath)),
      fs.promises.writeFile(validPaths.at(-1), minimalBinaryFbx()),
      fs.promises.writeFile(path.join(directory, 'invalid.glb'), Buffer.from('not a GLB')),
      fs.promises.writeFile(path.join(directory, 'invalid.gltf'), '{"asset":{"version":"1.0"}}'),
      fs.promises.writeFile(path.join(directory, 'invalid.obj'), 'this is not geometry'),
      fs.promises.writeFile(path.join(directory, 'invalid.stl'), 'solid empty\nendsolid empty\n'),
      fs.promises.writeFile(path.join(directory, 'invalid.ply'), 'ply\nformat unsupported 9.9\nend_header\n'),
      fs.promises.writeFile(path.join(directory, 'invalid.fbx'), 'not an FBX document'),
      fs.promises.writeFile(path.join(directory, 'invalid.dae'), '<not-collada/>'),
    ]);

    const scanner = new FileScanner();
    await expect(scanner.scanDirectories([directory])).resolves.toEqual({
      status: 'completed',
      count: validPaths.length,
      truncated: false,
    });
    expect(scanner.listModels().map((model) => model.name)).toEqual([
      'valid-ascii.fbx',
      'valid-binary.fbx',
      'valid.dae',
      'valid.glb',
      'valid.gltf',
      'valid.obj',
      'valid.ply',
      'valid.stl',
    ]);
    expect(scanner.getStatus()).toMatchObject({
      skippedEntries: 7,
      invalidModels: 7,
      oversizedModels: 0,
      foundModels: validPaths.length,
      availableModels: validPaths.length,
    });

    const knownFixtureScanner = new FileScanner();
    await expect(knownFixtureScanner.registerDroppedPath(path.resolve('tests/fixtures/nexoip-sample.stl')))
      .resolves.toMatchObject({ extension: 'stl', name: 'nexoip-sample.stl' });
    await expect(knownFixtureScanner.registerDroppedPath(path.join(directory, 'invalid.glb')))
      .rejects.toThrow('Invalid dropped file');
  });
});

test('scanner requires a GLB JSON chunk and still accepts the minimal glTF 2.0 container', async () => {
  await withTemporaryLibrary(async (directory) => {
    const headerOnlyPath = path.join(directory, 'header-only.glb');
    const validPath = path.join(directory, 'minimal.glb');
    const headerOnly = Buffer.alloc(12);
    headerOnly.writeUInt32LE(0x46546C67, 0);
    headerOnly.writeUInt32LE(2, 4);
    headerOnly.writeUInt32LE(headerOnly.length, 8);
    await Promise.all([
      fs.promises.writeFile(headerOnlyPath, headerOnly),
      fs.promises.writeFile(validPath, minimalGlb()),
    ]);

    const scanner = new FileScanner();
    await expect(scanner.scanDirectories([directory])).resolves.toEqual({
      status: 'completed',
      count: 1,
      truncated: false,
    });
    expect(scanner.listModels().map((model) => model.name)).toEqual(['minimal.glb']);
    expect(scanner.getStatus()).toMatchObject({ invalidModels: 1, foundModels: 1 });
    await expect(scanner.registerDroppedPath(headerOnlyPath)).rejects.toThrow('Invalid dropped file');
  });
});

test('scanner has no implicit roots and restores state after invalid input', async () => {
  const scanner = new FileScanner();
  await expect(scanner.scanDirectories()).rejects.toThrow(/Choose one or more/);
  expect(scanner.getStatus()).toEqual({
    status: 'failed',
    isScanning: false,
    scannedDirectories: 0,
    foundModels: 0,
    availableModels: 0,
    skippedEntries: 0,
    oversizedModels: 0,
    invalidModels: 0,
    selectedFolderCount: 0,
    truncated: false,
    catalogRevision: 2,
    scanId: 1,
  });
});

test('scanner indexes more selected roots than the former safety cap', async () => {
  await withTemporaryLibrary(async (directory) => {
    const roots = Array.from({ length: 9 }, (_, index) => path.join(directory, `library-${index}`));
    await Promise.all(roots.map(async (root, index) => {
      await fs.promises.mkdir(root);
      await writeValidModel(path.join(root, `model-${index}.glb`));
    }));

    const scanner = new FileScanner();
    await expect(scanner.scanDirectories(roots)).resolves.toEqual({
      status: 'completed',
      count: roots.length,
      truncated: false,
    });
    expect(scanner.getStatus()).toMatchObject({
      selectedFolderCount: roots.length,
      foundModels: roots.length,
      truncated: false,
    });
  });
});

test('scanner cancels a dense DFS traversal before retaining unvisited directory siblings', async () => {
  await withTemporaryLibrary(async (directory) => {
    const canonicalDirectory = await fs.promises.realpath(directory);
    const childCount = 2_048;
    const childPrefix = canonicalDirectory + path.sep + 'dense-';
    const virtualDirectoryStats = {
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    };
    const isVirtualChild = (candidatePath) => typeof candidatePath === 'string'
      && candidatePath.startsWith(childPrefix)
      && path.dirname(candidatePath) === canonicalDirectory;
    const originalLstat = fs.promises.lstat;
    const originalRealpath = fs.promises.realpath;
    const lstatSpy = vi.spyOn(fs.promises, 'lstat').mockImplementation(async (candidatePath, ...args) => (
      isVirtualChild(candidatePath)
        ? virtualDirectoryStats
        : originalLstat(candidatePath, ...args)
    ));
    const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation(async (candidatePath, ...args) => (
      isVirtualChild(candidatePath)
        ? candidatePath
        : originalRealpath(candidatePath, ...args)
    ));
    let rootEntriesYielded = 0;
    let firstChildOpenedAfterEntries = null;
    let signalFirstChildOpened;
    const firstChildOpened = new Promise((resolve) => { signalFirstChildOpened = resolve; });

    try {
      const scanner = new FileScanner({
        openDirectory: async (directoryPath) => {
          if (directoryPath === canonicalDirectory) {
            return {
              async *[Symbol.asyncIterator]() {
                for (let index = 0; index < childCount; index += 1) {
                  rootEntriesYielded += 1;
                  yield {
                    name: 'dense-' + index,
                    isSymbolicLink: () => false,
                    isDirectory: () => true,
                    isFile: () => false,
                  };
                }
              },
              close: async () => undefined,
            };
          }
          if (isVirtualChild(directoryPath)) {
            firstChildOpenedAfterEntries ??= rootEntriesYielded;
            signalFirstChildOpened();
            return {
              async *[Symbol.asyncIterator]() {},
              close: async () => undefined,
            };
          }
          throw new Error('Unexpected directory iterator request.');
        },
      });

      const scan = scanner.scanDirectories([directory]);
      await firstChildOpened;
      expect(firstChildOpenedAfterEntries).toBe(1);
      expect(scanner.cancelScan().cancelled).toBe(true);

      await expect(scan).resolves.toEqual({
        status: 'cancelled',
        count: 0,
        truncated: false,
      });
      expect(rootEntriesYielded).toBe(1);
      expect(scanner.getStatus()).toMatchObject({ status: 'cancelled', scannedDirectories: 1 });
    } finally {
      lstatSpy.mockRestore();
      realpathSpy.mockRestore();
    }
  });
});

test('scanner indexes models beyond the former depth cap', async () => {
  await withTemporaryLibrary(async (directory) => {
    let nestedDirectory = directory;
    for (let index = 0; index < 14; index += 1) {
      nestedDirectory = path.join(nestedDirectory, `level-${index}`);
      await fs.promises.mkdir(nestedDirectory);
    }
    await writeValidModel(path.join(nestedDirectory, 'deep-model.glb'));

    const scanner = new FileScanner();
    await expect(scanner.scanDirectories([directory])).resolves.toEqual({
      status: 'completed',
      count: 1,
      truncated: false,
    });
    expect(scanner.listModels().map((model) => model.name)).toEqual(['deep-model.glb']);
    expect(scanner.getStatus()).toMatchObject({ scannedDirectories: 15, truncated: false });
  });
});

test('scanner processes selected roots and nested entries in deterministic DFS order', async () => {
  await withTemporaryLibrary(async (directory) => {
    const firstRoot = path.join(directory, 'first');
    const secondRoot = path.join(directory, 'second');
    const nestedDirectory = path.join(firstRoot, 'nested');
    const deepModel = path.join(nestedDirectory, 'deep.glb');
    const siblingModel = path.join(firstRoot, 'sibling.glb');
    const secondRootModel = path.join(secondRoot, 'second.glb');
    await Promise.all([
      fs.promises.mkdir(nestedDirectory, { recursive: true }),
      fs.promises.mkdir(secondRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeValidModel(deepModel),
      writeValidModel(siblingModel),
      writeValidModel(secondRootModel),
    ]);

    const [canonicalFirstRoot, canonicalNestedDirectory, canonicalSecondRoot] = await Promise.all([
      fs.promises.realpath(firstRoot),
      fs.promises.realpath(nestedDirectory),
      fs.promises.realpath(secondRoot),
    ]);
    const directoryEntry = (name) => ({
      name,
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => false,
    });
    const fileEntry = (name) => ({
      name,
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
    });
    const entriesByDirectory = new Map([
      [canonicalFirstRoot, [directoryEntry('nested'), fileEntry('sibling.glb')]],
      [canonicalNestedDirectory, [fileEntry('deep.glb')]],
      [canonicalSecondRoot, [fileEntry('second.glb')]],
    ]);
    const validationOrder = [];
    const originalOpen = fs.promises.open;
    const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async (candidatePath, ...args) => {
      validationOrder.push(path.basename(candidatePath));
      return originalOpen(candidatePath, ...args);
    });

    try {
      const scanner = new FileScanner({
        openDirectory: async (directoryPath) => {
          const entries = entriesByDirectory.get(directoryPath);
          if (!entries) throw new Error('Unexpected directory iterator request.');
          return {
            async *[Symbol.asyncIterator]() {
              for (const entry of entries) yield entry;
            },
            close: async () => undefined,
          };
        },
      });

      await expect(scanner.scanDirectories([firstRoot, secondRoot])).resolves.toEqual({
        status: 'completed',
        count: 3,
        truncated: false,
      });
      expect(validationOrder).toEqual(['deep.glb', 'sibling.glb', 'second.glb']);
    } finally {
      openSpy.mockRestore();
    }
  });
});

test('scanner does not stop after a very dense directory before a later valid model', async () => {
  await withTemporaryLibrary(async (directory) => {
    await writeValidModel(path.join(directory, 'late-model.glb'));
    const ignoredEntry = (index) => ({
      name: `ignored-${index}.txt`,
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
    });
    const modelEntry = {
      name: 'late-model.glb',
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
    };
    const scanner = new FileScanner({
      openDirectory: async () => ({
        async *[Symbol.asyncIterator]() {
          for (let index = 0; index <= 20_000; index += 1) {
            yield ignoredEntry(index);
          }
          yield modelEntry;
        },
        close: async () => undefined,
      }),
    });

    await expect(scanner.scanDirectories([directory])).resolves.toEqual({
      status: 'completed',
      count: 1,
      truncated: false,
    });
    expect(scanner.listModels().map((model) => model.name)).toEqual(['late-model.glb']);
    expect(scanner.getStatus()).toMatchObject({
      scannedDirectories: 1,
      skippedEntries: 0,
      truncated: false,
    });
  });
});

test('scanner indexes more directories and models than the former global caps', async () => {
  const modelsRoot = path.resolve('nexoip-virtual-models');
  const directoriesRoot = path.resolve('nexoip-virtual-directories');
  const directoryPrefix = `${directoriesRoot}${path.sep}`;
  const modelCount = 10_001;
  const directoryCount = 10_001;
  let directoryEntriesYielded = 0;
  let firstChildDirectoryOpenedAfterEntries = null;
  const directoryStats = {
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  };
  const fileStats = {
    dev: 1,
    ino: 1,
    size: minimalGlb().length,
    mtime: new Date('2026-01-01T00:00:00.000Z'),
    mtimeMs: 1,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  const virtualDirectoryEntry = (index) => ({
    name: `directory-${index}`,
    isSymbolicLink: () => false,
    isDirectory: () => true,
    isFile: () => false,
  });
  const virtualModelEntry = (index) => ({
    name: `model-${index}.glb`,
    isSymbolicLink: () => false,
    isDirectory: () => false,
    isFile: () => true,
  });
  const isVirtualDirectory = (candidate) => candidate === modelsRoot
    || candidate === directoriesRoot
    || candidate.startsWith(directoryPrefix);
  const realpathSpy = vi.spyOn(fs.promises, 'realpath').mockImplementation(async (candidate) => candidate);
  const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (candidate) => (
    isVirtualDirectory(candidate) ? directoryStats : fileStats
  ));
  const lstatSpy = vi.spyOn(fs.promises, 'lstat').mockImplementation(async (candidate) => (
    isVirtualDirectory(candidate) ? directoryStats : fileStats
  ));
  const openSpy = vi.spyOn(fs.promises, 'open').mockImplementation(async () => ({
    stat: async () => fileStats,
    read: async (buffer) => {
      const bytes = minimalGlb();
      bytes.copy(buffer);
      return { bytesRead: bytes.length, buffer };
    },
    close: async () => undefined,
  }));

  try {
    const scanner = new FileScanner({
      openDirectory: async (directoryPath) => ({
        async *[Symbol.asyncIterator]() {
          if (directoryPath === directoriesRoot) {
            for (let index = 0; index < directoryCount; index += 1) {
              directoryEntriesYielded += 1;
              yield virtualDirectoryEntry(index);
            }
          }
          if (directoryPath.startsWith(directoryPrefix)) {
            firstChildDirectoryOpenedAfterEntries ??= directoryEntriesYielded;
          }
          if (directoryPath === modelsRoot) {
            for (let index = 0; index < modelCount; index += 1) {
              yield virtualModelEntry(index);
            }
          }
        },
        close: async () => undefined,
      }),
    });

    await expect(scanner.scanDirectories([modelsRoot, directoriesRoot])).resolves.toEqual({
      status: 'completed',
      count: modelCount,
      truncated: false,
    });
    expect(scanner.getStatus()).toMatchObject({
      scannedDirectories: directoryCount + 2,
      foundModels: modelCount,
      truncated: false,
    });
    expect(firstChildDirectoryOpenedAfterEntries).toBe(1);
  } finally {
    realpathSpy.mockRestore();
    statSpy.mockRestore();
    lstatSpy.mockRestore();
    openSpy.mockRestore();
  }
});

test('scanner prevents a repeated directory from making traversal cyclic', async () => {
  await withTemporaryLibrary(async (directory) => {
    await writeValidModel(path.join(directory, 'model.glb'));
    let openCount = 0;
    const scanner = new FileScanner({
      openDirectory: async () => {
        openCount += 1;
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              name: '.',
              isSymbolicLink: () => false,
              isDirectory: () => true,
              isFile: () => false,
            };
            yield {
              name: 'model.glb',
              isSymbolicLink: () => false,
              isDirectory: () => false,
              isFile: () => true,
            };
          },
          close: async () => undefined,
        };
      },
    });

    await expect(scanner.scanDirectories([directory])).resolves.toEqual({
      status: 'completed',
      count: 1,
      truncated: false,
    });
    expect(openCount).toBe(1);
    expect(scanner.listModels().map((model) => model.name)).toEqual(['model.glb']);
  });
});

test('overlapping selected roots index a physical model only once', async () => {
  await withTemporaryLibrary(async (directory) => {
    const nestedDirectory = path.join(directory, 'nested');
    await fs.promises.mkdir(nestedDirectory);
    await writeValidModel(path.join(nestedDirectory, 'single.glb'));

    const scanner = new FileScanner();
    await expect(scanner.scanDirectories([nestedDirectory, directory])).resolves.toEqual({
      status: 'completed',
      count: 1,
      truncated: false,
    });
    expect(scanner.listModels().map((model) => model.name)).toEqual(['single.glb']);
  });
});

test('scanner progressively publishes validated models and prunes stale records only after completion', async () => {
  await withTemporaryLibrary(async (directory) => {
    const previousDirectory = path.join(directory, 'previous');
    const nextDirectory = path.join(directory, 'next');
    await Promise.all([
      fs.promises.mkdir(previousDirectory),
      fs.promises.mkdir(nextDirectory),
    ]);
    const previousPath = path.join(previousDirectory, 'previous.glb');
    const firstPath = path.join(nextDirectory, 'first.glb');
    const secondPath = path.join(nextDirectory, 'second.glb');
    await Promise.all([
      writeValidModel(previousPath),
      writeValidModel(firstPath),
      writeValidModel(secondPath),
    ]);

    let releaseEnumeration;
    let signalEnumerationPaused;
    const enumerationGate = new Promise((resolve) => { releaseEnumeration = resolve; });
    const enumerationPaused = new Promise((resolve) => { signalEnumerationPaused = resolve; });
    const scanner = new FileScanner({
      openDirectory: async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            name: 'first.glb',
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          };
          signalEnumerationPaused();
          await enumerationGate;
          yield {
            name: 'second.glb',
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          };
        },
        close: async () => undefined,
      }),
    });
    const previous = await scanner.registerDroppedPath(previousPath);
    const scan = scanner.scanDirectories([nextDirectory]);
    await enumerationPaused;

    expect(scanner.listModels().map((model) => model.name)).toEqual(['first.glb', 'previous.glb']);
    expect(await scanner.resolveModelAsset(previous.id, 'asset')).toEqual(minimalGlb());
    expect(scanner.getTree().filesCount).toBe(2);
    expect(scanner.getStatus()).toMatchObject({
      status: 'scanning',
      isScanning: true,
      foundModels: 1,
      availableModels: 2,
    });

    releaseEnumeration();
    await expect(scan).resolves.toMatchObject({ status: 'completed', count: 2 });
    expect(scanner.listModels().map((model) => model.name)).toEqual(['first.glb', 'second.glb']);
    expect(scanner.getModelPath(previous.id)).toBeNull();
    expect(scanner.getStatus()).toMatchObject({
      status: 'completed',
      foundModels: 2,
      availableModels: 2,
    });
  });
});

test('cancelling a scan retains both the prior catalog and safely published discoveries', async () => {
  await withTemporaryLibrary(async (directory) => {
    const previousDirectory = path.join(directory, 'previous');
    const nextDirectory = path.join(directory, 'next');
    await Promise.all([
      fs.promises.mkdir(previousDirectory),
      fs.promises.mkdir(nextDirectory),
    ]);
    const previousPath = path.join(previousDirectory, 'previous.glb');
    const stagedPath = path.join(nextDirectory, 'staged.glb');
    await Promise.all([
      writeValidModel(previousPath),
      writeValidModel(stagedPath),
    ]);

    let releaseEnumeration;
    let signalEnumerationPaused;
    const enumerationGate = new Promise((resolve) => { releaseEnumeration = resolve; });
    const enumerationPaused = new Promise((resolve) => { signalEnumerationPaused = resolve; });
    const scanner = new FileScanner({
      openDirectory: async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            name: 'staged.glb',
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          };
          signalEnumerationPaused();
          await enumerationGate;
        },
        close: async () => undefined,
      }),
    });
    const previous = await scanner.registerDroppedPath(previousPath);
    const scan = scanner.scanDirectories([nextDirectory]);
    await enumerationPaused;

    expect(scanner.getStatus()).toMatchObject({ foundModels: 1, availableModels: 2 });
    expect(scanner.cancelScan().cancelled).toBe(true);
    releaseEnumeration();

    await expect(scan).resolves.toMatchObject({ status: 'cancelled', count: 2 });
    expect(scanner.listModels().map((model) => model.name)).toEqual(['previous.glb', 'staged.glb']);
    expect(await scanner.resolveModelAsset(previous.id, 'asset')).toEqual(minimalGlb());
    expect(scanner.getStatus()).toMatchObject({
      status: 'cancelled',
      foundModels: 1,
      availableModels: 2,
    });
  });
});

test('a model registered externally during a scan survives selected-root completion', async () => {
  await withTemporaryLibrary(async (directory) => {
    const previousDirectory = path.join(directory, 'previous');
    const nextDirectory = path.join(directory, 'next');
    const externalDirectory = path.join(directory, 'external');
    await Promise.all([
      fs.promises.mkdir(previousDirectory),
      fs.promises.mkdir(nextDirectory),
      fs.promises.mkdir(externalDirectory),
    ]);
    const previousPath = path.join(previousDirectory, 'previous.glb');
    const scannedPath = path.join(nextDirectory, 'scanned.glb');
    const externalPath = path.join(externalDirectory, 'external.glb');
    await Promise.all([
      writeValidModel(previousPath),
      writeValidModel(scannedPath),
      writeValidModel(externalPath),
    ]);

    let releaseEnumeration;
    let signalEnumerationPaused;
    const enumerationGate = new Promise((resolve) => { releaseEnumeration = resolve; });
    const enumerationPaused = new Promise((resolve) => { signalEnumerationPaused = resolve; });
    const scanner = new FileScanner({
      openDirectory: async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            name: 'scanned.glb',
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          };
          signalEnumerationPaused();
          await enumerationGate;
        },
        close: async () => undefined,
      }),
    });
    const previous = await scanner.registerDroppedPath(previousPath);
    const scan = scanner.scanDirectories([nextDirectory]);
    await enumerationPaused;

    const external = await scanner.registerDroppedPath(externalPath);
    expect(scanner.getStatus()).toMatchObject({ foundModels: 1, availableModels: 3 });
    releaseEnumeration();

    await expect(scan).resolves.toMatchObject({ status: 'completed', count: 2 });
    expect(scanner.listModels().map((model) => model.name)).toEqual(['external.glb', 'scanned.glb']);
    expect(scanner.getModelPath(previous.id)).toBeNull();
    expect(scanner.getModelPath(external.id)).toBe(await fs.promises.realpath(externalPath));
    expect(scanner.getStatus()).toMatchObject({
      status: 'completed',
      foundModels: 1,
      availableModels: 2,
    });
  });
});

test('scanner preserves an opaque ID when the same file identity is rescanned', async () => {
  await withTemporaryLibrary(async (directory) => {
    const modelPath = path.join(directory, 'stable.glb');
    await writeValidModel(modelPath);
    const scanner = new FileScanner();
    const dropped = await scanner.registerDroppedPath(modelPath);

    await scanner.scanDirectories([directory]);

    expect(scanner.listModels()).toHaveLength(1);
    expect(scanner.listModels()[0].id).toBe(dropped.id);
  });
});

test('scanner rotates the opaque ID when a rescanned file identity changes', async () => {
  await withTemporaryLibrary(async (directory) => {
    const modelPath = path.join(directory, 'changed.glb');
    await writeValidModel(modelPath);
    const scanner = new FileScanner();
    const previous = await scanner.registerDroppedPath(modelPath);

    await writeValidModel(modelPath, minimalGlb(20));
    await scanner.scanDirectories([directory]);

    expect(scanner.listModels()).toHaveLength(1);
    expect(scanner.listModels()[0].id).not.toBe(previous.id);
  });
});

test('dropped models are registered by explicit path and sidecars remain contained', async () => {
  await withTemporaryLibrary(async (directory) => {
    const modelPath = path.join(directory, 'scene.gltf');
    const sidecarPath = path.join(directory, 'textures', 'base-color.png');
    await fs.promises.mkdir(path.dirname(sidecarPath));
    await writeValidModel(modelPath);
    await fs.promises.writeFile(sidecarPath, 'png');

    const scanner = new FileScanner();
    const model = await scanner.registerDroppedPath(modelPath);
    expect(scanner.getModelPath(model.id)).toBe(await fs.promises.realpath(modelPath));
    expect((await scanner.resolveModelAsset(model.id, 'asset')).toString()).toBe(MINIMAL_GLTF);
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
    await writeValidModel(modelPath);
    await writeValidModel(outsideModel);

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

test('catalog pages are bounded, cursor-authenticated, and never expose filesystem paths', async () => {
  await withTemporaryLibrary(async (directory) => {
    await Promise.all([
      writeValidModel(path.join(directory, 'alpha.glb')),
      writeValidModel(path.join(directory, 'bravo.glb')),
      writeValidModel(path.join(directory, 'charlie.glb')),
    ]);
    const scanner = new FileScanner();
    await scanner.scanDirectories([directory]);

    const firstPage = scanner.getCatalogPage({ limit: 2, filters: { sortBy: 'name' } });
    expect(firstPage).toMatchObject({
      reset: false,
      total: 3,
      isScanning: false,
    });
    expect(firstPage.items.map((item) => item.name)).toEqual(['alpha.glb', 'bravo.glb']);
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(JSON.stringify(firstPage)).not.toContain(directory);
    expect(firstPage.nextCursor).not.toContain(directory);

    const secondPage = scanner.getCatalogPage({
      revision: firstPage.catalogRevision,
      cursor: firstPage.nextCursor,
      limit: 2,
      filters: { sortBy: 'name' },
    });
    expect(secondPage).toMatchObject({ reset: false, total: 3, nextCursor: null });
    expect(secondPage.items.map((item) => item.name)).toEqual(['charlie.glb']);

    expect(scanner.getCatalogNeighbor({
      relation: 'next',
      id: firstPage.items[0].id,
      revision: firstPage.catalogRevision,
      filters: { sortBy: 'name' },
    })).toMatchObject({ reset: false, model: { name: 'bravo.glb' } });
    expect(scanner.getCatalogNeighbor({
      relation: 'previous',
      id: firstPage.items[0].id,
      revision: firstPage.catalogRevision,
      filters: { sortBy: 'name' },
    })).toMatchObject({ reset: false, model: { name: 'charlie.glb' } });
    expect(scanner.getCatalogNeighbor({
      relation: 'next',
      id: 'f'.repeat(48),
      revision: firstPage.catalogRevision,
      filters: { query: 'alpha', sortBy: 'name' },
    })).toMatchObject({ reset: false, model: { name: 'alpha.glb' } });
    const randomNeighbor = scanner.getCatalogNeighbor({
      relation: 'random',
      id: firstPage.items[0].id,
      revision: firstPage.catalogRevision,
      filters: { sortBy: 'name' },
    });
    expect(randomNeighbor.model).not.toBeNull();
    expect(randomNeighbor.model.id).not.toBe(firstPage.items[0].id);

    expect(() => scanner.getCatalogPage({ limit: 101 })).toThrow('Invalid catalog page limit');
    expect(() => scanner.getCatalogPage({
      cursor: firstPage.nextCursor,
      filters: { query: 'other' },
    })).toThrow('Invalid catalog cursor');
  });
});

test('a catalog revision resets stale pages even when a replacement keeps the same count', async () => {
  await withTemporaryLibrary(async (directory) => {
    const modelPath = path.join(directory, 'replaceable.glb');
    await writeValidModel(modelPath);
    const scanner = new FileScanner();
    await scanner.scanDirectories([directory]);
    const before = scanner.getCatalogPage({ limit: 1 });
    const originalId = before.items[0].id;

    await writeValidModel(modelPath, minimalGlb(20));
    await scanner.scanDirectories([directory]);

    const after = scanner.getCatalogPage({ limit: 1 });
    expect(after.total).toBe(1);
    expect(after.catalogRevision).toBeGreaterThan(before.catalogRevision);
    expect(after.items[0].id).not.toBe(originalId);
    expect(scanner.getCatalogPage({
      revision: before.catalogRevision,
      cursor: before.nextCursor,
      limit: 1,
    })).toMatchObject({
      reset: true,
      items: [],
      nextCursor: null,
      catalogRevision: after.catalogRevision,
    });
  });
});

test('lazy tree children retain distinct root identities for equal relative folders', async () => {
  await withTemporaryLibrary(async (directory) => {
    const firstRoot = path.join(directory, 'first-root');
    const secondRoot = path.join(directory, 'second-root');
    await Promise.all([
      fs.promises.mkdir(path.join(firstRoot, 'assets'), { recursive: true }),
      fs.promises.mkdir(path.join(secondRoot, 'assets'), { recursive: true }),
    ]);
    await Promise.all([
      writeValidModel(path.join(firstRoot, 'assets', 'first.glb')),
      writeValidModel(path.join(secondRoot, 'assets', 'second.glb')),
    ]);
    const scanner = new FileScanner();
    await scanner.scanDirectories([firstRoot, secondRoot]);

    const roots = scanner.getTreeChildren({ limit: 10 });
    expect(roots.items).toHaveLength(2);
    expect(roots.items.every((item) => item.type === 'folder')).toBe(true);
    expect(new Set(roots.items.map((item) => item.id)).size).toBe(2);
    expect(JSON.stringify(roots)).not.toContain(directory);

    const firstAssets = scanner.getTreeChildren({ parentId: roots.items[0].id, limit: 10 });
    const secondAssets = scanner.getTreeChildren({ parentId: roots.items[1].id, limit: 10 });
    expect(firstAssets.items).toHaveLength(1);
    expect(secondAssets.items).toHaveLength(1);
    expect(firstAssets.items[0]).toMatchObject({ type: 'folder', name: 'assets' });
    expect(secondAssets.items[0]).toMatchObject({ type: 'folder', name: 'assets' });
    expect(firstAssets.items[0].id).not.toBe(secondAssets.items[0].id);

    const leaf = scanner.getTreeChildren({ parentId: firstAssets.items[0].id, limit: 10 });
    expect(leaf.items).toMatchObject([{ type: 'model', name: 'first.glb' }]);
    expect(JSON.stringify(leaf)).not.toContain(directory);
  });
});

test('cancellation creates a fresh revision while retaining safely published records', async () => {
  await withTemporaryLibrary(async (directory) => {
    const previousDirectory = path.join(directory, 'previous');
    const nextDirectory = path.join(directory, 'next');
    await Promise.all([fs.promises.mkdir(previousDirectory), fs.promises.mkdir(nextDirectory)]);
    const previousPath = path.join(previousDirectory, 'previous.glb');
    const stagedPath = path.join(nextDirectory, 'staged.glb');
    await Promise.all([writeValidModel(previousPath), writeValidModel(stagedPath)]);

    let releaseEnumeration;
    let signalEnumerationPaused;
    const enumerationGate = new Promise((resolve) => { releaseEnumeration = resolve; });
    const enumerationPaused = new Promise((resolve) => { signalEnumerationPaused = resolve; });
    const scanner = new FileScanner({
      openDirectory: async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            name: 'staged.glb',
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          };
          signalEnumerationPaused();
          await enumerationGate;
        },
        close: async () => undefined,
      }),
    });
    await scanner.registerDroppedPath(previousPath);
    const scan = scanner.scanDirectories([nextDirectory]);
    await enumerationPaused;
    const revisionBeforeCancellation = scanner.getStatus().catalogRevision;

    expect(scanner.cancelScan().cancelled).toBe(true);
    releaseEnumeration();
    await expect(scan).resolves.toMatchObject({ status: 'cancelled' });
    const statusAfterCancellation = scanner.getStatus();
    expect(statusAfterCancellation.catalogRevision).toBeGreaterThan(revisionBeforeCancellation);
    expect(scanner.listModels().map((model) => model.name)).toEqual(['previous.glb', 'staged.glb']);
    expect(scanner.getCatalogPage({ revision: revisionBeforeCancellation })).toMatchObject({
      reset: true,
      items: [],
      nextCursor: null,
    });
  });
});
