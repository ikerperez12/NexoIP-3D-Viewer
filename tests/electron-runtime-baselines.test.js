import fs from 'node:fs';
import { expect, test } from 'vitest';

const packageManifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const runtimeBaselines = JSON.parse(
  fs.readFileSync(new URL('../security/electron-runtime-baselines.json', import.meta.url), 'utf8'),
);
const releaseWorkflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

test('the reviewed Electron runtime baseline has a strict schema and matches the packaged runtime', () => {
  const electronVersion = packageManifest.devDependencies.electron;

  expect(Object.keys(runtimeBaselines).sort()).toEqual(['baselines', 'schemaVersion']);
  expect(runtimeBaselines.schemaVersion).toBe(1);
  expect(Array.isArray(runtimeBaselines.baselines)).toBe(true);

  const matches = runtimeBaselines.baselines.filter((baseline) => baseline.electronVersion === electronVersion);
  expect(matches).toHaveLength(1);

  const [baseline] = matches;
  expect(Object.keys(baseline).sort()).toEqual(['artifactName', 'electronVersion', 'sha256']);
  expect(baseline.artifactName).toBe(`electron-v${electronVersion}-win32-x64.zip`);
  expect(baseline.sha256).toMatch(/^[a-f0-9]{64}$/);
});

test('the release workflow validates the committed pin before using the remote Electron checksum', () => {
  const baselineValidation = releaseWorkflow.indexOf('- name: Validate committed Electron runtime baseline');
  const dependencyInstall = releaseWorkflow.indexOf('- name: Install locked dependencies');
  const runtimeDownload = releaseWorkflow.indexOf('- name: Download and verify the official Electron runtime baseline');
  const signingVerification = releaseWorkflow.indexOf('- name: Verify NexoIP signatures and official Electron runtime PE integrity');
  const validationStep = releaseWorkflow.slice(baselineValidation, dependencyInstall);
  const downloadStep = releaseWorkflow.slice(runtimeDownload, signingVerification);

  expect(baselineValidation).toBeGreaterThan(-1);
  expect(runtimeDownload).toBeGreaterThan(baselineValidation);
  expect(dependencyInstall).toBeGreaterThan(runtimeDownload);
  expect(signingVerification).toBeGreaterThan(runtimeDownload);
  expect(validationStep).toContain("$manifestPath = 'security/electron-runtime-baselines.json'");
  expect(validationStep).toContain('manifest.schemaVersion -cne 1');
  expect(validationStep).toContain('$expectedArtifactName = "electron-v$electronVersion-win32-x64.zip"');
  expect(validationStep).toContain("$pinnedHash -cnotmatch '^[a-f0-9]{64}$'");
  expect(downloadStep).toContain('ELECTRON_RUNTIME_SHA256: ${{ steps.electron_runtime_baseline.outputs.archive_sha256 }}');
  expect(downloadStep).toContain('$officialHash -cne $pinnedHash');
  expect(downloadStep).toContain('$actualHash -cne $pinnedHash');
  expect(downloadStep).toContain('does not match the committed runtime baseline pin');
});
