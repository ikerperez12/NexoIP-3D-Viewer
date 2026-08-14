import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { expect, test, vi } from 'vitest';
import {
  assertPackagedAccessibilityEvidence,
  runPackagedSelfTest,
} from '../electron/packaged-self-test.js';

function createEvidence() {
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

function createViewportEvidence() {
  return {
    actualWindow: { width: 900, height: 600 },
    requestedZoomFactor: 2,
    actualZoomFactor: 2,
  };
}

test('targeted packaged accessibility evidence accepts the documented responsive and keyboard invariants', () => {
  expect(() => assertPackagedAccessibilityEvidence({
    ...createEvidence(),
    viewport: createViewportEvidence(),
  })).not.toThrow();
});

test('targeted packaged accessibility evidence rejects an unhandled Shift+Arrow viewport command', () => {
  const evidence = createEvidence();
  evidence.keyboard.shiftArrowsHandled = false;

  expect(() => assertPackagedAccessibilityEvidence({
    ...evidence,
    viewport: createViewportEvidence(),
  })).toThrow('accessibility and responsive evidence is incomplete');
});

test('targeted packaged accessibility evidence rejects a handled key that does not move the camera', () => {
  const evidence = createEvidence();
  evidence.keyboard.arrowsMovedCamera = false;

  expect(() => assertPackagedAccessibilityEvidence({
    ...evidence,
    viewport: createViewportEvidence(),
  })).toThrow('accessibility and responsive evidence is incomplete');
});

test('targeted packaged accessibility evidence rejects global overflow at 200% zoom', () => {
  const evidence = createEvidence();
  evidence.globalOverflow.horizontal = true;

  expect(() => assertPackagedAccessibilityEvidence({
    ...evidence,
    viewport: createViewportEvidence(),
  })).toThrow('horizontal global overflow');
});

test('targeted packaged accessibility evidence rejects a widened overflow tolerance', () => {
  const evidence = createEvidence();
  evidence.globalOverflow.toleranceCssPixels = 2;

  expect(() => assertPackagedAccessibilityEvidence({
    ...evidence,
    viewport: createViewportEvidence(),
  })).toThrow('one-CSS-pixel overflow tolerance');
});

test('packaged self-test records accessibility evidence and restores its viewport state', async () => {
  const fixturePath = path.resolve('tests', 'fixtures', 'nexoip-sample.stl');
  const fixtureStats = await fs.promises.stat(fixturePath);
  const originalBounds = { x: 40, y: 60, width: 1280, height: 850 };
  let bounds = { ...originalBounds };
  let zoomFactor = 1;
  const applicationWindow = {
    getBounds: vi.fn(() => ({ ...bounds })),
    setSize: vi.fn((width, height) => { bounds = { ...bounds, width, height }; }),
    setBounds: vi.fn((nextBounds) => { bounds = { ...nextBounds }; }),
  };
  const model = { id: 'b'.repeat(48), name: path.basename(fixturePath), size: fixtureStats.size };
  const renderer = {
    getURL: () => 'nexoip://app/',
    getTitle: () => 'NexoIP 3D Viewer',
    getZoomFactor: vi.fn(() => zoomFactor),
    setZoomFactor: vi.fn(async (nextZoomFactor) => { zoomFactor = nextZoomFactor; }),
    executeJavaScript: vi.fn(async () => ({
      bridgeAvailable: true,
      modelBytes: fixtureStats.size,
      bundledRuntimes: [
        { runtimePath: '/draco/draco_decoder.wasm', status: 200, bytes: 1 },
        { runtimePath: '/draco/draco_wasm_wrapper.js', status: 200, bytes: 1 },
        { runtimePath: '/basis/basis_transcoder.js', status: 200, bytes: 1 },
        { runtimePath: '/basis/basis_transcoder.wasm', status: 200, bytes: 1 },
      ],
      accessibility: createEvidence(),
    })),
  };

  const report = await runPackagedSelfTest({
    config: { fixturePath, resultPath: path.join(process.cwd(), 'test-results', 'result-a11y.json') },
    scanner: {
      registerDroppedPath: async () => model,
      openModelAsset: async () => ({ stream: Readable.from(Buffer.from('fixture')) }),
    },
    renderer,
    window: applicationWindow,
  });

  expect(report.status).toBe('passed');
  expect(report.checks.accessibilityResponsive.viewport.actualWindow).toEqual({ width: 900, height: 600 });
  expect(report.checks.accessibilityResponsive.viewport.actualZoomFactor).toBe(2);
  expect(report.checks.accessibilityResponsive.restoredWindow).toEqual(originalBounds);
  expect(report.checks.accessibilityResponsive.restoredZoomFactor).toBe(1);
  expect(applicationWindow.setSize).toHaveBeenCalledWith(900, 600);
  expect(applicationWindow.setBounds).toHaveBeenLastCalledWith(originalBounds);
  expect(renderer.setZoomFactor).toHaveBeenNthCalledWith(1, 2);
  expect(renderer.setZoomFactor).toHaveBeenLastCalledWith(1);
  expect(bounds).toEqual(originalBounds);
  expect(zoomFactor).toBe(1);
});

test('packaged self-test restores its viewport state when the renderer accessibility probe rejects', async () => {
  const fixturePath = path.resolve('tests', 'fixtures', 'nexoip-sample.stl');
  const fixtureStats = await fs.promises.stat(fixturePath);
  const originalBounds = { x: 25, y: 35, width: 1440, height: 900 };
  let bounds = { ...originalBounds };
  let zoomFactor = 1.25;
  const viewportAtRendererProbe = [];
  const applicationWindow = {
    getBounds: vi.fn(() => ({ ...bounds })),
    setSize: vi.fn((width, height) => { bounds = { ...bounds, width, height }; }),
    setBounds: vi.fn((nextBounds) => { bounds = { ...nextBounds }; }),
  };
  const model = { id: 'c'.repeat(48), name: path.basename(fixturePath), size: fixtureStats.size };
  const renderer = {
    getURL: () => 'nexoip://app/',
    getTitle: () => 'NexoIP 3D Viewer',
    getZoomFactor: vi.fn(() => zoomFactor),
    setZoomFactor: vi.fn(async (nextZoomFactor) => { zoomFactor = nextZoomFactor; }),
    executeJavaScript: vi.fn(async () => {
      viewportAtRendererProbe.push({ bounds: { ...bounds }, zoomFactor });
      throw new Error('renderer accessibility probe rejected');
    }),
  };

  const report = await runPackagedSelfTest({
    config: { fixturePath, resultPath: path.join(process.cwd(), 'test-results', 'result-a11y-rejection.json') },
    scanner: {
      registerDroppedPath: async () => model,
      openModelAsset: async () => ({ stream: Readable.from(Buffer.from('fixture')) }),
    },
    renderer,
    window: applicationWindow,
  });

  expect(viewportAtRendererProbe).toEqual([{
    bounds: { x: originalBounds.x, y: originalBounds.y, width: 900, height: 600 },
    zoomFactor: 2,
  }]);
  expect(report.status).toBe('failed');
  expect(report.error).toBe('renderer accessibility probe rejected');
  expect(renderer.executeJavaScript).toHaveBeenCalledOnce();
  expect(applicationWindow.setSize).toHaveBeenCalledWith(900, 600);
  expect(applicationWindow.setBounds).toHaveBeenLastCalledWith(originalBounds);
  expect(renderer.setZoomFactor).toHaveBeenNthCalledWith(1, 2);
  expect(renderer.setZoomFactor).toHaveBeenLastCalledWith(1.25);
  expect(bounds).toEqual(originalBounds);
  expect(zoomFactor).toBe(1.25);
});
