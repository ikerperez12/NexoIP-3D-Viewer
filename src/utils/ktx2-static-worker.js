const STATIC_KTX2_WORKER_FILE = 'ktx2-transcoder-worker.js';

function createWorkerCapability() {
  const bytes = new Uint32Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('');
}

function hasWorkerPool(loader) {
  return loader
    && typeof loader.init === 'function'
    && loader.workerPool
    && typeof loader.workerPool.setWorkerCreator === 'function';
}

/**
 * Keep Basis' legacy dynamic-code requirement out of the renderer CSP.
 *
 * KTX2Loader normally serializes Basis' JS wrapper into a blob worker. That
 * worker inherits the renderer policy, which intentionally forbids
 * `unsafe-eval`. We let KTX2Loader fetch and validate its ordinary resources,
 * then replace only its worker factory with a static, same-origin worker. The
 * Electron main process grants the isolated worker a narrow CSP exception.
 */
export function configureKtx2StaticWorker(ktx2Loader, basisRoot) {
  if (!hasWorkerPool(ktx2Loader) || typeof basisRoot !== 'string') {
    throw new TypeError('KTX2 loader cannot be configured with the static transcoder worker.');
  }

  const originalInit = ktx2Loader.init.bind(ktx2Loader);
  const workerUrl = new URL(STATIC_KTX2_WORKER_FILE, basisRoot).href;
  let configured = false;

  ktx2Loader.init = async function initializeWithStaticWorker() {
    await originalInit();
    if (configured) return;

    if (!(this.transcoderBinary instanceof ArrayBuffer) || !this.workerConfig) {
      throw new Error('KTX2 transcoder resources are unavailable.');
    }
    const workerConstants = {
      engine: this.constructor.EngineFormat,
      transcoder: this.constructor.TranscoderFormat,
      basis: this.constructor.BasisFormat,
    };
    if (!workerConstants.engine || !workerConstants.transcoder || !workerConstants.basis) {
      throw new Error('KTX2 transcoder constants are unavailable.');
    }

    const transientBlobUrl = this.workerSourceURL;
    this.workerPool.setWorkerCreator(() => {
      const worker = new Worker(workerUrl, { name: 'nexoip-ktx2-transcoder' });
      const capability = createWorkerCapability();
      const authenticatedWorker = {
        addEventListener: worker.addEventListener.bind(worker),
        terminate: worker.terminate.bind(worker),
        postMessage(message, transfer) {
          worker.postMessage({ ...message, capability }, transfer);
        },
      };
      const transcoderBinary = this.transcoderBinary.slice(0);
      authenticatedWorker.postMessage({
        type: 'init',
        config: this.workerConfig,
        constants: workerConstants,
        transcoderBinary,
      }, [transcoderBinary]);
      return authenticatedWorker;
    });

    if (transientBlobUrl) URL.revokeObjectURL(transientBlobUrl);
    this.workerSourceURL = '';
    configured = true;
  };

  return ktx2Loader;
}
