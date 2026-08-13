const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {
  DEV_RENDERER_URL,
  getAppAssetPath,
  getModelRoute,
  isAllowedNavigationUrl,
  isAllowedRendererUrl,
  isSafeRelativePath,
  normalizeDevRendererUrl,
  normalizeFilters,
} = require('../electron/security.js');

test('development renderer URL is restricted to the expected loopback origin', () => {
  assert.equal(normalizeDevRendererUrl('http://127.0.0.1:3000'), DEV_RENDERER_URL);
  assert.throws(() => normalizeDevRendererUrl('http://localhost:3000/'));
  assert.throws(() => normalizeDevRendererUrl('https://127.0.0.1:3000/'));
  assert.throws(() => normalizeDevRendererUrl('http://127.0.0.1:3001/'));
});

test('renderer and navigation URLs reject external or model documents', () => {
  assert.equal(isAllowedRendererUrl('http://127.0.0.1:3000/anything', false), true);
  assert.equal(isAllowedRendererUrl('http://localhost:3000/', false), false);
  assert.equal(isAllowedRendererUrl('nexoip://app/', true), true);
  assert.equal(isAllowedRendererUrl('nexoip://app/model/abc/asset', true), false);
  assert.equal(isAllowedNavigationUrl('https://example.com/', true), false);
});

test('asset and sidecar routes reject traversal and malformed identifiers', () => {
  const distDirectory = path.resolve('dist');
  assert.equal(getAppAssetPath(distDirectory, '/assets/index.js'), path.join(distDirectory, 'assets', 'index.js'));
  assert.equal(getAppAssetPath(distDirectory, '/../package.json'), null);
  assert.equal(getAppAssetPath(distDirectory, '/assets/%2e%2e/package.json'), null);
  assert.equal(isSafeRelativePath('textures/normal.png'), true);
  assert.equal(isSafeRelativePath('../secret.txt'), false);
  assert.equal(isSafeRelativePath('textures\\normal.png'), false);

  const id = 'a'.repeat(48);
  assert.deepEqual(getModelRoute(`/model/${id}/asset`), { id, assetPath: 'asset' });
  assert.deepEqual(getModelRoute(`/model/${id}/textures/normal.png`), { id, assetPath: 'textures/normal.png' });
  assert.equal(getModelRoute(`/model/${id}/../secret.txt`), null);
  assert.equal(getModelRoute('/model/not-an-id/asset'), null);
});

test('filters are allowlisted and bounded to supported extensions', () => {
  assert.deepEqual(normalizeFilters({ query: '  chair ', extension: '.GLB', sortBy: 'size', order: 'desc' }), {
    query: 'chair',
    extension: 'glb',
    sortBy: 'size',
    order: 'desc',
  });
  assert.deepEqual(normalizeFilters({ extension: 'exe', sortBy: 'path', order: 'sideways' }), {
    query: '',
    extension: 'all',
    sortBy: 'name',
    order: 'asc',
  });
});
