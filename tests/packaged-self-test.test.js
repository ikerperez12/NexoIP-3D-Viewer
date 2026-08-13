import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { loadPackagedSelfTestConfig } from '../electron/packaged-self-test.js';

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
  await fs.promises.writeFile(configPath, JSON.stringify({
    version: 1,
    token,
    fixturePath,
    resultPath,
    ...overrides,
  }));
  return {
    directory,
    configPath,
    fixturePath,
    resultPath,
    tokenDigest: createHash('sha256').update(token).digest('hex'),
  };
}

test('packaged self-test accepts a bounded capability with a canonical sibling result', async () => {
  const capability = await writeCapabilityConfig();
  const config = await loadPackagedSelfTestConfig({
    valid: true,
    configPath: capability.configPath,
    tokenDigest: capability.tokenDigest,
  });

  expect(config.fixturePath).toBe(capability.fixturePath);
  expect(config.resultPath).toBe(path.join(await fs.promises.realpath(capability.directory), 'result-a1.json'));
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
    version: 1,
    token,
    fixturePath: path.resolve('tests', 'fixtures', 'nexoip-sample.stl'),
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
