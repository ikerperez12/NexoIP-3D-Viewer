import { expect, test } from 'vitest';
import {
  createCatalogRefreshQueue,
  createCatalogRequestGuard,
  getPublishedModelCount,
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
