import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPathInside, isSupportedModelPath } from './security.js';

const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_ASSET_PROBE_BYTES = 64 * 1024;
const MAX_FIXTURE_PATHS = 12;
const MAX_REJECTION_FIXTURE_PATHS = 12;
const MAX_LOADER_REJECTION_FIXTURE_PATHS = 4;
const MODEL_LOAD_TIMEOUT_MS = 20_000;
const TEMP_CONFIG_PATTERN = /^nexoip-packaged-self-test-[a-f0-9]+\.json$/;
const TEMP_RESULT_PATTERN = /^result-[a-f0-9]+\.json$/;
const TEMP_SCREENSHOT_PATTERN = /^screenshot-[a-f0-9]+\.png$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024;
const MAX_SCREENSHOT_DIMENSION = 8_192;
const MAX_SCREENSHOT_PIXELS = 16_777_216;
const ACCESSIBILITY_TEST_WINDOW = Object.freeze({ width: 900, height: 600 });
const ACCESSIBILITY_TEST_ZOOM_FACTOR = 2;
const ACCESSIBILITY_EVIDENCE_SCOPE = Object.freeze({
  claim: 'targeted packaged accessibility and responsive evidence',
  limitations: 'This verifies the listed packaged DOM, keyboard, zoom, and viewport invariants only; it is not a complete WCAG conformance evaluation.',
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function readBoundedUtf8(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('The packaged self-test configuration is invalid.');

    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_CONFIG_BYTES) throw new Error('The packaged self-test configuration is invalid.');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function canonicalTemporaryConfigPath(configPath) {
  if (typeof configPath !== 'string' || !path.isAbsolute(configPath)) {
    throw new Error('The packaged self-test configuration path is invalid.');
  }

  const [temporaryDirectory, realConfigPath] = await Promise.all([
    fs.promises.realpath(os.tmpdir()),
    fs.promises.realpath(configPath),
  ]);
  if (!isPathInside(temporaryDirectory, realConfigPath) || !TEMP_CONFIG_PATTERN.test(path.basename(realConfigPath))) {
    throw new Error('The packaged self-test configuration must be a temporary capability file.');
  }
  return realConfigPath;
}

async function validateConfig(config, configPath, expectedDigest) {
  const hasScreenshotPath = Object.hasOwn(config || {}, 'screenshotPath');
  const rejectedFixturePaths = config?.rejectedFixturePaths ?? [];
  const loaderRejectionFixturePaths = config?.loaderRejectionFixturePaths ?? [];
  if (!isPlainObject(config)
    || config.version !== 2
    || typeof config.token !== 'string'
    || !/^[a-f0-9]{64}$/i.test(config.token)
    || !Array.isArray(config.fixturePaths)
    || config.fixturePaths.length === 0
    || config.fixturePaths.length > MAX_FIXTURE_PATHS
    || config.fixturePaths.some((fixturePath) => typeof fixturePath !== 'string'
      || !path.isAbsolute(fixturePath)
      || !isSupportedModelPath(fixturePath))
    || !Array.isArray(rejectedFixturePaths)
    || rejectedFixturePaths.length > MAX_REJECTION_FIXTURE_PATHS
    || rejectedFixturePaths.some((fixturePath) => typeof fixturePath !== 'string'
      || !path.isAbsolute(fixturePath)
      || !isSupportedModelPath(fixturePath))
    || !Array.isArray(loaderRejectionFixturePaths)
    || loaderRejectionFixturePaths.length > MAX_LOADER_REJECTION_FIXTURE_PATHS
    || loaderRejectionFixturePaths.some((fixturePath) => typeof fixturePath !== 'string'
      || !path.isAbsolute(fixturePath)
      || !isSupportedModelPath(fixturePath))
    || typeof config.resultPath !== 'string'
    || !path.isAbsolute(config.resultPath)
    || !TEMP_RESULT_PATTERN.test(path.basename(config.resultPath))
    || (hasScreenshotPath && (typeof config.screenshotPath !== 'string'
      || !path.isAbsolute(config.screenshotPath)
      || !TEMP_SCREENSHOT_PATTERN.test(path.basename(config.screenshotPath))
      || hasPathTraversalSegment(config.screenshotPath)))
    || typeof expectedDigest !== 'string'
    || !/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    throw new Error('The packaged self-test configuration is invalid.');
  }

  let configDirectory;
  let resultDirectory;
  let screenshotDirectory;
  let fixturePaths;
  let canonicalRejectedFixturePaths;
  let canonicalLoaderRejectionFixturePaths;
  try {
    [
      configDirectory,
      resultDirectory,
      fixturePaths,
      canonicalRejectedFixturePaths,
      canonicalLoaderRejectionFixturePaths,
    ] = await Promise.all([
      fs.promises.realpath(path.dirname(configPath)),
      fs.promises.realpath(path.dirname(config.resultPath)),
      Promise.all(config.fixturePaths.map((fixturePath) => fs.promises.realpath(fixturePath))),
      Promise.all(rejectedFixturePaths.map((fixturePath) => fs.promises.realpath(fixturePath))),
      Promise.all(loaderRejectionFixturePaths.map((fixturePath) => fs.promises.realpath(fixturePath))),
    ]);
    if (hasScreenshotPath) {
      screenshotDirectory = await fs.promises.realpath(path.dirname(config.screenshotPath));
    }
  } catch {
    throw new Error('The packaged self-test configuration is invalid.');
  }
  if (path.relative(configDirectory, resultDirectory) !== ''
    || (hasScreenshotPath && path.relative(configDirectory, screenshotDirectory) !== '')) {
    throw new Error('The packaged self-test configuration is invalid.');
  }

  const allFixturePaths = [
    ...fixturePaths,
    ...canonicalRejectedFixturePaths,
    ...canonicalLoaderRejectionFixturePaths,
  ];
  const uniqueFixturePaths = new Set(allFixturePaths.map((fixturePath) => (
    process.platform === 'win32' ? fixturePath.toLowerCase() : fixturePath
  )));
  if (uniqueFixturePaths.size !== allFixturePaths.length) {
    throw new Error('The packaged self-test configuration is invalid.');
  }

  const suppliedDigest = Buffer.from(sha256(config.token), 'hex');
  const expectedDigestBuffer = Buffer.from(expectedDigest, 'hex');
  if (suppliedDigest.length !== expectedDigestBuffer.length || !timingSafeEqual(suppliedDigest, expectedDigestBuffer)) {
    throw new Error('The packaged self-test capability check failed.');
  }

  return {
    fixturePaths,
    rejectedFixturePaths: canonicalRejectedFixturePaths,
    loaderRejectionFixturePaths: canonicalLoaderRejectionFixturePaths,
    resultPath: path.join(resultDirectory, path.basename(config.resultPath)),
    screenshotPath: hasScreenshotPath
      ? path.join(screenshotDirectory, path.basename(config.screenshotPath))
      : undefined,
  };
}

function hasPathTraversalSegment(filePath) {
  const root = path.parse(filePath).root;
  return filePath.slice(root.length).split(/[\\/]+/).some((segment) => segment === '.' || segment === '..');
}

function assertCapturedPng(nativeImage) {
  if (!nativeImage
    || typeof nativeImage.isEmpty !== 'function'
    || typeof nativeImage.getSize !== 'function'
    || typeof nativeImage.toPNG !== 'function') {
    throw new Error('The packaged self-test screenshot capture is unavailable.');
  }

  let empty;
  let size;
  let png;
  try {
    empty = nativeImage.isEmpty();
    size = nativeImage.getSize();
    png = nativeImage.toPNG();
  } catch {
    throw new Error('The packaged self-test screenshot capture is invalid.');
  }
  if (empty !== false) {
    throw new Error('The packaged self-test screenshot capture is empty.');
  }
  if (!size
    || !Number.isSafeInteger(size.width)
    || !Number.isSafeInteger(size.height)
    || size.width <= 0
    || size.height <= 0
    || size.width > MAX_SCREENSHOT_DIMENSION
    || size.height > MAX_SCREENSHOT_DIMENSION
    || size.width * size.height > MAX_SCREENSHOT_PIXELS
    || (!Buffer.isBuffer(png) && !ArrayBuffer.isView(png))) {
    throw new Error('The packaged self-test screenshot capture is invalid.');
  }

  const bytes = Buffer.from(png);
  if (bytes.length < PNG_SIGNATURE.length
    || bytes.length > MAX_SCREENSHOT_BYTES
    || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('The packaged self-test screenshot capture is invalid.');
  }
  return { bytes, width: size.width, height: size.height };
}

async function writeCapturedPng(screenshotPath, bytes) {
  const directory = path.dirname(screenshotPath);
  const filename = path.basename(screenshotPath);
  if (!TEMP_SCREENSHOT_PATTERN.test(filename)
    || path.join(directory, filename) !== screenshotPath) {
    throw new Error('The packaged self-test screenshot path is invalid.');
  }

  const temporaryPath = path.join(directory, `.${filename}.${randomBytes(8).toString('hex')}.tmp`);
  try {
    await fs.promises.writeFile(temporaryPath, bytes, { mode: 0o600, flag: 'wx' });
    await fs.promises.rename(temporaryPath, screenshotPath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function capturePackagedSelfTestScreenshot(renderer, screenshotPath) {
  if (typeof renderer?.capturePage !== 'function') {
    throw new Error('The packaged self-test screenshot capture is unavailable.');
  }

  let nativeImage;
  try {
    nativeImage = await renderer.capturePage();
  } catch {
    throw new Error('The packaged self-test screenshot capture failed.');
  }
  const capture = assertCapturedPng(nativeImage);
  try {
    await writeCapturedPng(screenshotPath, capture.bytes);
  } catch {
    throw new Error('The packaged self-test screenshot capture could not be written.');
  }
  return {
    filename: path.basename(screenshotPath),
    width: capture.width,
    height: capture.height,
    bytes: capture.bytes.length,
  };
}

async function readAssetPrefix(stream) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const boundedChunk = Buffer.from(chunk).subarray(0, MAX_ASSET_PROBE_BYTES - total);
    chunks.push(boundedChunk);
    total += boundedChunk.length;
    if (total >= MAX_ASSET_PROBE_BYTES) {
      stream.destroy();
      break;
    }
  }
  return Buffer.concat(chunks, total);
}

function sanitizeRendererDiagnostic(value) {
  return String(value || '')
    .replace(/(?:https?|nexoip|blob|file):[^\s"'<>]+/gi, '[url]')
    .replace(/[a-z]:[\\/][^\s"'<>]+/gi, '[local-path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function probeRendererModelLoad(renderer, model, expectedSize, { prepareScreenshotFrame = false } = {}) {
  if (typeof renderer?.send !== 'function' || typeof renderer?.executeJavaScript !== 'function') {
    throw new Error('The packaged self-test cannot dispatch and observe a real model load.');
  }

  const consoleDiagnostics = [];
  const handleConsoleMessage = (...args) => {
    const message = typeof args[0]?.message === 'string' ? args[0].message : args[2];
    const sanitized = sanitizeRendererDiagnostic(message);
    if (sanitized && !consoleDiagnostics.includes(sanitized)) {
      consoleDiagnostics.push(sanitized);
      if (consoleDiagnostics.length > 4) consoleDiagnostics.shift();
    }
  };
  renderer.on?.('console-message', handleConsoleMessage);

  let result;
  try {
    renderer.send('nexoip:model-opened', model);
    result = await renderer.executeJavaScript(`(async () => {
    const expectedModelId = ${JSON.stringify(model.id)};
    const expectedSize = ${JSON.stringify(expectedSize)};
    const timeoutMs = ${MODEL_LOAD_TIMEOUT_MS};
    const prepareScreenshotFrame = ${JSON.stringify(prepareScreenshotFrame)};
    const bridgeAvailable = Boolean(window.nexoip)
      && typeof window.nexoip.getCatalogPage === 'function'
      && typeof window.nexoip.getModelUrl === 'function';
    if (!bridgeAvailable) throw new Error('The packaged preload bridge is unavailable during a model load.');

    const catalogPage = await window.nexoip.getCatalogPage({
      filters: { query: ${JSON.stringify(model.name)}, sortBy: 'name', order: 'asc' },
      limit: 100,
    });
    const model = Array.isArray(catalogPage?.items)
      ? catalogPage.items.find((item) => item.id === expectedModelId)
      : null;
    if (!model) throw new Error('The registered model is missing from the packaged library.');

    const modelResponse = await fetch(window.nexoip.getModelUrl(expectedModelId), { cache: 'no-store' });
    const modelBytes = modelResponse.ok ? (await modelResponse.arrayBuffer()).byteLength : 0;
    if (modelBytes !== expectedSize) {
      throw new Error('The private model protocol did not return the complete approved model.');
    }

    const deadline = performance.now() + timeoutMs;
    let dialogOpened = false;
    while (performance.now() < deadline) {
      const openDialog = document.querySelector('dialog[open]');
      if (openDialog) {
        dialogOpened = true;
        break;
      }

      const main = document.querySelector('main');
      if (main?.getAttribute('data-loaded-model-id') === expectedModelId) {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (document.querySelector('dialog[open]')) {
          throw new Error('The packaged renderer opened an error dialog after publishing its loaded-model marker.');
        }
        if (document.querySelector('main')?.getAttribute('data-loaded-model-id') !== expectedModelId) {
          throw new Error('The packaged renderer changed its loaded-model marker before the scene settled.');
        }
        const transientLoadStatusVisible = Array.from(document.querySelectorAll('[role="status"]'))
          .some((element) => element.textContent?.includes('Cargando'));
        if (transientLoadStatusVisible) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        let screenshotFrame;
        if (prepareScreenshotFrame) {
          const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const getAction = (label) => Array.from(document.querySelectorAll('button')).find((element) => element.getAttribute('aria-label') === label);
          if (document.querySelector('aside[aria-label="Biblioteca de modelos locales"]')) {
            const closeLibrary = getAction('Cerrar biblioteca de modelos') || getAction('Cerrar biblioteca');
            if (!(closeLibrary instanceof HTMLButtonElement)) {
              throw new Error('The packaged screenshot frame could not close the normal library panel.');
            }
            closeLibrary.click();
          }
          if (!document.querySelector('aside[aria-label="Propiedades del modelo"]')) {
            const openInspector = getAction('Abrir propiedades del modelo');
            if (!(openInspector instanceof HTMLButtonElement)) {
              throw new Error('The packaged screenshot frame could not open the normal properties panel.');
            }
            openInspector.click();
          }
          await nextFrame();
          if (document.querySelector('aside[aria-label="Biblioteca de modelos locales"]')
            || !document.querySelector('aside[aria-label="Propiedades del modelo"]')) {
            throw new Error('The packaged screenshot frame did not settle in its clean visual state.');
          }
          screenshotFrame = { libraryClosed: true, inspectorVisible: true };
        }
        const canvas = document.querySelector('[data-viewport-controls] canvas');
        let context = null;
        let webglContext = null;
        if (canvas instanceof HTMLCanvasElement) {
          try {
            context = canvas.getContext('webgl2');
            webglContext = context ? 'webgl2' : null;
            if (!context) {
              context = canvas.getContext('webgl');
              webglContext = context ? 'webgl' : null;
            }
          } catch {
            context = null;
          }
        }
        const contextLost = typeof context?.isContextLost === 'function' ? context.isContextLost() : true;
        return {
          bridgeAvailable,
          modelBytes,
          eventDispatches: 1,
          exactModelMarker: true,
          canvas: {
            present: canvas instanceof HTMLCanvasElement,
            width: canvas instanceof HTMLCanvasElement ? canvas.width : 0,
            height: canvas instanceof HTMLCanvasElement ? canvas.height : 0,
          },
          webglContext,
          contextLost,
          dialogOpened,
          screenshotFrame,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (dialogOpened) throw new Error('The packaged renderer opened an error dialog while loading a format fixture.');
    const probeWorkerRuntime = async () => {
      let worker;
      let workerUrl;
      try {
        const source = [
          'self.onmessage = async () => {',
          '  try {',
          '    await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));',
          '    let dynamicCode = "blocked";',
          '    try { dynamicCode = new Function("return 1")() === 1 ? "ok" : "unexpected"; } catch (_) {}',
          '    self.postMessage({ status: "ok", dynamicCode });',
          '  } catch (error) {',
          '    self.postMessage({ status: "error", name: error && error.name ? error.name : "Error" });',
          '  }',
          '};'
        ].join('\\n');
        workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        worker = new Worker(workerUrl);
        return await Promise.race([
          new Promise((resolve) => {
            worker.onmessage = (event) => resolve(event.data?.status === 'ok'
              ? 'wasm:ok,dynamic:' + (event.data?.dynamicCode || 'unknown')
              : 'error:' + (event.data?.name || 'Error'));
            worker.onerror = (event) => {
              event.preventDefault();
              resolve('error:WorkerError');
            };
            worker.postMessage(null);
          }),
          new Promise((resolve) => setTimeout(() => resolve('timeout'), 1_000))
        ]);
      } catch (error) {
        return 'error:' + (error && error.name ? error.name : 'Error');
      } finally {
        worker?.terminate();
        if (workerUrl) URL.revokeObjectURL(workerUrl);
      }
    };
    const workerRuntime = await probeWorkerRuntime();
    const observedMarker = document.querySelector('main')?.getAttribute('data-loaded-model-id');
    const loadingIndicator = Array.from(document.querySelectorAll('[role="status"]'))
      .some((element) => element.textContent?.includes('Cargando objeto 3D'));
    const selectedModel = Boolean(document.querySelector('button[aria-current="true"]'));
    const canvasPresent = document.querySelector('[data-viewport-controls] canvas') instanceof HTMLCanvasElement;
    throw new Error(
      'The packaged renderer timed out before publishing the exact loaded-model marker '
      + '(selected=' + selectedModel
      + ', loading=' + loadingIndicator
      + ', canvas=' + canvasPresent
      + ', workerWasm=' + workerRuntime
      + ', marker=' + (observedMarker ? 'different' : 'missing') + ').'
    );
    })()`);
  } catch (error) {
    const message = sanitizeRendererDiagnostic(error instanceof Error ? error.message : error);
    const consoleSummary = consoleDiagnostics.length > 0
      ? ` Renderer console: ${consoleDiagnostics.join(' | ')}`
      : '';
    throw new Error(`${message || 'The packaged renderer probe failed.'}${consoleSummary}`, { cause: error });
  } finally {
    renderer.off?.('console-message', handleConsoleMessage);
  }

  const valid = result?.bridgeAvailable === true
    && result.modelBytes === expectedSize
    && result.eventDispatches === 1
    && result.exactModelMarker === true
    && result.canvas?.present === true
    && Number.isSafeInteger(result.canvas.width) && result.canvas.width > 0
    && Number.isSafeInteger(result.canvas.height) && result.canvas.height > 0
    && (result.webglContext === 'webgl2' || result.webglContext === 'webgl')
    && result.contextLost === false
    && result.dialogOpened === false;
  if (!valid) {
    throw new Error('The packaged renderer did not provide complete evidence for a real model load.');
  }
  return result;
}

async function probeRendererStaleLoadCancellation(renderer, delayedModel, winningModel) {
  if (typeof renderer?.send !== 'function' || typeof renderer?.executeJavaScript !== 'function') {
    throw new Error('The packaged self-test cannot exercise stale model-load cancellation.');
  }

  let delayInstalled = false;
  try {
    delayInstalled = await renderer.executeJavaScript(`(() => {
      if (!window.nexoip || typeof window.nexoip.getModelUrl !== 'function') return false;
      const delayedUrl = window.nexoip.getModelUrl(${JSON.stringify(delayedModel.id)});
      const originalFetch = window.fetch;
      if (typeof delayedUrl !== 'string' || typeof originalFetch !== 'function') return false;
      const state = {
        intercepted: false,
        released: false,
        release: null,
        cleanup() {
          window.fetch = originalFetch;
          delete window.__nexoipPackagedSwitchProbe;
        },
      };
      window.__nexoipPackagedSwitchProbe = state;
      window.fetch = function packagedStaleLoadFetch(input, init) {
        const requestUrl = typeof input === 'string' ? input : input?.url;
        if (!state.intercepted && requestUrl === delayedUrl) {
          state.intercepted = true;
          return new Promise((resolve, reject) => {
            state.release = () => {
              if (state.released) return;
              state.released = true;
              Reflect.apply(originalFetch, window, [input, init]).then(resolve, reject);
            };
          });
        }
        return Reflect.apply(originalFetch, window, [input, init]);
      };
      return true;
    })()`);
    if (delayInstalled !== true) {
      throw new Error('The packaged stale-load delay could not be installed.');
    }

    renderer.send('nexoip:model-opened', delayedModel);
    const intercepted = await renderer.executeJavaScript(`(async () => {
      const deadline = performance.now() + ${MODEL_LOAD_TIMEOUT_MS};
      while (performance.now() < deadline) {
        if (window.__nexoipPackagedSwitchProbe?.intercepted === true) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    })()`);
    if (intercepted !== true) {
      throw new Error('The packaged stale model load did not reach its controlled fetch delay.');
    }

    renderer.send('nexoip:model-opened', winningModel);
    const result = await renderer.executeJavaScript(`(async () => {
      const expectedModelId = ${JSON.stringify(winningModel.id)};
      const deadline = performance.now() + ${MODEL_LOAD_TIMEOUT_MS};
      let winningModelLoaded = false;
      while (performance.now() < deadline) {
        const container = document.querySelector('[data-viewport-controls]');
        winningModelLoaded = container?.dataset?.loadedModelId === expectedModelId
          && container?.dataset?.loadedRendererGeneration === container?.dataset?.rendererGeneration
          && document.querySelector('main')?.getAttribute('data-loaded-model-id') === expectedModelId
          && !Array.from(document.querySelectorAll('[role="status"]'))
            .some((element) => element.textContent?.includes('Cargando objeto 3D'));
        if (winningModelLoaded) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const state = window.__nexoipPackagedSwitchProbe;
      const delayedRequestObserved = state?.intercepted === true;
      const delayedRequestReleased = typeof state?.release === 'function';
      state?.release?.();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const container = document.querySelector('[data-viewport-controls]');
      const canvas = container?.querySelector('canvas');
      let context = null;
      if (canvas instanceof HTMLCanvasElement) {
        try {
          context = canvas.getContext('webgl2') || canvas.getContext('webgl');
        } catch {
          context = null;
        }
      }
      const winningModelRemained = container?.dataset?.loadedModelId === expectedModelId
        && container?.dataset?.loadedRendererGeneration === container?.dataset?.rendererGeneration
        && document.querySelector('main')?.getAttribute('data-loaded-model-id') === expectedModelId;
      const loadingSettled = !Array.from(document.querySelectorAll('[role="status"]'))
        .some((element) => element.textContent?.includes('Cargando objeto 3D'));
      const dialogClosed = !document.querySelector('dialog[open]');
      const contextHealthy = Boolean(context)
        && (typeof context.isContextLost !== 'function' || context.isContextLost() === false);
      state?.cleanup?.();
      return {
        delayInstalled: true,
        delayedRequestObserved,
        winningModelLoaded,
        delayedRequestReleased,
        winningModelRemained,
        loadingSettled,
        dialogClosed,
        contextHealthy,
      };
    })()`);

    const valid = result?.delayInstalled === true
      && result.delayedRequestObserved === true
      && result.winningModelLoaded === true
      && result.delayedRequestReleased === true
      && result.winningModelRemained === true
      && result.loadingSettled === true
      && result.dialogClosed === true
      && result.contextHealthy === true;
    if (!valid) {
      throw new Error('The packaged renderer did not provide complete stale-load cancellation evidence.');
    }
    return result;
  } catch (error) {
    if (delayInstalled) {
      await renderer.executeJavaScript(`(() => {
        window.__nexoipPackagedSwitchProbe?.release?.();
        window.__nexoipPackagedSwitchProbe?.cleanup?.();
      })()`).catch(() => undefined);
    }
    const message = sanitizeRendererDiagnostic(error instanceof Error ? error.message : error);
    throw new Error(message || 'The packaged stale-load cancellation probe failed.', { cause: error });
  }
}

async function probeRendererContextRecovery(renderer, model) {
  if (typeof renderer?.executeJavaScript !== 'function') {
    throw new Error('The packaged self-test cannot exercise WebGL recovery.');
  }

  let result;
  try {
    result = await renderer.executeJavaScript(`(async () => {
    const expectedModelId = ${JSON.stringify(model.id)};
    const timeoutMs = ${MODEL_LOAD_TIMEOUT_MS};
    const container = document.querySelector('[data-viewport-controls]');
    const previousCanvas = container?.querySelector('canvas');
    const previousGeneration = container?.dataset?.rendererGeneration;
    if (!(previousCanvas instanceof HTMLCanvasElement) || previousGeneration === undefined) {
      throw new Error('The packaged WebGL recovery probe has no active renderer generation.');
    }

    const lossEvent = new Event('webglcontextlost', { cancelable: true });
    const lossWasNotCancelled = previousCanvas.dispatchEvent(lossEvent);
    const lossDeadline = performance.now() + timeoutMs;
    let lossDialogVisible = false;
    let recoveryActionVisible = false;
    while (performance.now() < lossDeadline) {
      const dialog = document.querySelector('dialog[open][aria-labelledby="model-error-title"]');
      const title = document.getElementById('model-error-title')?.textContent?.trim();
      const recover = Array.from(dialog?.querySelectorAll('button') || [])
        .find((button) => button.textContent?.trim() === 'Recuperar vista');
      lossDialogVisible = dialog instanceof HTMLDialogElement
        && title === 'No se pudo iniciar la vista 3D';
      recoveryActionVisible = recover instanceof HTMLButtonElement;
      if (lossDialogVisible && recoveryActionVisible) {
        recover.click();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!lossDialogVisible || !recoveryActionVisible) {
      throw new Error('The packaged renderer did not expose its WebGL recovery action.');
    }

    const recoveryDeadline = performance.now() + timeoutMs;
    while (performance.now() < recoveryDeadline) {
      const nextContainer = document.querySelector('[data-viewport-controls]');
      const nextCanvas = nextContainer?.querySelector('canvas');
      const nextGeneration = nextContainer?.dataset?.rendererGeneration;
      const generationAdvanced = nextGeneration !== undefined && nextGeneration !== previousGeneration;
      const canvasReplaced = nextCanvas instanceof HTMLCanvasElement && nextCanvas !== previousCanvas;
      const modelReloaded = nextContainer?.dataset?.loadedModelId === expectedModelId
        && nextContainer?.dataset?.loadedRendererGeneration === nextGeneration
        && document.querySelector('main')?.getAttribute('data-loaded-model-id') === expectedModelId;
      const loadingSettled = !Array.from(document.querySelectorAll('[role="status"]'))
        .some((element) => element.textContent?.includes('Cargando objeto 3D'));
      const dialogClosed = !document.querySelector('dialog[open][aria-labelledby="model-error-title"]');
      let contextHealthy = false;
      if (nextCanvas instanceof HTMLCanvasElement) {
        let context = null;
        try {
          context = nextCanvas.getContext('webgl2') || nextCanvas.getContext('webgl');
        } catch {
          context = null;
        }
        contextHealthy = Boolean(context)
          && (typeof context.isContextLost !== 'function' || context.isContextLost() === false);
      }
      if (generationAdvanced
        && canvasReplaced
        && modelReloaded
        && loadingSettled
        && dialogClosed
        && contextHealthy) {
        return {
          lossEventPrevented: lossWasNotCancelled === false,
          lossDialogVisible,
          recoveryActionVisible,
          generationAdvanced,
          canvasReplaced,
          modelReloaded,
          loadingSettled,
          dialogClosed,
          contextHealthy,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The packaged renderer did not recover a healthy WebGL generation in time.');
    })()`);
  } catch (error) {
    const message = sanitizeRendererDiagnostic(error instanceof Error ? error.message : error);
    throw new Error(message || 'The packaged WebGL recovery probe failed.', { cause: error });
  }

  const valid = result?.lossEventPrevented === true
    && result.lossDialogVisible === true
    && result.recoveryActionVisible === true
    && result.generationAdvanced === true
    && result.canvasReplaced === true
    && result.modelReloaded === true
    && result.loadingSettled === true
    && result.dialogClosed === true
    && result.contextHealthy === true;
  if (!valid) {
    throw new Error('The packaged renderer did not provide complete WebGL recovery evidence.');
  }
  return result;
}

async function probeRendererModelRejection(renderer, model, expectedSize) {
  if (typeof renderer?.send !== 'function' || typeof renderer?.executeJavaScript !== 'function') {
    throw new Error('The packaged self-test cannot dispatch and observe a rejected model load.');
  }

  renderer.send('nexoip:model-opened', model);
  let result;
  try {
    result = await renderer.executeJavaScript(`(async () => {
    const bridgeAvailable = Boolean(window.nexoip)
      && typeof window.nexoip.getCatalogPage === 'function'
      && typeof window.nexoip.getModelUrl === 'function';
    if (!bridgeAvailable) throw new Error('The packaged preload bridge was not available for the rejection probe.');
    const expectedModelId = ${JSON.stringify(model.id)};
    const expectedSize = ${JSON.stringify(expectedSize)};
    const deadline = performance.now() + ${MODEL_LOAD_TIMEOUT_MS};
    const catalogPage = await window.nexoip.getCatalogPage({
      filters: { query: ${JSON.stringify(model.name)}, sortBy: 'name', order: 'asc' },
      limit: 100,
    });
    const registered = Array.isArray(catalogPage?.items)
      && catalogPage.items.some((item) => item.id === expectedModelId);
    if (!registered) throw new Error('The loader-rejection fixture is missing from the packaged library.');

    const modelResponse = await fetch(window.nexoip.getModelUrl(expectedModelId), { cache: 'no-store' });
    const modelBytes = modelResponse.ok ? (await modelResponse.arrayBuffer()).byteLength : 0;
    if (modelBytes !== expectedSize) {
      throw new Error('The private model protocol did not return the complete loader-rejection fixture.');
    }

    while (performance.now() < deadline) {
      const dialog = document.querySelector('dialog[open][aria-labelledby="model-error-title"]');
      if (dialog instanceof HTMLDialogElement) {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const title = document.getElementById('model-error-title')?.textContent?.trim() || '';
        const description = document.getElementById('model-error-description')?.textContent?.trim() || '';
        const failedMarkerAbsent = document.querySelector('main')?.getAttribute('data-loaded-model-id') !== expectedModelId;
        const loadingSettled = !Array.from(document.querySelectorAll('[role="status"]'))
          .some((element) => element.textContent?.includes('Cargando objeto 3D'));
        const safeErrorMessage = title === 'No se pudo abrir el archivo 3D'
          && description.startsWith('No se pudo cargar el material OBJ')
          && !/(?:file|nexoip):/i.test(description)
          && !/[A-Za-z]:/.test(description);
        const canvasPresent = document.querySelector('[data-viewport-controls] canvas') instanceof HTMLCanvasElement;
        const chooseAnother = Array.from(dialog.querySelectorAll('button'))
          .find((button) => button.textContent?.trim() === 'Elegir otro modelo');
        if (!(chooseAnother instanceof HTMLButtonElement)) {
          throw new Error('The packaged rejection dialog has no recovery action.');
        }
        chooseAnother.click();

        const recoveryDeadline = performance.now() + 2_000;
        let recoveredToLibrary = false;
        while (performance.now() < recoveryDeadline) {
          recoveredToLibrary = !dialog.open
            && !document.querySelector('main')?.getAttribute('data-loaded-model-id')
            && !document.querySelector('button[aria-current="true"]')
            && Boolean(document.querySelector('aside[aria-label="Biblioteca de modelos locales"]'));
          if (recoveredToLibrary) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return {
          registered,
          protocolBytesComplete: modelBytes === expectedSize,
          errorDialogVisible: true,
          safeErrorMessage,
          failedMarkerAbsent,
          loadingSettled,
          canvasPresent,
          recoveredToLibrary,
        };
      }
      if (document.querySelector('main')?.getAttribute('data-loaded-model-id') === expectedModelId) {
        throw new Error('The packaged renderer published a loaded marker for a dependency-failing fixture.');
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('The packaged renderer did not expose a recoverable dependency-load error.');
    })()`);
  } catch (error) {
    const message = sanitizeRendererDiagnostic(error instanceof Error ? error.message : error);
    throw new Error(message || 'The packaged renderer rejection probe failed.', { cause: error });
  }

  const valid = result?.registered === true
    && result.protocolBytesComplete === true
    && result.errorDialogVisible === true
    && result.safeErrorMessage === true
    && result.failedMarkerAbsent === true
    && result.loadingSettled === true
    && result.canvasPresent === true
    && result.recoveredToLibrary === true;
  if (!valid) {
    throw new Error('The packaged renderer did not provide complete evidence for a recoverable rejected load.');
  }
  return result;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isExpectedWindowBounds(bounds) {
  return Boolean(bounds)
    && bounds.width === ACCESSIBILITY_TEST_WINDOW.width
    && bounds.height === ACCESSIBILITY_TEST_WINDOW.height;
}

async function configureAccessibilityTestViewport(applicationWindow, renderer) {
  if (!applicationWindow
    || typeof applicationWindow.getBounds !== 'function'
    || typeof applicationWindow.setSize !== 'function'
    || typeof applicationWindow.setBounds !== 'function'
    || !renderer
    || typeof renderer.getZoomFactor !== 'function'
    || typeof renderer.setZoomFactor !== 'function') {
    throw new Error('The packaged self-test cannot verify the minimum accessibility viewport.');
  }

  const originalBounds = applicationWindow.getBounds();
  const originalZoomFactor = renderer.getZoomFactor();
  if (!isFiniteNumber(originalZoomFactor)) {
    throw new Error('The packaged self-test could not read the renderer zoom factor.');
  }

  try {
    applicationWindow.setSize(ACCESSIBILITY_TEST_WINDOW.width, ACCESSIBILITY_TEST_WINDOW.height);
    await renderer.setZoomFactor(ACCESSIBILITY_TEST_ZOOM_FACTOR);
    const actualBounds = applicationWindow.getBounds();
    const actualZoomFactor = renderer.getZoomFactor();
    if (!isExpectedWindowBounds(actualBounds) || actualZoomFactor !== ACCESSIBILITY_TEST_ZOOM_FACTOR) {
      throw new Error('The packaged self-test could not apply the minimum accessibility viewport and 200% zoom.');
    }

    return {
      originalBounds,
      originalZoomFactor,
      viewport: {
        requestedWindow: ACCESSIBILITY_TEST_WINDOW,
        actualWindow: {
          width: actualBounds.width,
          height: actualBounds.height,
        },
        requestedZoomFactor: ACCESSIBILITY_TEST_ZOOM_FACTOR,
        actualZoomFactor,
      },
    };
  } catch (error) {
    applicationWindow.setBounds(originalBounds);
    await renderer.setZoomFactor(originalZoomFactor);
    throw error;
  }
}

async function restoreAccessibilityTestViewport(applicationWindow, renderer, state) {
  applicationWindow.setBounds(state.originalBounds);
  await renderer.setZoomFactor(state.originalZoomFactor);

  const restoredBounds = applicationWindow.getBounds();
  const restoredZoomFactor = renderer.getZoomFactor();
  const restored = restoredBounds.x === state.originalBounds.x
    && restoredBounds.y === state.originalBounds.y
    && restoredBounds.width === state.originalBounds.width
    && restoredBounds.height === state.originalBounds.height
    && restoredZoomFactor === state.originalZoomFactor;
  if (!restored) {
    throw new Error('The packaged self-test could not restore the window state after accessibility verification.');
  }
  return { window: restoredBounds, zoomFactor: restoredZoomFactor };
}

export function assertPackagedAccessibilityEvidence(evidence) {
  const visibleAction = (action) => Boolean(action?.visible && action?.insideViewport && action?.focusable);
  const tabs = evidence?.semantics?.tabs;
  const dialog = evidence?.semantics?.dialog;
  const missing = [];
  const requireEvidence = (condition, label) => {
    if (!condition) missing.push(label);
  };

  requireEvidence(evidence?.scope?.claim === ACCESSIBILITY_EVIDENCE_SCOPE.claim, 'scope claim');
  requireEvidence(evidence?.scope?.limitations === ACCESSIBILITY_EVIDENCE_SCOPE.limitations, 'scope limitation');
  requireEvidence(isExpectedWindowBounds(evidence?.viewport?.actualWindow), '900x600 viewport');
  requireEvidence(evidence?.viewport?.requestedZoomFactor === ACCESSIBILITY_TEST_ZOOM_FACTOR
    && evidence?.viewport?.actualZoomFactor === ACCESSIBILITY_TEST_ZOOM_FACTOR, '200% zoom');
  requireEvidence(evidence?.globalOverflow?.horizontal === false, 'horizontal global overflow');
  requireEvidence(evidence?.globalOverflow?.vertical === false, 'vertical global overflow');
  requireEvidence(evidence?.globalOverflow?.toleranceCssPixels === 1, 'one-CSS-pixel overflow tolerance');
  requireEvidence(visibleAction(evidence?.essentialActions?.openLocal)
    && evidence?.essentialActions?.openLocal?.enabled === true
    && evidence?.essentialActions?.openLocal?.controlsNativeFileInput === true, 'local-open action');
  requireEvidence(visibleAction(evidence?.essentialActions?.library)
    && evidence?.essentialActions?.library?.toggles === true, 'library action');
  requireEvidence(visibleAction(evidence?.essentialActions?.camera)
    && evidence?.essentialActions?.camera?.toggles === true
    && evidence?.essentialActions?.camera?.menuInsideViewport === true
    && evidence?.essentialActions?.camera?.menuScrollable === true
    && evidence?.essentialActions?.camera?.menuOverflowYScrollable === true, 'camera action');
  requireEvidence(evidence?.semantics?.main === true, 'main semantics');
  requireEvidence(Boolean(tabs?.valid) && tabs.count >= 2 && tabs.arrowNavigation === true, 'tab semantics');
  requireEvidence(dialog?.valid === true, 'dialog semantics');
  requireEvidence(evidence?.semantics?.liveRegions?.count >= 1 && evidence?.semantics?.liveRegions?.valid === true, 'live-region semantics');
  requireEvidence(evidence?.keyboard?.viewportFocused === true
    && evidence?.keyboard?.arrowsHandled === true
    && evidence?.keyboard?.arrowsMovedCamera === true
    && evidence?.keyboard?.shiftArrowsHandled === true
    && evidence?.keyboard?.shiftArrowsMovedCamera === true, 'viewport Arrow/Shift+Arrow camera movement');

  if (missing.length > 0) {
    throw new Error(`The packaged accessibility and responsive evidence is incomplete: ${missing.join(', ')}.`);
  }
}

export async function loadPackagedSelfTestConfig(request) {
  if (!request?.valid) throw new Error(request?.reason || 'Invalid packaged self-test request.');
  const configPath = await canonicalTemporaryConfigPath(request.configPath);
  const rawConfig = await readBoundedUtf8(configPath);
  let parsedConfig;
  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch {
    throw new Error('The packaged self-test configuration is not valid JSON.');
  }
  return validateConfig(parsedConfig, configPath, request.tokenDigest);
}

export async function runPackagedSelfTest({ scanner, config, renderer, window: applicationWindow }) {
  const startedAt = new Date().toISOString();
  const rejectedFixturePaths = config?.rejectedFixturePaths ?? [];
  const loaderRejectionFixturePaths = config?.loaderRejectionFixturePaths ?? [];
  const report = {
    version: 2,
    status: 'failed',
    startedAt,
    checks: {},
  };

  try {
    if (!Array.isArray(config?.fixturePaths)
      || config.fixturePaths.length === 0
      || config.fixturePaths.length > MAX_FIXTURE_PATHS
      || !Array.isArray(rejectedFixturePaths)
      || rejectedFixturePaths.length > MAX_REJECTION_FIXTURE_PATHS
      || !Array.isArray(loaderRejectionFixturePaths)
      || loaderRejectionFixturePaths.length > MAX_LOADER_REJECTION_FIXTURE_PATHS) {
      throw new Error('The packaged self-test fixture matrix is invalid.');
    }

    const rendererUrl = renderer.getURL();
    const rendererTitle = renderer.getTitle();
    if (rendererUrl !== 'nexoip://app/' || rendererTitle !== 'NexoIP 3D Viewer') {
      throw new Error('The packaged renderer did not load the expected local application.');
    }

    const accessibilityViewport = await configureAccessibilityTestViewport(applicationWindow, renderer);
    let rendererChecks;
    let restoredAccessibilityViewport;
    try {
      rendererChecks = await renderer.executeJavaScript(`(async () => {
      const bridgeMethods = ['getCatalogPage', 'getTreeChildren', 'getCatalogNeighbor', 'getModelUrl', 'getScanStatus', 'scan', 'cancelScan'];
      const bridgeAvailable = Boolean(window.nexoip)
        && bridgeMethods.every((method) => typeof window.nexoip[method] === 'function');
      if (!bridgeAvailable) return { bridgeAvailable: false };

      const runtimePaths = [
        '/draco/draco_decoder.wasm',
        '/draco/draco_wasm_wrapper.js',
        '/basis/basis_transcoder.js',
        '/basis/basis_transcoder.wasm'
      ];
      const bundledRuntimes = await Promise.all(runtimePaths.map(async (runtimePath) => {
        const response = await fetch(new URL(runtimePath, location.href), { cache: 'no-store' });
        const bytes = response.ok ? (await response.arrayBuffer()).byteLength : 0;
        return { runtimePath, status: response.status, bytes };
      }));
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const waitFor = async (predicate, timeout = 8_000) => {
        const deadline = performance.now() + timeout;
        while (performance.now() < deadline) {
          if (predicate()) return true;
          await nextFrame();
        }
        return false;
      };
      const getAction = (name) => Array.from(document.querySelectorAll('button, input, select, textarea, a')).find((element) =>
        element.getAttribute('aria-label') === name || element.textContent?.trim() === name);
      const isVisible = (element) => {
        if (!element || !element.isConnected) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
          && rect.width > 0 && rect.height > 0;
      };
      const isInsideViewport = (element) => {
        if (!isVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
      };
      const inspectAction = (element) => {
        element?.focus();
        const rect = element?.getBoundingClientRect();
        return {
          visible: isVisible(element),
          insideViewport: isInsideViewport(element),
          focusable: document.activeElement === element,
          enabled: Boolean(element && !element.disabled && element.getAttribute('aria-disabled') !== 'true'),
          rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
        };
      };
      const click = async (element, message) => {
        if (!element || !isVisible(element) || element.disabled) throw new Error(message);
        element.click();
        await nextFrame();
      };
      const dispatchArrow = async (element, key, shiftKey = false) => {
        const previousCameraState = element.dataset.cameraState || '';
        const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        await nextFrame();
        const nextCameraState = element.dataset.cameraState || '';
        return {
          handled: event.defaultPrevented,
          movedCamera: Boolean(previousCameraState && nextCameraState && previousCameraState !== nextCameraState),
        };
      };

      if (!await waitFor(() => document.querySelector('main') && getAction('Abrir archivo local') && document.querySelector('[data-viewport-controls][data-camera-state]'))) {
        throw new Error('The packaged renderer did not expose the expected accessible controls.');
      }

      if (document.fonts?.ready) await document.fonts.ready;
      const waitForStableLayout = async (...elements) => {
        let previousSnapshot = '';
        let stableFrames = 0;
        return waitFor(() => {
          const scrollRoot = document.scrollingElement || document.documentElement;
          const values = [
            window.innerWidth,
            window.innerHeight,
            scrollRoot.clientWidth,
            scrollRoot.clientHeight,
            ...elements.flatMap((element) => {
              const rect = element?.getBoundingClientRect();
              return rect ? [rect.left, rect.top, rect.right, rect.bottom] : ['missing'];
            }),
          ];
          const snapshot = values
            .map((value) => (typeof value === 'number' ? value.toFixed(2) : value))
            .join(',');
          if (snapshot === previousSnapshot) stableFrames += 1;
          else {
            previousSnapshot = snapshot;
            stableFrames = 0;
          }
          return stableFrames >= 2;
        });
      };
      const initialMain = document.querySelector('main');
      const initialOpenLocal = getAction('Abrir archivo local');
      const initialViewport = document.querySelector('[data-viewport-controls]');
      if (!await waitForStableLayout(initialMain, initialOpenLocal, initialViewport)) {
        throw new Error('The packaged renderer layout did not settle after applying the accessibility viewport.');
      }

      const initialLibraryOpen = Boolean(document.querySelector('aside[aria-label="Biblioteca de modelos locales"]'));
      const initialCameraOpen = Boolean(document.querySelector('[role="group"][aria-label="Controles precisos de cámara"]'));
      const initialFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      try {
        const openLocalButton = getAction('Abrir archivo local');
        const openLocal = inspectAction(openLocalButton);
        const fileInput = openLocalButton ? document.getElementById(openLocalButton.getAttribute('aria-controls') || '') : null;
        openLocal.controlsNativeFileInput = Boolean(fileInput?.matches('input[type="file"]'));

        let libraryTrigger = getAction('Abrir biblioteca de modelos') || getAction('Cerrar biblioteca de modelos');
        const library = inspectAction(libraryTrigger);
        if (!initialLibraryOpen) {
          await click(libraryTrigger, 'The packaged library opener is not operable.');
          if (!await waitFor(() => document.querySelector('aside[aria-label="Biblioteca de modelos locales"]'))) {
            throw new Error('The packaged library opener did not reveal the library.');
          }
        }
        libraryTrigger = getAction('Cerrar biblioteca de modelos');
        await click(libraryTrigger, 'The packaged library closer is not operable.');
        const libraryClosed = await waitFor(() => !document.querySelector('aside[aria-label="Biblioteca de modelos locales"]'));
        libraryTrigger = getAction('Abrir biblioteca de modelos');
        await click(libraryTrigger, 'The packaged library opener is not operable.');
        const libraryReopened = await waitFor(() => document.querySelector('aside[aria-label="Biblioteca de modelos locales"]'));
        library.toggles = libraryClosed && libraryReopened;

        const cameraTrigger = getAction('Abrir controles precisos de cámara') || getAction('Cerrar controles precisos de cámara');
        const camera = inspectAction(cameraTrigger);
        if (initialCameraOpen) {
          await click(cameraTrigger, 'The packaged camera menu closer is not operable.');
          if (!await waitFor(() => !document.querySelector('[role="group"][aria-label="Controles precisos de cámara"]'))) {
            throw new Error('The packaged camera menu did not close.');
          }
        }
        await click(getAction('Abrir controles precisos de cámara'), 'The packaged camera menu opener is not operable.');
        const cameraMenu = document.querySelector('[role="group"][aria-label="Controles precisos de cámara"]');
        camera.toggles = Boolean(cameraMenu && isVisible(cameraMenu)
          && getAction('Cerrar controles precisos de cámara')?.getAttribute('aria-expanded') === 'true');
        camera.menuInsideViewport = isInsideViewport(cameraMenu);
        camera.menuScrollable = Boolean(cameraMenu && cameraMenu.scrollHeight > cameraMenu.clientHeight);
        camera.menuOverflowYScrollable = Boolean(cameraMenu && /auto|scroll/.test(getComputedStyle(cameraMenu).overflowY));

        const viewport = document.querySelector('[data-viewport-controls]');
        viewport.focus();
        const viewportFocused = document.activeElement === viewport;
        const arrowResult = await dispatchArrow(viewport, 'ArrowLeft');
        const shiftArrowResult = await dispatchArrow(viewport, 'ArrowRight', true);

        const tabList = document.querySelector('[role="tablist"]');
        const tabs = tabList ? Array.from(tabList.querySelectorAll('[role="tab"]')) : [];
        const selectedTabs = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
        const tabLinksPanels = tabs.every((tab) => {
          const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
          return Boolean(panel?.matches('[role="tabpanel"]') && panel.getAttribute('aria-labelledby') === tab.id);
        });
        let arrowNavigation = false;
        if (tabs.length >= 2) {
          tabs[0].focus();
          const tabEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
          tabs[0].dispatchEvent(tabEvent);
          await nextFrame();
          arrowNavigation = tabEvent.defaultPrevented && tabs[1].getAttribute('aria-selected') === 'true'
            && document.activeElement === tabs[1];
          tabs[0].click();
          await nextFrame();
        }

        const dialog = document.querySelector('dialog');
        const dialogTitle = dialog ? document.getElementById(dialog.getAttribute('aria-labelledby') || '') : null;
        const dialogDescription = dialog ? document.getElementById(dialog.getAttribute('aria-describedby') || '') : null;
        const liveRegions = Array.from(document.querySelectorAll('[role="status"], [role="alert"], [aria-live]'));
        const scrollRoot = document.scrollingElement || document.documentElement;
        const mainElement = document.querySelector('main');
        const mainRect = mainElement.getBoundingClientRect();
        const overflowToleranceCssPixels = 1;
        const overflowContributors = Array.from(document.body.querySelectorAll('*'))
          .map((element) => ({
            element,
            rect: element.getBoundingClientRect(),
          }))
          .filter(({ element, rect }) => isVisible(element)
            && (rect.left < -overflowToleranceCssPixels || rect.top < -overflowToleranceCssPixels
              || rect.right > window.innerWidth + overflowToleranceCssPixels
              || rect.bottom > window.innerHeight + overflowToleranceCssPixels))
          .slice(0, 12)
          .map(({ element, rect }) => ({
            tag: element.tagName.toLowerCase(),
            label: element.getAttribute('aria-label') || null,
            role: element.getAttribute('role') || null,
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          }));
        const essentialActions = [openLocalButton, getAction('Cerrar biblioteca de modelos'), getAction('Cerrar controles precisos de cámara')];
        const globalOverflow = {
          horizontal: scrollRoot.scrollWidth - scrollRoot.clientWidth > overflowToleranceCssPixels
            || mainRect.left < -overflowToleranceCssPixels
            || mainRect.right - window.innerWidth > overflowToleranceCssPixels,
          vertical: scrollRoot.scrollHeight - scrollRoot.clientHeight > overflowToleranceCssPixels
            || mainRect.top < -overflowToleranceCssPixels
            || mainRect.bottom - window.innerHeight > overflowToleranceCssPixels,
          toleranceCssPixels: overflowToleranceCssPixels,
          allEssentialActionsInsideViewport: essentialActions.every(isInsideViewport),
          viewport: { width: window.innerWidth, height: window.innerHeight },
          rootSize: { clientWidth: scrollRoot.clientWidth, clientHeight: scrollRoot.clientHeight, scrollWidth: scrollRoot.scrollWidth, scrollHeight: scrollRoot.scrollHeight },
          mainSize: { clientWidth: mainElement.clientWidth, clientHeight: mainElement.clientHeight, scrollWidth: mainElement.scrollWidth, scrollHeight: mainElement.scrollHeight, rect: mainRect },
          contributors: overflowContributors,
        };
        if (!globalOverflow.allEssentialActionsInsideViewport) {
          throw new Error('The packaged accessibility viewport hides an essential action.');
        }

        return {
          bridgeAvailable,
          bundledRuntimes,
          accessibility: {
            scope: ${JSON.stringify(ACCESSIBILITY_EVIDENCE_SCOPE)},
            globalOverflow,
            essentialActions: { openLocal, library, camera },
            semantics: {
              main: Boolean(document.querySelector('main[aria-label="NexoIP 3D Viewer"]')),
              tabs: {
                count: tabs.length,
                valid: Boolean(tabList && selectedTabs.length === 1 && tabLinksPanels),
                arrowNavigation,
              },
              dialog: {
                present: Boolean(dialog),
                valid: Boolean(dialog && dialogTitle && dialogDescription),
              },
              liveRegions: {
                count: liveRegions.length,
                valid: liveRegions.every((region) => region.matches('[role="status"], [role="alert"], [aria-live]')),
              },
            },
            keyboard: {
              viewportFocused,
              arrowsHandled: arrowResult.handled,
              arrowsMovedCamera: arrowResult.movedCamera,
              shiftArrowsHandled: shiftArrowResult.handled,
              shiftArrowsMovedCamera: shiftArrowResult.movedCamera,
            },
          },
        };
      } finally {
        const libraryIsOpen = Boolean(document.querySelector('aside[aria-label="Biblioteca de modelos locales"]'));
        if (libraryIsOpen !== initialLibraryOpen) {
          (getAction(libraryIsOpen ? 'Cerrar biblioteca de modelos' : 'Abrir biblioteca de modelos'))?.click();
          await nextFrame();
        }
        const cameraIsOpen = Boolean(document.querySelector('[role="group"][aria-label="Controles precisos de cámara"]'));
        if (cameraIsOpen !== initialCameraOpen) {
          (getAction(cameraIsOpen ? 'Cerrar controles precisos de cámara' : 'Abrir controles precisos de cámara'))?.click();
          await nextFrame();
        }
        initialFocus?.focus();
      }
    })()`);
    } finally {
      restoredAccessibilityViewport = await restoreAccessibilityTestViewport(applicationWindow, renderer, accessibilityViewport);
    }
    if (!rendererChecks.bridgeAvailable) {
      throw new Error('The packaged preload bridge was not available.');
    }
    if (rendererChecks.bundledRuntimes.some((runtime) => runtime.status !== 200 || runtime.bytes === 0)) {
      throw new Error('A bundled Draco or Basis runtime was not available from the packaged application origin.');
    }
    const accessibilityResponsive = {
      ...rendererChecks.accessibility,
      viewport: accessibilityViewport.viewport,
      restoredWindow: restoredAccessibilityViewport.window,
      restoredZoomFactor: restoredAccessibilityViewport.zoomFactor,
    };
    assertPackagedAccessibilityEvidence(accessibilityResponsive);

    const formatMatrix = [];
    const rejectedFormatMatrix = [];
    const loaderRejectedFormatMatrix = [];
    let totalModelBytes = 0;
    const loadedModels = [];
    report.checks = {
      localRenderer: { title: rendererTitle, url: rendererUrl },
      formatMatrix,
      rejectedFormatMatrix,
      loaderRejectedFormatMatrix,
      preloadContract: {
        available: true,
        modelCount: 0,
        rejectedBeforePublicationCount: 0,
        loaderRejectedCount: 0,
        totalModelBytes: 0,
        noDebuggingTransport: true,
      },
      bundledRuntimes: rendererChecks.bundledRuntimes,
      accessibilityResponsive,
    };
    for (let fixtureIndex = 0; fixtureIndex < rejectedFixturePaths.length; fixtureIndex += 1) {
      const fixturePath = rejectedFixturePaths[fixtureIndex];
      let fixtureStats;
      try {
        fixtureStats = await fs.promises.stat(fixturePath);
      } catch {
        throw new Error(`Packaged rejection fixture ${fixtureIndex + 1} could not be inspected.`);
      }
      if (!fixtureStats.isFile() || fixtureStats.size === 0) {
        throw new Error(`Packaged rejection fixture ${fixtureIndex + 1} is missing or empty.`);
      }

      let rejectedBeforePublication = false;
      try {
        await scanner.registerDroppedPath(fixturePath);
      } catch (error) {
        rejectedBeforePublication = error instanceof TypeError && error.message === 'Invalid dropped file.';
        if (!rejectedBeforePublication) {
          throw new Error(`Packaged rejection fixture ${fixtureIndex + 1} did not reach the expected validation boundary.`, {
            cause: error,
          });
        }
      }
      if (!rejectedBeforePublication) {
        throw new Error(`Packaged rejection fixture ${fixtureIndex + 1} entered the model catalog.`);
      }
      rejectedFormatMatrix.push({
        name: path.basename(fixturePath),
        extension: path.extname(fixturePath).slice(1).toLowerCase(),
        size: fixtureStats.size,
        rejectedBeforePublication: true,
      });
      report.checks.preloadContract.rejectedBeforePublicationCount = rejectedFormatMatrix.length;
    }
    for (let fixtureIndex = 0; fixtureIndex < config.fixturePaths.length; fixtureIndex += 1) {
      const fixturePath = config.fixturePaths[fixtureIndex];
      let fixtureStats;
      try {
        fixtureStats = await fs.promises.stat(fixturePath);
      } catch {
        throw new Error(`Packaged format fixture ${fixtureIndex + 1} could not be inspected.`);
      }
      if (!fixtureStats.isFile() || fixtureStats.size === 0) {
        throw new Error(`Packaged format fixture ${fixtureIndex + 1} is missing or empty.`);
      }

      let model;
      try {
        model = await scanner.registerDroppedPath(fixturePath);
      } catch {
        throw new Error(`Packaged format fixture ${fixtureIndex + 1} could not be registered securely.`);
      }
      let asset;
      try {
        asset = await scanner.openModelAsset(model.id, 'asset');
      } catch {
        throw new Error(`Packaged format fixture ${fixtureIndex + 1} could not be opened securely.`);
      }
      if (!asset) throw new Error(`Packaged format fixture ${fixtureIndex + 1} could not be opened securely.`);

      let prefix;
      try {
        prefix = await readAssetPrefix(asset.stream);
      } catch {
        throw new Error(`Packaged format fixture ${fixtureIndex + 1} could not be read securely.`);
      }
      if (prefix.length === 0) throw new Error(`Packaged format fixture ${fixtureIndex + 1} is empty.`);

      const shouldCaptureScreenshot = Boolean(config.screenshotPath && fixtureIndex === config.fixturePaths.length - 1);
      let modelLoad;
      try {
        modelLoad = await probeRendererModelLoad(renderer, model, fixtureStats.size, {
          prepareScreenshotFrame: shouldCaptureScreenshot,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const safeDetail = /^(The packaged|The private|The registered)/.test(message)
          ? message
          : 'The renderer probe failed without safe diagnostics.';
        throw new Error(`Packaged format fixture ${fixtureIndex + 1} (${model.name}) failed: ${safeDetail}`, { cause: error });
      }
      totalModelBytes += modelLoad.modelBytes;
      loadedModels.push(model);
      formatMatrix.push({
        name: model.name,
        extension: path.extname(model.name).slice(1).toLowerCase(),
        size: model.size,
        bytesRead: prefix.length,
        modelBytes: modelLoad.modelBytes,
        eventDispatches: modelLoad.eventDispatches,
        exactModelMarker: modelLoad.exactModelMarker,
        canvas: modelLoad.canvas,
        webglContext: modelLoad.webglContext,
        contextLost: modelLoad.contextLost,
        dialogOpened: modelLoad.dialogOpened,
      });
      if (shouldCaptureScreenshot) {
        report.checks.screenshot = await capturePackagedSelfTestScreenshot(renderer, config.screenshotPath);
      }
      report.checks.preloadContract.modelCount = formatMatrix.length;
      report.checks.preloadContract.totalModelBytes = totalModelBytes;
    }
    if (loadedModels.length >= 2) {
      report.checks.staleLoadCancellation = await probeRendererStaleLoadCancellation(
        renderer,
        loadedModels[0],
        loadedModels.at(-1),
      );
    } else {
      report.checks.staleLoadCancellation = { tested: false, reason: 'insufficient-fixtures' };
    }
    report.checks.webglRecovery = await probeRendererContextRecovery(renderer, loadedModels.at(-1));
    for (let fixtureIndex = 0; fixtureIndex < loaderRejectionFixturePaths.length; fixtureIndex += 1) {
      const fixturePath = loaderRejectionFixturePaths[fixtureIndex];
      let fixtureStats;
      try {
        fixtureStats = await fs.promises.stat(fixturePath);
      } catch {
        throw new Error(`Packaged loader-rejection fixture ${fixtureIndex + 1} could not be inspected.`);
      }
      if (!fixtureStats.isFile() || fixtureStats.size === 0) {
        throw new Error(`Packaged loader-rejection fixture ${fixtureIndex + 1} is missing or empty.`);
      }

      let model;
      try {
        model = await scanner.registerDroppedPath(fixturePath);
      } catch {
        throw new Error(`Packaged loader-rejection fixture ${fixtureIndex + 1} could not be registered securely.`);
      }

      let modelRejection;
      try {
        modelRejection = await probeRendererModelRejection(renderer, model, fixtureStats.size);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const safeDetail = /^(The packaged|The private|The registered)/.test(message)
          ? message
          : 'The renderer rejection probe failed without safe diagnostics.';
        throw new Error(
          `Packaged loader-rejection fixture ${fixtureIndex + 1} (${model.name}) failed: ${safeDetail}`,
          { cause: error },
        );
      }

      loaderRejectedFormatMatrix.push({
        name: model.name,
        extension: path.extname(model.name).slice(1).toLowerCase(),
        size: model.size,
        ...modelRejection,
      });
      report.checks.preloadContract.loaderRejectedCount = loaderRejectedFormatMatrix.length;
    }
    report.status = 'passed';
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }

  report.completedAt = new Date().toISOString();
  return report;
}

export async function writePackagedSelfTestReport(resultPath, report) {
  const directory = path.dirname(resultPath);
  const filename = path.basename(resultPath);
  if (!/^result-[a-f0-9]+\.json$/.test(filename)) {
    throw new Error('The packaged self-test result path is invalid.');
  }

  const temporaryPath = path.join(directory, `.${filename}.${randomBytes(8).toString('hex')}.tmp`);
  const serialized = `${JSON.stringify(report)}\n`;
  await fs.promises.writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.rename(temporaryPath, resultPath);
}
