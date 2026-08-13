import path from 'node:path';
import { expect, test } from 'vitest';
import {
  DEV_RENDERER_URL,
  getAppAssetPath,
  getModelRoute,
  isAllowedNavigationUrl,
  isAllowedRendererUrl,
  isSafeRelativePath,
  normalizeDevRendererUrl,
  normalizeFilters,
} from '../electron/security.js';

test('development renderer URL is restricted to the expected loopback origin', () => {
  expect(normalizeDevRendererUrl('http://127.0.0.1:3000')).toBe(DEV_RENDERER_URL);
  expect(() => normalizeDevRendererUrl('http://localhost:3000/')).toThrow();
  expect(() => normalizeDevRendererUrl('https://127.0.0.1:3000/')).toThrow();
  expect(() => normalizeDevRendererUrl('http://127.0.0.1:3001/')).toThrow();
});

test('renderer and navigation URLs reject external or model documents', () => {
  expect(isAllowedRendererUrl('http://127.0.0.1:3000/anything', false)).toBe(true);
  expect(isAllowedRendererUrl('http://localhost:3000/', false)).toBe(false);
  expect(isAllowedRendererUrl('nexoip://app/', true)).toBe(true);
  expect(isAllowedRendererUrl('nexoip://app/model/abc/asset', true)).toBe(false);
  expect(isAllowedNavigationUrl('https://example.com/', true)).toBe(false);
});

test('asset and sidecar routes reject traversal and malformed identifiers', () => {
  const distDirectory = path.resolve('dist');
  expect(getAppAssetPath(distDirectory, '/assets/index.js')).toBe(path.join(distDirectory, 'assets', 'index.js'));
  expect(getAppAssetPath(distDirectory, '/../package.json')).toBeNull();
  expect(getAppAssetPath(distDirectory, '/assets/%2e%2e/package.json')).toBeNull();
  expect(isSafeRelativePath('textures/normal.png')).toBe(true);
  expect(isSafeRelativePath('../secret.txt')).toBe(false);
  expect(isSafeRelativePath('textures\\normal.png')).toBe(false);

  const id = 'a'.repeat(48);
  expect(getModelRoute(`/model/${id}/asset`)).toEqual({ id, assetPath: 'asset' });
  expect(getModelRoute(`/model/${id}/textures/normal.png`)).toEqual({ id, assetPath: 'textures/normal.png' });
  expect(getModelRoute(`/model/${id}/../secret.txt`)).toBeNull();
  expect(getModelRoute('/model/not-an-id/asset')).toBeNull();
});

test('filters are allowlisted and bounded to supported extensions', () => {
  expect(normalizeFilters({ query: '  chair ', extension: '.GLB', sortBy: 'size', order: 'desc' })).toEqual({
    query: 'chair',
    extension: 'glb',
    sortBy: 'size',
    order: 'desc',
  });
  expect(normalizeFilters({ extension: 'exe', sortBy: 'path', order: 'sideways' })).toEqual({
    query: '',
    extension: 'all',
    sortBy: 'name',
    order: 'asc',
  });
});
