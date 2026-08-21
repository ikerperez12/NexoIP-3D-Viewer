import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, '..');
export const ANIMATED_TRIANGLE_GLB_SHA256 = '780e30952df2a6db16face5375e851aeb24801ba4746c93c179ca970fe38bc29';

export const PACKAGED_FIXTURE_MATRIX = Object.freeze([
  Object.freeze({
    scenario: 'glb-animated',
    name: 'animated-triangle.glb',
    extension: 'glb',
    generated: 'animated-triangle',
  }),
  Object.freeze({
    scenario: 'gltf-simple-texture',
    relativePath: 'tests/fixtures/format-matrix/gltf-simple-texture/SimpleTexture.gltf',
  }),
  Object.freeze({
    scenario: 'gltf-meshopt-required',
    relativePath: 'tests/fixtures/format-matrix/meshopt-ext/triangle.gltf',
  }),
  Object.freeze({
    scenario: 'gltf-draco-required',
    relativePath: 'tests/fixtures/format-matrix/draco-required/Box.gltf',
  }),
  Object.freeze({
    scenario: 'gltf-ktx2-required',
    relativePath: 'tests/fixtures/format-matrix/ktx2-required/Ktx2Texture.gltf',
  }),
  Object.freeze({
    scenario: 'obj-multiple-materials',
    relativePath: 'tests/fixtures/format-matrix/obj-multimtl/multi-material.obj',
  }),
  Object.freeze({
    scenario: 'dae-textured-up-axis',
    relativePath: 'tests/fixtures/format-matrix/dae-up-axis/animated-textured.dae',
  }),
  Object.freeze({
    scenario: 'fbx-static',
    relativePath: 'tests/fixtures/format-matrix/fbx-static/lantern-pole.fbx',
  }),
  Object.freeze({
    scenario: 'ply-coloured-mesh',
    relativePath: 'tests/fixtures/format-matrix/ply-mesh/colored-triangle.ply',
  }),
  Object.freeze({
    scenario: 'stl-baseline',
    relativePath: 'tests/fixtures/nexoip-sample.stl',
  }),
]);

function fixtureName(fixture) {
  return fixture.name || path.basename(fixture.relativePath);
}

function fixtureExtension(fixture) {
  return fixture.extension || path.extname(fixture.relativePath).slice(1).toLowerCase();
}

function alignToFourBytes(buffer, fill = 0x20) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(padding, fill)]);
}

// A deterministic, authored GLB is generated in a temporary directory so the
// repository remains text-reviewable while the executable receives real GLB
// bytes over the same opaque-ID protocol as user models.
export function createAnimatedTriangleGlb() {
  const binary = Buffer.alloc(76);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4));
  [0, 1, 2].forEach((value, index) => binary.writeUInt16LE(value, 36 + index * 2));
  binary.writeFloatLE(0, 44);
  binary.writeFloatLE(1, 48);
  [0, 0, 0, 0.25, 0, 0].forEach((value, index) => binary.writeFloatLE(value, 52 + index * 4));

  const document = Buffer.from(JSON.stringify({
    asset: { version: '2.0', generator: 'NexoIP deterministic packaged fixture' },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
      { buffer: 0, byteOffset: 44, byteLength: 8 },
      { buffer: 0, byteOffset: 52, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ name: 'AnimatedTriangle', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    animations: [{
      name: 'Slide',
      samplers: [{ input: 2, output: 3, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
    }],
  }), 'utf8');
  const jsonChunk = alignToFourBytes(document);
  const output = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(output, 20);
  const binaryHeader = 20 + jsonChunk.length;
  output.writeUInt32LE(binary.length, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

export function resolvePackagedFixtureMatrix(repositoryDirectory = DEFAULT_REPOSITORY_DIRECTORY) {
  return PACKAGED_FIXTURE_MATRIX.filter((fixture) => !fixture.generated).map((fixture) => ({
    ...fixture,
    fixturePath: path.resolve(repositoryDirectory, ...fixture.relativePath.split('/')),
    name: fixtureName(fixture),
    extension: fixtureExtension(fixture),
  }));
}

export function assertPackagedFixtureFiles(repositoryDirectory = DEFAULT_REPOSITORY_DIRECTORY) {
  const fixtures = resolvePackagedFixtureMatrix(repositoryDirectory);
  for (const fixture of fixtures) {
    let stats;
    try {
      stats = fs.statSync(fixture.fixturePath);
    } catch {
      throw new Error(`Missing packaged format fixture for scenario ${fixture.scenario}.`);
    }
    if (!stats.isFile() || stats.size === 0) {
      throw new Error(`Packaged format fixture is not a non-empty file for scenario ${fixture.scenario}.`);
    }
  }
  return fixtures;
}

export async function preparePackagedFixtureMatrix(repositoryDirectory = DEFAULT_REPOSITORY_DIRECTORY) {
  const persistedFixtures = new Map(assertPackagedFixtureFiles(repositoryDirectory)
    .map((fixture) => [fixture.scenario, fixture]));
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexoip-format-matrix-'));
  try {
    const fixtures = [];
    for (const fixture of PACKAGED_FIXTURE_MATRIX) {
      if (!fixture.generated) {
        fixtures.push(persistedFixtures.get(fixture.scenario));
        continue;
      }
      if (fixture.generated !== 'animated-triangle') {
        throw new Error(`Unsupported generated packaged fixture ${fixture.scenario}.`);
      }
      const fixturePath = path.join(temporaryDirectory, fixtureName(fixture));
      await fs.promises.writeFile(fixturePath, createAnimatedTriangleGlb());
      fixtures.push({
        ...fixture,
        fixturePath,
        name: fixtureName(fixture),
        extension: fixtureExtension(fixture),
      });
    }

    return {
      fixtures,
      async cleanup() {
        await fs.promises.rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      },
    };
  } catch (error) {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    throw error;
  }
}

export function assertPackagedFixtureMatrixReport(report, artifactLabel = 'Packaged application') {
  const actualMatrix = report?.checks?.formatMatrix;
  if (!Array.isArray(actualMatrix) || actualMatrix.length !== PACKAGED_FIXTURE_MATRIX.length) {
    throw new Error(`${artifactLabel} did not report every packaged format-matrix scenario.`);
  }

  for (let index = 0; index < PACKAGED_FIXTURE_MATRIX.length; index += 1) {
    const expected = PACKAGED_FIXTURE_MATRIX[index];
    const actual = actualMatrix[index];
    const expectedName = fixtureName(expected);
    const expectedExtension = fixtureExtension(expected);
    const valid = actual?.name === expectedName
      && actual?.extension === expectedExtension
      && Number.isSafeInteger(actual?.size) && actual.size > 0
      && Number.isSafeInteger(actual?.bytesRead) && actual.bytesRead > 0
      && Number.isSafeInteger(actual?.modelBytes) && actual.modelBytes === actual.size
      && actual?.eventDispatches === 1
      && actual?.exactModelMarker === true
      && actual?.canvas?.present === true
      && Number.isSafeInteger(actual.canvas.width) && actual.canvas.width > 0
      && Number.isSafeInteger(actual.canvas.height) && actual.canvas.height > 0
      && (actual?.webglContext === 'webgl2' || actual?.webglContext === 'webgl')
      && actual?.contextLost === false
      && actual?.dialogOpened === false;
    if (!valid) {
      throw new Error(`${artifactLabel} failed packaged format-matrix scenario ${expected.scenario}.`);
    }

    if (Object.hasOwn(actual, 'path') || Object.hasOwn(actual, 'fixturePath')) {
      throw new Error(`${artifactLabel} exposed a local fixture path in its format-matrix report.`);
    }
  }
}
