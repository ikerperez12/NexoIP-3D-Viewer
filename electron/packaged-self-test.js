import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPathInside, isSupportedModelPath } from './security.js';

const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_ASSET_PROBE_BYTES = 64 * 1024;
const TEMP_CONFIG_PATTERN = /^nexoip-packaged-self-test-[a-f0-9]+\.json$/;
const TEMP_RESULT_PATTERN = /^result-[a-f0-9]+\.json$/;
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
  if (!isPlainObject(config)
    || config.version !== 1
    || typeof config.token !== 'string'
    || !/^[a-f0-9]{64}$/i.test(config.token)
    || typeof config.fixturePath !== 'string'
    || typeof config.resultPath !== 'string'
    || !path.isAbsolute(config.fixturePath)
    || !path.isAbsolute(config.resultPath)
    || !isSupportedModelPath(config.fixturePath)
    || !TEMP_RESULT_PATTERN.test(path.basename(config.resultPath))) {
    throw new Error('The packaged self-test configuration is invalid.');
  }

  const configDirectory = await fs.promises.realpath(path.dirname(configPath));
  const resultDirectory = await fs.promises.realpath(path.dirname(config.resultPath));
  if (path.relative(configDirectory, resultDirectory) !== '') {
    throw new Error('The packaged self-test configuration is invalid.');
  }

  const suppliedDigest = Buffer.from(sha256(config.token), 'hex');
  const expectedDigestBuffer = Buffer.from(expectedDigest, 'hex');
  if (suppliedDigest.length !== expectedDigestBuffer.length || !timingSafeEqual(suppliedDigest, expectedDigestBuffer)) {
    throw new Error('The packaged self-test capability check failed.');
  }

  return {
    fixturePath: path.resolve(config.fixturePath),
    resultPath: path.join(resultDirectory, path.basename(config.resultPath)),
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
  const report = {
    version: 1,
    status: 'failed',
    startedAt,
    checks: {},
  };

  try {
    const fixtureStats = await fs.promises.stat(config.fixturePath);
    if (!fixtureStats.isFile() || fixtureStats.size === 0) {
      throw new Error('The packaged self-test fixture is missing or empty.');
    }

    const model = await scanner.registerDroppedPath(config.fixturePath);
    const asset = await scanner.openModelAsset(model.id, 'asset');
    if (!asset) throw new Error('The packaged self-test fixture could not be opened securely.');

    const prefix = await readAssetPrefix(asset.stream);
    if (prefix.length === 0) throw new Error('The packaged self-test fixture could not be read.');

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
      const bridgeMethods = ['listModels', 'getModelUrl', 'getScanStatus', 'scan', 'cancelScan'];
      const bridgeAvailable = Boolean(window.nexoip)
        && bridgeMethods.every((method) => typeof window.nexoip[method] === 'function');
      if (!bridgeAvailable) return { bridgeAvailable: false };

      const models = await window.nexoip.listModels({ sortBy: 'name', order: 'asc' });
      const model = models.find((item) => item.id === ${JSON.stringify(model.id)});
      const modelUrl = model ? window.nexoip.getModelUrl(model.id) : null;
      const modelResponse = modelUrl ? await fetch(modelUrl, { cache: 'no-store' }) : null;
      const modelBytes = modelResponse?.ok ? (await modelResponse.arrayBuffer()).byteLength : 0;
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
        return {
          visible: isVisible(element),
          insideViewport: isInsideViewport(element),
          focusable: document.activeElement === element,
          enabled: Boolean(element && !element.disabled && element.getAttribute('aria-disabled') !== 'true'),
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
          modelBytes,
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
    if (!rendererChecks.bridgeAvailable || rendererChecks.modelBytes !== fixtureStats.size) {
      throw new Error('The packaged preload bridge or private model protocol did not return the approved fixture.');
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
    report.checks = {
      localRenderer: { title: rendererTitle, url: rendererUrl },
      fixture: {
        id: model.id,
        name: model.name,
        size: model.size,
        bytesRead: prefix.length,
      },
      preloadContract: {
        available: true,
        modelBytes: rendererChecks.modelBytes,
        noDebuggingTransport: true,
      },
      bundledRuntimes: rendererChecks.bundledRuntimes,
      accessibilityResponsive,
    };
    assertPackagedAccessibilityEvidence(accessibilityResponsive);
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
