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
 * validated models continuously.
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
