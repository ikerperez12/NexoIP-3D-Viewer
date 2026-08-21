import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, expect, test, vi } from 'vitest';
import { loadPackagedSelfTestConfig, runPackagedSelfTest } from '../electron/packaged-self-test.js';
import { preparePackagedFixtureMatrix } from '../scripts/packaged-fixture-matrix.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.promises.rm(directory, { recursive: true, force: true })));
});

async function writeCapabilityConfig(overrides = {}) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexoip-capability-test-'));
  temporaryDirectories.push(directory);
  const token = 'ab'.repeat(32);
  const configPath = path.join(directory, 'nexoip-packaged-self-test-a1.json');
  const resultPath = path.join(directory, 'result-a1.json');
  const fixturePath = path.resolve('tests', 'fixtures', 'nexoip-sample.stl');
  const resolvedOverrides = typeof overrides === 'function'
    ? overrides({ directory, configPath, fixturePath, resultPath })
    : overrides;
  await fs.promises.writeFile(configPath, JSON.stringify({
    version: 2,
    token,
    fixturePaths: [fixturePath],
    resultPath,
    ...resolvedOverrides,
  }));
  return {
    directory,
    configPath,
    fixturePath,
    resultPath,
    tokenDigest: createHash('sha256').update(token).digest('hex'),
  };
}

function createAccessibilityEvidence() {
  return {
    scope: {
      claim: 'targeted packaged accessibility and responsive evidence',
      limitations: 'This verifies the listed packaged DOM, keyboard, zoom, and viewport invariants only; it is not a complete WCAG conformance evaluation.',
    },
    globalOverflow: {
      horizontal: false,
      vertical: false,
      toleranceCssPixels: 1,
      allEssentialActionsInsideViewport: true,
    },
    essentialActions: {
      openLocal: { visible: true, insideViewport: true, focusable: true, enabled: true, controlsNativeFileInput: true },
      library: { visible: true, insideViewport: true, focusable: true, toggles: true },
      camera: {
        visible: true,
        insideViewport: true,
        focusable: true,
        toggles: true,
        menuInsideViewport: true,
        menuScrollable: true,
        menuOverflowYScrollable: true,
      },
    },
    semantics: {
      main: true,
      tabs: { count: 2, valid: true, arrowNavigation: true },
      dialog: { present: true, valid: true },
      liveRegions: { count: 2, valid: true },
    },
    keyboard: {
      viewportFocused: true,
      arrowsHandled: true,
      arrowsMovedCamera: true,
      shiftArrowsHandled: true,
      shiftArrowsMovedCamera: true,
    },
  };
}

function createPassingSelfTestHarness(fixturePath, capturePage) {
  let bounds = { x: 40, y: 60, width: 1280, height: 850 };
  let zoomFactor = 1;
  let modelLoadObserved = false;
  const applicationWindow = {
    getBounds: vi.fn(() => ({ ...bounds })),
    setSize: vi.fn((width, height) => { bounds = { ...bounds, width, height }; }),
    setBounds: vi.fn((nextBounds) => { bounds = { ...nextBounds }; }),
  };
  const renderer = {
    getURL: () => 'nexoip://app/',
    getTitle: () => 'NexoIP 3D Viewer',
    getZoomFactor: vi.fn(() => zoomFactor),
    setZoomFactor: vi.fn(async (nextZoomFactor) => { zoomFactor = nextZoomFactor; }),
    send: vi.fn(),
    executeJavaScript: vi.fn(async (source) => {
      if (source.includes('data-loaded-model-id')) {
        modelLoadObserved = true;
        const size = (await fs.promises.stat(fixturePath)).size;
        return {
          bridgeAvailable: true,
          modelBytes: size,
          eventDispatches: 1,
          exactModelMarker: true,
          canvas: { present: true, width: 800, height: 600 },
          webglContext: 'webgl2',
          contextLost: false,
          dialogOpened: false,
        };
      }
      return {
        bridgeAvailable: true,
        bundledRuntimes: [
          { runtimePath: '/draco/draco_decoder.wasm', status: 200, bytes: 1 },
          { runtimePath: '/draco/draco_wasm_wrapper.js', status: 200, bytes: 1 },
          { runtimePath: '/basis/basis_transcoder.js', status: 200, bytes: 1 },
          { runtimePath: '/basis/basis_transcoder.wasm', status: 200, bytes: 1 },
        ],
        accessibility: createAccessibilityEvidence(),
      };
    }),
  };
  if (capturePage) {
    renderer.capturePage = vi.fn(async () => {
      if (!modelLoadObserved) throw new Error('Capture attempted before the model completed loading.');
      return capturePage();
    });
  }

  return {
    applicationWindow,
    renderer,
    scanner: {
      registerDroppedPath: async () => ({
        id: 'a'.repeat(48),
        name: path.basename(fixturePath),
        size: (await fs.promises.stat(fixturePath)).size,
      }),
      openModelAsset: async () => ({ stream: Readable.from(Buffer.from('fixture')) }),
    },
  };
}

test('packaged self-test accepts a bounded capability with a canonical sibling result', async () => {
  const capability = await writeCapabilityConfig();
  const config = await loadPackagedSelfTestConfig({
    valid: true,
    configPath: capability.configPath,
    tokenDigest: capability.tokenDigest,
  });

  expect(config.fixturePaths).toEqual([capability.fixturePath]);
  expect(config.resultPath).toBe(path.join(await fs.promises.realpath(capability.directory), 'result-a1.json'));
});

test('packaged self-test accepts a canonical sibling screenshot target', async () => {
  const capability = await writeCapabilityConfig(({ directory }) => ({
    screenshotPath: path.join(directory, 'screenshot-a1b2.png'),
  }));
  const config = await loadPackagedSelfTestConfig({
    valid: true,
    configPath: capability.configPath,
    tokenDigest: capability.tokenDigest,
  });

  expect(config.screenshotPath).toBe(path.join(await fs.promises.realpath(capability.directory), 'screenshot-a1b2.png'));
});

test('packaged self-test accepts the unique ten-entry shared format matrix', async () => {
  const prepared = await preparePackagedFixtureMatrix();
  try {
    const fixturePaths = prepared.fixtures.map((fixture) => fixture.fixturePath);
    const capability = await writeCapabilityConfig({ fixturePaths });
    const config = await loadPackagedSelfTestConfig({
      valid: true,
      configPath: capability.configPath,
      tokenDigest: capability.tokenDigest,
    });

    expect(config.fixturePaths).toEqual(fixturePaths);
  } finally {
    await prepared.cleanup();
  }
});

test('packaged self-test accepts a temporary directory alias after canonicalisation', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexoip-capability-alias-'));
  temporaryDirectories.push(root);
  const realDirectory = path.join(root, 'real-profile');
  const aliasDirectory = path.join(root, 'profile-alias');
  await fs.promises.mkdir(realDirectory);
  await fs.promises.symlink(realDirectory, aliasDirectory, process.platform === 'win32' ? 'junction' : 'dir');

  const token = 'cd'.repeat(32);
  const configPath = path.join(aliasDirectory, 'nexoip-packaged-self-test-b2.json');
  const resultPath = path.join(aliasDirectory, 'result-b2.json');
  await fs.promises.writeFile(configPath, JSON.stringify({
    version: 2,
    token,
    fixturePaths: [path.resolve('tests', 'fixtures', 'nexoip-sample.stl')],
    resultPath,
  }));

  const config = await loadPackagedSelfTestConfig({
    valid: true,
    configPath,
    tokenDigest: createHash('sha256').update(token).digest('hex'),
  });
  expect(config.resultPath).toBe(path.join(await fs.promises.realpath(realDirectory), 'result-b2.json'));
});

test('packaged self-test rejects result paths outside the capability directory', async () => {
  const outsideDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexoip-capability-outside-'));
  temporaryDirectories.push(outsideDirectory);
  const capability = await writeCapabilityConfig({ resultPath: path.join(outsideDirectory, 'result-a1.json') });

  await expect(loadPackagedSelfTestConfig({
    valid: true,
    configPath: capability.configPath,
    tokenDigest: capability.tokenDigest,
  })).rejects.toThrow('configuration is invalid');
});

test.each([
  ['a relative screenshot path', () => 'screenshot-a1b2.png'],
  ['a non-conforming screenshot filename', ({ directory }) => path.join(directory, 'capture-a1b2.png')],
  ['a screenshot path outside the capability directory', () => path.join(os.tmpdir(), 'screenshot-a1b2.png')],
  ['a screenshot traversal path', ({ directory }) => `${directory}${path.sep}nested${path.sep}..${path.sep}screenshot-a1b2.png`],
])('packaged self-test rejects %s', async (_label, createScreenshotPath) => {
  const capability = await writeCapabilityConfig((context) => ({
    screenshotPath: createScreenshotPath(context),
  }));

  await expect(loadPackagedSelfTestConfig({
    valid: true,
    configPath: capability.configPath,
    tokenDigest: capability.tokenDigest,
  })).rejects.toThrow('configuration is invalid');
});

test('packaged self-test keeps the capability digest check when a screenshot is requested', async () => {
  const capability = await writeCapabilityConfig(({ directory }) => ({
    screenshotPath: path.join(directory, 'screenshot-a1b2.png'),
  }));

  await expect(loadPackagedSelfTestConfig({
    valid: true,
    configPath: capability.configPath,
    tokenDigest: '00'.repeat(32),
  })).rejects.toThrow('capability check failed');
});

test('packaged self-test rejects legacy, duplicate, and oversized fixture capabilities', async () => {
  const legacy = await writeCapabilityConfig({ version: 1 });
  await expect(loadPackagedSelfTestConfig({
    valid: true,
    configPath: legacy.configPath,
    tokenDigest: legacy.tokenDigest,
  })).rejects.toThrow('configuration is invalid');

  const duplicate = await writeCapabilityConfig({
    fixturePaths: [
      path.resolve('tests', 'fixtures', 'nexoip-sample.stl'),
      path.resolve('tests', 'fixtures', 'nexoip-sample.stl'),
    ],
  });
  await expect(loadPackagedSelfTestConfig({
    valid: true,
    configPath: duplicate.configPath,
    tokenDigest: duplicate.tokenDigest,
  })).rejects.toThrow('configuration is invalid');

  const oversized = await writeCapabilityConfig({
    fixturePaths: Array.from({ length: 13 }, () => path.resolve('tests', 'fixtures', 'nexoip-sample.stl')),
  });
  await expect(loadPackagedSelfTestConfig({
    valid: true,
    configPath: oversized.configPath,
    tokenDigest: oversized.tokenDigest,
  })).rejects.toThrow('configuration is invalid');
});

test('packaged self-test atomically records a main-process PNG capture after the selected model loads', async () => {
  const capability = await writeCapabilityConfig(({ directory }) => ({
    screenshotPath: path.join(directory, 'screenshot-a1b2.png'),
  }));
  const config = await loadPackagedSelfTestConfig({
    valid: true,
    configPath: capability.configPath,
    tokenDigest: capability.tokenDigest,
  });
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x6d, 0x6f, 0x63, 0x6b,
  ]);
  const nativeImage = {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => ({ width: 1280, height: 720 })),
    toPNG: vi.fn(() => png),
  };
  const harness = createPassingSelfTestHarness(capability.fixturePath, () => nativeImage);

  const report = await runPackagedSelfTest({
    config,
    scanner: harness.scanner,
    renderer: harness.renderer,
    window: harness.applicationWindow,
  });

  expect(report.status).toBe('passed');
  expect(harness.renderer.capturePage).toHaveBeenCalledOnce();
  expect(nativeImage.isEmpty).toHaveBeenCalledOnce();
  expect(nativeImage.getSize).toHaveBeenCalledOnce();
  expect(nativeImage.toPNG).toHaveBeenCalledOnce();
  expect(harness.renderer.executeJavaScript.mock.calls.at(-1)[0]).toContain('prepareScreenshotFrame');
  expect(harness.renderer.executeJavaScript.mock.calls.at(-1)[0]).toContain('transientLoadStatusVisible');
  expect(harness.renderer.executeJavaScript.mock.calls.at(-1)[0]).toContain('Cerrar biblioteca de modelos');
  expect(harness.renderer.executeJavaScript.mock.calls.at(-1)[0]).toContain('Abrir propiedades del modelo');
  expect(report.checks.screenshot).toEqual({
    filename: 'screenshot-a1b2.png',
    width: 1280,
    height: 720,
    bytes: png.length,
  });
  await expect(fs.promises.readFile(config.screenshotPath)).resolves.toEqual(png);
  await expect(fs.promises.readdir(capability.directory)).resolves.not.toContain(
    expect.stringContaining('.screenshot-a1b2.png.'),
  );
});

test.each([
  ['a missing main-process capture API', undefined, 'screenshot capture is unavailable'],
  ['an empty NativeImage', () => ({
    isEmpty: () => true,
    getSize: () => ({ width: 1280, height: 720 }),
    toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }), 'screenshot capture is empty'],
])('packaged self-test fails closed for %s', async (_label, createNativeImage, expectedError) => {
  const capability = await writeCapabilityConfig(({ directory }) => ({
    screenshotPath: path.join(directory, 'screenshot-a1b2.png'),
  }));
  const config = await loadPackagedSelfTestConfig({
    valid: true,
    configPath: capability.configPath,
    tokenDigest: capability.tokenDigest,
  });
  const harness = createPassingSelfTestHarness(capability.fixturePath, createNativeImage);

  const report = await runPackagedSelfTest({
    config,
    scanner: harness.scanner,
    renderer: harness.renderer,
    window: harness.applicationWindow,
  });

  expect(report.status).toBe('failed');
  expect(report.error).toContain(expectedError);
  expect(fs.existsSync(config.screenshotPath)).toBe(false);
});

test('packaged self-test fails closed when it cannot control the minimum accessibility viewport', async () => {
  const fixturePath = path.resolve('tests', 'fixtures', 'nexoip-sample.stl');
  const fixtureStats = await fs.promises.stat(fixturePath);
  const model = {
    id: 'a'.repeat(48),
    name: path.basename(fixturePath),
    size: fixtureStats.size,
  };
  const report = await runPackagedSelfTest({
    config: { fixturePaths: [fixturePath], resultPath: path.join(os.tmpdir(), 'result-a1.json') },
    scanner: {
      registerDroppedPath: async () => model,
      openModelAsset: async () => ({ stream: Readable.from(Buffer.from('fixture')) }),
    },
    renderer: {
      getURL: () => 'nexoip://app/',
      getTitle: () => 'NexoIP 3D Viewer',
    },
  });

  expect(report.status).toBe('failed');
  expect(report.error).toContain('minimum accessibility viewport');
});
