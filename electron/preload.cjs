const { contextBridge, ipcRenderer, webUtils } = require('electron');

const OPAQUE_ID_PATTERN = /^[a-f0-9]{48}$/;
const ALLOWED_FILTERS = new Set(['query', 'extension', 'sortBy', 'order']);

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

const nexoip = Object.freeze({
  listModels(filters) {
    return ipcRenderer.invoke('nexoip:list-models', sanitizeFilters(filters));
  },

  getTree() {
    return ipcRenderer.invoke('nexoip:get-tree');
  },

  scan() {
    return ipcRenderer.invoke('nexoip:scan');
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
