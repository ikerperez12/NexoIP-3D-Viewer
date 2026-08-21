import { expect, test } from 'vitest';
import {
  createCatalogRefreshQueue,
  createCatalogRequestGuard,
  getPublishedModelCount,
  mergeCatalogPage,
  responseCatalogChange,
  responseCatalogNeighbor,
  responseCatalogPage,
  supportsCatalogChangeSubscription,
  supportsCatalogV2,
} from '../src/utils/catalog-request.js';

test('a stale catalog response cannot overwrite a newer model-opened catalog selection', async () => {
  const guard = createCatalogRequestGuard();
  const staleRequest = guard.begin();
  let resolveStaleCatalog;
  const staleCatalog = new Promise((resolve) => { resolveStaleCatalog = resolve; });
  const state = {
    files: [],
    currentFile: null,
  };

  const applyStaleCatalog = staleCatalog.then((files) => {
    if (!guard.isCurrent(staleRequest)) return;
    state.files = files;
    state.currentFile = files[0] || null;
  });

  const opened = { id: 'newly-opened', name: 'newly-opened.glb' };
  guard.invalidate();
  state.files = [opened];
  state.currentFile = opened;
  resolveStaleCatalog([{ id: 'stale', name: 'stale.glb' }]);
  await applyStaleCatalog;

  expect(state).toEqual({
    files: [opened],
    currentFile: opened,
  });
});

test('serializes and coalesces progressive catalog refreshes without losing a final refresh', async () => {
  const refreshes = [];
  let resolveFirstRefresh;
  const firstRefresh = new Promise((resolve) => { resolveFirstRefresh = resolve; });
  const queue = createCatalogRefreshQueue(async (options) => {
    refreshes.push(options);
    if (refreshes.length === 1) {
      await firstRefresh;
    }
    return true;
  });

  const first = queue.request({ preserveCurrentSelection: true });
  const repeatedProgress = queue.request({ preserveCurrentSelection: true });
  const final = queue.request({ announce: true });

  expect(queue.isRefreshing()).toBe(true);
  expect(refreshes).toEqual([{ announce: false, preserveCurrentSelection: true }]);

  resolveFirstRefresh();
  await Promise.all([first, repeatedProgress, final]);

  expect(refreshes).toEqual([
    { announce: false, preserveCurrentSelection: true },
    { announce: true, preserveCurrentSelection: false },
  ]);
  expect(queue.isRefreshing()).toBe(false);
});

test('uses the live published count and falls back to legacy scan discovery fields', () => {
  expect(getPublishedModelCount({ availableModels: 7, foundModels: 3 })).toBe(7);
  expect(getPublishedModelCount({ foundModels: 3 })).toBe(3);
  expect(getPublishedModelCount({ foundFiles: 2 })).toBe(2);
  expect(getPublishedModelCount({ availableModels: -1, foundModels: 3 })).toBe(3);
  expect(getPublishedModelCount({ availableModels: 3.5 })).toBeNull();
});

test('accepts only bounded v2 catalog contracts and keeps snapshot pages immutable by revision', () => {
  const bridge = {
    getCatalogPage() {},
    getTreeChildren() {},
    getCatalogNeighbor() {},
    subscribeCatalogChanges() {},
  };
  expect(supportsCatalogV2(bridge)).toBe(true);
  expect(supportsCatalogChangeSubscription(bridge)).toBe(true);
  expect(supportsCatalogChangeSubscription({ ...bridge, subscribeCatalogChanges: undefined })).toBe(false);

  const page = responseCatalogPage({
    catalogRevision: 9,
    scanId: 2,
    isScanning: true,
    reset: false,
    total: 250,
    nextCursor: 'next',
    items: [{ id: 'first', name: 'first.glb' }],
  });
  expect(page.items).toEqual([{ id: 'first', name: 'first.glb' }]);
  expect(mergeCatalogPage({ items: [{ id: 'old' }] }, page, { append: true })).toMatchObject({
    catalogRevision: 9,
    isScanning: true,
    total: 250,
    nextCursor: 'next',
    items: [{ id: 'old' }, { id: 'first', name: 'first.glb' }],
  });
  expect(mergeCatalogPage(null, { ...page, reset: true })).toMatchObject({
    requiresReset: true,
    items: [],
    catalogRevision: 9,
  });
  expect(responseCatalogPage({ ...page, catalogRevision: -1 })).toBeNull();
  expect(responseCatalogPage({ ...page, items: [{ name: 'missing-id.glb' }] })).toBeNull();
});

test('rejects malformed navigation and change events before they can replace visible catalog state', () => {
  expect(responseCatalogNeighbor({
    catalogRevision: 4,
    scanId: 2,
    reset: false,
    model: { id: 'model-4', name: 'current.glb' },
  })).toMatchObject({ model: { id: 'model-4' } });
  expect(responseCatalogNeighbor({ catalogRevision: 4, scanId: 2, reset: false, model: { name: 'unsafe' } })).toBeNull();

  expect(responseCatalogChange({
    catalogRevision: 5,
    scanId: 2,
    modelCount: 12,
    isScanning: true,
    status: 'scanning',
  })).toMatchObject({ catalogRevision: 5, modelCount: 12 });
  expect(responseCatalogChange({ catalogRevision: 5, scanId: 2, modelCount: -1, isScanning: true, status: 'scanning' })).toBeNull();
});
