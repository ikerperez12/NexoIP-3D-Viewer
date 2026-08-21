import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
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
const MAX_STRUCTURAL_VALIDATION_BYTES = 256 * 1024;
const GLB_MAGIC = 0x46546C67;
const GLB_VERSION = 2;
const BINARY_STL_HEADER_BYTES = 84;
const BINARY_STL_TRIANGLE_BYTES = 50;
const FBX_BINARY_HEADER = Buffer.from('Kaydara FBX Binary  \0\x1A\0', 'binary');

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

function isStructurallyValidGlb(bytes, size) {
  if (bytes.length < 12) return false;
  const magic = bytes.readUInt32LE(0);
  const version = bytes.readUInt32LE(4);
  const declaredLength = bytes.readUInt32LE(8);
  return magic === GLB_MAGIC && version === GLB_VERSION && declaredLength === size;
}

function isStructurallyValidGltf(bytes, size) {
  const text = toText(bytes);
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') || trimmed.includes('\0')) return false;

  // JSON metadata can legitimately be large because data URIs may be embedded.
  // Keep the scan bounded: reject malformed files when their complete JSON is
  // available, and retain a plausibly JSON-shaped larger candidate for loader
  // validation rather than falsely excluding a valid model.
  if (size > bytes.length) return true;

  try {
    const document = JSON.parse(trimmed);
    return isPlainObject(document)
      && isPlainObject(document.asset)
      && typeof document.asset.version === 'string'
      && /^2(?:\.\d+)?$/.test(document.asset.version);
  } catch {
    return false;
  }
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
  constructor({ openFile = fs.promises.open, openDirectory = fs.promises.opendir } = {}) {
    this.recordsById = new Map();
    this.idsByPath = new Map();
    this.openFile = openFile;
    this.openDirectory = openDirectory;
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
    };
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

  #publishRecord(realPath, stats, rootPath) {
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

    if (previousId && previousId !== record.id) {
      this.recordsById.delete(previousId);
    }
    this.recordsById.set(record.id, record);
    this.idsByPath.set(realPath, record.id);
    return record;
  }

  #publishScannedRecord(scanContext, realPath, stats, rootPath) {
    const record = this.#publishRecord(realPath, stats, rootPath);
    scanContext.discoveredPaths.add(realPath);
    this.status.foundModels = scanContext.discoveredPaths.size;
    this.status.availableModels = this.recordsById.size;
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
    this.recordsById = finalRecordsById;
    this.idsByPath = finalIdsByPath;
    this.status.foundModels = scanContext.discoveredPaths.size;
    this.status.availableModels = this.recordsById.size;
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

  async #scanDirectory(directoryPath, rootPath, scanContext, pendingDirectories) {
    let directory;
    try {
      directory = await this.openDirectory(directoryPath);
      if (this.#isCancelled()) return true;
      this.status.scannedDirectories += 1;
      let entryCount = 0;

      for await (const entry of directory) {
        if (this.#isCancelled()) return true;
        entryCount += 1;
        if (entryCount % SCAN_YIELD_INTERVAL === 0) {
          await this.#yieldToEventLoop();
          if (this.#isCancelled()) return true;
        }

        if (entry.isSymbolicLink()) {
          this.status.skippedEntries += 1;
          continue;
        }

        const candidatePath = path.resolve(directoryPath, entry.name);
        if (!isPathInside(rootPath, candidatePath)) {
          this.status.skippedEntries += 1;
          continue;
        }

        if (entry.isDirectory()) {
          try {
            const entryStats = await fs.promises.lstat(candidatePath);
            if (entryStats.isSymbolicLink() || !entryStats.isDirectory()) {
              this.status.skippedEntries += 1;
              continue;
            }
            const realDirectoryPath = await fs.promises.realpath(candidatePath);
            if (!isPathInside(rootPath, realDirectoryPath)) {
              this.status.skippedEntries += 1;
              continue;
            }
            pendingDirectories.push({ directoryPath: realDirectoryPath, rootPath });
          } catch {
            this.status.skippedEntries += 1;
          }
          continue;
        }

        if (!entry.isFile() || !isSupportedModelPath(candidatePath)) {
          continue;
        }

        try {
          const entryStats = await fs.promises.lstat(candidatePath);
          if (entryStats.isSymbolicLink() || !entryStats.isFile()) {
            this.status.skippedEntries += 1;
            continue;
          }
          const realPath = await fs.promises.realpath(candidatePath);
          const stats = await fs.promises.stat(realPath);
          if (!isPathInside(rootPath, realPath) || !isSupportedModelPath(realPath)) {
            this.status.skippedEntries += 1;
            continue;
          }
          if (!isReadableRegularFile(stats)) {
            this.status.skippedEntries += 1;
            if (stats.isFile() && stats.size > MAX_MODEL_BYTES) {
              this.status.oversizedModels += 1;
            }
            continue;
          }

          const structurallyValid = await this.#validateModelCandidate(realPath, stats);
          if (structurallyValid !== true) {
            this.status.skippedEntries += 1;
            if (structurallyValid === false) {
              this.status.invalidModels += 1;
            }
            continue;
          }
          if (this.#isCancelled()) return true;

          this.#publishScannedRecord(scanContext, realPath, stats, rootPath);
        } catch {
          this.status.skippedEntries += 1;
        }
      }
    } catch {
      this.status.skippedEntries += 1;
    } finally {
      if (directory) {
        await directory.close().catch(() => undefined);
      }
    }
    return this.#isCancelled();
  }

  async #scanDirectories(canonicalRoots, scanContext) {
    const pendingDirectories = canonicalRoots.map((rootPath) => ({ directoryPath: rootPath, rootPath }));
    const visitedDirectories = new Set();

    while (pendingDirectories.length > 0) {
      if (this.#isCancelled()) return true;

      const current = pendingDirectories.pop();
      const directoryKey = getDirectoryVisitKey(current.directoryPath);
      if (visitedDirectories.has(directoryKey)) {
        continue;
      }
      visitedDirectories.add(directoryKey);

      if (await this.#scanDirectory(
        current.directoryPath,
        current.rootPath,
        scanContext,
        pendingDirectories,
      )) {
        return true;
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
    this.status = this.#createStatus('scanning');
    const scanContext = {
      discoveredPaths: new Set(),
      externalPaths: new Set(),
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
      return {
        status: this.status.status,
        count: this.recordsById.size,
        truncated: this.status.truncated,
      };
    } catch (error) {
      this.status.status = 'failed';
      throw error;
    } finally {
      this.isScanning = false;
      this.scanAbortController = null;
      if (this.scanContext === scanContext) {
        this.scanContext = null;
      }
      this.status.isScanning = false;
    }
  }

  cancelScan() {
    if (!this.isScanning || !this.scanAbortController || this.scanAbortController.signal.aborted) {
      return { cancelled: false, status: this.getStatus() };
    }

    this.scanAbortController.abort();
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
