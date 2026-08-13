import React, { useState, useEffect } from 'react';
import { 
  X, Search, RefreshCw, Folder, HardDrive, CheckCircle2, 
  ExternalLink, Filter, ChevronRight, ChevronDown, FolderTree, Sparkles, Box
} from 'lucide-react';

export default function FileLibrarySidebar({
  isOpen,
  onClose,
  onSelectFile,
  currentFile
}) {
  const [activeTab, setActiveTab] = useState('tree'); // 'tree' | 'flat'
  const [files, setFiles] = useState([]);
  const [folderTree, setFolderTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedExt, setSelectedExt] = useState('all');
  const [scanStatus, setScanStatus] = useState(null);
  const [isScanning, setIsScanning] = useState(false);

  // Cargar catálogo de archivos
  const fetchCatalog = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (query) params.append('query', query);
      if (selectedExt !== 'all') params.append('extension', selectedExt);

      const [resFiles, resTree] = await Promise.all([
        fetch(`/api/files?${params.toString()}`),
        fetch('/api/tree')
      ]);

      const dataFiles = await resFiles.json();
      const dataTree = await resTree.json();

      if (dataFiles.success) setFiles(dataFiles.files);
      if (dataTree.success) setFolderTree(dataTree.tree);
    } catch (err) {
      console.error('Error cargando catálogo NexoIP 3D:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkScanStatus = async () => {
    try {
      const res = await fetch('/api/scan-status');
      const data = await res.json();
      if (data.success) {
        setScanStatus(data.status);
        setIsScanning(data.status.isScanning);
        if (!data.status.isScanning && isScanning) {
          fetchCatalog();
        }
      }
    } catch (err) {
      console.error('Error comprobando estado del escáner:', err);
    }
  };

  useEffect(() => {
    fetchCatalog();
    checkScanStatus();
    const interval = setInterval(checkScanStatus, 2500);
    return () => clearInterval(interval);
  }, [query, selectedExt]);

  const handleStartScan = async () => {
    try {
      setIsScanning(true);
      await fetch('/api/scan', { method: 'POST' });
      checkScanStatus();
    } catch (err) {
      console.error('Error iniciando escaneo masivo:', err);
    }
  };

  const handleOpenInExplorer = async (filePath, e) => {
    e.stopPropagation();
    try {
      await fetch('/api/open-in-explorer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      });
    } catch (err) {
      console.error('Error abriendo explorador:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <aside className="absolute top-20 left-4 bottom-4 w-80 md:w-96 z-20 glass-panel rounded-2xl flex flex-col overflow-hidden shadow-2xl animate-fade-in pointer-events-auto">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/40">
        <div className="flex items-center gap-2">
          <HardDrive size={18} className="text-amber-400" />
          <div>
            <h3 className="font-semibold text-gray-100 text-sm">NexoIP 3D Viewer</h3>
            <p className="text-[10px] text-emerald-400 font-mono">Explorador & Árbol de Carpetas</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 bg-black/60 p-1 gap-1">
        <button
          onClick={() => setActiveTab('tree')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
            activeTab === 'tree'
              ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          }`}
        >
          <FolderTree size={14} />
          <span>Árbol de Carpetas</span>
        </button>
        <button
          onClick={() => setActiveTab('flat')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
            activeTab === 'flat'
              ? 'bg-amber-500/30 text-amber-300 border border-amber-500/50'
              : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
          }`}
        >
          <Box size={14} />
          <span>Lista Plana ({files.length})</span>
        </button>
      </div>

      {/* Panel Superior: Escáner Masivo y Filtros */}
      <div className="p-3 border-b border-white/10 bg-black/30 space-y-2">
        <button
          onClick={handleStartScan}
          disabled={isScanning}
          className={`w-full py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 text-xs font-bold transition-all shadow-lg ${
            isScanning
              ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/20'
          }`}
        >
          <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
          <span>{isScanning ? 'Escaneando discos masivamente...' : 'Escanear Todo el Ordenador'}</span>
        </button>

        {scanStatus && (
          <div className="bg-black/50 p-2 rounded-xl border border-white/5 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-gray-400">Carpetas: {scanStatus.scannedFolders}</span>
              <span className="text-amber-400 font-bold">{scanStatus.totalCached || files.length} objetos 3D</span>
            </div>
            {isScanning && (
              <p className="text-[10px] text-emerald-400 truncate font-mono">
                {scanStatus.currentPath}
              </p>
            )}
          </div>
        )}

        {/* Buscador */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar modelo o ruta..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-black/50 text-gray-200 text-xs rounded-xl pl-8 pr-3 py-2 border border-white/10 outline-none focus:border-amber-500/60"
          />
        </div>

        {/* Filtros por Extensión 3D */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 pt-1 no-scrollbar">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'glb', label: '.GLB' },
            { id: 'gltf', label: '.GLTF' },
            { id: 'obj', label: '.OBJ' },
            { id: 'stl', label: '.STL' },
            { id: 'fbx', label: '.FBX' },
            { id: 'ply', label: '.PLY' },
            { id: 'dae', label: '.DAE' }
          ].map(ext => (
            <button
              key={ext.id}
              onClick={() => setSelectedExt(ext.id)}
              className={`px-2.5 py-1 text-[10px] font-mono rounded-lg transition-all shrink-0 ${
                selectedExt === ext.id
                  ? 'bg-amber-500 text-black font-extrabold shadow'
                  : 'bg-black/40 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {ext.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenido Principal */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-500 text-xs gap-2">
            <RefreshCw size={24} className="animate-spin text-amber-400" />
            <span>Indexando archivos 3D...</span>
          </div>
        ) : activeTab === 'tree' ? (
          folderTree && folderTree.children && folderTree.children.length > 0 ? (
            <TreeNode
              node={folderTree}
              onSelectFile={onSelectFile}
              currentFile={currentFile}
              onOpenInExplorer={handleOpenInExplorer}
            />
          ) : (
            <div className="text-center text-gray-500 py-12 text-xs">
              <FolderTree size={36} className="mx-auto mb-2 opacity-30 text-amber-400" />
              <p>No hay árbol generado aún.</p>
              <button
                onClick={handleStartScan}
                className="mt-2 text-amber-400 hover:underline inline-flex items-center gap-1 font-semibold"
              >
                <Sparkles size={12} /> Iniciar escaneo masivo
              </button>
            </div>
          )
        ) : (
          /* Pestaña Lista Plana */
          files.length === 0 ? (
            <div className="text-center text-gray-500 py-12 text-xs">
              <Box size={36} className="mx-auto mb-2 opacity-30 text-amber-400" />
              <p>No se encontraron archivos 3D.</p>
            </div>
          ) : (
            files.map((file) => {
              const isActive = currentFile && currentFile.path === file.path;
              return (
                <div
                  key={file.id || file.path}
                  onClick={() => onSelectFile(file)}
                  className={`p-2.5 rounded-xl transition-all cursor-pointer border group flex items-center justify-between ${
                    isActive
                      ? 'bg-amber-500/20 border-amber-500/60 shadow-lg'
                      : 'bg-black/20 hover:bg-white/10 border-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase shrink-0 badge-${file.extension}`}>
                      {file.extension}
                    </span>
                    <div className="flex flex-col truncate">
                      <span className={`text-xs font-medium truncate ${isActive ? 'text-amber-200 font-bold' : 'text-gray-200 group-hover:text-white'}`}>
                        {file.name}
                      </span>
                      <span className="text-[10px] text-gray-400 truncate font-mono">
                        {file.folder}
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleOpenInExplorer(file.path, e)}
                    className="p-1.5 text-gray-500 hover:text-amber-300 hover:bg-white/10 rounded-lg transition-all shrink-0"
                    title="Abrir carpeta en Explorador de Windows"
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              );
            })
          )
        )}
      </div>
    </aside>
  );
}

/**
 * Componente recursivo para renderizar el Árbol de Carpetas
 */
function TreeNode({ node, level = 0, onSelectFile, currentFile, onOpenInExplorer }) {
  const [expanded, setExpanded] = useState(level < 2);

  if (!node) return null;

  const hasChildren = (node.children && node.children.length > 0) || (node.files && node.files.length > 0);

  return (
    <div style={{ paddingLeft: level > 0 ? '10px' : '0px' }} className="text-xs">
      {/* Fila de Carpeta */}
      {node.name !== 'Equipo (Discos y Carpetas)' && (
        <div
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/10 cursor-pointer group transition-all"
        >
          <div className="flex items-center gap-2 truncate">
            {hasChildren ? (
              expanded ? <ChevronDown size={14} className="text-amber-400 shrink-0" /> : <ChevronRight size={14} className="text-gray-400 shrink-0" />
            ) : (
              <div className="w-3.5" />
            )}
            <Folder size={16} className="text-amber-400 shrink-0" />
            <span className="font-medium text-gray-200 truncate">{node.name}</span>
          </div>

          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-500/20 font-bold">
            {node.filesCount}
          </span>
        </div>
      )}

      {/* Hijos de Carpeta o Archivos 3D */}
      {(expanded || node.name === 'Equipo (Discos y Carpetas)') && (
        <div className="space-y-0.5 mt-0.5">
          {/* Subcarpetas */}
          {node.children && node.children.map((sub, i) => (
            <TreeNode
              key={sub.path || i}
              node={sub}
              level={level + 1}
              onSelectFile={onSelectFile}
              currentFile={currentFile}
              onOpenInExplorer={onOpenInExplorer}
            />
          ))}

          {/* Archivos 3D dentro de esta carpeta */}
          {node.files && node.files.map((file, i) => {
            const isActive = currentFile && currentFile.path === file.path;
            return (
              <div
                key={file.path || i}
                style={{ paddingLeft: `${(level + 1) * 10}px` }}
                onClick={() => onSelectFile(file)}
                className={`py-1.5 px-2 rounded-lg flex items-center justify-between cursor-pointer transition-all ${
                  isActive
                    ? 'bg-amber-500/30 border border-amber-500/60 text-white font-bold'
                    : 'hover:bg-white/10 text-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono uppercase badge-${file.extension}`}>
                    {file.extension}
                  </span>
                  <span className="truncate">{file.name}</span>
                </div>

                <button
                  onClick={(e) => onOpenInExplorer(file.path, e)}
                  className="p-1 text-gray-500 hover:text-amber-300 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
                  title="Abrir en Explorador de Windows"
                >
                  <ExternalLink size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
