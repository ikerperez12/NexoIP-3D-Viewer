import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

test('the application protocol and BrowserWindow share a no-cache in-memory session', async () => {
  const mainSource = await readFile(new URL('../electron/main.js', import.meta.url), 'utf8');

  const partition = mainSource.match(/APP_SESSION_PARTITION\s*=\s*'([^']+)'/)?.[1];
  expect(partition).toBeTruthy();
  expect(partition).not.toMatch(/^persist:/i);
  expect(mainSource).toMatch(
    /session\.fromPartition\(APP_SESSION_PARTITION,\s*\{\s*cache:\s*false\s*\}\)/
  );
  expect(mainSource).not.toContain('session.defaultSession');
  expect(mainSource).toContain("currentSession.protocol.handle('nexoip', handleNexoipProtocol)");
  expect(mainSource).toMatch(/webPreferences:\s*\{\s*session:\s*currentSession,/);
});
