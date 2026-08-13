import fs from 'fs';
import path from 'path';
import os from 'os';

const TARGET_EXTENSIONS = ['.glb', '.gltf', '.obj', '.stl', '.fbx', '.ply', '.dae', '.3ds', '.usdz', '.off'];

// Carpetas del sistema que deben ignorarse para evitar bloqueos
const IGNORED_DIRS = new Set([
  'node_modules', '$recycle.bin', 'system volume information',
  'appdata', 'windows', 'program files', 'program files (x86)', '.git',
  '.vscode', '.idea', 'cache', 'temp', 'tmp', 'package-lock.json'
]);

class FileScanner {
  constructor() {
    this.filesCache = [];
    this.folderTree = { name: 'Equipo', path: 'root', isFolder: true, filesCount: 0, children: [] };
    this.isScanning = false;
    this.scanProgress = { scannedFolders: 0, foundFiles: 0, status: 'idle', currentPath: '' };
  }

  getDrivesAndHomeDirs() {
    const userHome = os.homedir();
    const dirs = [
      path.join(userHome, '3D Objects'),
      path.join(userHome, 'Downloads'),
      path.join(userHome, 'Desktop'),
      path.join(userHome, 'Documents'),
      path.join(userHome, 'Pictures'),
      userHome
    ];

    if (process.platform === 'win32') {
      const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ';
      for (let i = 0; i < letters.length; i++) {
        const drive = `${letters[i]}:\\`;
        if (fs.existsSync(drive)) {
          dirs.push(drive);
        }
      }
    } else {
      dirs.push('/');
    }

    // Eliminar duplicados y verificar existencia
    return Array.from(new Set(dirs)).filter(d => {
      try {
        return fs.existsSync(d);
      } catch (e) {
        return false;
      }
    });
  }

  async scanDirectories(customDirs = null) {
    if (this.isScanning) {
      return { status: 'already_scanning', count: this.filesCache.length };
    }

    this.isScanning = true;
    this.scanProgress = { scannedFolders: 0, foundFiles: 0, status: 'scanning', currentPath: '' };
    this.filesCache = [];

    const targetDirs = customDirs && customDirs.length > 0 ? customDirs : this.getDrivesAndHomeDirs();

    console.log('[NexoIP Scanner] Iniciando escaneo masivo de discos en:', targetDirs);

    for (const dir of targetDirs) {
      try {
        await this.scanRecursive(dir, 0, 15); // Profundidad masiva de hasta 15 subniveles
      } catch (err) {
        console.error(`[NexoIP Scanner] Error escaneando ${dir}:`, err.message);
      }
    }

    // Construir el árbol ordenado de directorios
    this.folderTree = this.buildFolderTree(this.filesCache);

    this.isScanning = false;
    this.scanProgress.status = 'completed';
    this.scanProgress.foundFiles = this.filesCache.length;
    console.log(`[NexoIP Scanner] Escaneo masivo completado. ${this.filesCache.length} archivos 3D indexados.`);

    return { status: 'completed', count: this.filesCache.length, files: this.filesCache, tree: this.folderTree };
  }

  async scanRecursive(dirPath, currentDepth, maxDepth) {
    if (currentDepth > maxDepth) return;

    const baseName = path.basename(dirPath).toLowerCase();
    if (IGNORED_DIRS.has(baseName) || (baseName.startsWith('.') && baseName !== '.')) return;

    this.scanProgress.scannedFolders++;
    this.scanProgress.currentPath = dirPath;

    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (e) {
      return; // Error de lectura o permisos denegados en Windows
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await this.scanRecursive(fullPath, currentDepth + 1, maxDepth);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (TARGET_EXTENSIONS.includes(ext)) {
          try {
            const stats = await fs.promises.stat(fullPath);
            const fileObj = {
              id: Buffer.from(fullPath).toString('base64url'),
              name: entry.name,
              path: fullPath,
              extension: ext.replace('.', ''),
              size: stats.size,
              mtime: stats.mtime,
              folder: path.dirname(fullPath)
            };
            this.filesCache.push(fileObj);
            this.scanProgress.foundFiles++;
          } catch (e) {
            // Ignorar bloqueo de lectura
          }
        }
      }
    }
  }

  buildFolderTree(fileList) {
    const rootMap = new Map();

    for (const file of fileList) {
      const parts = file.path.split(path.sep).filter(Boolean);
      let currentLevel = rootMap;

      let accumulatedPath = process.platform === 'win32' ? '' : '/';

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (process.platform === 'win32' && i === 0) {
          accumulatedPath = `${part}\\`;
        } else {
          accumulatedPath = path.join(accumulatedPath, part);
        }

        if (!currentLevel.has(part)) {
          currentLevel.set(part, {
            name: part,
            path: accumulatedPath,
            isFolder: true,
            filesCount: 0,
            children: new Map(),
            files: []
          });
        }

        const node = currentLevel.get(part);
        node.filesCount++;
        currentLevel = node.children;
      }

      // Añadir archivo al nodo de la carpeta final
      const folderName = parts[parts.length - 2] || parts[0];
      const folderNode = rootMap.get(parts[0]);
      if (folderNode) {
        let curr = folderNode;
        for (let i = 1; i < parts.length - 1; i++) {
          if (curr.children.has(parts[i])) {
            curr = curr.children.get(parts[i]);
          }
        }
        curr.files.push(file);
      }
    }

    // Convertir mapas recursivamente a arrays ordenados
    function mapToArray(map) {
      const result = [];
      for (const [key, value] of map.entries()) {
        result.push({
          name: value.name,
          path: value.path,
          isFolder: true,
          filesCount: value.filesCount,
          files: value.files,
          children: mapToArray(value.children)
        });
      }
      result.sort((a, b) => a.name.localeCompare(b.name));
      return result;
    }

    return {
      name: 'Equipo (Discos y Carpetas)',
      path: 'root',
      isFolder: true,
      filesCount: fileList.length,
      children: mapToArray(rootMap)
    };
  }

  getFiles({ query = '', extension = '', sortBy = 'name', order = 'asc' } = {}) {
    let result = [...this.filesCache];

    if (query) {
      const q = query.toLowerCase();
      result = result.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    }

    if (extension && extension !== 'all') {
      const extClean = extension.toLowerCase().replace('.', '');
      result = result.filter(f => f.extension.toLowerCase() === extClean);
    }

    result.sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = valB.toLowerCase();
      }
      if (valA < valB) return order === 'asc' ? -1 : 1;
      if (valA > valB) return order === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }

  getTree() {
    return this.folderTree;
  }

  getStatus() {
    return {
      ...this.scanProgress,
      totalCached: this.filesCache.length,
      isScanning: this.isScanning
    };
  }
}

export const scanner = new FileScanner();
