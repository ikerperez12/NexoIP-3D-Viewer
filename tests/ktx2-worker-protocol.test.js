import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { expect, test, vi } from 'vitest';

const VALID_CAPABILITY = '0123456789abcdef0123456789abcdef';

async function createWorkerHarness() {
  const source = await readFile(
    new URL('../public/basis/ktx2-transcoder-worker.js', import.meta.url),
    'utf8',
  );
  let messageHandler = null;
  const outbound = [];
  const basisBootstrap = vi.fn((module) => {
    module.initializeBasis = vi.fn();
    module.KTX2File = class FakeKtx2File {};
    module.onRuntimeInitialized();
  });
  const self = {
    addEventListener(type, handler) {
      if (type === 'message') messageHandler = handler;
    },
    postMessage(message) {
      outbound.push(message);
    },
  };

  vm.runInNewContext(source, {
    ArrayBuffer,
    BASIS: basisBootstrap,
    Error,
    Promise,
    Uint8Array,
    importScripts: vi.fn(),
    self,
  });

  return {
    basisBootstrap,
    dispatch(data, origin = '') {
      messageHandler({ data, origin });
    },
    outbound,
  };
}

function validInit(overrides = {}) {
  return {
    type: 'init',
    capability: VALID_CAPABILITY,
    config: { dxtSupported: true },
    constants: {
      engine: { RGBAFormat: 1023 },
      transcoder: { RGBA32: 13 },
      basis: { ETC1S: 0, UASTC_4x4: 1 },
    },
    transcoderBinary: new ArrayBuffer(8),
    ...overrides,
  };
}

test('KTX2 worker rejects messages outside its dedicated-worker channel invariant', async () => {
  const harness = await createWorkerHarness();
  harness.dispatch(validInit(), 'https://untrusted.example');

  expect(harness.basisBootstrap).not.toHaveBeenCalled();
  expect(harness.outbound).toEqual([]);
});

test('KTX2 worker authenticates the session and rejects malformed transcode requests', async () => {
  const harness = await createWorkerHarness();
  harness.dispatch(validInit());
  expect(harness.basisBootstrap).toHaveBeenCalledTimes(1);

  harness.dispatch({
    type: 'transcode',
    capability: 'ffffffffffffffffffffffffffffffff',
    buffer: new ArrayBuffer(8),
  });
  harness.dispatch({
    type: 'transcode',
    capability: VALID_CAPABILITY,
    buffer: 'not-an-array-buffer',
  });

  expect(harness.outbound).toEqual([
    { type: 'error', id: undefined, error: 'Invalid KTX2 transcoding request.' },
    { type: 'error', id: undefined, error: 'Invalid KTX2 transcoding request.' },
  ]);
});

test('KTX2 worker initializes only once for one authenticated session', async () => {
  const harness = await createWorkerHarness();
  harness.dispatch(validInit());
  harness.dispatch(validInit({ capability: 'ffffffffffffffffffffffffffffffff' }));

  expect(harness.basisBootstrap).toHaveBeenCalledTimes(1);
});
