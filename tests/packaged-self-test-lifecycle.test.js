import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('the packaged self-test flushes its report marker before exiting without renderer teardown', async () => {
  const mainSource = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');
  const runner = mainSource.match(/async function runConfiguredPackagedSelfTest\(\) \{[\s\S]*?\n\}/)?.[0];
  const selfTestBranch = mainSource.match(/if \(packagedSelfTestRequest\) \{\s*await runConfiguredPackagedSelfTest\(\);[\s\S]*?\n\s*\}/)?.[0];

  expect(runner).toBeTruthy();
  expect(runner.indexOf('await writePackagedSelfTestReport')).toBeLessThan(runner.indexOf('await new Promise'));
  expect(runner).toContain("process.stdout.write('NexoIP packaged self-test passed without a debugging transport.\\n', (error) =>");

  expect(selfTestBranch).toBeTruthy();
  expect(selfTestBranch).toContain('app.exit(0);');
  expect(selfTestBranch).not.toContain('app.quit();');
  expect(selfTestBranch.indexOf('await runConfiguredPackagedSelfTest();')).toBeLessThan(selfTestBranch.indexOf('app.exit(0);'));
});

test('normal interactive shutdown remains graceful', async () => {
  const mainSource = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');

  expect(mainSource).toMatch(/app\.on\('window-all-closed',[\s\S]*?app\.quit\(\);/);
  expect(mainSource).toMatch(/app\.on\('activate',[\s\S]*?void createWindow\(\);/);
});
