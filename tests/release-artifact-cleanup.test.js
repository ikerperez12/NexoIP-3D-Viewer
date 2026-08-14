import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  cleanupTemporaryNsisInstallation,
  getNsisRegistryKeys,
  getNsisRegistryLocations,
} from '../scripts/release-artifact-smoke.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.promises.rm(directory, { recursive: true, force: true })));
});

async function createCorruptUninstaller() {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nexoip-corrupt-uninstaller-test-'));
  temporaryDirectories.push(directory);
  const uninstallerPath = path.join(directory, 'Uninstall NexoIP.exe');
  await fs.promises.writeFile(uninstallerPath, 'not a Windows executable');
  return uninstallerPath;
}

test('NSIS preflight covers every exact install and uninstall registry location', () => {
  const registryKeys = getNsisRegistryKeys({ nsisGuid: '195abf82-5ba1-59b2-940c-d7f53e2f3f74' });

  expect(registryKeys).toEqual([
    {
      kind: 'install',
      registryPath: 'Software\\195abf82-5ba1-59b2-940c-d7f53e2f3f74',
    },
    {
      kind: 'uninstall',
      registryPath: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\195abf82-5ba1-59b2-940c-d7f53e2f3f74',
    },
  ]);
  expect(getNsisRegistryLocations(registryKeys).map(({ rootKey, registryPath }) =>
    `${rootKey}\\${registryPath}`)).toHaveLength(4);
});

test('cleanup falls back to verified residues when the uninstaller is missing', async () => {
  const uninstall = vi.fn();
  const removeResidues = vi.fn();
  const residueArguments = { ownership: 'verified by caller' };

  await cleanupTemporaryNsisInstallation({
    uninstallerPath: path.join(os.tmpdir(), `missing-nexoip-uninstaller-${process.pid}.exe`),
    uninstallerAttempted: false,
    uninstallArguments: {},
    residueArguments,
    uninstall,
    removeResidues,
  });

  expect(uninstall).not.toHaveBeenCalled();
  expect(removeResidues).toHaveBeenCalledOnce();
  expect(removeResidues).toHaveBeenCalledWith(residueArguments);
});

test('cleanup falls back to verified residues when the uninstaller is corrupt', async () => {
  const uninstallerPath = await createCorruptUninstaller();
  const uninstallFailure = new Error('corrupt executable');
  const uninstall = vi.fn().mockRejectedValue(uninstallFailure);
  const removeResidues = vi.fn();

  await cleanupTemporaryNsisInstallation({
    uninstallerPath,
    uninstallerAttempted: false,
    uninstallArguments: { uninstallerPath },
    residueArguments: { uninstallerPath },
    uninstall,
    removeResidues,
  });

  expect(uninstall).toHaveBeenCalledOnce();
  expect(removeResidues).toHaveBeenCalledOnce();
});

test('cleanup fails closed when residue ownership cannot be proved', async () => {
  const uninstallerPath = await createCorruptUninstaller();
  const uninstallFailure = new Error('corrupt executable');
  const ownershipFailure = new Error('shortcut target does not match the temporary installation');

  let caught;
  try {
    await cleanupTemporaryNsisInstallation({
      uninstallerPath,
      uninstallerAttempted: false,
      uninstallArguments: { uninstallerPath },
      residueArguments: { uninstallerPath },
      uninstall: vi.fn().mockRejectedValue(uninstallFailure),
      removeResidues: vi.fn().mockRejectedValue(ownershipFailure),
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  expect(caught.errors).toEqual([uninstallFailure, ownershipFailure]);
  expect(caught.message).toContain('without stronger ownership evidence');
});

test('main arms cleanup before validating the produced uninstaller', () => {
  const source = fs.readFileSync(path.resolve('scripts', 'release-artifact-smoke.mjs'), 'utf8');
  const mainStart = source.indexOf('async function main()');
  const successfulExitCheck = source.indexOf('assert(installation.code === 0', mainStart);
  const cleanupArm = source.indexOf('nsisInstallationNeedsCleanup = true;', successfulExitCheck);
  const uninstallerValidation = source.indexOf("assertRegularFile(uninstallerPath, 'NSIS uninstaller executable');", successfulExitCheck);

  expect(mainStart).toBeGreaterThanOrEqual(0);
  expect(successfulExitCheck).toBeGreaterThan(mainStart);
  expect(cleanupArm).toBeGreaterThan(successfulExitCheck);
  expect(cleanupArm).toBeLessThan(uninstallerValidation);
  expect(source).toContain('if (nsisInstallationNeedsCleanup) {');
  expect(source).not.toContain('if (nsisInstallationNeedsCleanup && uninstallerPath) {');
});
