const path = require('node:path');

const DEV_RENDERER_URL = 'http://127.0.0.1:3000/';
const PACKAGED_APP_ORIGIN = 'nexoip://app';
const OPAQUE_ID_PATTERN = /^[a-f0-9]{48}$/;
const SUPPORTED_MODEL_EXTENSIONS = Object.freeze([
  '.glb',
  '.gltf',
  '.obj',
  '.stl',
  '.fbx',
  '.ply',
  '.dae',
]);
const SUPPORTED_MODEL_EXTENSION_SET = new Set(SUPPORTED_MODEL_EXTENSIONS);
const SUPPORTED_SIDECAR_EXTENSIONS = new Set([
  '.bin',
  '.basis',
  '.dds',
  '.gif',
  '.hdr',
  '.jpeg',
  '.jpg',
  '.ktx',
  '.ktx2',
  '.png',
  '.tga',
  '.webp',
]);
const SORT_FIELDS = new Set(['name', 'size', 'modifiedAt']);
const SORT_ORDERS = new Set(['asc', 'desc']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOpaqueId(value) {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value);
}

function getExtension(filePath) {
  return path.extname(filePath).toLowerCase();
}

function isSupportedModelPath(filePath) {
  return typeof filePath === 'string' && SUPPORTED_MODEL_EXTENSION_SET.has(getExtension(filePath));
}

function isSupportedSidecarPath(filePath) {
  return typeof filePath === 'string' && SUPPORTED_SIDECAR_EXTENSIONS.has(getExtension(filePath));
}

function normalizeFilters(input) {
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

function decodePathSegment(value) {
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

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    return false;
  }

  if (value.includes('\0') || value.includes('\\') || value.includes('%') || value.startsWith('/')) {
    return false;
  }

  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isPathInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeResolveUnder(rootPath, relativePath) {
  if (!path.isAbsolute(rootPath) || !isSafeRelativePath(relativePath)) {
    return null;
  }

  const candidatePath = path.resolve(rootPath, ...relativePath.split('/'));
  return isPathInside(rootPath, candidatePath) ? candidatePath : null;
}

function getAppAssetPath(distDirectory, pathname) {
  const rawPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const decodedPath = decodePathSegment(rawPath);
  if (!decodedPath) {
    return null;
  }
  return safeResolveUnder(distDirectory, decodedPath);
}

function getModelRoute(pathname) {
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

function normalizeDevRendererUrl(value) {
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

function isAllowedRendererUrl(value, isPackaged) {
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

function isAllowedNavigationUrl(value, isPackaged) {
  return isAllowedRendererUrl(value, isPackaged);
}

module.exports = {
  DEV_RENDERER_URL,
  PACKAGED_APP_ORIGIN,
  SUPPORTED_MODEL_EXTENSIONS,
  decodePathSegment,
  getAppAssetPath,
  getExtension,
  getModelRoute,
  isAllowedNavigationUrl,
  isAllowedRendererUrl,
  isOpaqueId,
  isPathInside,
  isSafeRelativePath,
  isSupportedModelPath,
  isSupportedSidecarPath,
  normalizeDevRendererUrl,
  normalizeFilters,
  safeResolveUnder,
};
