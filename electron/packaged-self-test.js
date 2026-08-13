import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPathInside, isSupportedModelPath } from './security.js';

const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_ASSET_PROBE_BYTES = 64 * 1024;
const TEMP_CONFIG_PATTERN = /^nexoip-packaged-self-test-[a-f0-9]+\.json$/;
const TEMP_RESULT_PATTERN = /^result-[a-f0-9]+\.json$/;

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

export async function runPackagedSelfTest({ scanner, config, renderer }) {
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

    const rendererChecks = await renderer.executeJavaScript(`(async () => {
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
      return { bridgeAvailable, modelBytes, bundledRuntimes };
    })()`);
    if (!rendererChecks.bridgeAvailable || rendererChecks.modelBytes !== fixtureStats.size) {
      throw new Error('The packaged preload bridge or private model protocol did not return the approved fixture.');
    }
    if (rendererChecks.bundledRuntimes.some((runtime) => runtime.status !== 200 || runtime.bytes === 0)) {
      throw new Error('A bundled Draco or Basis runtime was not available from the packaged application origin.');
    }

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
    };
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
