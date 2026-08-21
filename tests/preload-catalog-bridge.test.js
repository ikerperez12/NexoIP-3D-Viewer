import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD_PATH = path.join(__dirname, '..', 'electron', 'preload.cjs');

function loadPreloadBridge() {
  let bridge;
  let catalogChangeHandler;
  const invoke = vi.fn(() => Promise.resolve(null));
  const ipcRenderer = {
    invoke,
    on: vi.fn((channel, listener) => {
      if (channel === 'nexoip:catalog-changed') catalogChangeHandler = listener;
    }),
    removeAllListeners: vi.fn(),
  };
  const context = {
    require: (moduleName) => {
      if (moduleName !== 'electron') throw new Error(`Unexpected dependency: ${moduleName}`);
      return {
        contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } },
        ipcRenderer,
        webUtils: { getPathForFile: () => '' },
      };
    },
    queueMicrotask,
    Object,
    Set,
    Number,
    TypeError,
  };
  vm.runInNewContext(fs.readFileSync(PRELOAD_PATH, 'utf8'), context, { filename: PRELOAD_PATH });
  return { bridge, invoke, getCatalogChangeHandler: () => catalogChangeHandler };
}

test('preload exposes bounded catalog APIs and rejects unsafe request shapes before IPC', async () => {
  const { bridge, invoke } = loadPreloadBridge();
  const revision = 7;
  await bridge.getCatalogPage({ revision, limit: 50, filters: { query: 'safe' } });
  expect(invoke).toHaveBeenLastCalledWith('nexoip:get-catalog-page', {
    revision,
    limit: 50,
    filters: { query: 'safe' },
  });

  await bridge.getTreeChildren({ parentId: 'library', revision, limit: 10 });
  expect(invoke).toHaveBeenLastCalledWith('nexoip:get-tree-children', {
    parentId: 'library',
    revision,
    limit: 10,
  });

  expect(() => bridge.getCatalogPage({ limit: 101 })).toThrow('Invalid catalog page limit');
  expect(() => bridge.getTreeChildren({ parentId: 'C:\\private' })).toThrow('Invalid tree node identifier');
  expect(() => bridge.getCatalogNeighbor({ relation: 'next', id: 'not-an-id' }))
    .toThrow('Invalid model identifier');
  expect(invoke).toHaveBeenCalledTimes(2);
});

test('preload coalesces catalog metadata events and returns an unsubscribe handle', async () => {
  const { bridge, getCatalogChangeHandler } = loadPreloadBridge();
  const received = [];
  const unsubscribe = bridge.subscribeCatalogChanges((change) => received.push(change));
  const publish = getCatalogChangeHandler();

  publish({}, {
    catalogRevision: 3,
    scanId: 1,
    modelCount: 4,
    isScanning: true,
    status: 'scanning',
  });
  publish({}, {
    catalogRevision: 4,
    scanId: 1,
    modelCount: 5,
    isScanning: true,
    status: 'scanning',
  });
  await Promise.resolve();

  expect(received).toEqual([{
    catalogRevision: 4,
    scanId: 1,
    modelCount: 5,
    isScanning: true,
    status: 'scanning',
  }]);
  expect(JSON.stringify(received)).not.toContain('path');
  unsubscribe();
  publish({}, {
    catalogRevision: 5,
    scanId: 1,
    modelCount: 5,
    isScanning: false,
    status: 'cancelled',
  });
  await Promise.resolve();
  expect(received).toHaveLength(1);
});
