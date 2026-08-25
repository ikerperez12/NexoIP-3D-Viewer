import path from 'node:path';

export const MAX_MODEL_PREFLIGHT_BYTES = 256 * 1024;

const GLB_MAGIC = 0x46546C67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4E4F534A;
const BINARY_STL_HEADER_BYTES = 84;
const BINARY_STL_TRIANGLE_BYTES = 50;
const FBX_BINARY_HEADER = Buffer.from('Kaydara FBX Binary  \0\x1A\0', 'binary');

function toText(bytes) {
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasSupportedGltfAsset(document) {
  return isPlainObject(document)
    && isPlainObject(document.asset)
    && typeof document.asset.version === 'string'
    && /^2(?:\.\d+)?$/.test(document.asset.version);
}

function hasRenderableGltfMesh(document) {
  return hasSupportedGltfAsset(document)
    && Array.isArray(document.meshes)
    && document.meshes.some((mesh) => isPlainObject(mesh)
      && Array.isArray(mesh.primitives)
      && mesh.primitives.some((primitive) => isPlainObject(primitive)
        && isPlainObject(primitive.attributes)
        && Object.keys(primitive.attributes).length > 0));
}

function parseCompactGltfJson(bytes) {
  const text = toText(bytes);
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || trimmed.includes('\0')) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isSemanticallyValidCompactGltf(bytes) {
  const document = parseCompactGltfJson(bytes);
  return document !== null && hasRenderableGltfMesh(document);
}

function isStructurallyValidGlb(bytes, size) {
  // A header alone is not an asset. GLB 2.0 requires a first JSON chunk whose
  // declared, four-byte-aligned extent fits the file. Compact JSON chunks also
  // need at least one renderable mesh before the model enters the catalog.
  if (bytes.length < 20 || size < 20) return false;
  const magic = bytes.readUInt32LE(0);
  const version = bytes.readUInt32LE(4);
  const declaredLength = bytes.readUInt32LE(8);
  if (magic !== GLB_MAGIC || version !== GLB_VERSION || declaredLength !== size) return false;

  const jsonChunkLength = bytes.readUInt32LE(12);
  const jsonChunkType = bytes.readUInt32LE(16);
  const jsonChunkEnd = 20 + jsonChunkLength;
  if (jsonChunkType !== GLB_JSON_CHUNK_TYPE
    || jsonChunkLength === 0
    || jsonChunkLength % 4 !== 0
    || jsonChunkEnd > size) {
    return false;
  }

  if (jsonChunkEnd <= bytes.length) {
    if (!isSemanticallyValidCompactGltf(bytes.subarray(20, jsonChunkEnd))) return false;
  } else {
    // Very large embedded JSON stays on the bounded-prefix path so indexing a
    // library never requires buffering a complete model in the main process.
    const jsonPrefix = toText(bytes.subarray(20));
    const trimmedPrefix = jsonPrefix.trimStart();
    if (!trimmedPrefix.startsWith('{') || trimmedPrefix.includes('\0')) return false;
  }

  // When the whole compact GLB was read, ensure every declared chunk fits the
  // container. A large GLB remains bounded to the first validation window.
  if (bytes.length < size) return true;
  let chunkOffset = jsonChunkEnd;
  while (chunkOffset < size) {
    if (chunkOffset + 8 > size) return false;
    const chunkLength = bytes.readUInt32LE(chunkOffset);
    if (chunkLength % 4 !== 0 || chunkOffset + 8 + chunkLength > size) return false;
    chunkOffset += 8 + chunkLength;
  }
  return chunkOffset === size;
}

function isStructurallyValidGltf(bytes, size) {
  // JSON metadata can legitimately be large because data URIs may be embedded.
  // Keep the scan bounded. Compact documents must describe renderable geometry;
  // oversized candidates retain a prefix-only preflight and are fully parsed
  // by the renderer when opened.
  if (size > bytes.length) {
    const text = toText(bytes);
    const trimmed = text.trimStart();
    return trimmed.startsWith('{') && !trimmed.includes('\0');
  }
  return isSemanticallyValidCompactGltf(bytes);
}

function isStructurallyValidObj(bytes, size) {
  const text = toText(bytes);
  if (!text.trim() || text.includes('\0')) return false;
  const hasVertex = /^v\s+[-+.\deE]+\s+[-+.\deE]+\s+[-+.\deE]+(?:\s|$)/m.test(text);
  const hasPrimitive = /^(?:f|l|p)\s+\S+/m.test(text);
  if (hasVertex && hasPrimitive) return true;

  // Do not exclude an unusually large valid OBJ whose long header pushes its
  // first primitive beyond the bounded validation window.
  return size > bytes.length && /^(?:o|g|mtllib|usemtl|v|vn|vt)\s+/m.test(text);
}

function isStructurallyValidPly(bytes) {
  const text = toText(bytes);
  const headerEnd = text.search(/^end_header\s*$/m);
  if (!/^ply(?:\r?\n|\r)/.test(text)
    || !/^format\s+(?:ascii|binary_little_endian|binary_big_endian)\s+1\.0\s*$/m.test(text)
    || headerEnd < 0) {
    return false;
  }
  const header = text.slice(0, headerEnd);
  const vertexMatch = header.match(/^element\s+vertex\s+(\d+)\s*$/m);
  return Boolean(vertexMatch)
    && Number.parseInt(vertexMatch[1], 10) > 0
    && /^property\s+\S+\s+x\s*$/m.test(header)
    && /^property\s+\S+\s+y\s*$/m.test(header)
    && /^property\s+\S+\s+z\s*$/m.test(header);
}

function isStructurallyValidFbx(bytes, size) {
  if (bytes.length >= FBX_BINARY_HEADER.length
    && bytes.subarray(0, FBX_BINARY_HEADER.length).equals(FBX_BINARY_HEADER)) {
    const hasGeometryMarkers = bytes.includes(Buffer.from('Geometry'))
      && bytes.includes(Buffer.from('Vertices'));
    return hasGeometryMarkers || size > bytes.length;
  }

  const text = toText(bytes);
  const hasHeader = /^;\s*FBX\b/im.test(text) || /\bFBXHeaderExtension\s*:/m.test(text);
  const hasMesh = /\bGeometry\s*:\s*[^\r\n]*["']Mesh["']/m.test(text)
    && /\bVertices\s*:/m.test(text);
  return hasHeader && (hasMesh || size > bytes.length);
}

function isStructurallyValidDae(bytes, size) {
  const text = toText(bytes);
  const hasHeader = /<\s*COLLADA(?:\s|>)/i.test(text);
  const hasGeometry = /<\s*geometry(?:\s|>)/i.test(text)
    && /<\s*mesh(?:\s|>)/i.test(text)
    && /<\s*(?:triangles|polylist|polygons|lines|linestrips|trifans|tristrips)(?:\s|>)/i.test(text);
  return hasHeader && (hasGeometry || size > bytes.length);
}

function isStructurallyValidStl(bytes, size) {
  if (bytes.length >= BINARY_STL_HEADER_BYTES) {
    const triangleCount = bytes.readUInt32LE(80);
    const declaredLength = BINARY_STL_HEADER_BYTES + (triangleCount * BINARY_STL_TRIANGLE_BYTES);
    if (triangleCount > 0 && Number.isSafeInteger(declaredLength) && declaredLength === size) {
      return true;
    }
  }

  const text = toText(bytes);
  const trimmed = text.trimStart();
  if (!/^solid(?:\s|$)/i.test(trimmed)) return false;
  if (!/\bfacet\s+normal\b/i.test(text) || !/\bouter\s+loop\b/i.test(text) || !/\bvertex\b/i.test(text)) {
    return false;
  }
  return size > bytes.length || /\bendsolid\b/i.test(text);
}

// This deliberately verifies bounded, format-specific structure and rejects
// compact geometry-free files before publication. The renderer loader remains
// responsible for full parsing, dependency resolution, and fidelity checks.
export function isPreflightValidModel(filePath, bytes, size) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.glb':
      return isStructurallyValidGlb(bytes, size);
    case '.gltf':
      return isStructurallyValidGltf(bytes, size);
    case '.obj':
      return isStructurallyValidObj(bytes, size);
    case '.ply':
      return isStructurallyValidPly(bytes);
    case '.fbx':
      return isStructurallyValidFbx(bytes, size);
    case '.dae':
      return isStructurallyValidDae(bytes, size);
    case '.stl':
      return isStructurallyValidStl(bytes, size);
    default:
      return false;
  }
}
