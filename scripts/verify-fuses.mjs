import fs from 'node:fs';
import path from 'node:path';
import {
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from '@electron/fuses';

const appPath = path.resolve(
  process.argv[2] || path.join('release', 'win-unpacked', 'NexoIP 3D Viewer.exe'),
);

if (!fs.existsSync(appPath)) {
  throw new Error(`Packaged executable not found: ${appPath}`);
}

const actual = await getCurrentFuseWire(appPath);
if (actual.version !== FuseVersion.V1) {
  throw new Error(`Unsupported Electron fuse schema: ${actual.version}`);
}

const expected = new Map([
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
  [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE],
]);

const actualFuseIndexes = Object.keys(actual)
  .filter((key) => /^\d+$/.test(key))
  .map(Number)
  .sort((left, right) => left - right);
const expectedFuseIndexes = [...expected.keys()].sort((left, right) => left - right);

if (actualFuseIndexes.length !== expectedFuseIndexes.length) {
  throw new Error(
    `Electron exposes ${actualFuseIndexes.length} fuses, but ${expectedFuseIndexes.length} are explicitly verified. Update the release policy before packaging a new Electron major.`,
  );
}

for (const [fuse, expectedState] of expected) {
  if (actual[fuse] !== expectedState) {
    throw new Error(
      `${FuseV1Options[fuse]} has state ${actual[fuse]}, expected ${expectedState}.`,
    );
  }
}

console.log(`Verified ${expected.size} Electron fuses in ${path.basename(appPath)}.`);
