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

export const MAX_SCAN_ROOTS = 8;
export const MAX_SCAN_DEPTH = 12;
export const MAX_SCANNED_DIRECTORIES = 10_000;
export const MAX_SCANNED_MODELS = 10_000;
export const MAX_MODEL_BYTES = 256 * 1024 * 1024;
export const MAX_DIRECTORY_ENTRIES = 20_000;

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

export class FileScanner {
  constructor({ openFile = fs.promises.open } = {}) {
    this.recordsById = new Map();
    this.idsByPath = new Map();
    this.openFile = openFile;
    this.isScanning = false;
    this.scanAbortController = null;
    this.status = this.#createStatus('idle');
  }

  #createStatus(status) {
    return {
      status,
      isScanning: false,
      scannedDirectories: 0,
      foundModels: 0,
      skippedEntries: 0,
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

  #addRecord(realPath, stats, rootPath) {
    const existingId = this.idsByPath.get(realPath);
    if (existingId) {
      return this.recordsById.get(existingId);
    }

    if (this.recordsById.size >= MAX_SCANNED_MODELS) {
      throw new RangeError('The local model registry reached its safety limit.');
    }

    const record = {
      id: this.#newOpaqueId(),
      path: realPath,
      rootPath,
      name: path.basename(realPath),
      extension: path.extname(realPath).toLowerCase(),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      identity: toFileIdentity(stats),
    };

    this.recordsById.set(record.id, record);
    this.idsByPath.set(realPath, record.id);
    return record;
  }

  async #canonicalizeRoots(roots) {
    if (!Array.isArray(roots) || roots.length === 0 || roots.length > MAX_SCAN_ROOTS) {
      throw new TypeError(`Choose between 1 and ${MAX_SCAN_ROOTS} folders.`);
    }

    const canonicalRoots = [];
    const seenRoots = new Set();
    for (const root of roots) {
      if (this.#isCancelled()) break;
      if (typeof root !== 'string' || !path.isAbsolute(root)) {
        throw new TypeError('Invalid folder selection.');
      }

      const canonicalRoot = await fs.promises.realpath(root);
      const rootStats = await fs.promises.stat(canonicalRoot);
      if (!rootStats.isDirectory() || seenRoots.has(canonicalRoot)) {
        continue;
      }

      seenRoots.add(canonicalRoot);
      canonicalRoots.push(canonicalRoot);
    }

    if (canonicalRoots.length === 0 && !this.#isCancelled()) {
      throw new TypeError('No readable folders were selected.');
    }
    return canonicalRoots;
  }

  async #scanDirectory(directoryPath, rootPath, depth) {
    if (this.#isCancelled()) return true;
    if (
      depth > MAX_SCAN_DEPTH
      || this.status.scannedDirectories >= MAX_SCANNED_DIRECTORIES
      || this.recordsById.size >= MAX_SCANNED_MODELS
    ) {
      this.status.truncated = true;
      return false;
    }

    let directory;
    try {
      directory = await fs.promises.opendir(directoryPath);
      if (this.#isCancelled()) return true;
      this.status.scannedDirectories += 1;
      let entryCount = 0;

      for await (const entry of directory) {
        if (this.#isCancelled()) return true;
        entryCount += 1;
        if (entryCount > MAX_DIRECTORY_ENTRIES) {
          this.status.skippedEntries += 1;
          this.status.truncated = true;
          break;
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
            const realDirectoryPath = await fs.promises.realpath(candidatePath);
            if (!isPathInside(rootPath, realDirectoryPath)) {
              this.status.skippedEntries += 1;
              continue;
            }
            if (await this.#scanDirectory(realDirectoryPath, rootPath, depth + 1)) return true;
          } catch {
            this.status.skippedEntries += 1;
          }
          continue;
        }

        if (!entry.isFile() || !isSupportedModelPath(candidatePath)) {
          continue;
        }

        if (this.recordsById.size >= MAX_SCANNED_MODELS) {
          this.status.truncated = true;
          break;
        }

        try {
          const realPath = await fs.promises.realpath(candidatePath);
          const stats = await fs.promises.stat(realPath);
          if (!isPathInside(rootPath, realPath) || !isSupportedModelPath(realPath)) {
            this.status.skippedEntries += 1;
            continue;
          }
          if (!isReadableRegularFile(stats)) {
            this.status.skippedEntries += 1;
            continue;
          }

          this.#addRecord(realPath, stats, rootPath);
          this.status.foundModels = this.recordsById.size;
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

  async scanDirectories(roots) {
    if (this.isScanning) {
      return { status: 'already_scanning', count: this.recordsById.size };
    }

    this.isScanning = true;
    this.scanAbortController = new AbortController();
    this.status = this.#createStatus('scanning');

    try {
      const canonicalRoots = await this.#canonicalizeRoots(roots);
      this.status.selectedFolderCount = canonicalRoots.length;
      this.recordsById.clear();
      this.idsByPath.clear();

      for (const rootPath of canonicalRoots) {
        if (await this.#scanDirectory(rootPath, rootPath, 0)) break;
      }

      const cancelled = this.#isCancelled();
      this.status.status = cancelled ? 'cancelled' : 'completed';
      this.status.foundModels = this.recordsById.size;
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

    const record = this.#addRecord(realPath, stats, path.dirname(realPath));
    this.status.foundModels = this.recordsById.size;
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
