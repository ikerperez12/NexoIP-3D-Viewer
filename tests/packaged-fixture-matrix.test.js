import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, test } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ANIMATED_TRIANGLE_GLB_SHA256,
  PACKAGED_FIXTURE_MATRIX,
  PACKAGED_LOADER_REJECTION_MATRIX,
  PACKAGED_REJECTION_MATRIX,
  assertPackagedFixtureFiles,
  assertPackagedFixtureMatrixReport,
  assertPackagedLoaderRejectionFiles,
  assertPackagedLoaderRejectionMatrixReport,
  assertPackagedRejectionFiles,
  assertPackagedRejectionMatrixReport,
  assertPackagedWebglRecoveryReport,
  createAnimatedTriangleGlb,
  preparePackagedFixtureMatrix,
} from '../scripts/packaged-fixture-matrix.mjs';

function createPassingReport() {
  return {
    checks: {
      formatMatrix: PACKAGED_FIXTURE_MATRIX.map((fixture) => ({
        name: fixture.name || path.basename(fixture.relativePath),
        extension: fixture.extension || path.extname(fixture.relativePath).slice(1).toLowerCase(),
        size: 128,
        bytesRead: 128,
        modelBytes: 128,
        eventDispatches: 1,
        exactModelMarker: true,
        canvas: { present: true, width: 800, height: 600 },
        webglContext: 'webgl2',
        contextLost: false,
        dialogOpened: false,
      })),
      rejectedFormatMatrix: PACKAGED_REJECTION_MATRIX.map((fixture) => ({
        name: path.basename(fixture.relativePath),
        extension: path.extname(fixture.relativePath).slice(1).toLowerCase(),
        size: 64,
        rejectedBeforePublication: true,
      })),
      loaderRejectedFormatMatrix: PACKAGED_LOADER_REJECTION_MATRIX.map((fixture) => ({
        name: path.basename(fixture.relativePath),
        extension: path.extname(fixture.relativePath).slice(1).toLowerCase(),
        size: 64,
        registered: true,
        protocolBytesComplete: true,
        errorDialogVisible: true,
        safeErrorMessage: true,
        failedMarkerAbsent: true,
        loadingSettled: true,
        canvasPresent: true,
        recoveredToLibrary: true,
      })),
      webglRecovery: {
        lossEventPrevented: true,
        lossDialogVisible: true,
        recoveryActionVisible: true,
        generationAdvanced: true,
        canvasReplaced: true,
        modelReloaded: true,
        loadingSettled: true,
        dialogClosed: true,
        contextHealthy: true,
      },
    },
  };
}

test('packaged fixture manifest resolves persisted and generated real-format scenarios', async () => {
  const persistedFixtures = assertPackagedFixtureFiles();
  expect(persistedFixtures).toHaveLength(9);
  expect(assertPackagedRejectionFiles()).toHaveLength(6);
  expect(assertPackagedLoaderRejectionFiles()).toHaveLength(1);
  const prepared = await preparePackagedFixtureMatrix();
  try {
    const fixtures = prepared.fixtures;
    expect(fixtures).toHaveLength(10);
    expect(new Set(fixtures.map((fixture) => fixture.scenario)).size).toBe(fixtures.length);
    expect(new Set(fixtures.map((fixture) => fixture.fixturePath.toLowerCase())).size).toBe(fixtures.length);
    expect(fixtures.map((fixture) => fixture.extension)).toEqual([
      'glb', 'gltf', 'gltf', 'gltf', 'gltf', 'obj', 'dae', 'fbx', 'ply', 'stl',
    ]);
    expect(prepared.rejectedFixtures).toHaveLength(6);
    expect(prepared.loaderRejectedFixtures).toHaveLength(1);
  } finally {
    await prepared.cleanup();
  }
});

test('generated GLB is a real animated binary glTF asset', async () => {
  const bytes = createAnimatedTriangleGlb();
  expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ANIMATED_TRIANGLE_GLB_SHA256);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  expect(gltf.scene.children).toHaveLength(1);
  expect(gltf.animations).toHaveLength(1);
  expect(gltf.animations[0].name).toBe('Slide');
});

test('packaged fixture report accepts complete real-load evidence without local paths', () => {
  const report = createPassingReport();
  expect(() => assertPackagedFixtureMatrixReport(report, 'Test artifact')).not.toThrow();
  expect(() => assertPackagedRejectionMatrixReport(report, 'Test artifact')).not.toThrow();
  expect(() => assertPackagedLoaderRejectionMatrixReport(report, 'Test artifact')).not.toThrow();
  expect(() => assertPackagedWebglRecoveryReport(report, 'Test artifact')).not.toThrow();
  expect(JSON.stringify(report.checks.formatMatrix)).not.toContain('fixturePath');
  expect(JSON.stringify(report.checks.rejectedFormatMatrix)).not.toContain('fixturePath');
  expect(JSON.stringify(report.checks.loaderRejectedFormatMatrix)).not.toContain('fixturePath');
});

test('packaged fixture report rejects missing scenarios and ambiguous load evidence', () => {
  const missing = createPassingReport();
  missing.checks.formatMatrix.pop();
  expect(() => assertPackagedFixtureMatrixReport(missing, 'Test artifact'))
    .toThrow('every packaged format-matrix scenario');

  const ambiguous = createPassingReport();
  ambiguous.checks.formatMatrix[3].exactModelMarker = false;
  expect(() => assertPackagedFixtureMatrixReport(ambiguous, 'Test artifact'))
    .toThrow('gltf-draco-required');
});

test('packaged fixture report rejects local filesystem path fields', () => {
  const report = createPassingReport();
  report.checks.formatMatrix[0].fixturePath = 'C:\\private\\fixture.gltf';
  expect(() => assertPackagedFixtureMatrixReport(report, 'Test artifact'))
    .toThrow('exposed a local fixture path');
});

test('packaged rejection report requires every hostile candidate to fail before publication', () => {
  const missing = createPassingReport();
  missing.checks.rejectedFormatMatrix.pop();
  expect(() => assertPackagedRejectionMatrixReport(missing, 'Test artifact'))
    .toThrow('every packaged rejection scenario');

  const accepted = createPassingReport();
  accepted.checks.rejectedFormatMatrix[1].rejectedBeforePublication = false;
  expect(() => assertPackagedRejectionMatrixReport(accepted, 'Test artifact'))
    .toThrow('obj-geometry-free');
});

test('packaged loader-rejection report requires safe recovery without local diagnostics', () => {
  const missing = createPassingReport();
  missing.checks.loaderRejectedFormatMatrix.pop();
  expect(() => assertPackagedLoaderRejectionMatrixReport(missing, 'Test artifact'))
    .toThrow('every packaged loader-rejection scenario');

  const unsafe = createPassingReport();
  unsafe.checks.loaderRejectedFormatMatrix[0].safeErrorMessage = false;
  expect(() => assertPackagedLoaderRejectionMatrixReport(unsafe, 'Test artifact'))
    .toThrow('obj-missing-material');

  const diagnosticLeak = createPassingReport();
  diagnosticLeak.checks.loaderRejectedFormatMatrix[0].errorMessage = 'C:\\private\\missing.mtl';
  expect(() => assertPackagedLoaderRejectionMatrixReport(diagnosticLeak, 'Test artifact'))
    .toThrow('may contain a local path');
});

test('packaged WebGL recovery report requires a replaced healthy context without identifiers', () => {
  const incomplete = createPassingReport();
  incomplete.checks.webglRecovery.canvasReplaced = false;
  expect(() => assertPackagedWebglRecoveryReport(incomplete, 'Test artifact'))
    .toThrow('complete packaged WebGL recovery evidence');

  const diagnosticLeak = createPassingReport();
  diagnosticLeak.checks.webglRecovery.modelId = 'a'.repeat(48);
  expect(() => assertPackagedWebglRecoveryReport(diagnosticLeak, 'Test artifact'))
    .toThrow('unnecessary WebGL recovery diagnostics');
});
