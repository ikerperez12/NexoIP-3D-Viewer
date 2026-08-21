import { createHash } from 'node:crypto';
import path from 'node:path';
import { expect, test } from 'vitest';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  ANIMATED_TRIANGLE_GLB_SHA256,
  PACKAGED_FIXTURE_MATRIX,
  assertPackagedFixtureFiles,
  assertPackagedFixtureMatrixReport,
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
    },
  };
}

test('packaged fixture manifest resolves persisted and generated real-format scenarios', async () => {
  const persistedFixtures = assertPackagedFixtureFiles();
  expect(persistedFixtures).toHaveLength(9);
  const prepared = await preparePackagedFixtureMatrix();
  try {
    const fixtures = prepared.fixtures;
    expect(fixtures).toHaveLength(10);
    expect(new Set(fixtures.map((fixture) => fixture.scenario)).size).toBe(fixtures.length);
    expect(new Set(fixtures.map((fixture) => fixture.fixturePath.toLowerCase())).size).toBe(fixtures.length);
    expect(fixtures.map((fixture) => fixture.extension)).toEqual([
      'glb', 'gltf', 'gltf', 'gltf', 'gltf', 'obj', 'dae', 'fbx', 'ply', 'stl',
    ]);
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
  expect(JSON.stringify(report.checks.formatMatrix)).not.toContain('fixturePath');
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
