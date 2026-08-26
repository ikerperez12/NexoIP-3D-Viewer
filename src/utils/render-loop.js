function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function.`);
}

/**
 * Coalesces viewport mutations into a single animation frame and only keeps a
 * frame loop alive while the caller reports active motion.
 */
export function createDemandRenderScheduler({ requestFrame, cancelFrame, onFrame, onError }) {
  requireFunction(requestFrame, 'requestFrame');
  requireFunction(cancelFrame, 'cancelFrame');
  requireFunction(onFrame, 'onFrame');

  let frameId = null;
  let previousTimestamp = null;
  let suspended = false;
  let disposed = false;

  const schedule = () => {
    if (disposed || suspended || frameId !== null) return false;
    frameId = requestFrame(runFrame);
    return true;
  };

  function runFrame(timestamp) {
    frameId = null;
    if (disposed || suspended) {
      previousTimestamp = null;
      return;
    }

    const finiteTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
    const deltaSeconds = previousTimestamp === null
      ? 0
      : Math.min(Math.max((finiteTimestamp - previousTimestamp) / 1000, 0), 0.1);
    previousTimestamp = finiteTimestamp;

    let keepAlive;
    try {
      keepAlive = Boolean(onFrame({ timestamp: finiteTimestamp, deltaSeconds }));
    } catch (error) {
      previousTimestamp = null;
      onError?.(error);
      return;
    }

    if (keepAlive) {
      schedule();
    } else if (frameId === null) {
      previousTimestamp = null;
    }
  }

  return {
    invalidate: schedule,
    setSuspended(nextSuspended) {
      const next = Boolean(nextSuspended);
      if (suspended === next || disposed) return;
      suspended = next;
      previousTimestamp = null;
      if (suspended) {
        if (frameId !== null) cancelFrame(frameId);
        frameId = null;
      } else {
        schedule();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameId !== null) cancelFrame(frameId);
      frameId = null;
      previousTimestamp = null;
    },
    isIdle() {
      return frameId === null;
    },
  };
}
