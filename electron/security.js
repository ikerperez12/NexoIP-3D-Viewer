import path from 'node:path';

export const DEV_RENDERER_URL = 'http://127.0.0.1:3000/';
export const PACKAGED_APP_ORIGIN = 'nexoip://app';
export const KTX2_TRANSCODER_WORKER_PATH = '/basis/ktx2-transcoder-worker.js';
export const PACKAGED_RENDERER_CSP = 'default-src \'self\'; base-uri \'none\'; object-src \'none\'; frame-src \'none\'; form-action \'none\'; script-src \'self\' \'wasm-unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\'; connect-src \'self\' data: blob:; worker-src \'self\' blob:';
export const PACKAGED_KTX2_WORKER_CSP = 'default-src \'none\'; base-uri \'none\'; object-src \'none\'; script-src \'self\' \'unsafe-eval\' \'wasm-unsafe-eval\'; connect-src \'none\'; worker-src \'none\'; form-action \'none\'';
export const OPAQUE_ID_PATTERN = /^[a-f0-9]{48}$/;
export const SUPPORTED_MODEL_EXTENSIONS = Object.freeze([
  '.glb',
  '.gltf',
  '.obj',
  '.stl',
  '.fbx',
  '.ply',
  '.dae',
]);
export const SUPPORTED_MODEL_EXTENSION_SET = new Set(SUPPORTED_MODEL_EXTENSIONS);
export const SUPPORTED_SIDECAR_EXTENSIONS = new Set([
  '.bin',
  '.basis',
  '.dds',
  '.gif',
  '.hdr',
  '.jpeg',
  '.jpg',
  '.ktx',
  '.ktx2',
  '.mtl',
  '.png',
  '.tga',
  '.webp',
]);
export const SORT_FIELDS = new Set(['name', 'size', 'modifiedAt']);
export const SORT_ORDERS = new Set(['asc', 'desc']);
const MODEL_ASSET_MIME_TYPES = new Map([
  ['.basis', 'application/octet-stream'],
  ['.bin', 'application/octet-stream'],
  ['.dae', 'model/vnd.collada+xml'],
  ['.dds', 'image/vnd-ms.dds'],
  ['.fbx', 'application/octet-stream'],
  ['.gif', 'image/gif'],
  ['.glb', 'model/gltf-binary'],
  ['.gltf', 'model/gltf+json'],
  ['.hdr', 'application/octet-stream'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.ktx', 'image/ktx'],
  ['.ktx2', 'image/ktx2'],
  ['.mtl', 'text/plain; charset=utf-8'],
  ['.obj', 'text/plain; charset=utf-8'],
  ['.ply', 'application/octet-stream'],
  ['.png', 'image/png'],
  ['.stl', 'model/stl'],
  ['.tga', 'image/x-tga'],
  ['.webp', 'image/webp'],
]);

export function getPackagedContentSecurityPolicy(pathname) {
  return pathname === KTX2_TRANSCODER_WORKER_PATH
    ? PACKAGED_KTX2_WORKER_CSP
    : PACKAGED_RENDERER_CSP;
}

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isOpaqueId(value) {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value);
}

export function getExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

export function isSupportedModelPath(filePath) {
  return typeof filePath === 'string' && SUPPORTED_MODEL_EXTENSION_SET.has(getExtension(filePath));
}

export function isSupportedSidecarPath(filePath) {
  return typeof filePath === 'string' && SUPPORTED_SIDECAR_EXTENSIONS.has(getExtension(filePath));
}

export function getModelAssetMimeType(filePath) {
  return MODEL_ASSET_MIME_TYPES.get(getExtension(filePath)) || 'application/octet-stream';
}

export function normalizeFilters(input) {
  if (input === undefined || input === null) {
    return { query: '', extension: 'all', sortBy: 'name', order: 'asc' };
  }

  if (!isPlainObject(input)) {
    throw new TypeError('Filters must be an object.');
  }

  const query = typeof input.query === 'string' ? input.query.trim().slice(0, 200) : '';
  const extension = typeof input.extension === 'string' ? input.extension.toLowerCase() : 'all';
  const sortBy = typeof input.sortBy === 'string' && SORT_FIELDS.has(input.sortBy) ? input.sortBy : 'name';
  const order = typeof input.order === 'string' && SORT_ORDERS.has(input.order) ? input.order : 'asc';

  return {
    query,
    extension: extension === 'all' || SUPPORTED_MODEL_EXTENSION_SET.has(`.${extension.replace(/^\./, '')}`)
      ? extension.replace(/^\./, '')
      : 'all',
    sortBy,
    order,
  };
}

export function decodePathSegment(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    return false;
  }

  if (value.includes('\0') || value.includes('\\') || value.includes('%') || value.startsWith('/')) {
    return false;
  }

  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function safeResolveUnder(rootPath, relativePath) {
  if (!path.isAbsolute(rootPath) || !isSafeRelativePath(relativePath)) {
    return null;
  }

  const candidatePath = path.resolve(rootPath, ...relativePath.split('/'));
  return isPathInside(rootPath, candidatePath) ? candidatePath : null;
}

export function getAppAssetPath(distDirectory, pathname) {
  const rawPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const decodedPath = decodePathSegment(rawPath);
  if (!decodedPath) {
    return null;
  }
  return safeResolveUnder(distDirectory, decodedPath);
}

export function getModelRoute(pathname) {
  if (typeof pathname !== 'string') {
    return null;
  }

  const rawSegments = pathname.split('/').filter(Boolean);
  if (rawSegments.length < 3 || rawSegments[0] !== 'model') {
    return null;
  }

  const id = decodePathSegment(rawSegments[1]);
  if (!isOpaqueId(id)) {
    return null;
  }

  const decodedAssetSegments = rawSegments.slice(2).map(decodePathSegment);
  if (decodedAssetSegments.some((segment) => segment === null)) {
    return null;
  }

  const assetPath = decodedAssetSegments.join('/');
  if (assetPath !== 'asset' && !isSafeRelativePath(assetPath)) {
    return null;
  }

  return { id, assetPath };
}

export function normalizeDevRendererUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ELECTRON_RENDERER_URL must be the local Vite URL.');
  }

  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port !== '3000' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('ELECTRON_RENDERER_URL must be http://127.0.0.1:3000/.');
  }

  return DEV_RENDERER_URL;
}

export function isAllowedRendererUrl(value, isPackaged) {
  try {
    const url = new URL(value);
    if (isPackaged) {
      return url.protocol === 'nexoip:' && url.hostname === 'app' && !url.port && (url.pathname === '/' || url.pathname === '/index.html');
    }
    return url.origin === new URL(DEV_RENDERER_URL).origin;
  } catch {
    return false;
  }
}

export function isAllowedNavigationUrl(value, isPackaged) {
  return isAllowedRendererUrl(value, isPackaged);
}
