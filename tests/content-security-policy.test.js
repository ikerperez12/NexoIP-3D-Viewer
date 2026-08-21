import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import {
  KTX2_TRANSCODER_WORKER_PATH,
  PACKAGED_KTX2_WORKER_CSP,
  PACKAGED_RENDERER_CSP,
  getPackagedContentSecurityPolicy,
} from '../electron/security.js';

function directiveTokens(policy, directiveName) {
  const directive = policy.match(new RegExp(`(?:^|;)\\s*${directiveName}\\s+([^;]+)`))?.[1] || '';
  return directive.trim().split(/\s+/).filter(Boolean);
}

test('packaged and development renderer policies allow only bundled WebAssembly compilation', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../electron/main.js', import.meta.url), 'utf8')
  ]);
  const policies = [
    html.match(/content="([^"]*script-src[^"]*)"/)?.[1],
    PACKAGED_RENDERER_CSP,
  ];

  for (const policy of policies) {
    expect(policy).toBeTruthy();
    expect(directiveTokens(policy, 'script-src')).toContain("'wasm-unsafe-eval'");
    expect(directiveTokens(policy, 'script-src')).not.toContain("'unsafe-eval'");
    expect(directiveTokens(policy, 'connect-src')).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']));
  }
  expect(main).toContain('getPackagedContentSecurityPolicy(new URL(details.url).pathname)');
});

test('only the fixed static Basis worker receives the legacy dynamic-code exception', async () => {
  const worker = await readFile(new URL('../public/basis/ktx2-transcoder-worker.js', import.meta.url), 'utf8');

  expect(getPackagedContentSecurityPolicy(KTX2_TRANSCODER_WORKER_PATH)).toBe(PACKAGED_KTX2_WORKER_CSP);
  expect(getPackagedContentSecurityPolicy('/basis/another-worker.js')).toBe(PACKAGED_RENDERER_CSP);
  expect(directiveTokens(PACKAGED_KTX2_WORKER_CSP, 'script-src')).toEqual(
    expect.arrayContaining(["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"]),
  );
  expect(directiveTokens(PACKAGED_KTX2_WORKER_CSP, 'connect-src')).toEqual(["'none'"]);
  expect(directiveTokens(PACKAGED_KTX2_WORKER_CSP, 'worker-src')).toEqual(["'none'"]);
  expect(worker).toContain("importScripts('./basis_transcoder.js')");
  expect(worker).not.toMatch(/\b(?:eval|new\s+Function)\s*\(/);
});
