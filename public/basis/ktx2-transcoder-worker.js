/* global BASIS, importScripts, self */
/*
 * Static KTX2 worker for NexoIP 3D Viewer.
 *
 * Derived from THREE.KTX2Loader.BasisWorker in three@0.165.0 (MIT). Keeping
 * this worker as a separately served, tightly scoped script lets the renderer
 * retain a strict CSP: the Basis wrapper requires dynamic code generation,
 * but that capability is never granted to the UI or the application bridge.
 */

'use strict';

let bootstrapError = null;
let config = null;
let constants = null;
let basisModule = null;
let transcoderPending = null;

try {
  importScripts('./basis_transcoder.js');
  if (typeof BASIS !== 'function') bootstrapError = 'Basis transcoder bootstrap failed.';
} catch {
  bootstrapError = 'Basis transcoder bootstrap failed.';
}

function fail(id, message) {
  self.postMessage({ type: 'error', id, error: message });
}

function initialize(message) {
  if (bootstrapError) return;
  if (!message?.config || !message?.constants || !(message.transcoderBinary instanceof ArrayBuffer)) {
    bootstrapError = 'Basis transcoder initialization failed.';
    return;
  }

  config = message.config;
  constants = message.constants;
  if (!constants.engine || !constants.transcoder || !constants.basis) {
    bootstrapError = 'Basis transcoder initialization failed.';
    return;
  }

  transcoderPending = new Promise((resolve, reject) => {
    try {
      basisModule = {
        wasmBinary: message.transcoderBinary,
        onAbort: () => reject(new Error('Basis transcoder initialization failed.')),
        onRuntimeInitialized: resolve,
      };
      BASIS(basisModule);
    } catch {
      reject(new Error('Basis transcoder initialization failed.'));
    }
  }).then(() => {
    basisModule.initializeBasis();
    if (basisModule.KTX2File === undefined) {
      throw new Error('Basis transcoder initialization failed.');
    }
  });

  transcoderPending.catch(() => {
    bootstrapError = 'Basis transcoder initialization failed.';
  });
}

function selectTranscoderFormat(basisFormat, width, height, hasAlpha) {
  const { engine, transcoder, basis } = constants;
  const options = [
    {
      if: 'astcSupported', basisFormat: [basis.UASTC_4x4],
      transcoderFormat: [transcoder.ASTC_4x4, transcoder.ASTC_4x4],
      engineFormat: [engine.RGBA_ASTC_4x4_Format, engine.RGBA_ASTC_4x4_Format],
      priorityEtc1s: Infinity, priorityUastc: 1, needsPowerOfTwo: false,
    },
    {
      if: 'bptcSupported', basisFormat: [basis.ETC1S, basis.UASTC_4x4],
      transcoderFormat: [transcoder.BC7_M5, transcoder.BC7_M5],
      engineFormat: [engine.RGBA_BPTC_Format, engine.RGBA_BPTC_Format],
      priorityEtc1s: 3, priorityUastc: 2, needsPowerOfTwo: false,
    },
    {
      if: 'dxtSupported', basisFormat: [basis.ETC1S, basis.UASTC_4x4],
      transcoderFormat: [transcoder.BC1, transcoder.BC3],
      engineFormat: [engine.RGBA_S3TC_DXT1_Format, engine.RGBA_S3TC_DXT5_Format],
      priorityEtc1s: 4, priorityUastc: 5, needsPowerOfTwo: false,
    },
    {
      if: 'etc2Supported', basisFormat: [basis.ETC1S, basis.UASTC_4x4],
      transcoderFormat: [transcoder.ETC1, transcoder.ETC2],
      engineFormat: [engine.RGB_ETC2_Format, engine.RGBA_ETC2_EAC_Format],
      priorityEtc1s: 1, priorityUastc: 3, needsPowerOfTwo: false,
    },
    {
      if: 'etc1Supported', basisFormat: [basis.ETC1S, basis.UASTC_4x4],
      transcoderFormat: [transcoder.ETC1], engineFormat: [engine.RGB_ETC1_Format],
      priorityEtc1s: 2, priorityUastc: 4, needsPowerOfTwo: false,
    },
    {
      if: 'pvrtcSupported', basisFormat: [basis.ETC1S, basis.UASTC_4x4],
      transcoderFormat: [transcoder.PVRTC1_4_RGB, transcoder.PVRTC1_4_RGBA],
      engineFormat: [engine.RGB_PVRTC_4BPPV1_Format, engine.RGBA_PVRTC_4BPPV1_Format],
      priorityEtc1s: 5, priorityUastc: 6, needsPowerOfTwo: true,
    },
  ].sort((left, right) => (
    basisFormat === basis.ETC1S
      ? left.priorityEtc1s - right.priorityEtc1s
      : left.priorityUastc - right.priorityUastc
  ));

  for (const option of options) {
    if (!config[option.if] || !option.basisFormat.includes(basisFormat)) continue;
    if (hasAlpha && option.transcoderFormat.length < 2) continue;
    if (option.needsPowerOfTwo && !isPowerOfTwo(width, height)) continue;
    return {
      transcoderFormat: option.transcoderFormat[hasAlpha ? 1 : 0],
      engineFormat: option.engineFormat[hasAlpha ? 1 : 0],
    };
  }

  return {
    transcoderFormat: transcoder.RGBA32,
    engineFormat: engine.RGBAFormat,
  };
}

function isPowerOfTwo(width, height) {
  return [width, height].every((value) => value <= 2 || ((value & (value - 1)) === 0 && value !== 0));
}

function concat(arrays) {
  if (arrays.length === 1) return arrays[0];
  const total = arrays.reduce((size, array) => size + array.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }
  return result;
}

function transcode(buffer) {
  const { basis } = constants;
  const ktx2File = new basisModule.KTX2File(new Uint8Array(buffer));
  const cleanup = () => {
    ktx2File.close();
    ktx2File.delete();
  };

  if (!ktx2File.isValid()) {
    cleanup();
    throw new Error('Invalid or unsupported KTX2 texture.');
  }

  const basisFormat = ktx2File.isUASTC() ? basis.UASTC_4x4 : basis.ETC1S;
  const width = ktx2File.getWidth();
  const height = ktx2File.getHeight();
  const layerCount = ktx2File.getLayers() || 1;
  const levelCount = ktx2File.getLevels();
  const faceCount = ktx2File.getFaces();
  const hasAlpha = ktx2File.getHasAlpha();
  const dfdFlags = ktx2File.getDFDFlags();
  const { transcoderFormat, engineFormat } = selectTranscoderFormat(basisFormat, width, height, hasAlpha);

  if (!width || !height || !levelCount || !faceCount) {
    cleanup();
    throw new Error('Invalid KTX2 texture.');
  }
  if (!ktx2File.startTranscoding()) {
    cleanup();
    throw new Error('KTX2 transcoding could not start.');
  }

  const faces = [];
  const buffers = [];
  for (let face = 0; face < faceCount; face += 1) {
    const mipmaps = [];
    for (let mip = 0; mip < levelCount; mip += 1) {
      const layerMips = [];
      let mipWidth;
      let mipHeight;
      for (let layer = 0; layer < layerCount; layer += 1) {
        const levelInfo = ktx2File.getImageLevelInfo(mip, layer, face);
        mipWidth = levelCount > 1 ? levelInfo.origWidth : levelInfo.width;
        mipHeight = levelCount > 1 ? levelInfo.origHeight : levelInfo.height;
        const destination = new Uint8Array(
          ktx2File.getImageTranscodedSizeInBytes(mip, layer, face, transcoderFormat),
        );
        if (!ktx2File.transcodeImage(destination, mip, layer, face, transcoderFormat, 0, -1, -1)) {
          cleanup();
          throw new Error('KTX2 transcoding failed.');
        }
        layerMips.push(destination);
      }
      const data = concat(layerMips);
      mipmaps.push({ data, width: mipWidth, height: mipHeight });
      buffers.push(data.buffer);
    }
    faces.push({ mipmaps, width, height, format: engineFormat });
  }
  cleanup();
  return { faces, buffers, width, height, hasAlpha, format: engineFormat, dfdFlags };
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'init') {
    initialize(message);
    return;
  }
  if (message?.type !== 'transcode') return;
  if (bootstrapError || !transcoderPending) {
    fail(message.id, bootstrapError || 'Basis transcoder is not initialized.');
    return;
  }

  transcoderPending.then(() => {
    try {
      const result = transcode(message.buffer);
      self.postMessage({ type: 'transcode', id: message.id, ...result }, result.buffers);
    } catch (error) {
      fail(message.id, error instanceof Error ? error.message : 'KTX2 transcoding failed.');
    }
  }).catch(() => {
    fail(message.id, 'Basis transcoder initialization failed.');
  });
});
