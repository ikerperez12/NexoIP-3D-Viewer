import { execFile } from 'node:child_process';
import { expect, test } from '@playwright/test';

function run(command, argumentsList) {
  return new Promise((resolve, reject) => {
    execFile(command, argumentsList, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${error.message}\n${stdout}\n${stderr}`;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

test('packaged Windows smoke keeps debug transports disabled and verifies the local fixture', async () => {
  // The real packaged self-test opens ten representative local assets and
  // waits for the executable to exit cleanly. On a fresh Windows runner that
  // routinely exceeds Playwright's generic 45-second default even when the
  // smoke itself succeeds, so keep this bound explicit and finite.
  // This wraps a bounded 30-second unsafe-startup check plus the packaged
  // self-test's own 180-second timeout. Keep Playwright's outer watchdog
  // above both so it cannot report a false failure first.
  test.setTimeout(240_000);
  test.skip(process.platform !== 'win32', 'Official packages currently target Windows x64.');
  const result = await run(process.execPath, ['scripts/packaged-smoke.mjs']);
  expect(result.stdout).toContain('without CDP');
  expect(result.stderr).toBe('');
});
