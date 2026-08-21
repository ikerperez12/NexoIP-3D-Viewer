import { expect, test } from 'vitest';
import { findUnsafePackagedArguments, getPackagedSelfTestRequest } from '../electron/startup-policy.js';
import { getModelAssetMimeType } from '../electron/security.js';

test('packaged startup policy rejects remote debugging, inspector and sandbox bypass switches', () => {
  const rejected = findUnsafePackagedArguments([
    'NexoIP 3D Viewer.exe',
    '--remote-debugging-port=9222',
    '--inspect-brk=9230',
    '--disable-web-security',
    '--no-sandbox',
    '--js-flags=--inspect=9231',
  ]);

  expect(rejected).toEqual([
    '--remote-debugging-port=9222',
    '--inspect-brk=9230',
    '--disable-web-security',
    '--no-sandbox',
    '--js-flags=--inspect=9231',
  ]);
  expect(findUnsafePackagedArguments(['NexoIP 3D Viewer.exe', 'C:\\models\\chair.glb'])).toEqual([]);
});

test('packaged startup policy rejects Chromium feature and field-trial overrides', () => {
  const rejected = findUnsafePackagedArguments([
    '--disable-features=WinSboxForceRendererCodeIntegrity,IsolateOrigins',
    '--enable-features=NetworkServiceInProcess',
    '--force-fieldtrials=RendererCodeIntegrity/Disabled/',
    '--force-fieldtrial-params=RendererCodeIntegrity.Disabled:enabled/true',
    '--variations-server-url=https://example.invalid/seed',
    '--load-extension=C:\\Temp\\untrusted-extension',
    '-disable-features=WinSboxForceRendererCodeIntegrity',
    '/disable-features:WinSboxForceRendererCodeIntegrity',
  ]);

  expect(rejected).toEqual([
    '--disable-features=WinSboxForceRendererCodeIntegrity,IsolateOrigins',
    '--enable-features=NetworkServiceInProcess',
    '--force-fieldtrials=RendererCodeIntegrity/Disabled/',
    '--force-fieldtrial-params=RendererCodeIntegrity.Disabled:enabled/true',
    '--variations-server-url=https://example.invalid/seed',
    '--load-extension=C:\\Temp\\untrusted-extension',
    '-disable-features=WinSboxForceRendererCodeIntegrity',
    '/disable-features:WinSboxForceRendererCodeIntegrity',
  ]);
});

test('packaged startup policy preserves model and bounded self-test arguments', () => {
  const digest = 'b'.repeat(64);
  expect(findUnsafePackagedArguments([
    'NexoIP 3D Viewer.exe',
    'C:\\models\\chair.glb',
    '--nexoip-self-test=C:\\Temp\\nexoip-packaged-self-test-a.json',
    `--nexoip-self-test-token-sha256=${digest}`,
    '--user-data-dir=C:\\Temp\\nexoip-isolated-profile',
  ])).toEqual([]);
});

test('allowed model assets use explicit safe MIME types instead of depending on sniffing', () => {
  expect(getModelAssetMimeType('scene.gltf')).toBe('model/gltf+json');
  expect(getModelAssetMimeType('textures/base-color.png')).toBe('image/png');
  expect(getModelAssetMimeType('mesh.mtl')).toBe('text/plain; charset=utf-8');
  expect(getModelAssetMimeType('unknown.data')).toBe('application/octet-stream');
});

test('the packaged self-test requires exactly one capability file and a SHA-256 digest', () => {
  const digest = 'a'.repeat(64);
  expect(getPackagedSelfTestRequest([
    'NexoIP 3D Viewer.exe',
    '--nexoip-self-test=C:\\Temp\\nexoip-packaged-self-test-a.json',
    `--nexoip-self-test-token-sha256=${digest}`,
  ])).toEqual({
    valid: true,
    configPath: 'C:\\Temp\\nexoip-packaged-self-test-a.json',
    tokenDigest: digest,
  });
  expect(getPackagedSelfTestRequest(['NexoIP 3D Viewer.exe', '--nexoip-self-test=C:\\Temp\\config.json']))
    .toEqual({ valid: false, reason: 'Invalid packaged self-test request.' });
});
