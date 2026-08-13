import React, { useMemo, useState } from 'react';
import {
  Box, ChevronDown, ChevronRight, ExternalLink, Folder, FolderTree,
  HardDrive, RefreshCw, Search, Sparkles, X
} from 'lucide-react';
import { SUPPORTED_MODEL_EXTENSIONS } from '../utils/nexoip.js';

function isMatchingFile(file, query, extension) {
  if (!file?.id) return false;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return (!normalizedQuery || String(file.name || '').toLocaleLowerCase().includes(normalizedQuery))
    && (extension === 'all' || file.extension === extension);
}

function treeHasMatches(node, query, extension) {
  if (!node) return false;
  return (node.files || []).some((file) => isMatchingFile(file, query, extension))
    || (node.children || []).some((child) => treeHasMatches(child, query, extension));
}

function statusLabel(scanStatus, isScanning) {
  if (isScanning) return 'Escaneando archivos locales…';
  if (scanStatus?.status === 'completed') return 'Escaneo local completado.';
  return 'El escaneo se inicia solo cuando lo solicitas.';
}

export default function FileLibrarySidebar({
  isOpen,
  onClose,
  files,
  folderTree,
  currentFileId,
  onSelectFile,
  onRevealFile,
  onRefresh,
  onStartScan,
  scanStatus,
  isScanning,
  bridgeAvailable
}) {
  const [activeTab, setActiveTab] = useState('tree');
  const [query, setQuery] = useState('');
  const [selectedExt, setSelectedExt] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const visibleFiles = useMemo(
    () => files.filter((file) => isMatchingFile(file, query, selectedExt)),
    [files, query, selectedExt]
  );

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!isOpen) return null;

  const totalCached = scanStatus?.totalCached ?? scanStatus?.foundFiles ?? files.length;

  return (
    <aside className="absolute bottom-4 left-4 top-20 z-20 flex w-80 flex-col overflow-hidden rounded-2xl shadow-2xl glass-panel pointer-events-auto md:w-96" aria-label="Biblioteca de modelos locales">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/40 p-4">
        <div className="flex items-center gap-2">
          <HardDrive size={18} aria-hidden="true" className="text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold text-gray-100">NexoIP 3D Viewer</h2>
            <p className="font-mono text-[10px] text-emerald-300">Biblioteca local y árbol de carpetas</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-300 hover:bg-white/10 hover:text-white" aria-label="Cerrar biblioteca">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex gap-1 border-b border-white/10 bg-black/60 p-1" role="tablist" aria-label="Vista de biblioteca">
        <button type="button" role="tab" aria-selected={activeTab === 'tree'} onClick={() => setActiveTab('tree')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold ${activeTab === 'tree' ? 'border border-amber-500/50 bg-amber-500/30 text-amber-200' : 'text-gray-300 hover:bg-white/5 hover:text-white'}`}>
          <FolderTree size={14} aria-hidden="true" /> Árbol
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'flat'} onClick={() => setActiveTab('flat')} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold ${activeTab === 'flat' ? 'border border-emerald-500/50 bg-emerald-500/30 text-emerald-100' : 'text-gray-300 hover:bg-white/5 hover:text-white'}`}>
          <Box size={14} aria-hidden="true" /> Lista
        </button>
      </div>

      <div className="border-b border-white/10 bg-black/30 p-3">
        <div className="mb-2 flex gap-2">
          <button type="button" onClick={onStartScan} disabled={!bridgeAvailable || isScanning} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50" aria-describedby="scan-status">
            {isScanning ? <RefreshCw size={14} aria-hidden="true" className="animate-spin" /> : <Sparkles size={14} aria-hidden="true" />}
            {isScanning ? 'Escaneando…' : 'Escanear'}
          </button>
          <button type="button" onClick={refresh} disabled={!bridgeAvailable || isRefreshing} className="rounded-lg border border-white/15 p-2 text-gray-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Actualizar biblioteca">
            <RefreshCw size={15} aria-hidden="true" className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
        <div id="scan-status" className="space-y-1 text-[10px]" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-gray-300">
            <span>{statusLabel(scanStatus, isScanning)}</span>
            <span className="font-mono font-bold text-emerald-300">{totalCached} modelos</span>
          </div>
          {isScanning && (
            <>
              <progress className="h-1.5 w-full accent-amber-400" aria-label="Escaneo local en curso" />
              <span className="block text-gray-400">Carpetas revisadas: {scanStatus?.scannedFolders ?? 0}</span>
            </>
          )}
          {!bridgeAvailable && <span className="block text-amber-200">Disponible solo desde la aplicación de escritorio.</span>}
        </div>
      </div>

      <div className="border-b border-white/10 p-3">
        <label htmlFor="model-search" className="sr-only">Buscar modelos por nombre</label>
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/50 px-3 py-2 focus-within:border-emerald-400/60">
          <Search size={15} aria-hidden="true" className="text-emerald-300" />
          <input id="model-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre…" className="w-full bg-transparent text-xs text-white outline-none placeholder:text-gray-400" />
        </div>
        <div className="mt-2 flex gap-1 overflow-x-auto pb-1" aria-label="Filtrar por formato">
          {['all', ...SUPPORTED_MODEL_EXTENSIONS].map((extension) => {
            const label = extension === 'all' ? 'Todos' : `.${extension.toUpperCase()}`;
            return <button type="button" key={extension} onClick={() => setSelectedExt(extension)} aria-pressed={selectedExt === extension} className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-mono font-bold ${selectedExt === extension ? 'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/60' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>{label}</button>;
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3" aria-busy={isRefreshing}>
        {isRefreshing ? (
          <div className="flex flex-col items-center justify-center py-12 text-xs text-gray-300" role="status">
            <RefreshCw size={24} aria-hidden="true" className="mb-2 animate-spin text-emerald-300" /> Actualizando biblioteca…
          </div>
        ) : activeTab === 'tree' && folderTree ? (
          <div role="tabpanel" aria-label="Árbol de carpetas" className="space-y-0.5">
            <TreeNode node={folderTree} query={query} extension={selectedExt} currentFileId={currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} />
          </div>
        ) : visibleFiles.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-400">
            <Box size={36} aria-hidden="true" className="mx-auto mb-2 text-amber-300/50" />
            <p>{files.length ? 'No hay coincidencias con los filtros.' : 'La biblioteca está vacía.'}</p>
            {!isScanning && bridgeAvailable && <button type="button" onClick={onStartScan} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-amber-400/50 px-3 py-2 text-amber-100 hover:bg-amber-500/15"><Sparkles size={12} aria-hidden="true" /> Iniciar escaneo</button>}
          </div>
        ) : (
          <div role="tabpanel" aria-label="Lista de modelos" className="space-y-1.5">
            {visibleFiles.map((file) => <ModelRow key={file.id} file={file} isActive={file.id === currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} />)}
          </div>
        )}
      </div>
    </aside>
  );
}

function ModelRow({ file, isActive, onSelectFile, onRevealFile, compact = false }) {
  return (
    <div className={`flex items-center justify-between gap-1 rounded-xl border ${isActive ? 'border-amber-500/60 bg-amber-500/20' : 'border-white/5 bg-black/20 hover:bg-white/10'}`}>
      <button type="button" onClick={() => onSelectFile(file.id)} aria-current={isActive ? 'true' : undefined} className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2.5 text-left ${isActive ? 'text-amber-100' : 'text-gray-100'}`}>
        <span className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase badge-${file.extension}`}>{file.extension}</span>
        <span className="min-w-0 truncate text-xs font-medium">{file.name}</span>
      </button>
      <button type="button" onClick={() => onRevealFile(file.id)} className="mr-1 shrink-0 rounded-lg p-2 text-gray-300 hover:bg-white/10 hover:text-amber-200" aria-label={`Mostrar ${file.name} en el Explorador`} title="Mostrar en el Explorador">
        <ExternalLink size={compact ? 12 : 14} aria-hidden="true" />
      </button>
    </div>
  );
}

function TreeNode({ node, query, extension, currentFileId, onSelectFile, onRevealFile, level = 0 }) {
  const [expanded, setExpanded] = useState(level < 2);
  if (!node || !treeHasMatches(node, query, extension)) return null;

  const children = (node.children || []).filter((child) => treeHasMatches(child, query, extension));
  const files = (node.files || []).filter((file) => isMatchingFile(file, query, extension));
  const hasContent = children.length > 0 || files.length > 0;
  const isRoot = level === 0;

  return (
    <div className="text-xs" style={{ paddingLeft: isRoot ? 0 : 10 }}>
      {!isRoot && (
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-gray-100 hover:bg-white/10">
          <span className="flex min-w-0 items-center gap-2 truncate">
            {hasContent ? (expanded ? <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-amber-300" /> : <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-gray-300" />) : <span className="w-3.5" />}
            <Folder size={15} aria-hidden="true" className="shrink-0 text-amber-300" />
            <span className="truncate font-medium">{node.name}</span>
          </span>
          <span className="ml-2 rounded border border-emerald-500/20 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-200">{node.filesCount ?? files.length}</span>
        </button>
      )}
      {(isRoot || expanded) && (
        <div className="space-y-0.5">
          {children.map((child, index) => <TreeNode key={child.id || `${child.name}-${index}`} node={child} query={query} extension={extension} currentFileId={currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} level={level + 1} />)}
          {files.map((file) => <ModelRow key={file.id} compact file={file} isActive={file.id === currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} />)}
        </div>
      )}
    </div>
  );
}
