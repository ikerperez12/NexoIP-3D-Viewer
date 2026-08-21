import * as THREE from 'three';
import { getFileExtension, SUPPORTED_MODEL_EXTENSIONS } from './nexoip.js';
import { configureKtx2StaticWorker } from './ktx2-static-worker.js';

export const DEFAULT_MODEL_BUDGET = Object.freeze({
  // The native scanner keeps every individual model asset below 256 MiB. A
  // model can still reference multiple local buffers and textures, so loading
  // needs a separate aggregate source budget as well.
  maxSourceBytes: 512 * 1024 * 1024,
  maxRequests: 256,
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
  sourceBytes: 'bytes de recursos de origen',
  requests: 'solicitudes de recursos',
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

const DEFAULT_HIERARCHY_LIMITS = Object.freeze({
  maxNodes: 2_000,
  maxDepth: 64
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

const SOURCE_BUDGET_QUERY_PARAMETER = '__nexoip_source_budget';
const SOURCE_BUDGET_TRACKED_PROTOCOLS = new Set(['nexoip:', 'http:', 'https:']);
const IMAGE_SIDECAR_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const IMAGE_MIME_TYPES = Object.freeze({
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp'
});

const activeSourceBudgets = new Map();
let sourceBudgetFetchDispatcher = null;
let sourceBudgetUpstreamFetch = null;
let nextSourceBudgetIdentifier = 0;

function normalizeBudgetLimit(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function urlFromFetchInput(value) {
  if (value instanceof Request) return value.url;
  return typeof value === 'string' || value instanceof URL ? String(value) : '';
}

function sourceBudgetForFetchInput(value) {
  try {
    const identifier = new URL(urlFromFetchInput(value)).searchParams.get(SOURCE_BUDGET_QUERY_PARAMETER);
    return identifier ? activeSourceBudgets.get(identifier) || null : null;
  } catch {
    return null;
  }
}

function installSourceBudgetFetchDispatcher() {
  if (sourceBudgetFetchDispatcher) return;
  if (typeof globalThis.fetch !== 'function') throw new Error('Fetch no está disponible para cargar recursos locales.');

  sourceBudgetUpstreamFetch = globalThis.fetch;
  sourceBudgetFetchDispatcher = (input, init) => {
    const sourceBudget = sourceBudgetForFetchInput(input);
    if (!sourceBudget) return sourceBudgetUpstreamFetch(input, init);
    return sourceBudget.fetchTagged(sourceBudgetUpstreamFetch, input, init);
  };
  globalThis.fetch = sourceBudgetFetchDispatcher;
}

function uninstallSourceBudgetFetchDispatcherWhenIdle() {
  if (activeSourceBudgets.size !== 0 || !sourceBudgetFetchDispatcher) return;
  if (globalThis.fetch === sourceBudgetFetchDispatcher) globalThis.fetch = sourceBudgetUpstreamFetch;
  sourceBudgetFetchDispatcher = null;
  sourceBudgetUpstreamFetch = null;
}

function contentLengthOf(response) {
  const value = response?.headers?.get?.('content-length') || response?.headers?.get?.('x-file-size');
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function byteLengthOfResponseValue(value) {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
  if (typeof value === 'string') return new TextEncoder().encode(value).byteLength;
  if (value === undefined || value === null) return 0;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function createLoadAbortError() {
  return new DOMException('La carga se canceló.', 'AbortError');
}

function discardLateResponse(response) {
  const cancellation = response?.body?.cancel?.();
  if (cancellation?.catch) void cancellation.catch(() => undefined);
}

function raceWithAbort(task, signal, onLateValue) {
  const promise = Promise.resolve(task);
  if (!signal) return promise;

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const resolveLateValue = (value) => {
      if (settled) {
        try {
          onLateValue?.(value);
        } catch {
          // Late cleanup must not produce an unhandled rejection after the
          // loading operation has already been cancelled.
        }
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };
    const rejectTask = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createLoadAbortError());
    };

    promise.then(resolveLateValue, rejectTask);
    if (signal.aborted) handleAbort();
    else signal.addEventListener('abort', handleAbort, { once: true });
  });
}

class ModelSourceBudget {
  constructor(budget, parentSignal) {
    this.maxSourceBytes = normalizeBudgetLimit(budget?.maxSourceBytes, DEFAULT_MODEL_BUDGET.maxSourceBytes);
    this.maxRequests = normalizeBudgetLimit(budget?.maxRequests, DEFAULT_MODEL_BUDGET.maxRequests);
    this.sourceBytes = 0;
    this.requests = 0;
    this.failure = null;
    this.parentSignal = parentSignal;
    this.abortController = new AbortController();
    this.signal = this.abortController.signal;
    this.handleParentAbort = () => this.abort();
    if (parentSignal?.aborted) this.abort();
    else parentSignal?.addEventListener('abort', this.handleParentAbort, { once: true });
    this.identifier = `s${Date.now().toString(36)}-${(++nextSourceBudgetIdentifier).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    activeSourceBudgets.set(this.identifier, this);
    installSourceBudgetFetchDispatcher();
  }

  abort() {
    if (!this.signal.aborted) this.abortController.abort();
  }

  dispose() {
    this.abort();
    this.parentSignal?.removeEventListener('abort', this.handleParentAbort);
    activeSourceBudgets.delete(this.identifier);
    uninstallSourceBudgetFetchDispatcherWhenIdle();
  }

  recordFailure(error) {
    if (error instanceof ModelBudgetError && !this.failure) this.failure = error;
    return error;
  }

  chargeRequest() {
    const actual = this.requests + 1;
    if (actual > this.maxRequests) throw this.recordFailure(new ModelBudgetError('requests', actual, this.maxRequests));
    this.requests = actual;
  }

  assertTransferCanFit(byteLength) {
    const actual = this.sourceBytes + byteLength;
    if (actual > this.maxSourceBytes) {
      throw this.recordFailure(new ModelBudgetError('sourceBytes', actual, this.maxSourceBytes));
    }
  }

  chargeTransfer(byteLength) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return;
    this.assertTransferCanFit(byteLength);
    this.sourceBytes += byteLength;
  }

  tag(url) {
    try {
      const parsed = new URL(url);
      if (!SOURCE_BUDGET_TRACKED_PROTOCOLS.has(parsed.protocol)) return url;
      parsed.searchParams.set(SOURCE_BUDGET_QUERY_PARAMETER, this.identifier);
      return parsed.href;
    } catch {
      return url;
    }
  }

  fetchDirect(input, init) {
    try {
      this.chargeRequest();
      throwIfAborted(this.signal);
      return raceWithAbort(globalThis.fetch(input, { ...init, signal: this.signal }), this.signal, discardLateResponse)
        .then((response) => this.wrapResponse(response));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  fetchTagged(upstreamFetch, input, init) {
    try {
      this.chargeRequest();
      throwIfAborted(this.signal);
      return raceWithAbort(upstreamFetch(input, { ...init, signal: this.signal }), this.signal, discardLateResponse)
        .then((response) => this.wrapResponse(response));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  wrapResponse(response) {
    try {
      throwIfAborted(this.signal);
      const declaredLength = contentLengthOf(response);
      if (declaredLength !== null) this.assertTransferCanFit(declaredLength);
      if (!response?.body?.getReader || typeof ReadableStream === 'undefined') {
        if (declaredLength !== null) {
          this.chargeTransfer(declaredLength);
          return this.wrapUnstreamedResponse(response, declaredLength);
        }
        return this.wrapUnstreamedResponse(response);
      }

      const reader = response.body.getReader();
      const sourceBudget = this;
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            throwIfAborted(sourceBudget.signal);
            const { done, value } = await raceWithAbort(reader.read(), sourceBudget.signal);
            if (done) {
              controller.close();
              return;
            }
            sourceBudget.chargeTransfer(value.byteLength);
            controller.enqueue(value);
          } catch (error) {
            await reader.cancel(error).catch(() => undefined);
            controller.error(sourceBudget.recordFailure(error));
          }
        },
        async cancel(reason) {
          await reader.cancel(reason).catch(() => undefined);
        }
      });
      return new Response(stream, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText
      });
    } catch (error) {
      throw this.recordFailure(error);
    }
  }

  wrapUnstreamedResponse(response, chargedBytes = 0) {
    if (!response) return response;
    const sourceBudget = this;
    const methods = ['arrayBuffer', 'blob', 'json', 'text'];
    for (const method of methods) {
      if (typeof response[method] !== 'function') continue;
      const original = response[method].bind(response);
      Object.defineProperty(response, method, {
        configurable: true,
        value: async (...args) => {
          const value = await raceWithAbort(original(...args), sourceBudget.signal);
          const actualBytes = byteLengthOfResponseValue(value);
          if (actualBytes > chargedBytes) sourceBudget.chargeTransfer(actualBytes - chargedBytes);
          return value;
        }
      });
    }
    return response;
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createLoadAbortError();
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

function createLocalLoadingManager(baseUrl, bundledRoots = [], sourceBudget = null, signal) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((candidate) => {
    const resolved = new URL(candidate, baseUrl).href;
    if (!isAllowedLoaderUrl(resolved, bundledRoots)) {
      throw new Error('El modelo intentó cargar un recurso externo bloqueado.');
    }
    return sourceBudget?.tag(resolved) || resolved;
  });
  if (sourceBudget) {
    manager.addHandler(IMAGE_SIDECAR_PATTERN, createBudgetedTextureLoader(manager, sourceBudget, sourceBudget.signal || signal));
  }
  return manager;
}

function createLoadingManagerBarrier(manager, signal, sourceBudget = null) {
  let started = false;
  let settled = false;
  let resolveCompletion;
  let rejectCompletion;
  const previous = {
    onStart: manager.onStart,
    onLoad: manager.onLoad,
    onError: manager.onError
  };
  const completion = new Promise((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  // A parser can fail before it reaches `wait()`. Keep that early rejection
  // observed while preserving the original promise for the normal await path.
  void completion.catch(() => undefined);

  const cleanup = () => {
    signal?.removeEventListener('abort', handleAbort);
    if (manager.onStart === handleStart) manager.onStart = previous.onStart;
    if (manager.onLoad === handleLoad) manager.onLoad = previous.onLoad;
    if (manager.onError === handleError) manager.onError = previous.onError;
  };
  const settle = (callback) => {
    if (settled) return;
    settled = true;
    callback();
  };
  const handleStart = (...args) => {
    started = true;
    previous.onStart?.(...args);
  };
  const handleLoad = (...args) => {
    previous.onLoad?.(...args);
    settle(resolveCompletion);
  };
  const handleError = (url) => {
    previous.onError?.(url);
    settle(() => rejectCompletion(sourceBudget?.failure || new Error('No se pudo cargar un recurso local del modelo.')));
  };
  const handleAbort = () => {
    settle(() => rejectCompletion(new DOMException('La carga se canceló.', 'AbortError')));
  };

  manager.onStart = handleStart;
  manager.onLoad = handleLoad;
  manager.onError = handleError;
  signal?.addEventListener('abort', handleAbort, { once: true });

  return {
    async wait() {
      try {
        // Loader parsers schedule every ImageLoader request synchronously. The
        // microtask lets a parser with no sidecars complete without a timer.
        await Promise.resolve();
        throwIfAborted(signal);
        if (started) await completion;
        if (sourceBudget?.failure) throw sourceBudget.failure;
        throwIfAborted(signal);
      } finally {
        cleanup();
      }
    },
    cancel() {
      settle(resolveCompletion);
      cleanup();
    }
  };
}

async function fetchArrayBuffer(url, onProgress, signal, sourceBudget = null) {
  const effectiveSignal = sourceBudget?.signal || signal;
  throwIfAborted(effectiveSignal);
  const request = {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal: effectiveSignal
  };
  const response = sourceBudget ? await sourceBudget.fetchDirect(url, request) : await fetch(url, request);
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
      throwIfAborted(effectiveSignal);
      const { done, value } = await raceWithAbort(reader.read(), effectiveSignal);
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

function imageMimeTypeForUrl(url) {
  try {
    const pathName = new URL(url).pathname;
    const extension = pathName.slice(pathName.lastIndexOf('.') + 1).toLowerCase();
    return IMAGE_MIME_TYPES[extension] || 'application/octet-stream';
  } catch {
    return 'application/octet-stream';
  }
}

async function decodeBudgetedTextureImage(buffer, url, signal) {
  throwIfAborted(signal);
  const blob = new Blob([buffer], { type: imageMimeTypeForUrl(url) });
  if (typeof globalThis.createImageBitmap === 'function') {
    try {
      return await raceWithAbort(globalThis.createImageBitmap(blob), signal, (image) => {
        if (typeof image?.close === 'function') image.close();
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Some browser-supported formats (notably animated or vector images)
      // are not consistently accepted by createImageBitmap. Keep the regular
      // image-element decode as a local-only fallback.
    }
  }

  if (!globalThis.document?.createElement || typeof URL.createObjectURL !== 'function') {
    throw new Error('No se pudo decodificar una textura local en este entorno.');
  }

  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    let image = null;
    let settled = false;
    let objectUrlRevoked = false;

    const revokeObjectUrl = () => {
      if (objectUrlRevoked) return;
      objectUrlRevoked = true;
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // Revocation is best-effort in older embedded browser runtimes. The
        // image and listeners are still detached below in every terminal path.
      }
    };
    const clearImage = (cancelDecode) => {
      if (!image) return;
      if (image.onload === handleLoad) image.onload = null;
      if (image.onerror === handleError) image.onerror = null;
      if (!cancelDecode) return;
      try {
        // Removing the attribute aborts an in-flight local blob decode without
        // assigning an implicit document URL to the image element.
        if (typeof image.removeAttribute === 'function') image.removeAttribute('src');
        else image.src = '';
      } catch {
        // This is only a release path; the result has already settled and the
        // object URL is revoked independently.
      }
    };
    const cleanup = (cancelDecode = false) => {
      signal?.removeEventListener('abort', handleAbort);
      clearImage(cancelDecode);
      revokeObjectUrl();
    };
    const settle = (callback, cancelDecode = false) => {
      if (settled) return;
      settled = true;
      cleanup(cancelDecode);
      callback();
    };
    const handleLoad = () => settle(() => resolve(image));
    const handleError = () => settle(
      () => reject(new Error('No se pudo decodificar una textura local del modelo.')),
      true
    );
    const handleAbort = () => settle(() => reject(createLoadAbortError()), true);

    try {
      image = globalThis.document.createElement('img');
      image.onload = handleLoad;
      image.onerror = handleError;
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      signal?.addEventListener('abort', handleAbort, { once: true });
      // An AbortSignal may have changed state immediately before the listener
      // was registered. Check once more before the decode can be started.
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      image.src = objectUrl;
    } catch (error) {
      settle(() => reject(error), true);
    }
  });
}

function createBudgetedTextureLoader(manager, sourceBudget, signal) {
  return {
    load(url, onLoad, onProgress, onError) {
      const texture = new THREE.Texture();
      const resolvedUrl = manager.resolveURL(url);
      manager.itemStart(resolvedUrl);
      void (async () => {
        let image = null;
        let delivered = false;
        try {
          // The manager URL is already tagged. Leaving the budget argument out
          // here avoids charging the image request twice.
          const buffer = await fetchArrayBuffer(resolvedUrl, onProgress, signal);
          image = await decodeBudgetedTextureImage(buffer, resolvedUrl, signal);
          throwIfAborted(signal);
          texture.image = image;
          texture.needsUpdate = true;
          onLoad?.(texture);
          delivered = true;
        } catch (error) {
          if (!delivered && image && typeof image.close === 'function') {
            if (texture.image === image) texture.image = null;
            image.close();
          }
          texture.dispose();
          onError?.(sourceBudget.recordFailure(error));
          manager.itemError(resolvedUrl);
        } finally {
          manager.itemEnd(resolvedUrl);
        }
      })();
      return texture;
    },
    setCrossOrigin() {
      return this;
    },
    setRequestHeader() {
      return this;
    }
  };
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

function isAsciiWhitespace(value) {
  return value === 0x09 || value === 0x20;
}

function asciiWordEquals(bytes, start, end, word) {
  if (end - start !== word.length) return false;
  for (let index = 0; index < word.length; index += 1) {
    if (bytes[start + index] !== word.charCodeAt(index)) return false;
  }
  return true;
}

function parsePlyFaceElement(bytes, start, end) {
  let cursor = start;
  while (cursor < end && isAsciiWhitespace(bytes[cursor])) cursor += 1;
  const elementStart = cursor;
  while (cursor < end && !isAsciiWhitespace(bytes[cursor])) cursor += 1;
  if (!asciiWordEquals(bytes, elementStart, cursor, 'element')) return false;

  while (cursor < end && isAsciiWhitespace(bytes[cursor])) cursor += 1;
  const typeStart = cursor;
  while (cursor < end && !isAsciiWhitespace(bytes[cursor])) cursor += 1;
  if (!asciiWordEquals(bytes, typeStart, cursor, 'face')) return false;

  while (cursor < end && isAsciiWhitespace(bytes[cursor])) cursor += 1;
  let faces = 0;
  let digits = 0;
  while (cursor < end && bytes[cursor] >= 0x30 && bytes[cursor] <= 0x39) {
    faces = Math.min(Number.MAX_SAFE_INTEGER, faces * 10 + bytes[cursor] - 0x30);
    digits += 1;
    cursor += 1;
  }
  return digits > 0 && faces > 0;
}

function plyHasFaces(buffer) {
  const bytes = new Uint8Array(buffer);
  let lineStart = 0;
  for (let cursor = 0; cursor <= bytes.length; cursor += 1) {
    if (cursor !== bytes.length && bytes[cursor] !== 0x0a && bytes[cursor] !== 0x0d) continue;
    let lineEnd = cursor;
    while (lineEnd > lineStart && isAsciiWhitespace(bytes[lineEnd - 1])) lineEnd -= 1;
    let first = lineStart;
    while (first < lineEnd && isAsciiWhitespace(bytes[first])) first += 1;
    if (asciiWordEquals(bytes, first, lineEnd, 'end_header')) return false;
    if (parsePlyFaceElement(bytes, first, lineEnd)) return true;
    if (bytes[cursor] === 0x0d && bytes[cursor + 1] === 0x0a) cursor += 1;
    lineStart = cursor + 1;
  }
  throw new Error('La cabecera PLY está incompleta.');
}

async function loadGltf(url, onProgress, { renderer, signal, sourceBudget }) {
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
  const manager = createLocalLoadingManager(baseUrl, [dracoRoot, basisRoot], sourceBudget, signal);
  const dracoLoader = new DRACOLoader(manager).setDecoderPath(dracoRoot);
  dracoLoader.setDecoderConfig({ type: 'wasm' });
  const ktx2Loader = configureKtx2StaticWorker(
    new KTX2Loader(manager).setTranscoderPath(basisRoot),
    basisRoot,
  );
  if (renderer) ktx2Loader.detectSupport(renderer);

  const loader = new GLTFLoader(manager)
    .setDRACOLoader(dracoLoader)
    .setMeshoptDecoder(MeshoptDecoder);
  if (renderer) loader.setKTX2Loader(ktx2Loader);

  const sidecars = createLoadingManagerBarrier(manager, sourceBudget.signal, sourceBudget);
  let gltf;
  try {
    const buffer = await fetchArrayBuffer(url, onProgress, signal, sourceBudget);
    throwIfAborted(signal);
    gltf = await raceWithAbort(loader.parseAsync(buffer, baseUrl), sourceBudget.signal);
    await sidecars.wait();
    return gltf;
  } catch (error) {
    sidecars.cancel();
    if (gltf?.scene) disposeModelResources(gltf.scene);
    throw sourceBudget?.failure || error;
  } finally {
    dracoLoader.dispose();
    ktx2Loader.dispose();
  }
}

async function loadObj(url, onProgress, signal, sourceBudget) {
  const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
    import('three/examples/jsm/loaders/OBJLoader.js'),
    import('three/examples/jsm/loaders/MTLLoader.js')
  ]);
  const baseUrl = getBaseUrl(url);
  const manager = createLocalLoadingManager(baseUrl, [], sourceBudget, signal);
  const text = new TextDecoder().decode(await fetchArrayBuffer(url, onProgress, signal, sourceBudget));
  throwIfAborted(signal);

  const loader = new OBJLoader(manager);
  const mtlReferences = extractMtlReferences(text);
  if (mtlReferences.length > 0) {
    const materialCreators = [];
    for (const mtlReference of mtlReferences) {
      const mtlUrl = new URL(mtlReference.split('/').map(encodeURIComponent).join('/'), baseUrl).href;
      let mtlText;
      try {
        mtlText = new TextDecoder().decode(await fetchArrayBuffer(mtlUrl, undefined, signal, sourceBudget));
      } catch (error) {
        if (error instanceof ModelBudgetError) throw error;
        if (error?.name === 'AbortError') throw error;
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

  const sidecars = createLoadingManagerBarrier(manager, sourceBudget.signal, sourceBudget);
  let object;
  try {
    object = loader.parse(text);
    await sidecars.wait();
    return object;
  } catch (error) {
    sidecars.cancel();
    if (object) disposeModelResources(object);
    throw error;
  }
}

async function loadStl(url, fileName, onProgress, signal, sourceBudget) {
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
  const geometry = new STLLoader().parse(await fetchArrayBuffer(url, onProgress, signal, sourceBudget));
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

async function loadFbx(url, onProgress, signal, sourceBudget) {
  const [{ FBXLoader }, { TGALoader }] = await Promise.all([
    import('three/examples/jsm/loaders/FBXLoader.js'),
    import('three/examples/jsm/loaders/TGALoader.js')
  ]);
  const baseUrl = getBaseUrl(url);
  const manager = createLocalLoadingManager(baseUrl, [], sourceBudget, signal);
  manager.addHandler(/\.tga$/i, new TGALoader(manager));
  const buffer = await fetchArrayBuffer(url, onProgress, signal, sourceBudget);
  const sidecars = createLoadingManagerBarrier(manager, sourceBudget.signal, sourceBudget);
  let group;
  try {
    group = new FBXLoader(manager).parse(buffer, baseUrl);
    await sidecars.wait();
    return { group, animations: group.animations || [] };
  } catch (error) {
    sidecars.cancel();
    if (group) disposeModelResources(group);
    throw sourceBudget?.failure || error;
  }
}

async function loadPly(url, fileName, onProgress, signal, sourceBudget) {
  const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
  const buffer = await fetchArrayBuffer(url, onProgress, signal, sourceBudget);
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

async function loadDae(url, onProgress, signal, sourceBudget) {
  const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
  const baseUrl = getBaseUrl(url);
  const manager = createLocalLoadingManager(baseUrl, [], sourceBudget, signal);
  const text = new TextDecoder().decode(await fetchArrayBuffer(url, onProgress, signal, sourceBudget));
  const sidecars = createLoadingManagerBarrier(manager, sourceBudget.signal, sourceBudget);
  let collada;
  try {
    collada = new ColladaLoader(manager).parse(text, baseUrl);
    await sidecars.wait();
    return collada;
  } catch (error) {
    sidecars.cancel();
    if (collada?.scene) disposeModelResources(collada.scene);
    throw sourceBudget?.failure || error;
  }
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
    const instanceMultiplier = object.isInstancedMesh ? Math.max(0, Number(object.count) || 0) : 1;
    if (object.isMesh || object.isPoints || object.isLine) vertices += positionCount * instanceMultiplier;
    if (object.isMesh) {
      meshes += 1;
      const primitiveTriangles = object.geometry?.index ? object.geometry.index.count / 3 : positionCount / 3;
      triangles += primitiveTriangles * instanceMultiplier;
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
  const sourceBudget = new ModelSourceBudget(budget, signal);
  let sceneGroup = null;
  let animations = [];
  let metadata = { scenes: 1, cameras: 0 };

  try {
    switch (ext) {
      case 'glb':
      case 'gltf': {
        const gltf = await loadGltf(url, onProgress, { renderer, signal, sourceBudget });
        sceneGroup = gltf.scene || gltf.scenes?.[0];
        animations = gltf.animations || [];
        metadata = { scenes: gltf.scenes?.length || 1, cameras: gltf.cameras?.length || 0 };
        break;
      }
      case 'obj':
        sceneGroup = await loadObj(url, onProgress, signal, sourceBudget);
        break;
      case 'stl':
        sceneGroup = await loadStl(url, fileName, onProgress, signal, sourceBudget);
        break;
      case 'fbx': {
        const result = await loadFbx(url, onProgress, signal, sourceBudget);
        sceneGroup = result.group;
        animations = result.animations;
        break;
      }
      case 'ply':
        sceneGroup = await loadPly(url, fileName, onProgress, signal, sourceBudget);
        break;
      case 'dae': {
        const collada = await loadDae(url, onProgress, signal, sourceBudget);
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
  } finally {
    sourceBudget.dispose();
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
    hierarchy: buildHierarchyTree(rootObject, DEFAULT_HIERARCHY_LIMITS)
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
