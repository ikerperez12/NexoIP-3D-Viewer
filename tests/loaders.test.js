import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { exportModelAsGlb } from '../src/utils/exporters.js';
import {
  DEFAULT_MODEL_BUDGET,
  ModelBudgetError,
  assertModelWithinBudget,
  buildHierarchyTree,
  disposeModelResources,
  extractModelStats,
  getBundledLoaderRoot,
  inspectModelResources,
  load3DModel
} from '../src/utils/loaders.js';

const originalFetch = globalThis.fetch;
const originalProgressEvent = globalThis.ProgressEvent;
const originalFileReader = globalThis.FileReader;

class TestFileReader {
  result = null;

  error = null;

  onloadend = null;

  readAsArrayBuffer(blob) {
    void blob.arrayBuffer()
      .then((result) => { this.result = result; })
      .catch((error) => { this.error = error; })
      .finally(() => queueMicrotask(() => this.onloadend?.()));
  }

  readAsDataURL(blob) {
    void blob.arrayBuffer()
      .then((result) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(result).toString('base64')}`;
      })
      .catch((error) => { this.error = error; })
      .finally(() => queueMicrotask(() => this.onloadend?.()));
  }
}

function responseFrom(value, contentType = 'application/octet-stream') {
  return new Response(value, { status: 200, headers: { 'content-type': contentType } });
}

function createBinaryColorStl() {
  const buffer = new ArrayBuffer(84 + 50);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  bytes.set(new TextEncoder().encode('COLOR='), 0);
  bytes.set([255, 0, 0, 128], 6);
  view.setUint32(80, 1, true);
  const start = 84;
  view.setFloat32(start + 8, 1, true);
  const vertices = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  vertices.forEach((vertex, index) => {
    vertex.forEach((value, component) => view.setFloat32(start + 12 + index * 12 + component * 4, value, true));
  });
  view.setUint16(start + 48, 0x8000, true);
  return buffer;
}

function createTriangleGltf() {
  const positions = Buffer.alloc(36);
  [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((vertex, index) => {
    vertex.forEach((value, component) => positions.writeFloatLE(value, index * 12 + component * 4));
  });
  const indices = Buffer.alloc(6);
  [0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2));
  const binary = Buffer.concat([positions, indices]);
  return JSON.stringify({
    asset: { version: '2.0', generator: 'NexoIP test fixture' },
    buffers: [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR', min: [0], max: [2] }
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0, name: 'Triangle' }],
    scenes: [{ nodes: [0] }],
    scene: 0
  });
}

describe('real model loader paths and resource budgets', () => {
  beforeEach(() => {
    if (!globalThis.ProgressEvent) {
      globalThis.ProgressEvent = class ProgressEvent {
        constructor(type, init = {}) {
          this.type = type;
          Object.assign(this, init);
        }
      };
    }
    globalThis.FileReader = TestFileReader;
    globalThis.fetch = vi.fn(async (url) => {
      const value = url instanceof Request ? url.url : String(url);
      if (value.endsWith('/colored.stl')) return responseFrom(createBinaryColorStl());
      if (value.endsWith('/points.ply')) {
        return responseFrom(`ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 0 255 0 0\n1 1 1 0 255 0\n`, 'text/plain');
      }
      if (value.endsWith('/mesh.ply')) {
        return responseFrom(`ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 1 0 0\n1 0 0 1 0 0\n0 1 0 1 0 0\n3 0 1 2\n`, 'text/plain');
      }
      if (value.endsWith('/triangle.gltf')) return responseFrom(createTriangleGltf(), 'model/gltf+json');
      if (value.endsWith('/material.obj')) {
        return responseFrom('mtllib material.mtl\no Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl Amber\nf 1 2 3\n', 'text/plain');
      }
      if (value.endsWith('/material.mtl')) return responseFrom('newmtl Amber\nKd 1.0 0.5 0.0\n', 'text/plain');
      if (value.endsWith('/multi.obj')) {
        return responseFrom('mtllib first.mtl\nmtllib second.mtl\no Multi\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nusemtl First\nf 1 2 3\nusemtl Second\nf 2 4 3\n', 'text/plain');
      }
      if (value.endsWith('/first.mtl')) return responseFrom('newmtl First\nKd 1 0 0\n', 'text/plain');
      if (value.endsWith('/second.mtl')) return responseFrom('newmtl Second\nKd 0 1 0\n', 'text/plain');
      if (value.startsWith('data:')) return originalFetch(url);
      return new Response('not found', { status: 404 });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalProgressEvent) globalThis.ProgressEvent = originalProgressEvent;
    else delete globalThis.ProgressEvent;
    if (originalFileReader) globalThis.FileReader = originalFileReader;
    else delete globalThis.FileReader;
    vi.restoreAllMocks();
  });

  it('preserves supported binary STL vertex colours and alpha', async () => {
    const result = await load3DModel('nexoip://app/model/id/colored.stl', 'colored.stl');
    expect(result.object.isMesh).toBe(true);
    expect(result.object.geometry.hasColors).toBe(true);
    expect(result.object.material.vertexColors).toBe(true);
    expect(result.object.material.transparent).toBe(true);
    expect(result.object.material.opacity).toBeCloseTo(128 / 255);
    disposeModelResources(result.object);
  });

  it('represents PLY point clouds as Points and keeps authored mesh normals', async () => {
    const points = await load3DModel('nexoip://app/model/id/points.ply', 'points.ply');
    expect(points.object.isPoints).toBe(true);
    expect(points.stats.pointClouds).toBe(1);
    expect(points.stats.vertices).toBe(2);

    const mesh = await load3DModel('nexoip://app/model/id/mesh.ply', 'mesh.ply');
    expect(mesh.object.isMesh).toBe(true);
    expect(mesh.object.geometry.attributes.normal.getX(0)).toBeCloseTo(1);
    expect(mesh.stats.triangles).toBe(1);
    disposeModelResources(points.object);
    disposeModelResources(mesh.object);
  });

  it('loads a real glTF scene with a local embedded buffer', async () => {
    const result = await load3DModel('nexoip://app/model/id/triangle.gltf', 'triangle.gltf');
    expect(result.stats.meshes).toBe(1);
    expect(result.stats.vertices).toBe(3);
    expect(result.stats.triangles).toBe(1);
    expect(result.metadata).toEqual({ scenes: 1, cameras: 0 });
    expect(result.exportObject).not.toBe(result.object);
    disposeModelResources(result.object);
  });

  it('resolves bundled Draco and Basis runtimes from the application root', () => {
    const modelUrl = 'nexoip://app/model/abc123/textures/';
    expect(getBundledLoaderRoot('draco', 'nexoip://app/')).toBe('nexoip://app/draco/');
    expect(getBundledLoaderRoot('basis', 'http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000/basis/');
    expect(getBundledLoaderRoot('draco', 'nexoip://app/')).not.toContain(modelUrl);
    expect(() => getBundledLoaderRoot('untrusted', 'nexoip://app/')).toThrow(TypeError);
  });

  it('loads an adjacent OBJ material instead of silently dropping it', async () => {
    const result = await load3DModel('nexoip://app/model/id/material.obj', 'material.obj');
    let material;
    result.object.traverse((object) => { if (object.isMesh) material = object.material; });
    expect(material?.name).toBe('Amber');
    expect(material?.color.r).toBeCloseTo(1);
    expect(material?.color.getHexString()).toBe('ff8000');
    disposeModelResources(result.object);
  });

  it('merges every declared OBJ material library', async () => {
    const result = await load3DModel('nexoip://app/model/id/multi.obj', 'multi.obj');
    const colours = [];
    result.object.traverse((object) => {
      if (!object.isMesh) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        colours.push([material.name, material.color.getHexString()]);
      }
    });
    expect(colours).toContainEqual(['First', 'ff0000']);
    expect(colours).toContainEqual(['Second', '00ff00']);
    disposeModelResources(result.object);
  });

  it('round-trips GLB animations and includes nodes hidden in the current view', async () => {
    const source = new THREE.Group();
    const hiddenMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    hiddenMesh.name = 'HiddenPart';
    hiddenMesh.visible = false;
    source.add(hiddenMesh);
    const animation = new THREE.AnimationClip('MovePart', 1, [
      new THREE.VectorKeyframeTrack('HiddenPart.position', [0, 1], [0, 0, 0, 1, 0, 0])
    ]);

    const glb = await exportModelAsGlb(source, [animation]);
    const reloaded = await new GLTFLoader().parseAsync(glb, '');

    expect(reloaded.scene.getObjectByName('HiddenPart')).toBeTruthy();
    expect(reloaded.animations).toHaveLength(1);
    expect(reloaded.animations[0].name).toBe('MovePart');
    disposeModelResources(source);
    disposeModelResources(reloaded.scene);
  });

  it('rejects decoded geometry beyond a configured budget', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const usage = inspectModelResources(mesh);
    expect(usage.vertices).toBeGreaterThan(2);
    expect(() => assertModelWithinBudget(mesh, [], { ...DEFAULT_MODEL_BUDGET, maxVertices: 2 }))
      .toThrow(ModelBudgetError);
    disposeModelResources(mesh);
  });

  it('charges instanced geometry against decoded vertex and triangle budgets', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0
    ], 3));
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 100_000);

    expect(inspectModelResources(mesh)).toMatchObject({ vertices: 300_000, triangles: 100_000 });
    expect(() => assertModelWithinBudget(mesh, [], { ...DEFAULT_MODEL_BUDGET, maxTriangles: 99_999 }))
      .toThrow(ModelBudgetError);
    disposeModelResources(mesh);
  });

  it('builds a bounded hierarchy iteratively and reports non-mesh primitives', () => {
    const root = new THREE.Group();
    let parent = root;
    for (let index = 0; index < 8; index += 1) {
      const child = new THREE.Group();
      child.name = `level-${index}`;
      parent.add(child);
      parent = child;
    }
    parent.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial()));

    const hierarchy = buildHierarchyTree(root, { ...DEFAULT_MODEL_BUDGET, maxDepth: 3 });
    expect(hierarchy.children[0].children[0].children[0].truncated).toBe(true);
    const stats = extractModelStats(root);
    expect(stats.pointClouds).toBe(1);
    expect(stats.meshes).toBe(0);
    disposeModelResources(root);
  });

  it('keeps inspector hierarchy data below its dedicated presentation budget', () => {
    const root = new THREE.Group();
    for (let index = 0; index < 2_100; index += 1) {
      const child = new THREE.Group();
      child.name = `node-${index}`;
      root.add(child);
    }

    const stats = extractModelStats(root);
    expect(stats.nodes).toBe(2_101);
    expect(stats.hierarchy.children).toHaveLength(1_999);
    expect(stats.hierarchy.truncated).toBe(true);
    disposeModelResources(root);
  });
});
