export function createCatalogRequestGuard() {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(requestGeneration) {
      return requestGeneration === generation;
    },
  };
}

function normalizeRefreshOptions(options = {}) {
  return {
    announce: Boolean(options.announce),
    preserveCurrentSelection: Boolean(options.preserveCurrentSelection),
  };
}

function mergeRefreshOptions(previous, next) {
  if (!previous) return normalizeRefreshOptions(next);

  const nextOptions = normalizeRefreshOptions(next);
  return {
    // A manual refresh should still receive its one confirmation, even if it
    // joins a background refresh started by progressive scan discovery.
    announce: previous.announce || nextOptions.announce,
    // A final refresh must be allowed to select a replacement when the prior
    // model no longer belongs to the completed scan result.
    preserveCurrentSelection: previous.preserveCurrentSelection && nextOptions.preserveCurrentSelection,
  };
}

/**
 * Coalesces catalog refresh requests into one-at-a-time loads. This prevents
 * list/tree IPC replies from racing each other while a scan is publishing new
 * structurally prechecked models continuously.
 */
export function createCatalogRefreshQueue(refreshCatalog) {
  if (typeof refreshCatalog !== 'function') {
    throw new TypeError('A catalog refresh function is required.');
  }

  let pendingOptions = null;
  let activeRefresh = null;

  const drain = async () => {
    let result = false;
    while (pendingOptions) {
      const options = pendingOptions;
      pendingOptions = null;
      result = await refreshCatalog(options);
    }
    return result;
  };

  return {
    request(options = {}) {
      pendingOptions = mergeRefreshOptions(pendingOptions, options);
      if (!activeRefresh) {
        activeRefresh = drain().finally(() => {
          activeRefresh = null;
        });
      }
      return activeRefresh;
    },
    isRefreshing() {
      return activeRefresh !== null;
    },
  };
}

/**
 * `availableModels` is the scanner's live published catalog total. Older
 * bridge versions only expose `foundModels`, so use it as a safe fallback.
 */
export function getPublishedModelCount(scanStatus) {
  const availableModels = scanStatus?.availableModels;
  if (Number.isSafeInteger(availableModels) && availableModels >= 0) {
    return availableModels;
  }

  const foundModels = scanStatus?.foundModels ?? scanStatus?.foundFiles;
  if (Number.isSafeInteger(foundModels) && foundModels >= 0) {
    return foundModels;
  }

  return null;
}

// The main process enforces this transfer budget too. Keeping it in the
// renderer lets all catalogue callers make their bounded intent explicit.
export const CATALOG_PAGE_LIMIT = 100;
export const CATALOG_SEARCH_DEBOUNCE_MS = 300;
// This is a renderer-only cache key. The actual bridge request deliberately
// omits `parentId` for the library root, so the renderer does not rely on an
// implementation-specific opaque root identifier.
export const CATALOG_TREE_ROOT_PAGE_KEY = '__catalog-root__';

export function supportsCatalogV2(bridge) {
  return Boolean(bridge)
    && typeof bridge.getCatalogPage === 'function'
    && typeof bridge.getTreeChildren === 'function'
    && typeof bridge.getCatalogNeighbor === 'function';
}

export function supportsCatalogChangeSubscription(bridge) {
  return supportsCatalogV2(bridge)
    && typeof bridge?.subscribeCatalogChanges === 'function';
}

export function normalizeCatalogFilters(filters = {}) {
  return {
    query: typeof filters.query === 'string' ? filters.query.trim().slice(0, 200) : '',
    extension: typeof filters.extension === 'string' ? filters.extension : 'all',
    sortBy: 'name',
    order: 'asc',
  };
}

export function responseCatalogPage(response) {
  const page = response?.data ?? response;
  if (!page || typeof page !== 'object' || !Array.isArray(page.items)) return null;
  if (!Number.isSafeInteger(page.catalogRevision) || page.catalogRevision < 0) return null;
  if (!Number.isSafeInteger(page.scanId) || page.scanId < 0) return null;
  if (!Number.isSafeInteger(page.total) || page.total < 0) return null;
  if (typeof page.reset !== 'boolean' || typeof page.isScanning !== 'boolean') return null;
  if (page.nextCursor !== null && typeof page.nextCursor !== 'string') return null;
  if (page.items.length > page.total && !page.reset) return null;
  if (page.items.some((item) => !item || typeof item.id !== 'string')) return null;

  return {
    catalogRevision: page.catalogRevision,
    scanId: page.scanId,
    isScanning: page.isScanning,
    reset: page.reset,
    total: page.total,
    nextCursor: page.nextCursor,
    items: page.items,
  };
}

export function responseCatalogNeighbor(response) {
  const neighbor = response?.data ?? response;
  if (!neighbor || typeof neighbor !== 'object') return null;
  if (!Number.isSafeInteger(neighbor.catalogRevision) || neighbor.catalogRevision < 0) return null;
  if (!Number.isSafeInteger(neighbor.scanId) || neighbor.scanId < 0) return null;
  if (typeof neighbor.reset !== 'boolean') return null;
  if (neighbor.model !== null && (!neighbor.model || typeof neighbor.model.id !== 'string')) return null;

  return {
    catalogRevision: neighbor.catalogRevision,
    scanId: neighbor.scanId,
    reset: neighbor.reset,
    model: neighbor.model,
  };
}

export function responseCatalogChange(change) {
  if (!change || typeof change !== 'object') return null;
  if (!Number.isSafeInteger(change.catalogRevision) || change.catalogRevision < 0) return null;
  if (!Number.isSafeInteger(change.scanId) || change.scanId < 0) return null;
  if (!Number.isSafeInteger(change.modelCount) || change.modelCount < 0) return null;
  if (typeof change.isScanning !== 'boolean' || typeof change.status !== 'string') return null;

  return {
    catalogRevision: change.catalogRevision,
    scanId: change.scanId,
    modelCount: change.modelCount,
    isScanning: change.isScanning,
    status: change.status,
  };
}

export function mergeCatalogItems(previousItems, incomingItems) {
  const byId = new Map();
  for (const item of previousItems || []) {
    if (item?.id) byId.set(item.id, item);
  }
  for (const item of incomingItems || []) {
    if (item?.id) byId.set(item.id, item);
  }
  return [...byId.values()];
}

/**
 * Applies one bounded snapshot page. `reset: true` is intentionally not
 * merged: the caller must restart at cursor null against the new revision.
 */
export function mergeCatalogPage(previous, page, { append = false } = {}) {
  if (!page || page.reset) {
    return {
      requiresReset: true,
      items: [],
      nextCursor: null,
      total: page?.total ?? 0,
      catalogRevision: page?.catalogRevision ?? null,
      scanId: page?.scanId ?? null,
      isScanning: Boolean(page?.isScanning),
    };
  }

  return {
    requiresReset: false,
    items: append ? mergeCatalogItems(previous?.items, page.items) : page.items,
    nextCursor: page.nextCursor,
    total: page.total,
    catalogRevision: page.catalogRevision,
    scanId: page.scanId,
    isScanning: page.isScanning,
  };
}
