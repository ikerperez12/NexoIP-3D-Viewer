import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MeshoptDecoder as ThreeMeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  DEFAULT_MODEL_BUDGET,
  disposeModelResources,
  getBundledLoaderRoot,
  load3DModel
} from '../src/utils/loaders.js';

const fixtureRoot = path.resolve(fileURLToPath(new URL('./fixtures/format-matrix/', import.meta.url)));
const fixtureUrlRoot = 'nexoip://app/model/format-matrix/';
const bundledRuntimeRoot = fileURLToPath(new URL('../node_modules/three/examples/jsm/libs/', import.meta.url));
const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ktx2Signature = Uint8Array.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

const originalGlobals = {
  DOMParser: globalThis.DOMParser,
  Node: globalThis.Node,
  ProgressEvent: globalThis.ProgressEvent,
  createImageBitmap: globalThis.createImageBitmap,
  document: globalThis.document,
  fetch: globalThis.fetch,
  self: globalThis.self,
};

let requests;
let imageLoads;

function fixtureUrl(relativePath) {
  return new URL(relativePath, fixtureUrlRoot).href;
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return new Map([
    ['.bin', 'application/octet-stream'],
    ['.dae', 'model/vnd.collada+xml'],
    ['.fbx', 'application/octet-stream'],
    ['.gltf', 'model/gltf+json'],
    ['.ktx2', 'image/ktx2'],
    ['.mtl', 'text/plain; charset=utf-8'],
    ['.obj', 'text/plain; charset=utf-8'],
    ['.png', 'image/png']
  ]).get(extension) || 'application/octet-stream';
}

function safePathUnder(rootPath, encodedPath) {
  const segments = encodedPath.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\\'))) return null;
  const resolved = path.resolve(rootPath, ...segments);
  return resolved.startsWith(`${rootPath}${path.sep}`) ? resolved : null;
}

function pathForRequest(value) {
  const url = new URL(value instanceof Request ? value.url : String(value));
  if (url.protocol !== 'nexoip:' || url.hostname !== 'app') return null;

  const modelPrefix = '/model/format-matrix/';
  if (url.pathname.startsWith(modelPrefix)) {
    return safePathUnder(fixtureRoot, url.pathname.slice(modelPrefix.length));
  }

  if (url.pathname.startsWith('/basis/') || url.pathname.startsWith('/draco/')) {
    return safePathUnder(bundledRuntimeRoot, url.pathname.slice(1));
  }

  return null;
}

async function inspectPng(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 24 || !pngSignature.every((value, index) => bytes[index] === value)) {
    throw new Error('The format-matrix image sidecar is not a PNG.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function createFetchBackedImage() {
  const listeners = new Map();
  const image = {
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type);
    }
  };

  Object.defineProperty(image, 'src', {
    set(url) {
      const task = globalThis.fetch(url)
        .then(async (response) => {
          if (!response.ok) throw new Error(`Image sidecar returned ${response.status}.`);
          const dimensions = await inspectPng(await response.blob());
          image.width = dimensions.width;
          image.height = dimensions.height;
          listeners.get('load')?.call(image);
        })
        .catch((error) => listeners.get('error')?.call(image, error));
      imageLoads.add(task);
    }
  });

  return image;
}

function collectMaterials(rootObject) {
  const materials = [];
  rootObject.traverse((object) => {
    if (!object.material) return;
    materials.push(...(Array.isArray(object.material) ? object.material : [object.material]));
  });
  return materials;
}

function requestedPaths() {
  return requests.map((value) => new URL(value).pathname);
}

async function loadFixture(relativePath, options = {}) {
  return load3DModel(fixtureUrl(relativePath), path.basename(relativePath), undefined, options);
}

async function listFixtureFiles(directory = fixtureRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFixtureFiles(absolutePath));
    else files.push(path.relative(fixtureRoot, absolutePath).replaceAll(path.sep, '/'));
  }
  return files.sort();
}

beforeEach(() => {
  requests = [];
  imageLoads = new Set();
  THREE.Cache.clear();

  globalThis.DOMParser = DOMParser;
  globalThis.Node = class Node {
    static TEXT_NODE = 3;
  };
  globalThis.self = globalThis;
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  globalThis.createImageBitmap = async (blob) => {
    const dimensions = await inspectPng(blob);
    return { ...dimensions, close() {} };
  };
  globalThis.document = {
    createElementNS() {
      return createFetchBackedImage();
    }
  };
  globalThis.fetch = async (value) => {
    const requestUrl = value instanceof Request ? value.url : String(value);
    requests.push(requestUrl);
    if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) {
      return originalGlobals.fetch(value);
    }
    const filePath = pathForRequest(value);
    if (!filePath) return new Response('blocked', { status: 404 });

    try {
      return new Response(await readFile(filePath), {
        status: 200,
        headers: { 'content-type': contentTypeFor(filePath) }
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  THREE.Cache.clear();
  for (const [name, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[name];
    else globalThis[name] = value;
  }
});

describe('redistributable on-disk format matrix', () => {
  it('pins the exact bytes of every fixture used by the matrix', async () => {
    const checksumText = await readFile(path.join(fixtureRoot, 'SHA256SUMS.txt'), 'utf8');
    const expected = new Map(checksumText.trim().split(/\r?\n/).map((line) => {
      const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/);
      if (!match) throw new Error(`Malformed fixture checksum: ${line}`);
      return [match[2], match[1]];
    }));
    const fixtureFiles = (await listFixtureFiles()).filter((name) => !['ATTRIBUTION.md', 'SHA256SUMS.txt'].includes(name));

    expect([...expected.keys()].sort()).toEqual(fixtureFiles);
    for (const [relativePath, expectedHash] of expected) {
      const bytes = await readFile(path.join(fixtureRoot, relativePath));
      expect(createHash('sha256').update(bytes).digest('hex'), relativePath).toBe(expectedHash);
    }
  });

  it('loads the Khronos glTF JSON fixture with its external buffer and PNG texture', async () => {
    const result = await loadFixture('gltf-simple-texture/SimpleTexture.gltf');
    const [material] = collectMaterials(result.object);

    expect(result.stats).toMatchObject({ meshes: 1, vertices: 4, triangles: 2, textures: 1 });
    expect(material.map?.image).toMatchObject({ width: 256, height: 256 });
    expect(requestedPaths()).toEqual(expect.arrayContaining([
      '/model/format-matrix/gltf-simple-texture/SimpleTexture.gltf',
      '/model/format-matrix/gltf-simple-texture/SimpleTexture.bin',
      '/model/format-matrix/gltf-simple-texture/testTexture.png'
    ]));
    disposeModelResources(result.object);
  });

  it('loads every declared OBJ material library and its local PNG textures', async () => {
    const result = await loadFixture('obj-multimtl/multi-material.obj');
    const materials = collectMaterials(result.object);
    const materialsByName = new Map(materials.map((material) => [material.name, material]));

    expect(materials.map((material) => material.name)).toEqual(expect.arrayContaining(['WarmTexture', 'CoolTexture']));
    expect(materialsByName.get('WarmTexture')?.map?.image).toMatchObject({ width: 256, height: 256 });
    expect(materialsByName.get('CoolTexture')?.map?.image).toMatchObject({ width: 256, height: 256 });
    expect(requestedPaths()).toEqual(expect.arrayContaining([
      '/model/format-matrix/obj-multimtl/multi-material.obj',
      '/model/format-matrix/obj-multimtl/warm.mtl',
      '/model/format-matrix/obj-multimtl/cool.mtl',
      '/model/format-matrix/obj-multimtl/warm-texture.png',
      '/model/format-matrix/obj-multimtl/cool-texture.png'
    ]));
    disposeModelResources(result.object);
  });

  it('parses the DAE fixture with centimetre scale, Z-up conversion, a texture, and a matrix animation', async () => {
    const result = await loadFixture('dae-up-axis/animated-textured.dae');
    const [material] = collectMaterials(result.object);

    expect(result.object.scale.toArray()).toEqual([0.01, 0.01, 0.01]);
    expect(result.object.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(result.animations).toHaveLength(1);
    expect(result.animations[0].tracks).not.toHaveLength(0);
    expect(material.map?.image).toMatchObject({ width: 256, height: 256 });
    expect(requestedPaths()).toEqual(expect.arrayContaining([
      '/model/format-matrix/dae-up-axis/animated-textured.dae',
      '/model/format-matrix/dae-up-axis/checker.png'
    ]));
    disposeModelResources(result.object);
  });

  it('waits for local image sidecars before enforcing the decoded texture budget', async () => {
    await expect(loadFixture('obj-multimtl/multi-material.obj', {
      budget: { ...DEFAULT_MODEL_BUDGET, maxTexturePixels: 1 }
    })).rejects.toMatchObject({ code: 'MODEL_BUDGET_TEXTUREPIXELS' });
    expect(requestedPaths()).toEqual(expect.arrayContaining([
      '/model/format-matrix/obj-multimtl/warm-texture.png',
      '/model/format-matrix/obj-multimtl/cool-texture.png'
    ]));
  });

  it('applies the aggregate source-byte budget to glTF image sidecars while they are fetched', async () => {
    const [manifest, binary, texture] = await Promise.all([
      readFile(path.join(fixtureRoot, 'gltf-simple-texture/SimpleTexture.gltf')),
      readFile(path.join(fixtureRoot, 'gltf-simple-texture/SimpleTexture.bin')),
      readFile(path.join(fixtureRoot, 'gltf-simple-texture/testTexture.png'))
    ]);
    const limit = manifest.byteLength + binary.byteLength + texture.byteLength - 1;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(loadFixture('gltf-simple-texture/SimpleTexture.gltf', {
        budget: { ...DEFAULT_MODEL_BUDGET, maxSourceBytes: limit }
      })).rejects.toMatchObject({ code: 'MODEL_BUDGET_SOURCEBYTES', limit });
    } finally {
      consoleError.mockRestore();
    }
    expect(requestedPaths()).toEqual(expect.arrayContaining([
      '/model/format-matrix/gltf-simple-texture/SimpleTexture.gltf',
      '/model/format-matrix/gltf-simple-texture/SimpleTexture.bin',
      '/model/format-matrix/gltf-simple-texture/testTexture.png'
    ]));
  });

  it('parses the compact CC0 static FBX fixture', async () => {
    const result = await loadFixture('fbx-static/lantern-pole.fbx');

    expect(result.object.isObject3D).toBe(true);
    expect(result.object.name).toBe('SM_LanternPole');
    expect(result.stats.meshes).toBeGreaterThan(0);
    expect(result.stats.vertices).toBeGreaterThan(0);
    expect(result.animations).toHaveLength(0);
    expect(requestedPaths()).toContain('/model/format-matrix/fbx-static/lantern-pole.fbx');
    disposeModelResources(result.object);
  });

  it('parses the authored coloured PLY mesh fixture with its authored normals', async () => {
    const result = await loadFixture('ply-mesh/colored-triangle.ply');

    expect(result.object.isMesh).toBe(true);
    expect(result.object.geometry.attributes.color).toBeTruthy();
    expect(result.object.geometry.attributes.normal.getZ(0)).toBeCloseTo(1);
    expect(result.stats).toMatchObject({ meshes: 1, vertices: 3, triangles: 1 });
    expect(requestedPaths()).toContain('/model/format-matrix/ply-mesh/colored-triangle.ply');
    disposeModelResources(result.object);
  });

  it('decodes a required EXT_meshopt_compression fixture without an uncompressed fallback', async () => {
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, 'meshopt-ext/triangle.gltf'), 'utf8'));
    const decode = vi.spyOn(ThreeMeshoptDecoder, 'decodeGltfBufferAsync');
    const result = await loadFixture('meshopt-ext/triangle.gltf');

    expect(manifest.extensionsRequired).toEqual(['EXT_meshopt_compression']);
    expect(manifest.buffers[2].uri).toBeUndefined();
    expect(manifest.bufferViews.every((view) => view.extensions?.EXT_meshopt_compression)).toBe(true);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(result.stats).toMatchObject({ meshes: 1, vertices: 3, triangles: 1 });
    expect(requestedPaths()).toContain('/model/format-matrix/meshopt-ext/triangle.gltf');
    disposeModelResources(result.object);
    decode.mockRestore();
  });

  it('keeps a valid, pinned KTX2 BasisU sidecar and explicit required extension', async () => {
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, 'ktx2-required/Ktx2Texture.gltf'), 'utf8'));
    const ktx2 = await readFile(path.join(fixtureRoot, 'ktx2-required/basis-texture.ktx2'));

    expect(manifest.extensionsRequired).toContain('KHR_texture_basisu');
    expect(manifest.images).toEqual([{ uri: 'basis-texture.ktx2', mimeType: 'image/ktx2' }]);
    expect(ktx2.subarray(0, ktx2Signature.length)).toEqual(Buffer.from(ktx2Signature));
    expect(createHash('sha256').update(ktx2).digest('hex')).toBe('15913638d6d882c41bde2021443d1f0a83de29adb294dcb835fd4618baf19780');
  });

  it('keeps a required Draco fixture and resolves decoder runtimes from the packaged app origin', async () => {
    const manifest = JSON.parse(await readFile(path.join(fixtureRoot, 'draco-required/Box.gltf'), 'utf8'));

    expect(manifest.extensionsRequired).toContain('KHR_draco_mesh_compression');
    expect(manifest.meshes[0].primitives[0].extensions.KHR_draco_mesh_compression).toBeTruthy();
    expect(manifest.buffers[0].uri).toBe('Box.bin');
    expect(getBundledLoaderRoot('draco', 'nexoip://app/')).toBe('nexoip://app/draco/');
    expect(getBundledLoaderRoot('basis', 'nexoip://app/')).toBe('nexoip://app/basis/');
  });

  it('rejects malformed glTF and a missing OBJ material sidecar without a synthetic fallback', async () => {
    await expect(loadFixture('invalid/malformed.gltf')).rejects.toThrow();
    await expect(loadFixture('invalid/missing-material.obj')).rejects.toThrow(/No se pudo cargar el material OBJ/);
    expect(requestedPaths()).toEqual(expect.arrayContaining([
      '/model/format-matrix/invalid/malformed.gltf',
      '/model/format-matrix/invalid/missing-material.obj',
      '/model/format-matrix/invalid/missing.mtl'
    ]));
  });
});
