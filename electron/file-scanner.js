import fs from 'node:fs';
import path from 'node:path';
import {
  randomBytes,
  createHash,
  createHmac,
  timingSafeEqual,
  randomInt,
} from 'node:crypto';
import {
  isOpaqueId,
  isPathInside,
  isSafeRelativePath,
  isSupportedModelPath,
  isSupportedSidecarPath,
  normalizeFilters,
  safeResolveUnder,
} from './security.js';

export const MAX_MODEL_BYTES = 256 * 1024 * 1024;

// This is a scheduling interval, not a scan limit. A broad library must be
// fully discoverable, while Electron still needs opportunities to deliver a
// cancellation request and repaint progress during a very dense directory.
const SCAN_YIELD_INTERVAL = 128;
const SCAN_CATALOG_PUBLICATION_INTERVAL_MS = 200;
const MAX_STRUCTURAL_VALIDATION_BYTES = 256 * 1024;
const GLB_MAGIC = 0x46546C67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4E4F534A;
const BINARY_STL_HEADER_BYTES = 84;
const BINARY_STL_TRIANGLE_BYTES = 50;
const FBX_BINARY_HEADER = Buffer.from('Kaydara FBX Binary  \0\x1A\0', 'binary');
const CATALOG_ROOT_ID = 'library';
const CATALOG_ROOT_ID_PREFIX = 'root-';
const CATALOG_FOLDER_ID_PREFIX = 'folder-';
const CATALOG_CURSOR_VERSION = 1;
const CATALOG_CURSOR_MAX_LENGTH = 512;
const DEFAULT_CATALOG_PAGE_LIMIT = 50;
const MAX_CATALOG_PAGE_LIMIT = 100;
const CATALOG_PAGE_REQUEST_KEYS = new Set(['filters', 'revision', 'cursor', 'limit']);
const TREE_CHILDREN_REQUEST_KEYS = new Set(['parentId', 'revision', 'cursor', 'limit']);
const CATALOG_NEIGHBOR_REQUEST_KEYS = new Set(['relation', 'id', 'filters', 'revision']);

function toFileIdentity(stats) {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function hasSameFileIdentity(left, right) {
  return left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function isReadableRegularFile(stats) {
  return stats.isFile() && stats.size >= 0 && stats.size <= MAX_MODEL_BYTES;
}

function closeFileHandle(fileHandle) {
  return fileHandle?.close().catch(() => undefined);
}

function getDirectoryVisitKey(directoryPath) {
  const normalizedPath = path.normalize(directoryPath);
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function toText(bytes) {
  return bytes.toString('utf8').replace(/^\uFEFF/, '');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCatalogRevision(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Invalid catalog revision.');
  }
  return value;
}

function normalizeCatalogPageLimit(value) {
  if (value === undefined || value === null) return DEFAULT_CATALOG_PAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CATALOG_PAGE_LIMIT) {
    throw new TypeError('Invalid catalog page limit.');
  }
  return value;
}

function normalizeCatalogCursor(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.length > CATALOG_CURSOR_MAX_LENGTH) {
    throw new TypeError('Invalid catalog cursor.');
  }
  return value;
}

function assertOnlyKnownRequestKeys(input, knownKeys, message) {
  if (Object.keys(input).some((key) => !knownKeys.has(key))) {
    throw new TypeError(message);
  }
}

function normalizeCatalogPageRequest(input) {
  if (input === undefined || input === null) {
    return {
      filters: normalizeFilters(),
      revision: null,
      cursor: null,
      limit: DEFAULT_CATALOG_PAGE_LIMIT,
    };
  }
  if (!isPlainObject(input)) {
    throw new TypeError('Invalid catalog page request.');
  }
  assertOnlyKnownRequestKeys(input, CATALOG_PAGE_REQUEST_KEYS, 'Invalid catalog page request.');
  return {
    filters: normalizeFilters(input.filters),
    revision: normalizeCatalogRevision(input.revision),
    cursor: normalizeCatalogCursor(input.cursor),
    limit: normalizeCatalogPageLimit(input.limit),
  };
}

function isCatalogTreeNodeId(value) {
  return value === CATALOG_ROOT_ID
    || (typeof value === 'string'
      && (/^root-[a-f0-9]{48}$/.test(value) || /^folder-[a-f0-9]{48}$/.test(value)));
}

function normalizeTreeChildrenRequest(input) {
  if (input === undefined || input === null) {
    return {
      parentId: CATALOG_ROOT_ID,
      revision: null,
      cursor: null,
      limit: DEFAULT_CATALOG_PAGE_LIMIT,
    };
  }
  if (!isPlainObject(input)) {
    throw new TypeError('Invalid tree request.');
  }
  assertOnlyKnownRequestKeys(input, TREE_CHILDREN_REQUEST_KEYS, 'Invalid tree request.');
  const parentId = input.parentId === undefined ? CATALOG_ROOT_ID : input.parentId;
  if (!isCatalogTreeNodeId(parentId)) {
    throw new TypeError('Invalid tree node identifier.');
  }
  return {
    parentId,
    revision: normalizeCatalogRevision(input.revision),
    cursor: normalizeCatalogCursor(input.cursor),
    limit: normalizeCatalogPageLimit(input.limit),
  };
}

function normalizeCatalogNeighborRequest(input) {
  if (!isPlainObject(input)) {
    throw new TypeError('Invalid catalog navigation request.');
  }
  assertOnlyKnownRequestKeys(input, CATALOG_NEIGHBOR_REQUEST_KEYS, 'Invalid catalog navigation request.');
  const relation = input.relation;
  if (!['previous', 'next', 'random'].includes(relation)) {
    throw new TypeError('Invalid catalog navigation relation.');
  }
  const id = input.id;
  if (relation !== 'random' && !isOpaqueId(id)) {
    throw new TypeError('Invalid model identifier.');
  }
  if (id !== undefined && id !== null && !isOpaqueId(id)) {
    throw new TypeError('Invalid model identifier.');
  }
  return {
    relation,
    id: id || null,
    filters: normalizeFilters(input.filters),
    revision: normalizeCatalogRevision(input.revision),
  };
}

function catalogFilterKey(filters) {
  return JSON.stringify([
    filters.query,
    filters.extension,
    filters.sortBy,
    filters.order,
  ]);
}

function hasSupportedGltfAsset(document) {
  return isPlainObject(document)
    && isPlainObject(document.asset)
    && typeof document.asset.version === 'string'
    && /^2(?:\.\d+)?$/.test(document.asset.version);
}

function isStructurallyValidGltfJson(bytes) {
  const text = toText(bytes);
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || trimmed.includes('\0')) return false;

  try {
    return hasSupportedGltfAsset(JSON.parse(trimmed));
  } catch {
    return false;
  }
}

function isStructurallyValidGlb(bytes, size) {
  // A header alone is not an asset. GLB 2.0 requires a first JSON chunk whose
  // declared, four-byte-aligned extent fits the file. Complete bounded JSON
  // chunks are checked as glTF 2.0 metadata; larger chunks retain the same
  // prefix-only policy used for oversized .gltf files below.
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
    if (!isStructurallyValidGltfJson(bytes.subarray(20, jsonChunkEnd))) return false;
  } else {
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
  // Keep the scan bounded: reject malformed files when their complete JSON is
  // available, and retain a plausibly JSON-shaped larger candidate for loader
  // validation rather than falsely excluding a valid model.
  if (size > bytes.length) {
    const text = toText(bytes);
    const trimmed = text.trimStart();
    return trimmed.startsWith('{') && !trimmed.includes('\0');
  }
  return isStructurallyValidGltfJson(bytes);
}

function isStructurallyValidObj(bytes) {
  const text = toText(bytes);
  if (!text.trim() || text.includes('\0')) return false;
  return /^(?:v|vn|vt|vp|f|l|p)\s+/m.test(text) || /^mtllib\s+/m.test(text);
}

function isStructurallyValidPly(bytes) {
  const text = toText(bytes);
  return /^ply(?:\r?\n|\r)/.test(text)
    && /^format\s+(?:ascii|binary_little_endian|binary_big_endian)\s+1\.0\s*$/m.test(text)
    && /^end_header\s*$/m.test(text);
}

function isStructurallyValidFbx(bytes) {
  if (bytes.length >= FBX_BINARY_HEADER.length
    && bytes.subarray(0, FBX_BINARY_HEADER.length).equals(FBX_BINARY_HEADER)) {
    return true;
  }

  const text = toText(bytes);
  return /^;\s*FBX\b/im.test(text) || /\bFBXHeaderExtension\s*:/m.test(text);
}

function isStructurallyValidDae(bytes) {
  const text = toText(bytes);
  return /<\s*COLLADA(?:\s|>)/i.test(text);
}

function isStructurallyValidStl(bytes, size) {
  if (bytes.length >= BINARY_STL_HEADER_BYTES) {
    const triangleCount = bytes.readUInt32LE(80);
    const declaredLength = BINARY_STL_HEADER_BYTES + (triangleCount * BINARY_STL_TRIANGLE_BYTES);
    if (Number.isSafeInteger(declaredLength) && declaredLength === size) {
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

// This deliberately verifies only bounded, format-specific structure before
// publication. The renderer loader remains responsible for full parsing,
// dependency resolution, and model-fidelity validation when a user opens it.
function isStructurallyValidModel(filePath, bytes, size) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.glb':
      return isStructurallyValidGlb(bytes, size);
    case '.gltf':
      return isStructurallyValidGltf(bytes, size);
    case '.obj':
      return isStructurallyValidObj(bytes);
    case '.ply':
      return isStructurallyValidPly(bytes);
    case '.fbx':
      return isStructurallyValidFbx(bytes);
    case '.dae':
      return isStructurallyValidDae(bytes);
    case '.stl':
      return isStructurallyValidStl(bytes, size);
    default:
      return false;
  }
}

export class FileScanner {
  constructor({
    openFile = fs.promises.open,
    openDirectory = fs.promises.opendir,
    catalogPublicationIntervalMs = SCAN_CATALOG_PUBLICATION_INTERVAL_MS,
  } = {}) {
    this.recordsById = new Map();
    this.idsByPath = new Map();
    this.rootNodesByPath = new Map();
    this.treeNodesById = new Map();
    this.libraryRootIds = new Set();
    this.treeMembershipsByRecordId = new Map();
    this.catalogRevision = 0;
    this.scanId = 0;
    this.catalogChangeListeners = new Set();
    this.catalogCursorSecret = randomBytes(32);
    this.catalogOrderCache = null;
    this.treeChildOrderCache = null;
    this.openFile = openFile;
    this.openDirectory = openDirectory;
    this.catalogPublicationIntervalMs = Number.isSafeInteger(catalogPublicationIntervalMs)
      && catalogPublicationIntervalMs >= 0
      ? catalogPublicationIntervalMs
      : SCAN_CATALOG_PUBLICATION_INTERVAL_MS;
    this.isScanning = false;
    this.scanAbortController = null;
    this.scanContext = null;
    this.status = this.#createStatus('idle');
  }

  #createStatus(status) {
    return {
      status,
      isScanning: false,
      scannedDirectories: 0,
      foundModels: 0,
      availableModels: this.recordsById.size,
      skippedEntries: 0,
      oversizedModels: 0,
      invalidModels: 0,
      selectedFolderCount: 0,
      truncated: false,
      catalogRevision: this.catalogRevision,
      scanId: this.scanId,
    };
  }

  #catalogChangeEvent() {
    return {
      catalogRevision: this.catalogRevision,
      scanId: this.scanId,
      modelCount: this.recordsById.size,
      isScanning: this.isScanning,
      status: this.status.status,
    };
  }

  #emitCatalogChange() {
    const event = this.#catalogChangeEvent();
    for (const listener of this.catalogChangeListeners) {
      try {
        listener(event);
      } catch {
        // A consumer must not be able to interrupt secure local indexing.
      }
    }
  }

  #markCatalogChanged({ emit = true } = {}) {
    this.catalogRevision += 1;
    this.catalogOrderCache = null;
    this.treeChildOrderCache = null;
    this.status.catalogRevision = this.catalogRevision;
    if (emit) this.#emitCatalogChange();
  }

  #clearPendingScanCatalogPublication(scanContext) {
    if (scanContext?.catalogPublicationTimer !== null && scanContext?.catalogPublicationTimer !== undefined) {
      clearTimeout(scanContext.catalogPublicationTimer);
      scanContext.catalogPublicationTimer = null;
    }
    if (scanContext) scanContext.pendingCatalogPublication = false;
  }

  #flushPendingScanCatalogPublication(scanContext) {
    if (this.scanContext !== scanContext || !scanContext.pendingCatalogPublication) return;
    this.#clearPendingScanCatalogPublication(scanContext);
    scanContext.lastCatalogPublicationAt = Date.now();
    this.#emitCatalogChange();
  }

  #scheduleScanCatalogPublication(scanContext) {
    if (this.scanContext !== scanContext) return;
    scanContext.pendingCatalogPublication = true;
    const now = Date.now();
    const lastPublication = scanContext.lastCatalogPublicationAt;
    const elapsed = lastPublication === null ? Infinity : now - lastPublication;
    if (elapsed >= this.catalogPublicationIntervalMs) {
      this.#flushPendingScanCatalogPublication(scanContext);
      return;
    }

    if (scanContext.catalogPublicationTimer !== null) return;
    const delay = Math.max(0, this.catalogPublicationIntervalMs - elapsed);
    scanContext.catalogPublicationTimer = setTimeout(() => {
      scanContext.catalogPublicationTimer = null;
      this.#flushPendingScanCatalogPublication(scanContext);
    }, delay);
    scanContext.catalogPublicationTimer.unref?.();
  }

  onCatalogChange(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Catalog listener must be a function.');
    }
    this.catalogChangeListeners.add(listener);
    return () => this.catalogChangeListeners.delete(listener);
  }

  #isCancelled() {
    return this.scanAbortController?.signal.aborted === true;
  }

  #newOpaqueId() {
    let id;
    do {
      id = randomBytes(24).toString('hex');
    } while (this.recordsById.has(id));
    return id;
  }

  #toDto(record) {
    return {
      id: record.id,
      name: record.name,
      extension: record.extension.slice(1),
      size: record.size,
      modifiedAt: record.modifiedAt,
    };
  }

  #folderId(relativeFolder) {
    return createHash('sha256').update(`folder:${relativeFolder}`).digest('hex').slice(0, 24);
  }

  #catalogRootId(rootPath) {
    return `${CATALOG_ROOT_ID_PREFIX}${createHash('sha256')
      .update(`catalog-root:${rootPath}`)
      .digest('hex')
      .slice(0, 48)}`;
  }

  #catalogFolderId(rootPath, relativeDirectory) {
    return `${CATALOG_FOLDER_ID_PREFIX}${createHash('sha256')
      .update(`catalog-folder:${rootPath}\0${relativeDirectory}`)
      .digest('hex')
      .slice(0, 48)}`;
  }

  #toTreeFolderDto(node) {
    return {
      id: node.id,
      name: node.name,
      type: 'folder',
      filesCount: node.filesCount,
    };
  }

  #toTreeModelDto(record) {
    return {
      ...this.#toDto(record),
      type: 'model',
    };
  }

  #getOrCreateTreeRoot(rootPath) {
    const existingRoot = this.rootNodesByPath.get(rootPath);
    if (existingRoot) return existingRoot;

    const root = {
      id: this.#catalogRootId(rootPath),
      name: path.basename(rootPath) || 'Biblioteca',
      type: 'root',
      rootPath,
      relativeDirectory: '',
      parentId: CATALOG_ROOT_ID,
      filesCount: 0,
      childIds: new Set(),
      fileIds: new Set(),
    };
    this.rootNodesByPath.set(rootPath, root);
    this.treeNodesById.set(root.id, root);
    this.libraryRootIds.add(root.id);
    return root;
  }

  #addRecordToTree(record) {
    const root = this.#getOrCreateTreeRoot(record.rootPath);
    const nodeIds = [root.id];
    let currentNode = root;
    const relativeDirectory = path.relative(record.rootPath, path.dirname(record.path));
    const safeRelativeDirectory = relativeDirectory === '' ? '' : relativeDirectory.split(path.sep).join('/');
    const segments = safeRelativeDirectory && isSafeRelativePath(safeRelativeDirectory)
      ? safeRelativeDirectory.split('/')
      : [];
    let currentRelativeDirectory = '';

    for (const segment of segments) {
      currentRelativeDirectory = currentRelativeDirectory
        ? `${currentRelativeDirectory}/${segment}`
        : segment;
      const nodeId = this.#catalogFolderId(record.rootPath, currentRelativeDirectory);
      let child = this.treeNodesById.get(nodeId);
      if (!child) {
        child = {
          id: nodeId,
          name: segment,
          type: 'folder',
          rootPath: record.rootPath,
          relativeDirectory: currentRelativeDirectory,
          parentId: currentNode.id,
          filesCount: 0,
          childIds: new Set(),
          fileIds: new Set(),
        };
        this.treeNodesById.set(nodeId, child);
        currentNode.childIds.add(nodeId);
      }
      currentNode = child;
      nodeIds.push(nodeId);
    }

    currentNode.fileIds.add(record.id);
    for (const nodeId of nodeIds) {
      const node = this.treeNodesById.get(nodeId);
      if (node) node.filesCount += 1;
    }
    this.treeMembershipsByRecordId.set(record.id, { nodeIds });
  }

  #removeRecordFromTree(record) {
    const membership = this.treeMembershipsByRecordId.get(record.id);
    if (!membership) return;

    const leaf = this.treeNodesById.get(membership.nodeIds.at(-1));
    leaf?.fileIds.delete(record.id);
    for (const nodeId of membership.nodeIds) {
      const node = this.treeNodesById.get(nodeId);
      if (node) node.filesCount = Math.max(0, node.filesCount - 1);
    }
    this.treeMembershipsByRecordId.delete(record.id);

    for (const nodeId of [...membership.nodeIds].reverse()) {
      const node = this.treeNodesById.get(nodeId);
      if (!node || node.filesCount !== 0) continue;
      if (node.type === 'root') {
        this.libraryRootIds.delete(node.id);
        this.rootNodesByPath.delete(node.rootPath);
      } else {
        this.treeNodesById.get(node.parentId)?.childIds.delete(node.id);
      }
      this.treeNodesById.delete(node.id);
    }
  }

  #hasSameCatalogRecord(left, right) {
    return left.id === right.id
      && left.path === right.path
      && left.rootPath === right.rootPath
      && left.name === right.name
      && left.extension === right.extension
      && left.size === right.size
      && left.modifiedAt === right.modifiedAt
      && hasSameFileIdentity(left.identity, right.identity);
  }

  #publishRecord(realPath, stats, rootPath, { emitCatalogChange = true } = {}) {
    const previousId = this.idsByPath.get(realPath);
    const previousRecord = previousId ? this.recordsById.get(previousId) : null;
    const reusableId = previousRecord && hasSameFileIdentity(previousRecord.identity, toFileIdentity(stats))
      ? previousRecord.id
      : null;

    const record = {
      id: reusableId || this.#newOpaqueId(),
      path: realPath,
      rootPath,
      name: path.basename(realPath),
      extension: path.extname(realPath).toLowerCase(),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      identity: toFileIdentity(stats),
    };

    if (previousRecord && this.#hasSameCatalogRecord(previousRecord, record)) {
      return previousRecord;
    }

    if (previousRecord) {
      this.#removeRecordFromTree(previousRecord);
      if (previousId !== record.id) {
        this.recordsById.delete(previousId);
      }
    }
    this.recordsById.set(record.id, record);
    this.idsByPath.set(realPath, record.id);
    this.#addRecordToTree(record);
    this.#markCatalogChanged({ emit: emitCatalogChange });
    return record;
  }

  #publishScannedRecord(scanContext, realPath, stats, rootPath) {
    const revisionBeforePublication = this.catalogRevision;
    const record = this.#publishRecord(realPath, stats, rootPath, { emitCatalogChange: false });
    scanContext.discoveredPaths.add(realPath);
    this.status.foundModels = scanContext.discoveredPaths.size;
    this.status.availableModels = this.recordsById.size;
    if (this.catalogRevision !== revisionBeforePublication) {
      this.#scheduleScanCatalogPublication(scanContext);
    }
    return record;
  }

  #recordExternalPublication(realPath) {
    if (this.isScanning && this.scanContext) {
      this.scanContext.externalPaths.add(realPath);
    }
    this.status.availableModels = this.recordsById.size;
    if (!this.isScanning) {
      this.status.foundModels = this.recordsById.size;
    }
  }

  #completeScan(scanContext) {
    const retainedPaths = new Set([
      ...scanContext.discoveredPaths,
      ...scanContext.externalPaths,
    ]);
    const finalRecordsById = new Map();
    const finalIdsByPath = new Map();

    for (const realPath of retainedPaths) {
      const id = this.idsByPath.get(realPath);
      const record = id ? this.recordsById.get(id) : null;
      if (!record || record.path !== realPath) continue;
      finalRecordsById.set(id, record);
      finalIdsByPath.set(realPath, id);
    }

    // This is synchronous map replacement: readers see either the live
    // progressive catalog or the complete selected-root catalog, never a
    // partially pruned pair of indexes.
    let prunedRecords = false;
    for (const [id, record] of this.recordsById) {
      if (!finalRecordsById.has(id)) {
        this.#removeRecordFromTree(record);
        prunedRecords = true;
      }
    }
    this.recordsById = finalRecordsById;
    this.idsByPath = finalIdsByPath;
    this.status.foundModels = scanContext.discoveredPaths.size;
    this.status.availableModels = this.recordsById.size;
    if (prunedRecords) this.#markCatalogChanged({ emit: false });
  }

  async #validateModelCandidate(realPath, expectedStats) {
    let fileHandle;
    try {
      fileHandle = await fs.promises.open(realPath, 'r');
      const openedStats = await fileHandle.stat();
      if (!isReadableRegularFile(openedStats)
        || !hasSameFileIdentity(toFileIdentity(openedStats), toFileIdentity(expectedStats))) {
        return null;
      }

      const bytesToRead = Math.min(openedStats.size, MAX_STRUCTURAL_VALIDATION_BYTES);
      const bytes = Buffer.alloc(bytesToRead);
      const { bytesRead } = bytesToRead > 0
        ? await fileHandle.read(bytes, 0, bytesToRead, 0)
        : { bytesRead: 0 };
      return isStructurallyValidModel(realPath, bytes.subarray(0, bytesRead), openedStats.size);
    } catch {
      return null;
    } finally {
      await closeFileHandle(fileHandle);
    }
  }

  async #canonicalizeRoots(roots) {
    if (!Array.isArray(roots) || roots.length === 0) {
      throw new TypeError('Choose one or more folders.');
    }

    const canonicalRoots = [];
    const seenRoots = new Set();
    for (const root of roots) {
      if (this.#isCancelled()) break;
      if (typeof root !== 'string' || !path.isAbsolute(root)) {
        throw new TypeError('Invalid folder selection.');
      }

      try {
        // A user-selected symbolic-link root is canonicalized once and then
        // treated as that concrete root. Descendant links are still rejected
        // below, so they cannot escape the approved canonical root.
        const canonicalRoot = await fs.promises.realpath(root);
        const rootStats = await fs.promises.stat(canonicalRoot);
        const rootKey = getDirectoryVisitKey(canonicalRoot);
        if (!rootStats.isDirectory() || seenRoots.has(rootKey)) {
          continue;
        }

        seenRoots.add(rootKey);
        canonicalRoots.push(canonicalRoot);
      } catch {
        // A multi-folder selection should still index every readable root when
        // one selected folder disappears or cannot be read.
        this.status.skippedEntries += 1;
      }
    }

    if (canonicalRoots.length === 0 && !this.#isCancelled()) {
      throw new TypeError('No readable folders were selected.');
    }
    return canonicalRoots;
  }

  async #yieldToEventLoop() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  async #closeDirectoryFrame(frame) {
    try {
      await frame.iterator?.return?.();
    } catch {
      // The explicit directory close below releases the descriptor when an
      // iterator cannot finish cleanly.
    }

    try {
      await frame.directory?.close?.();
    } catch {
      // fs.Dir may already be closed after iterator.return().
    }
  }

  async #openDirectoryFrame(directoryPath, rootPath, activeDirectoryKeys) {
    const directoryKey = getDirectoryVisitKey(directoryPath);
    if (activeDirectoryKeys.has(directoryKey)) {
      // A checked canonical descendant that resolves to an active ancestor is
      // cyclic. Keep only ancestor keys, not a global set for every directory.
      return null;
    }

    let directory;
    try {
      directory = await this.openDirectory(directoryPath);
      if (this.#isCancelled()) {
        await this.#closeDirectoryFrame({ directory });
        return null;
      }

      const iterator = directory?.[Symbol.asyncIterator]?.();
      if (!iterator || typeof iterator.next !== 'function') {
        throw new TypeError('Invalid directory iterator.');
      }

      activeDirectoryKeys.add(directoryKey);
      this.status.scannedDirectories += 1;
      return {
        directoryPath,
        rootPath,
        directoryKey,
        directory,
        iterator,
        entryCount: 0,
      };
    } catch {
      await this.#closeDirectoryFrame({ directory });
      this.status.skippedEntries += 1;
      return null;
    }
  }

  async #finishDirectoryFrame(frames, activeDirectoryKeys) {
    const frame = frames.pop();
    if (!frame) return;
    activeDirectoryKeys.delete(frame.directoryKey);
    await this.#closeDirectoryFrame(frame);
  }

  async #scanDirectoryEntry(entry, directoryPath, rootPath, scanContext) {
    if (entry.isSymbolicLink()) {
      this.status.skippedEntries += 1;
      return null;
    }

    const candidatePath = path.resolve(directoryPath, entry.name);
    if (!isPathInside(rootPath, candidatePath)) {
      this.status.skippedEntries += 1;
      return null;
    }

    if (entry.isDirectory()) {
      try {
        const entryStats = await fs.promises.lstat(candidatePath);
        if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
          this.status.skippedEntries += 1;
          return null;
        }
        const realDirectoryPath = await fs.promises.realpath(candidatePath);
        if (!isPathInside(rootPath, realDirectoryPath)) {
          this.status.skippedEntries += 1;
          return null;
        }
        return { directoryPath: realDirectoryPath, rootPath };
      } catch {
        this.status.skippedEntries += 1;
        return null;
      }
    }

    if (!entry.isFile() || !isSupportedModelPath(candidatePath)) {
      return null;
    }

    try {
      const entryStats = await fs.promises.lstat(candidatePath);
      if (entryStats.isSymbolicLink() || !entryStats.isFile()) {
        this.status.skippedEntries += 1;
        return null;
      }
      const realPath = await fs.promises.realpath(candidatePath);
      const stats = await fs.promises.stat(realPath);
      if (!isPathInside(rootPath, realPath) || !isSupportedModelPath(realPath)) {
        this.status.skippedEntries += 1;
        return null;
      }
      if (!isReadableRegularFile(stats)) {
        this.status.skippedEntries += 1;
        if (stats.isFile() && stats.size > MAX_MODEL_BYTES) {
          this.status.oversizedModels += 1;
        }
        return null;
      }

      const structurallyValid = await this.#validateModelCandidate(realPath, stats);
      if (structurallyValid !== true) {
        this.status.skippedEntries += 1;
        if (structurallyValid === false) {
          this.status.invalidModels += 1;
        }
        return null;
      }
      if (this.#isCancelled()) return null;

      this.#publishScannedRecord(scanContext, realPath, stats, rootPath);
    } catch {
      this.status.skippedEntries += 1;
    }
    return null;
  }

  async #scanDirectories(canonicalRoots, scanContext) {
    const frames = [];
    const activeDirectoryKeys = new Set();
    let nextRootIndex = 0;

    try {
      while (frames.length > 0 || nextRootIndex < canonicalRoots.length) {
        if (this.#isCancelled()) return true;

        if (frames.length === 0) {
          const rootPath = canonicalRoots[nextRootIndex];
          nextRootIndex += 1;
          const rootFrame = await this.#openDirectoryFrame(rootPath, rootPath, activeDirectoryKeys);
          if (rootFrame) frames.push(rootFrame);
          continue;
        }

        const frame = frames.at(-1);
        let nextEntry;
        try {
          nextEntry = await frame.iterator.next();
        } catch {
          this.status.skippedEntries += 1;
          await this.#finishDirectoryFrame(frames, activeDirectoryKeys);
          continue;
        }

        if (nextEntry.done) {
          await this.#finishDirectoryFrame(frames, activeDirectoryKeys);
          continue;
        }
        if (this.#isCancelled()) return true;

        frame.entryCount += 1;
        if (frame.entryCount % SCAN_YIELD_INTERVAL === 0) {
          await this.#yieldToEventLoop();
          if (this.#isCancelled()) return true;
        }

        const childDirectory = await this.#scanDirectoryEntry(
          nextEntry.value,
          frame.directoryPath,
          frame.rootPath,
          scanContext,
        );
        if (this.#isCancelled()) return true;
        if (!childDirectory) continue;

        // Retain only open ancestor iterators. A directory with millions of
        // siblings never materializes a matching global pending-directory list.
        const childFrame = await this.#openDirectoryFrame(
          childDirectory.directoryPath,
          childDirectory.rootPath,
          activeDirectoryKeys,
        );
        if (childFrame) frames.push(childFrame);
      }
    } finally {
      while (frames.length > 0) {
        await this.#finishDirectoryFrame(frames, activeDirectoryKeys);
      }
    }

    return this.#isCancelled();
  }

  async scanDirectories(roots) {
    if (this.isScanning) {
      return { status: 'already_scanning', count: this.recordsById.size };
    }

    this.isScanning = true;
    this.scanAbortController = new AbortController();
    this.scanId += 1;
    this.status = this.#createStatus('scanning');
    this.status.scanId = this.scanId;
    // A new scan starts a new catalog snapshot even before its first model is
    // published, so page cursors from an earlier snapshot cannot interleave.
    this.#markCatalogChanged();
    const scanContext = {
      discoveredPaths: new Set(),
      externalPaths: new Set(),
      catalogPublicationTimer: null,
      lastCatalogPublicationAt: null,
      pendingCatalogPublication: false,
    };
    this.scanContext = scanContext;

    try {
      const canonicalRoots = await this.#canonicalizeRoots(roots);
      this.status.selectedFolderCount = canonicalRoots.length;
      await this.#scanDirectories(canonicalRoots, scanContext);

      const cancelled = this.#isCancelled();
      if (!cancelled) {
        this.#completeScan(scanContext);
      }
      this.status.status = cancelled ? 'cancelled' : 'completed';
      this.status.availableModels = this.recordsById.size;
      // Cancellation deliberately retains safe discoveries, but it is still a
      // distinct snapshot boundary for consumers holding an older cursor.
      if (cancelled && !scanContext.cancellationRevisionPublished) this.#markCatalogChanged();
      return {
        status: this.status.status,
        count: this.recordsById.size,
        truncated: this.status.truncated,
      };
    } catch (error) {
      this.status.status = 'failed';
      this.#markCatalogChanged({ emit: false });
      throw error;
    } finally {
      this.#clearPendingScanCatalogPublication(scanContext);
      this.isScanning = false;
      this.scanAbortController = null;
      if (this.scanContext === scanContext) {
        this.scanContext = null;
      }
      this.status.isScanning = false;
      this.#emitCatalogChange();
    }
  }

  cancelScan() {
    if (!this.isScanning || !this.scanAbortController || this.scanAbortController.signal.aborted) {
      return { cancelled: false, status: this.getStatus() };
    }

    this.scanAbortController.abort();
    if (this.scanContext) {
      this.#clearPendingScanCatalogPublication(this.scanContext);
      this.scanContext.cancellationRevisionPublished = true;
    }
    // Invalidate in-flight pages immediately. Files already published remain
    // available, but they are now part of a cancellation snapshot.
    this.#markCatalogChanged();
    return { cancelled: true, status: this.getStatus() };
  }

  async registerDroppedPath(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new TypeError('Invalid dropped file.');
    }

    const realPath = await fs.promises.realpath(filePath);
    const stats = await fs.promises.stat(realPath);
    if (!isReadableRegularFile(stats) || !isSupportedModelPath(realPath)) {
      throw new TypeError('Unsupported dropped file.');
    }

    const structurallyValid = await this.#validateModelCandidate(realPath, stats);
    if (structurallyValid !== true) {
      throw new TypeError('Invalid dropped file.');
    }

    const record = this.#publishRecord(realPath, stats, path.dirname(realPath));
    this.#recordExternalPublication(realPath);
    if (this.status.status === 'idle') {
      this.status.status = 'completed';
    }
    return this.#toDto(record);
  }

  #cursorFilterFingerprint(value) {
    return createHash('sha256').update(value).digest('base64url').slice(0, 32);
  }

  #encodeCatalogCursor({ scope, filterKey, offset }) {
    const payload = Buffer.from(JSON.stringify({
      v: CATALOG_CURSOR_VERSION,
      r: this.catalogRevision,
      s: scope,
      f: this.#cursorFilterFingerprint(filterKey),
      o: offset,
    })).toString('base64url');
    const signature = createHmac('sha256', this.catalogCursorSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  #decodeCatalogCursor(cursor, scope, filterKey) {
    const parts = cursor.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
      throw new TypeError('Invalid catalog cursor.');
    }

    const expectedSignature = createHmac('sha256', this.catalogCursorSecret).update(parts[0]).digest();
    let actualSignature;
    try {
      actualSignature = Buffer.from(parts[1], 'base64url');
    } catch {
      throw new TypeError('Invalid catalog cursor.');
    }
    if (actualSignature.length !== expectedSignature.length
      || !timingSafeEqual(actualSignature, expectedSignature)) {
      throw new TypeError('Invalid catalog cursor.');
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      throw new TypeError('Invalid catalog cursor.');
    }
    if (!isPlainObject(payload)
      || payload.v !== CATALOG_CURSOR_VERSION
      || payload.s !== scope
      || !Number.isSafeInteger(payload.r)
      || payload.r < 0
      || !Number.isSafeInteger(payload.o)
      || payload.o < 0
      || typeof payload.f !== 'string'
      || payload.f !== this.#cursorFilterFingerprint(filterKey)) {
      throw new TypeError('Invalid catalog cursor.');
    }
    return payload;
  }

  #getOrderedRecordIds(filters) {
    const key = catalogFilterKey(filters);
    if (this.catalogOrderCache
      && this.catalogOrderCache.revision === this.catalogRevision
      && this.catalogOrderCache.key === key) {
      return this.catalogOrderCache.ids;
    }

    const extension = filters.extension === 'all' ? '' : `.${filters.extension}`;
    const query = filters.query.toLocaleLowerCase();
    const multiplier = filters.order === 'asc' ? 1 : -1;
    const ids = [...this.recordsById.values()]
      .filter((record) => !extension || record.extension === extension)
      .filter((record) => !query || record.name.toLocaleLowerCase().includes(query))
      .sort((left, right) => {
        const leftValue = left[filters.sortBy];
        const rightValue = right[filters.sortBy];
        if (typeof leftValue === 'string') {
          return multiplier * leftValue.localeCompare(rightValue);
        }
        return multiplier * (leftValue - rightValue);
      })
      .map((record) => record.id);

    // Preserve only the active ordering. It avoids repeatedly rebuilding a
    // whole-array sort while keeping the cache bounded for unbounded libraries.
    this.catalogOrderCache = { revision: this.catalogRevision, key, ids };
    return ids;
  }

  #getOrderedTreeEntries(parentId) {
    const cache = this.treeChildOrderCache;
    if (cache && cache.revision === this.catalogRevision && cache.parentId === parentId) {
      return cache.entries;
    }

    const node = parentId === CATALOG_ROOT_ID
      ? { childIds: this.libraryRootIds, fileIds: new Set() }
      : this.treeNodesById.get(parentId);
    if (!node) return null;

    const entries = [
      ...node.childIds,
    ].map((id) => ({ type: 'folder', id }))
      .concat([...node.fileIds].map((id) => ({ type: 'model', id })))
      .sort((left, right) => {
        if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
        const leftName = left.type === 'folder'
          ? this.treeNodesById.get(left.id)?.name
          : this.recordsById.get(left.id)?.name;
        const rightName = right.type === 'folder'
          ? this.treeNodesById.get(right.id)?.name
          : this.recordsById.get(right.id)?.name;
        return (leftName || '').localeCompare(rightName || '');
      });
    this.treeChildOrderCache = { revision: this.catalogRevision, parentId, entries };
    return entries;
  }

  #buildCatalogResponse({ reset = false, total = this.recordsById.size, items = [], nextCursor = null }) {
    return {
      catalogRevision: this.catalogRevision,
      scanId: this.scanId,
      isScanning: this.isScanning,
      reset,
      total,
      items,
      nextCursor,
    };
  }

  getCatalogPage(request) {
    const normalized = normalizeCatalogPageRequest(request);
    const filterKey = catalogFilterKey(normalized.filters);
    if (normalized.revision !== null && normalized.revision !== this.catalogRevision) {
      return this.#buildCatalogResponse({ reset: true });
    }

    let offset = 0;
    if (normalized.cursor) {
      const cursor = this.#decodeCatalogCursor(normalized.cursor, 'models', filterKey);
      if (cursor.r !== this.catalogRevision) {
        return this.#buildCatalogResponse({ reset: true });
      }
      offset = cursor.o;
    }

    const ids = this.#getOrderedRecordIds(normalized.filters);
    const pageIds = ids.slice(offset, offset + normalized.limit);
    const nextOffset = offset + pageIds.length;
    return this.#buildCatalogResponse({
      total: ids.length,
      items: pageIds.map((id) => this.recordsById.get(id)).filter(Boolean).map((record) => this.#toDto(record)),
      nextCursor: nextOffset < ids.length
        ? this.#encodeCatalogCursor({ scope: 'models', filterKey, offset: nextOffset })
        : null,
    });
  }

  getTreeChildren(request) {
    const normalized = normalizeTreeChildrenRequest(request);
    const filterKey = `tree:${normalized.parentId}`;
    if (normalized.revision !== null && normalized.revision !== this.catalogRevision) {
      return this.#buildCatalogResponse({ reset: true });
    }

    let offset = 0;
    if (normalized.cursor) {
      const cursor = this.#decodeCatalogCursor(normalized.cursor, 'tree', filterKey);
      if (cursor.r !== this.catalogRevision) {
        return this.#buildCatalogResponse({ reset: true });
      }
      offset = cursor.o;
    }

    const entries = this.#getOrderedTreeEntries(normalized.parentId);
    if (!entries) {
      return this.#buildCatalogResponse({ total: 0 });
    }
    const pageEntries = entries.slice(offset, offset + normalized.limit);
    const nextOffset = offset + pageEntries.length;
    return this.#buildCatalogResponse({
      total: entries.length,
      items: pageEntries.flatMap((entry) => {
        const value = entry.type === 'folder'
          ? this.treeNodesById.get(entry.id)
          : this.recordsById.get(entry.id);
        if (!value) return [];
        return entry.type === 'folder' ? this.#toTreeFolderDto(value) : this.#toTreeModelDto(value);
      }),
      nextCursor: nextOffset < entries.length
        ? this.#encodeCatalogCursor({ scope: 'tree', filterKey, offset: nextOffset })
        : null,
    });
  }

  getCatalogNeighbor(request) {
    const normalized = normalizeCatalogNeighborRequest(request);
    if (normalized.revision !== null && normalized.revision !== this.catalogRevision) {
      return {
        catalogRevision: this.catalogRevision,
        scanId: this.scanId,
        reset: true,
        model: null,
      };
    }

    const ids = this.#getOrderedRecordIds(normalized.filters);
    if (ids.length === 0) {
      return {
        catalogRevision: this.catalogRevision,
        scanId: this.scanId,
        reset: false,
        model: null,
      };
    }

    let index;
    if (normalized.relation === 'random') {
      index = randomInt(ids.length);
      if (normalized.id && ids.length > 1) {
        const currentIndex = ids.indexOf(normalized.id);
        if (currentIndex >= 0 && index === currentIndex) index = (index + 1) % ids.length;
      }
    } else {
      const currentIndex = ids.indexOf(normalized.id);
      // Preserve the original toolbar's cyclic navigation even though the
      // renderer now holds only a page. When a new filter excludes the model
      // currently open in the viewport, resume from the first matching entry
      // instead of leaving previous/next unusable.
      if (currentIndex < 0) {
        index = 0;
      } else if (normalized.relation === 'previous') {
        index = (currentIndex - 1 + ids.length) % ids.length;
      } else {
        index = (currentIndex + 1) % ids.length;
      }
    }
    const record = index >= 0 ? this.recordsById.get(ids[index]) : null;
    return {
      catalogRevision: this.catalogRevision,
      scanId: this.scanId,
      reset: false,
      model: record ? this.#toDto(record) : null,
    };
  }

  listModels(filters) {
    const normalizedFilters = normalizeFilters(filters);
    const extension = normalizedFilters.extension === 'all' ? '' : normalizedFilters.extension;
    const query = normalizedFilters.query.toLocaleLowerCase();
    const multiplier = normalizedFilters.order === 'asc' ? 1 : -1;

    return [...this.recordsById.values()]
      .filter((record) => !extension || record.extension === `.${extension}`)
      .filter((record) => !query || record.name.toLocaleLowerCase().includes(query))
      .sort((left, right) => {
        const leftValue = left[normalizedFilters.sortBy];
        const rightValue = right[normalizedFilters.sortBy];
        if (typeof leftValue === 'string') {
          return multiplier * leftValue.localeCompare(rightValue);
        }
        return multiplier * (leftValue - rightValue);
      })
      .map((record) => this.#toDto(record));
  }

  getTree() {
    const root = {
      id: 'library',
      name: 'Biblioteca local',
      isFolder: true,
      filesCount: this.recordsById.size,
      files: [],
      children: [],
    };
    const nodes = new Map([['', root]]);

    for (const record of this.recordsById.values()) {
      const relativeDirectory = path.relative(record.rootPath, path.dirname(record.path));
      const safeRelativeDirectory = relativeDirectory === '' ? '' : relativeDirectory.split(path.sep).join('/');
      const segments = safeRelativeDirectory && isSafeRelativePath(safeRelativeDirectory)
        ? safeRelativeDirectory.split('/')
        : [];
      let currentKey = '';
      let currentNode = root;

      for (const segment of segments) {
        currentKey = currentKey ? `${currentKey}/${segment}` : segment;
        let child = nodes.get(currentKey);
        if (!child) {
          child = {
            id: this.#folderId(currentKey),
            name: segment,
            isFolder: true,
            filesCount: 0,
            files: [],
            children: [],
          };
          nodes.set(currentKey, child);
          currentNode.children.push(child);
        }
        child.filesCount += 1;
        currentNode = child;
      }

      currentNode.files.push(this.#toDto(record));
    }

    const sortNode = (node) => {
      node.children.sort((left, right) => left.name.localeCompare(right.name));
      node.files.sort((left, right) => left.name.localeCompare(right.name));
      node.children.forEach(sortNode);
    };
    sortNode(root);
    return root;
  }

  getStatus() {
    return { ...this.status, isScanning: this.isScanning };
  }

  getModelPath(id) {
    return isOpaqueId(id) ? this.recordsById.get(id)?.path || null : null;
  }

  async #openVerifiedFile(candidatePath, expectedIdentity, allowedPath, isAllowedPath) {
    let fileHandle;
    try {
      fileHandle = await this.openFile(candidatePath, 'r');
      const openedStats = await fileHandle.stat();
      if (!isReadableRegularFile(openedStats)
        || !isAllowedPath(allowedPath)
        || !hasSameFileIdentity(toFileIdentity(openedStats), expectedIdentity)) {
        await closeFileHandle(fileHandle);
        return null;
      }

      const stream = fileHandle.createReadStream({ autoClose: true });
      stream.once('error', () => void closeFileHandle(fileHandle));
      stream.once('end', () => void closeFileHandle(fileHandle));
      stream.once('close', () => void closeFileHandle(fileHandle));
      return { stream, size: openedStats.size, path: candidatePath };
    } catch {
      await closeFileHandle(fileHandle);
      return null;
    }
  }

  async openModelAsset(id, assetPath) {
    if (!isOpaqueId(id) || typeof assetPath !== 'string') return null;

    const record = this.recordsById.get(id);
    if (!record) return null;

    try {
      if (assetPath === 'asset') {
        return this.#openVerifiedFile(
          record.path,
          record.identity,
          record.path,
          (candidatePath) => isSupportedModelPath(candidatePath) && isPathInside(record.rootPath, candidatePath),
        );
      }

      if (!isSafeRelativePath(assetPath)) return null;

      const candidatePath = safeResolveUnder(path.dirname(record.path), assetPath);
      if (!candidatePath || !isSupportedSidecarPath(candidatePath)) return null;

      // Resolve once to establish the permitted target, then compare its identity with
      // the already-open descriptor. The served stream never reopens the pathname.
      const realPath = await fs.promises.realpath(candidatePath);
      const expectedStats = await fs.promises.stat(realPath);
      if (!isReadableRegularFile(expectedStats) || !isPathInside(path.dirname(record.path), realPath)) return null;

      return this.#openVerifiedFile(
        candidatePath,
        toFileIdentity(expectedStats),
        realPath,
        (resolvedPath) => isSupportedSidecarPath(resolvedPath) && isPathInside(path.dirname(record.path), resolvedPath),
      );
    } catch {
      return null;
    }
  }

  async resolveModelAsset(id, assetPath) {
    const asset = await this.openModelAsset(id, assetPath);
    if (!asset) return null;
    const chunks = [];
    try {
      for await (const chunk of asset.stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
}
