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
  test.skip(process.platform !== 'win32', 'Official packages currently target Windows x64.');
  const result = await run(process.execPath, ['scripts/packaged-smoke.mjs']);
  expect(result.stdout).toContain('without CDP');
  expect(result.stderr).toBe('');
});
