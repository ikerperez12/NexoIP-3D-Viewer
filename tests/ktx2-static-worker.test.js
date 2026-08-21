import { afterEach, expect, test, vi } from 'vitest';
import { configureKtx2StaticWorker } from '../src/utils/ktx2-static-worker.js';

const originalWorker = globalThis.Worker;

afterEach(() => {
  globalThis.Worker = originalWorker;
  vi.restoreAllMocks();
});

function createLoader({ binary = new ArrayBuffer(8) } = {}) {
  const workerPool = { setWorkerCreator: vi.fn() };
  return {
    init: vi.fn(async function initialize() {
      this.transcoderBinary = binary;
      this.workerConfig = { dxtSupported: true };
      this.workerSourceURL = 'blob:nexoip-transient';
    }),
    workerPool,
    workerSourceURL: 'blob:nexoip-transient',
    constructor: {
      EngineFormat: { RGBAFormat: 1023 },
      TranscoderFormat: { RGBA32: 13 },
      BasisFormat: { ETC1S: 0, UASTC_4x4: 1 },
    },
  };
}

test('KTX2 uses a fixed same-origin worker after loading Three resources', async () => {
  const loader = createLoader();
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const workerMessages = [];
  globalThis.Worker = class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
    }

    postMessage(message, transfer) {
      workerMessages.push({ message, transfer, worker: this });
    }
  };

  configureKtx2StaticWorker(loader, 'nexoip://app/basis/');
  await loader.init();
  await loader.init();

  expect(loader.workerPool.setWorkerCreator).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledWith('blob:nexoip-transient');
  const worker = loader.workerPool.setWorkerCreator.mock.calls[0][0]();
  expect(worker.url).toBe('nexoip://app/basis/ktx2-transcoder-worker.js');
  expect(worker.options).toEqual({ name: 'nexoip-ktx2-transcoder' });
  expect(workerMessages).toHaveLength(1);
  expect(workerMessages[0].message).toMatchObject({
    type: 'init',
    config: { dxtSupported: true },
    constants: {
      engine: loader.constructor.EngineFormat,
      transcoder: loader.constructor.TranscoderFormat,
      basis: loader.constructor.BasisFormat,
    },
  });
  expect(workerMessages[0].transfer).toHaveLength(1);
  expect(workerMessages[0].transfer[0]).toBeInstanceOf(ArrayBuffer);
});

test('KTX2 static worker setup rejects incomplete loader resources', async () => {
  const loader = createLoader({ binary: null });
  configureKtx2StaticWorker(loader, 'nexoip://app/basis/');

  await expect(loader.init()).rejects.toThrow('KTX2 transcoder resources are unavailable');
  expect(loader.workerPool.setWorkerCreator).not.toHaveBeenCalled();
});
