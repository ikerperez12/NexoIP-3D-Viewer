const { contextBridge, ipcRenderer, webUtils } = require('electron');

const OPAQUE_ID_PATTERN = /^[a-f0-9]{48}$/;
const CATALOG_TREE_NODE_PATTERN = /^(?:root|folder)-[a-f0-9]{48}$/;
const ALLOWED_FILTERS = new Set(['query', 'extension', 'sortBy', 'order']);
const ALLOWED_CATALOG_PAGE_KEYS = new Set(['filters', 'revision', 'cursor', 'limit']);
const ALLOWED_TREE_REQUEST_KEYS = new Set(['parentId', 'revision', 'cursor', 'limit']);
const ALLOWED_NEIGHBOR_REQUEST_KEYS = new Set(['id', 'relation', 'filters', 'revision']);
const ALLOWED_CATALOG_RELATIONS = new Set(['previous', 'next', 'random']);
const MAX_CATALOG_CURSOR_LENGTH = 512;
const MAX_CATALOG_PAGE_LIMIT = 100;
const CATALOG_CHANGE_STATUSES = new Set(['idle', 'scanning', 'completed', 'cancelled', 'failed']);
const catalogChangeListeners = new Set();
let latestCatalogChange = null;
let catalogChangeScheduled = false;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeFilters(filters) {
  if (filters === undefined) {
    return {};
  }

  if (!isPlainObject(filters)) {
    throw new TypeError('Invalid model filters.');
  }

  const safeFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!ALLOWED_FILTERS.has(key) || typeof value !== 'string' || value.length > 200) {
      throw new TypeError('Invalid model filters.');
    }
    safeFilters[key] = value;
  }
  return safeFilters;
}

function assertOpaqueId(id) {
  if (typeof id !== 'string' || !OPAQUE_ID_PATTERN.test(id)) {
    throw new TypeError('Invalid model identifier.');
  }
}

function assertOnlyKnownKeys(value, allowedKeys, message) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new TypeError(message);
  }
}

function sanitizeCatalogRevision(value) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid catalog revision.');
  }
  return value;
}

function sanitizeCatalogCursor(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CATALOG_CURSOR_LENGTH) {
    throw new TypeError('Invalid catalog cursor.');
  }
  return value;
}

function sanitizeCatalogLimit(value) {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CATALOG_PAGE_LIMIT) {
    throw new TypeError('Invalid catalog page limit.');
  }
  return value;
}

function sanitizeCatalogPageRequest(request) {
  if (request === undefined || request === null) return {};
  if (!isPlainObject(request)) throw new TypeError('Invalid catalog page request.');
  assertOnlyKnownKeys(request, ALLOWED_CATALOG_PAGE_KEYS, 'Invalid catalog page request.');
  return {
    ...(request.filters === undefined ? {} : { filters: sanitizeFilters(request.filters) }),
    ...(request.revision === undefined ? {} : { revision: sanitizeCatalogRevision(request.revision) }),
    ...(request.cursor === undefined ? {} : { cursor: sanitizeCatalogCursor(request.cursor) }),
    ...(request.limit === undefined ? {} : { limit: sanitizeCatalogLimit(request.limit) }),
  };
}

function sanitizeTreeChildrenRequest(request) {
  if (request === undefined || request === null) return {};
  if (!isPlainObject(request)) throw new TypeError('Invalid tree request.');
  assertOnlyKnownKeys(request, ALLOWED_TREE_REQUEST_KEYS, 'Invalid tree request.');
  if (request.parentId !== undefined
    && request.parentId !== 'library'
    && (typeof request.parentId !== 'string' || !CATALOG_TREE_NODE_PATTERN.test(request.parentId))) {
    throw new TypeError('Invalid tree node identifier.');
  }
  return {
    ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
    ...(request.revision === undefined ? {} : { revision: sanitizeCatalogRevision(request.revision) }),
    ...(request.cursor === undefined ? {} : { cursor: sanitizeCatalogCursor(request.cursor) }),
    ...(request.limit === undefined ? {} : { limit: sanitizeCatalogLimit(request.limit) }),
  };
}

function sanitizeCatalogNeighborRequest(request) {
  if (!isPlainObject(request)) throw new TypeError('Invalid catalog navigation request.');
  assertOnlyKnownKeys(request, ALLOWED_NEIGHBOR_REQUEST_KEYS, 'Invalid catalog navigation request.');
  if (!ALLOWED_CATALOG_RELATIONS.has(request.relation)) {
    throw new TypeError('Invalid catalog navigation relation.');
  }
  if (request.relation !== 'random') assertOpaqueId(request.id);
  if (request.id !== undefined && request.id !== null) assertOpaqueId(request.id);
  return {
    relation: request.relation,
    ...(request.id === undefined || request.id === null ? {} : { id: request.id }),
    ...(request.filters === undefined ? {} : { filters: sanitizeFilters(request.filters) }),
    ...(request.revision === undefined ? {} : { revision: sanitizeCatalogRevision(request.revision) }),
  };
}

function isCatalogChange(value) {
  return isPlainObject(value)
    && Number.isSafeInteger(value.catalogRevision)
    && value.catalogRevision >= 0
    && Number.isSafeInteger(value.scanId)
    && value.scanId >= 0
    && Number.isSafeInteger(value.modelCount)
    && value.modelCount >= 0
    && typeof value.isScanning === 'boolean'
    && CATALOG_CHANGE_STATUSES.has(value.status);
}

function publishCatalogChange() {
  catalogChangeScheduled = false;
  const change = latestCatalogChange;
  latestCatalogChange = null;
  if (!change) return;
  for (const listener of catalogChangeListeners) {
    try {
      listener(change);
    } catch {
      // An application listener must not compromise the isolated bridge.
    }
  }
}

ipcRenderer.on('nexoip:catalog-changed', (_event, change) => {
  if (!isCatalogChange(change)) return;
  latestCatalogChange = Object.freeze({ ...change });
  if (catalogChangeScheduled) return;
  catalogChangeScheduled = true;
  queueMicrotask(publishCatalogChange);
});

const nexoip = Object.freeze({
  getCatalogPage(request) {
    return ipcRenderer.invoke('nexoip:get-catalog-page', sanitizeCatalogPageRequest(request));
  },

  getTreeChildren(request) {
    return ipcRenderer.invoke('nexoip:get-tree-children', sanitizeTreeChildrenRequest(request));
  },

  getCatalogNeighbor(request) {
    return ipcRenderer.invoke('nexoip:get-catalog-neighbor', sanitizeCatalogNeighborRequest(request));
  },

  subscribeCatalogChanges(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Catalog listener must be a function.');
    }
    catalogChangeListeners.add(listener);
    return () => catalogChangeListeners.delete(listener);
  },

  scan() {
    return ipcRenderer.invoke('nexoip:scan');
  },

  cancelScan() {
    return ipcRenderer.invoke('nexoip:cancel-scan');
  },

  getScanStatus() {
    return ipcRenderer.invoke('nexoip:get-scan-status');
  },

  consumeStartupModel() {
    return ipcRenderer.invoke('nexoip:consume-startup-model');
  },

  onModelOpened(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Model listener must be a function.');
    }
    ipcRenderer.removeAllListeners('nexoip:model-opened');
    ipcRenderer.on('nexoip:model-opened', (_event, model) => callback(model));
  },

  revealModel(id) {
    assertOpaqueId(id);
    return ipcRenderer.invoke('nexoip:reveal-model', id);
  },

  registerDropped(file) {
    if (!file || typeof file !== 'object') {
      return Promise.reject(new TypeError('Invalid dropped file.'));
    }

    let filePath;
    try {
      filePath = webUtils.getPathForFile(file);
    } catch {
      return Promise.reject(new TypeError('Unable to read the dropped file.'));
    }

    if (!filePath) {
      return Promise.reject(new TypeError('Unable to read the dropped file.'));
    }

    return ipcRenderer.invoke('nexoip:register-dropped', { path: filePath });
  },

  getModelUrl(id) {
    assertOpaqueId(id);
    return `nexoip://app/model/${id}/asset`;
  },
});

contextBridge.exposeInMainWorld('nexoip', nexoip);
