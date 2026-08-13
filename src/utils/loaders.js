import * as THREE from 'three';
import { getFileExtension, SUPPORTED_MODEL_EXTENSIONS } from './nexoip.js';

export const DEFAULT_MODEL_BUDGET = Object.freeze({
  maxNodes: 50_000,
  maxDepth: 256,
  maxVertices: 20_000_000,
  maxTriangles: 10_000_000,
  maxMaterials: 2_048,
  maxTextures: 512,
  maxTexturePixels: 64 * 1024 * 1024,
  maxAnimations: 256,
  maxAnimationTracks: 10_000
});

const MODEL_BUDGET_LABELS = Object.freeze({
  nodes: 'nodos',
  depth: 'niveles de jerarquía',
  vertices: 'vértices',
  triangles: 'triángulos',
  materials: 'materiales',
  textures: 'texturas',
  texturePixels: 'píxeles de textura',
  animations: 'animaciones',
  animationTracks: 'pistas de animación'
});

export class ModelBudgetError extends Error {
  constructor(metric, actual, limit) {
    super(`El modelo supera el límite seguro de ${MODEL_BUDGET_LABELS[metric] || metric} (${actual.toLocaleString()} > ${limit.toLocaleString()}).`);
    this.name = 'ModelBudgetError';
    this.code = `MODEL_BUDGET_${metric.toUpperCase()}`;
    this.metric = metric;
    this.actual = actual;
    this.limit = limit;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('La carga se canceló.', 'AbortError');
}

function getBaseUrl(url) {
  try {
    return new URL('.', url).href;
  } catch {
    return url.slice(0, Math.max(0, url.lastIndexOf('/') + 1));
  }
}

const BUNDLED_LOADER_DIRECTORIES = new Set(['basis', 'draco']);

export function getBundledLoaderRoot(directory, rendererUrl = globalThis.location?.href || 'nexoip://app/') {
  if (!BUNDLED_LOADER_DIRECTORIES.has(directory)) throw new TypeError('Unknown bundled loader directory.');
  const applicationBase = new URL(import.meta.env.BASE_URL, rendererUrl);
  return new URL(`${directory}/`, applicationBase).href;
}

function isAllowedLoaderUrl(candidate, bundledRoots = []) {
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === 'nexoip:' && parsed.hostname === 'app')
      || parsed.protocol === 'blob:'
      || parsed.protocol === 'data:'
      || bundledRoots.some((root) => candidate.startsWith(root));
  } catch {
    return false;
  }
}

function createLocalLoadingManager(baseUrl, bundledRoots = []) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((candidate) => {
    const resolved = new URL(candidate, baseUrl).href;
    if (!isAllowedLoaderUrl(resolved, bundledRoots)) {
      throw new Error('El modelo intentó cargar un recurso externo bloqueado.');
    }
    return resolved;
  });
  return manager;
}

async function fetchArrayBuffer(url, onProgress, signal) {
  throwIfAborted(signal);
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal
  });
  if (!response.ok) throw new Error(`No se pudo leer el recurso local (${response.status}).`);

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    onProgress?.(1);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (total > 0) onProgress?.(Math.max(0, Math.min(1, loaded / total)));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress?.(1);
  return merged.buffer;
}

function safeSidecarReference(value) {
  const reference = value.trim().replace(/^['"]|['"]$/g, '');
  if (!reference || reference.length > 512 || reference.includes('\\') || reference.includes('\0')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('/') || reference.startsWith('//')) return null;
  const segments = reference.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return reference;
}

function extractMtlReferences(text) {
  const references = [];
  for (const match of text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gim)) {
    const reference = safeSidecarReference(match[1]);
    if (reference && !references.includes(reference)) references.push(reference);
  }
  return references;
}

function plyHasFaces(buffer) {
  const prefix = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64 * 1024)));
  const end = prefix.indexOf('end_header');
  if (end < 0) throw new Error('La cabecera PLY está incompleta.');
  const header = prefix.slice(0, end);
  const faceMatch = header.match(/^element\s+face\s+(\d+)\s*$/im);
  return Number(faceMatch?.[1] || 0) > 0;
}

async function loadGltf(url, onProgress, { renderer, signal }) {
  const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
    import('three/examples/jsm/loaders/KTX2Loader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js')
  ]);
  throwIfAborted(signal);

  const baseUrl = getBaseUrl(url);
  const dracoRoot = getBundledLoaderRoot('draco');
  const basisRoot = getBundledLoaderRoot('basis');
  const manager = createLocalLoadingManager(baseUrl, [dracoRoot, basisRoot]);
  const dracoLoader = new DRACOLoader(manager).setDecoderPath(dracoRoot);
  dracoLoader.setDecoderConfig({ type: 'wasm' });
  const ktx2Loader = new KTX2Loader(manager).setTranscoderPath(basisRoot);
  if (renderer) ktx2Loader.detectSupport(renderer);

  const loader = new GLTFLoader(manager)
    .setDRACOLoader(dracoLoader)
    .setMeshoptDecoder(MeshoptDecoder);
  if (renderer) loader.setKTX2Loader(ktx2Loader);

  try {
    const buffer = await fetchArrayBuffer(url, onProgress, signal);
    throwIfAborted(signal);
    return await loader.parseAsync(buffer, baseUrl);
  } finally {
    dracoLoader.dispose();
    ktx2Loader.dispose();
  }
}

async function loadObj(url, onProgress, signal) {
  const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
    import('three/examples/jsm/loaders/OBJLoader.js'),
    import('three/examples/jsm/loaders/MTLLoader.js')
  ]);
  const baseUrl = getBaseUrl(url);
  const manager = createLocalLoadingManager(baseUrl);
  const text = new TextDecoder().decode(await fetchArrayBuffer(url, onProgress, signal));
  throwIfAborted(signal);

  const loader = new OBJLoader(manager);
  const mtlReferences = extractMtlReferences(text);
  if (mtlReferences.length > 0) {
    const materialCreators = [];
    for (const mtlReference of mtlReferences) {
      const mtlUrl = new URL(mtlReference.split('/').map(encodeURIComponent).join('/'), baseUrl).href;
      let mtlText;
      try {
        mtlText = new TextDecoder().decode(await fetchArrayBuffer(mtlUrl, undefined, signal));
      } catch (error) {
        throw new Error(`No se pudo cargar el material OBJ “${mtlReference}”. ${error instanceof Error ? error.message : ''}`.trim(), { cause: error });
      }
      materialCreators.push(new MTLLoader(manager).parse(mtlText, baseUrl));
    }

    const materials = {
      create(materialName) {
        for (let index = materialCreators.length - 1; index >= 0; index -= 1) {
          const creator = materialCreators[index];
          if (Object.hasOwn(creator.materialsInfo, materialName)) return creator.create(materialName);
        }
        return undefined;
      }
    };
    loader.setMaterials(materials);
  }

  return loader.parse(text);
}

async function loadStl(url, fileName, onProgress, signal) {
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
  const geometry = new STLLoader().parse(await fetchArrayBuffer(url, onProgress, signal));
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const hasColors = Boolean(geometry.hasColors || geometry.attributes.color);
  const opacity = Number.isFinite(geometry.alpha) ? geometry.alpha : 1;
  const material = new THREE.MeshStandardMaterial({
    color: hasColors ? 0xffffff : 0xf59e0b,
    metalness: 0.08,
    opacity,
    roughness: 0.55,
    transparent: opacity < 1,
    vertexColors: hasColors,
    name: 'STL Material'
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = fileName || 'STL_Mesh';
  return mesh;
}

async function loadFbx(url, onProgress, signal) {
  const [{ FBXLoader }, { TGALoader }] = await Promise.all([
    import('three/examples/jsm/loaders/FBXLoader.js'),
    import('three/examples/jsm/loaders/TGALoader.js')
  ]);
  const baseUrl = getBaseUrl(url);
  const manager = createLocalLoadingManager(baseUrl);
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  const group = new FBXLoader(manager).parse(await fetchArrayBuffer(url, onProgress, signal), baseUrl);
  return { group, animations: group.animations || [] };
}

async function loadPly(url, fileName, onProgress, signal) {
  const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
  const buffer = await fetchArrayBuffer(url, onProgress, signal);
  const hasFaces = plyHasFaces(buffer);
  const geometry = new PLYLoader().parse(buffer);
  const hasColors = Boolean(geometry.attributes.color);

  if (!hasFaces) {
    const material = new THREE.PointsMaterial({
      color: hasColors ? 0xffffff : 0x10b981,
      size: 2,
      sizeAttenuation: false,
      vertexColors: hasColors,
      name: 'PLY Point Material'
    });
    const points = new THREE.Points(geometry, material);
    points.name = fileName || 'PLY_Points';
    return points;
  }

  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: hasColors ? 0xffffff : 0x10b981,
    metalness: 0.08,
    roughness: 0.5,
    vertexColors: hasColors,
    name: 'PLY Material'
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = fileName || 'PLY_Mesh';
  return mesh;
}

async function loadDae(url, onProgress, signal) {
  const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
  const baseUrl = getBaseUrl(url);
  const manager = createLocalLoadingManager(baseUrl);
  const text = new TextDecoder().decode(await fetchArrayBuffer(url, onProgress, signal));
  return new ColladaLoader(manager).parse(text, baseUrl);
}

function eachObjectIterative(rootObject, visitor) {
  if (!rootObject) return;
  const stack = [{ object: rootObject, depth: 0 }];
  while (stack.length) {
    const entry = stack.pop();
    visitor(entry.object, entry.depth);
    const children = entry.object.children || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ object: children[index], depth: entry.depth + 1 });
    }
  }
}

function collectMaterials(rootObject) {
  const materials = new Set();
  eachObjectIterative(rootObject, (object) => {
    const values = object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [];
    values.forEach((material) => material && materials.add(material));
  });
  return materials;
}

function textureDimensions(texture) {
  const source = texture?.source?.data || texture?.image;
  const width = Number(source?.width || source?.videoWidth || source?.naturalWidth || texture?.mipmaps?.[0]?.width || 0);
  const height = Number(source?.height || source?.videoHeight || source?.naturalHeight || texture?.mipmaps?.[0]?.height || 0);
  return {
    width: Number.isFinite(width) ? Math.max(0, width) : 0,
    height: Number.isFinite(height) ? Math.max(0, height) : 0
  };
}

export function inspectModelResources(rootObject, animations = []) {
  const materials = collectMaterials(rootObject);
  const textures = new Set();
  let nodes = 0;
  let depth = 0;
  let vertices = 0;
  let triangles = 0;
  let meshes = 0;
  let pointClouds = 0;
  let lines = 0;

  eachObjectIterative(rootObject, (object, objectDepth) => {
    nodes += 1;
    depth = Math.max(depth, objectDepth);
    const positionCount = object.geometry?.attributes?.position?.count || 0;
    if (object.isMesh || object.isPoints || object.isLine) vertices += positionCount;
    if (object.isMesh) {
      meshes += 1;
      triangles += object.geometry?.index ? object.geometry.index.count / 3 : positionCount / 3;
    } else if (object.isPoints) {
      pointClouds += 1;
    } else if (object.isLine) {
      lines += 1;
    }
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value?.isTexture) textures.add(value);
    }
  }

  let texturePixels = 0;
  for (const texture of textures) {
    const dimensions = textureDimensions(texture);
    texturePixels += dimensions.width * dimensions.height;
  }

  return {
    nodes,
    depth,
    vertices: Math.round(vertices),
    triangles: Math.round(triangles),
    meshes,
    pointClouds,
    lines,
    materials: materials.size,
    textures: textures.size,
    texturePixels: Math.round(texturePixels),
    animations: animations.length,
    animationTracks: animations.reduce((total, clip) => total + (clip?.tracks?.length || 0), 0)
  };
}

export function assertModelWithinBudget(rootObject, animations = [], budget = DEFAULT_MODEL_BUDGET) {
  const usage = inspectModelResources(rootObject, animations);
  const checks = [
    ['nodes', 'maxNodes'],
    ['depth', 'maxDepth'],
    ['vertices', 'maxVertices'],
    ['triangles', 'maxTriangles'],
    ['materials', 'maxMaterials'],
    ['textures', 'maxTextures'],
    ['texturePixels', 'maxTexturePixels'],
    ['animations', 'maxAnimations'],
    ['animationTracks', 'maxAnimationTracks']
  ];
  for (const [metric, limitKey] of checks) {
    if (usage[metric] > budget[limitKey]) throw new ModelBudgetError(metric, usage[metric], budget[limitKey]);
  }
  return usage;
}

function createDefaultPbrMaterial(colorHex, name = 'Material') {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.5,
    metalness: 0.08,
    name: `${name || 'Mesh'}_Material`
  });
}

/**
 * Loads a model from the private URL emitted by the native bridge.
 * The principal resource is abortable; external sidecars remain constrained by
 * the custom protocol and are checked again before a result can be committed.
 */
export async function load3DModel(url, fileName = '', onProgress, options = {}) {
  const ext = getFileExtension(fileName || url);
  if (!ext) {
    throw new Error(`Formato no soportado. Soportados: ${SUPPORTED_MODEL_EXTENSIONS.map((item) => item.toUpperCase()).join(', ')}.`);
  }

  const { renderer = null, signal, budget = DEFAULT_MODEL_BUDGET } = options;
  let sceneGroup = null;
  let animations = [];
  let metadata = { scenes: 1, cameras: 0 };

  try {
    switch (ext) {
      case 'glb':
      case 'gltf': {
        const gltf = await loadGltf(url, onProgress, { renderer, signal });
        sceneGroup = gltf.scene || gltf.scenes?.[0];
        animations = gltf.animations || [];
        metadata = { scenes: gltf.scenes?.length || 1, cameras: gltf.cameras?.length || 0 };
        break;
      }
      case 'obj':
        sceneGroup = await loadObj(url, onProgress, signal);
        break;
      case 'stl':
        sceneGroup = await loadStl(url, fileName, onProgress, signal);
        break;
      case 'fbx': {
        const result = await loadFbx(url, onProgress, signal);
        sceneGroup = result.group;
        animations = result.animations;
        break;
      }
      case 'ply':
        sceneGroup = await loadPly(url, fileName, onProgress, signal);
        break;
      case 'dae': {
        const collada = await loadDae(url, onProgress, signal);
        sceneGroup = collada.scene;
        animations = collada.animations || [];
        metadata = { scenes: 1, cameras: collada.kinematics ? 1 : 0 };
        break;
      }
      default:
        throw new Error(`Formato .${ext} no soportado.`);
    }

    throwIfAborted(signal);
    if (!sceneGroup?.isObject3D) throw new Error('El archivo no contiene una escena 3D válida.');

    eachObjectIterative(sceneGroup, (child) => {
      if (!child.isMesh && !child.isPoints && !child.isLine) return;
      child.castShadow = child.isMesh;
      child.receiveShadow = child.isMesh;
      if (!child.material) child.material = createDefaultPbrMaterial(0x9ca3af, child.name);
    });

    assertModelWithinBudget(sceneGroup, animations, budget);
    const stats = extractModelStats(sceneGroup, animations);
    const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
    throwIfAborted(signal);
    const exportObject = clone(sceneGroup);

    return { object: sceneGroup, exportObject, animations, stats, extension: ext, metadata };
  } catch (error) {
    if (sceneGroup) disposeModelResources(sceneGroup);
    if (error?.name === 'AbortError') throw new Error('La carga del modelo se canceló.', { cause: error });
    throw error;
  }
}

/** Frees GPU and image resources owned by a model before loading another one. */
export function disposeModelResources(rootObject) {
  if (!rootObject) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const skeletons = new Set();

  const disposeTexture = (value) => {
    if (!value?.isTexture || textures.has(value)) return;
    textures.add(value);
    const image = value.source?.data || value.image;
    if (typeof image?.close === 'function') image.close();
    value.dispose();
  };

  eachObjectIterative(rootObject, (child) => {
    if (child.geometry && !geometries.has(child.geometry)) {
      geometries.add(child.geometry);
      child.geometry.dispose();
    }
    if (child.skeleton && !skeletons.has(child.skeleton)) {
      skeletons.add(child.skeleton);
      child.skeleton.dispose?.();
    }
    const childMaterials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
    for (const material of childMaterials) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      Object.values(material).forEach(disposeTexture);
      material.dispose();
    }
  });
}

export function extractModelStats(rootObject, animations = []) {
  const usage = inspectModelResources(rootObject, animations);
  const materialsMap = new Map();
  const bbox = new THREE.Box3().setFromObject(rootObject);
  const size = bbox.isEmpty() ? new THREE.Vector3() : bbox.getSize(new THREE.Vector3());
  const center = bbox.isEmpty() ? new THREE.Vector3() : bbox.getCenter(new THREE.Vector3());

  for (const material of collectMaterials(rootObject)) {
    materialsMap.set(material.uuid, {
      id: material.uuid,
      name: material.name || 'Sin nombre',
      type: material.type,
      color: material.color ? `#${material.color.getHexString()}` : '#ffffff',
      roughness: material.roughness ?? null,
      metalness: material.metalness ?? null,
      wireframe: Boolean(material.wireframe),
      transparent: Boolean(material.transparent),
      opacity: material.opacity ?? 1,
      map: Boolean(material.map)
    });
  }

  return {
    vertices: usage.vertices,
    triangles: usage.triangles,
    meshes: usage.meshes,
    pointClouds: usage.pointClouds,
    lines: usage.lines,
    nodes: usage.nodes,
    textures: usage.textures,
    dimensions: {
      x: Number(size.x.toFixed(3)),
      y: Number(size.y.toFixed(3)),
      z: Number(size.z.toFixed(3)),
      unit: 'u'
    },
    center: {
      x: Number(center.x.toFixed(3)),
      y: Number(center.y.toFixed(3)),
      z: Number(center.z.toFixed(3))
    },
    materials: Array.from(materialsMap.values()),
    animationsCount: animations.length,
    animationNames: animations.map((animation, index) => animation.name || `Animación ${index + 1}`),
    hierarchy: buildHierarchyTree(rootObject)
  };
}

export function buildHierarchyTree(rootObject, limits = DEFAULT_MODEL_BUDGET) {
  const toNode = (object) => ({
    uuid: object.uuid,
    name: object.name || (object.isMesh ? 'Malla' : object.isPoints ? 'Nube de puntos' : object.type),
    type: object.type,
    isMesh: Boolean(object.isMesh),
    visible: object.visible,
    children: []
  });
  const root = toNode(rootObject);
  const stack = [{ source: rootObject, target: root, depth: 0 }];
  let count = 1;

  while (stack.length) {
    const { source, target, depth } = stack.pop();
    if (depth >= limits.maxDepth) {
      if (source.children?.length) target.truncated = true;
      continue;
    }
    for (const child of source.children || []) {
      if (count >= limits.maxNodes) {
        target.truncated = true;
        break;
      }
      const childNode = toNode(child);
      target.children.push(childNode);
      count += 1;
      stack.push({ source: child, target: childNode, depth: depth + 1 });
    }
  }
  return root;
}
