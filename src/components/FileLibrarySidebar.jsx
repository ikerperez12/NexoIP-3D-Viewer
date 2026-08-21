/* eslint-disable react-refresh/only-export-components */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Box, ChevronDown, ChevronRight, ExternalLink, Folder, FolderTree,
  HardDrive, RefreshCw, Search, Sparkles, X
} from 'lucide-react';
import { CATALOG_SEARCH_DEBOUNCE_MS, CATALOG_TREE_ROOT_PAGE_KEY } from '../utils/catalog-request.js';
import { SUPPORTED_MODEL_EXTENSIONS } from '../utils/nexoip.js';

const LIBRARY_TABS = [
  { id: 'tree', label: 'Árbol', icon: FolderTree },
  { id: 'flat', label: 'Lista', icon: Box }
];
export function nextRovingTabIndex(currentIndex, tabCount, key) {
  if (!tabCount) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % tabCount;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + tabCount) % tabCount;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;
  return null;
}

export function scanProgressMessage(scanStatus, isScanning) {
  if (!isScanning) {
    if (scanStatus?.status === 'cancelled') return 'Escaneo detenido. Se conservan los modelos precomprobados hasta la cancelación.';
    if (scanStatus?.status === 'failed') return 'El último escaneo no pudo completarse.';
    if (scanStatus?.status === 'completed') {
      const foundModels = scanStatus?.foundModels ?? scanStatus?.foundFiles ?? 0;
      const skippedEntries = scanStatus?.skippedEntries ?? 0;
      const oversizedModels = Math.min(scanStatus?.oversizedModels ?? 0, skippedEntries);
      const invalidModels = Math.min(scanStatus?.invalidModels ?? 0, skippedEntries - oversizedModels);
      const remainingSkipped = skippedEntries - oversizedModels - invalidModels;
      const details = [];
      if (oversizedModels > 0) details.push(`${oversizedModels} ${oversizedModels === 1 ? 'archivo supera' : 'archivos superan'} los 256 MB que el visor puede abrir de forma segura.`);
      if (invalidModels > 0) details.push(`${invalidModels} ${invalidModels === 1 ? 'archivo no supera' : 'archivos no superan'} la comprobación estructural del formato.`);
      if (remainingSkipped > 0) details.push(`${remainingSkipped} ${remainingSkipped === 1 ? 'elemento no se pudo indexar' : 'elementos no se pudieron indexar'} de forma segura.`);
      return details.length
        ? `Escaneo terminado: ${foundModels} modelos compatibles indexados. ${details.join(' ')}`
        : `Escaneo completo: ${foundModels} modelos compatibles indexados.`;
    }
    return 'El escaneo se inicia solo cuando lo solicitas.';
  }

  const foundModels = scanStatus?.foundModels ?? scanStatus?.foundFiles ?? 0;
  const availableModels = scanStatus?.availableModels ?? foundModels;
  const scannedDirectories = scanStatus?.scannedDirectories ?? scanStatus?.scannedFolders ?? 0;
  const availability = availableModels === foundModels
    ? `${foundModels} modelos precomprobados y disponibles`
    : `${foundModels} modelos precomprobados; ${availableModels} disponibles`;
  return `Escaneando: ${availability} en ${scannedDirectories} carpetas.`;
}

export function searchAnnouncement(query, extension, resultCount) {
  const hasQuery = Boolean(query.trim());
  const hasExtensionFilter = extension !== 'all';
  if (!hasQuery && !hasExtensionFilter) return '';
  const format = hasExtensionFilter ? ` en formato .${extension.toUpperCase()}` : '';
  const term = hasQuery ? ` para “${query.trim()}”` : '';
  return `${resultCount} ${resultCount === 1 ? 'modelo encontrado' : 'modelos encontrados'}${term}${format}.`;
}

function restoreFocus(triggerRef) {
  const focusTrigger = () => triggerRef?.current?.focus?.();
  if (typeof window !== 'undefined') window.requestAnimationFrame(focusTrigger);
  else focusTrigger();
}

export default function FileLibrarySidebar({
  isOpen,
  onClose,
  onRequestClose,
  triggerRef,
  files = [],
  catalogState,
  treePages = {},
  currentFileId,
  onSelectFile,
  onRevealFile,
  onRefresh,
  onLoadMoreCatalog,
  onLoadTreeChildren,
  onCatalogFiltersChange,
  onStartScan,
  onCancelScan,
  scanStatus,
  isScanning,
  isCancellingScan = false,
  bridgeAvailable
}) {
  const catalogFilters = catalogState?.filters || { query: '', extension: 'all' };
  const [activeTab, setActiveTab] = useState('tree');
  const [query, setQuery] = useState(catalogFilters.query);
  const [selectedExt, setSelectedExt] = useState(catalogFilters.extension);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const tabRefs = useRef([]);
  const instanceId = useId().replace(/:/g, '');

  const activePanelId = `library-${instanceId}-panel-${activeTab}`;
  const rootTreePage = treePages[CATALOG_TREE_ROOT_PAGE_KEY];
  const resultCount = catalogState?.total ?? 0;
  const catalogBusy = Boolean(catalogState?.isLoading || catalogState?.isLoadingMore);
  const announcedResultStatus = catalogState?.isLoading
    ? 'Actualizando resultados de la biblioteca…'
    : searchAnnouncement(query, selectedExt, resultCount);

  const requestClose = useCallback(() => {
    if (onRequestClose) onRequestClose();
    else onClose?.();
    restoreFocus(triggerRef);
  }, [onClose, onRequestClose, triggerRef]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      requestClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, requestClose]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'tree' || catalogState?.catalogRevision === null) return undefined;
    if (!rootTreePage && !catalogState?.isLoading) void onLoadTreeChildren?.(null);
    return undefined;
  }, [activeTab, catalogState?.catalogRevision, catalogState?.isLoading, isOpen, onLoadTreeChildren, rootTreePage]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const nextQuery = query.trim().slice(0, 200);
    const filtersAreCurrent = nextQuery === catalogFilters.query && selectedExt === catalogFilters.extension;
    if (filtersAreCurrent) return undefined;
    const timer = window.setTimeout(() => {
      onCatalogFiltersChange?.({ query: nextQuery, extension: selectedExt });
    }, CATALOG_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [catalogFilters.extension, catalogFilters.query, isOpen, onCatalogFiltersChange, query, selectedExt]);

  const refresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh?.();
    } finally {
      setIsRefreshing(false);
    }
  };
  const handleTabKeyDown = (event, index) => {
    const nextIndex = nextRovingTabIndex(index, LIBRARY_TABS.length, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveTab(LIBRARY_TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };
  const handleQueryChange = (event) => {
    setQuery(event.target.value);
    setActiveTab('flat');
  };
  const handleExtensionChange = (extension) => {
    setSelectedExt(extension);
    setActiveTab('flat');
  };

  if (!isOpen) return null;

  const scannedModelCount = scanStatus?.foundModels ?? scanStatus?.foundFiles;
  const totalCached = scanStatus?.availableModels ?? scanStatus?.totalCached ?? scannedModelCount ?? catalogState?.total ?? files.length;
  const statusMessage = scanProgressMessage(scanStatus, isScanning);
  const emptyMessage = resultCount
    ? 'No hay coincidencias con los filtros actuales.'
    : 'La biblioteca está vacía. Inicia un escaneo o abre un archivo local.';
  const hasCatalogSnapshot = catalogState?.catalogRevision !== null && catalogState?.catalogRevision !== undefined;
  const isTreeLoading = Boolean(isRefreshing
    || catalogState?.isLoading
    || (hasCatalogSnapshot && !rootTreePage));
  const isFlatLoading = Boolean(isRefreshing || catalogState?.isLoading);
  const rootTreeIsEmpty = Boolean(rootTreePage
    && !rootTreePage.isLoading
    && !rootTreePage.error
    && !rootTreePage.items?.length
    && !rootTreePage.nextCursor);

  return (
    <aside className="absolute bottom-4 left-4 top-32 z-20 flex w-[min(18rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl shadow-2xl glass-panel pointer-events-auto lg:w-80 2xl:top-20 2xl:w-96" aria-label="Biblioteca de modelos locales">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/40 p-4">
        <div className="flex items-center gap-2"><HardDrive size={18} aria-hidden="true" className="text-amber-300" /><div><h2 className="text-sm font-semibold text-gray-100">NexoIP 3D Viewer</h2><p className="font-mono text-[11px] text-emerald-200">Biblioteca local y árbol de carpetas</p></div></div>
        <button type="button" onClick={requestClose} className="min-h-8 min-w-8 rounded-lg p-2 text-gray-200 hover:bg-white/10 hover:text-white" aria-label="Cerrar biblioteca"><X size={18} aria-hidden="true" /></button>
      </div>

      <div className="flex gap-1 border-b border-white/10 bg-black/60 p-1" role="tablist" aria-label="Vista de biblioteca">
        {LIBRARY_TABS.map((tab, index) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          const tabId = `library-${instanceId}-tab-${tab.id}`;
          return <button type="button" key={tab.id} ref={(element) => { tabRefs.current[index] = element; }} id={tabId} role="tab" tabIndex={selected ? 0 : -1} aria-selected={selected} aria-controls={`library-${instanceId}-panel-${tab.id}`} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => handleTabKeyDown(event, index)} className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold ${selected ? (tab.id === 'tree' ? 'border border-amber-500/60 bg-amber-500/30 text-amber-100' : 'border border-emerald-500/60 bg-emerald-500/30 text-emerald-100') : 'text-gray-200 hover:bg-white/10 hover:text-white'}`}><Icon size={14} aria-hidden="true" /> {tab.label}</button>;
        })}
      </div>

      <div className="border-b border-white/10 bg-black/30 p-3">
        <div className="mb-2 flex gap-2">
          <button type="button" onClick={onStartScan} disabled={!bridgeAvailable || isScanning} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-2 py-2 text-xs font-semibold text-amber-100 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60" aria-describedby="scan-status scan-preflight-note">{isScanning ? <RefreshCw size={14} aria-hidden="true" className="animate-spin" /> : <Sparkles size={14} aria-hidden="true" />}{isScanning ? 'Escaneando…' : 'Escanear'}</button>
          {isScanning && <button type="button" onClick={onCancelScan} disabled={!bridgeAvailable || isCancellingScan} className="flex min-h-9 items-center justify-center gap-1 rounded-lg border border-red-400/60 bg-red-500/15 px-2 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60" aria-describedby="scan-status scan-preflight-note"><X size={14} aria-hidden="true" /> {isCancellingScan ? 'Deteniendo…' : 'Detener'}</button>}
          <button type="button" onClick={refresh} disabled={!bridgeAvailable || isRefreshing} className="min-h-9 min-w-9 rounded-lg border border-white/20 p-2 text-gray-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60" aria-label="Actualizar biblioteca"><RefreshCw size={15} aria-hidden="true" className={isRefreshing ? 'animate-spin' : ''} /></button>
        </div>
        <div id="scan-status" className="space-y-1 text-[11px]" role="status" aria-live="polite" aria-atomic="true"><div className="flex items-start justify-between gap-2 text-gray-200"><span>{statusMessage}</span><span className="shrink-0 font-mono font-bold text-emerald-200">{totalCached} modelos</span></div>{isScanning && <progress className="h-2 w-full accent-amber-400" aria-label="Escaneo local en curso" />}{!bridgeAvailable && <span className="block text-amber-100">Disponible solo desde la aplicación de escritorio.</span>}</div>
        <p id="scan-preflight-note" className="mt-1 text-[10px] leading-relaxed text-gray-300">La precomprobación estructural filtra candidatos inseguros; al abrirlos, el cargador valida el modelo completo y sus recursos.</p>
      </div>

      <div className="border-b border-white/10 p-3">
        <form role="search" aria-label="Buscar modelos locales"><label htmlFor={`model-search-${instanceId}`} className="sr-only">Buscar modelos por nombre</label><div className="flex min-h-9 items-center gap-2 rounded-xl border border-white/20 bg-black/50 px-3 py-2 focus-within:border-emerald-300"><Search size={15} aria-hidden="true" className="text-emerald-200" /><input id={`model-search-${instanceId}`} type="search" value={query} onChange={handleQueryChange} placeholder="Buscar por nombre…" aria-controls={activePanelId} className="w-full bg-transparent text-xs text-white outline-none placeholder:text-gray-300" /></div></form>
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filtrar por formato">{['all', ...SUPPORTED_MODEL_EXTENSIONS].map((extension) => { const label = extension === 'all' ? 'Todos' : `.${extension.toUpperCase()}`; return <button type="button" key={extension} onClick={() => handleExtensionChange(extension)} aria-pressed={selectedExt === extension} className={`min-h-8 shrink-0 rounded-lg px-2 py-1 text-[11px] font-mono font-bold ${selectedExt === extension ? 'bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-300/70' : 'bg-white/5 text-gray-200 hover:bg-white/10'}`}>{label}</button>; })}</div>
        {activeTab === 'tree' && (query.trim() || selectedExt !== 'all') && <p className="mt-2 text-[11px] text-gray-300">Los filtros se muestran en la vista Lista; el árbol se carga por carpetas.</p>}
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcedResultStatus}</div>
      </div>

      <div className="flex-1 overflow-y-auto p-3" aria-busy={Boolean(isRefreshing || catalogBusy)}>
        <div id={`library-${instanceId}-panel-tree`} role="tabpanel" aria-labelledby={`library-${instanceId}-tab-tree`} hidden={activeTab !== 'tree'} className="space-y-1.5">
          {isTreeLoading ? <LoadingLibraryState /> : (rootTreeIsEmpty ? <EmptyLibraryState message={emptyMessage} canScan={!isScanning && bridgeAvailable} onStartScan={onStartScan} /> : <LazyTreeNode node={{ id: null, name: 'Biblioteca local', type: 'root' }} pageKey={CATALOG_TREE_ROOT_PAGE_KEY} treePages={treePages} currentFileId={currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} onLoadTreeChildren={onLoadTreeChildren} panelId={`library-${instanceId}-panel-tree`} />)}
        </div>
        <div id={`library-${instanceId}-panel-flat`} role="tabpanel" aria-labelledby={`library-${instanceId}-tab-flat`} hidden={activeTab !== 'flat'} className="space-y-1.5">
          {isFlatLoading ? <LoadingLibraryState /> : (files.length ? <FlatModelList key={`${catalogState?.catalogRevision}\u0000${catalogFilters.query}\u0000${catalogFilters.extension}`} files={files} currentFileId={currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} panelId={`library-${instanceId}-panel-flat`} totalCount={catalogState?.total ?? files.length} hasMore={Boolean(catalogState?.nextCursor)} isLoadingMore={Boolean(catalogState?.isLoadingMore)} onLoadMore={onLoadMoreCatalog} /> : <EmptyLibraryState message={emptyMessage} canScan={!isScanning && bridgeAvailable} onStartScan={onStartScan} />)}
        </div>
      </div>
    </aside>
  );
}

function LoadingLibraryState() {
  return <div className="flex flex-col items-center justify-center py-12 text-xs text-gray-200" role="status" aria-live="polite"><RefreshCw size={24} aria-hidden="true" className="mb-2 animate-spin text-emerald-200" /> Actualizando biblioteca…</div>;
}

function EmptyLibraryState({ message, canScan, onStartScan }) {
  return <div className="py-12 text-center text-xs text-gray-300"><Box size={36} aria-hidden="true" className="mx-auto mb-2 text-amber-200/70" /><p>{message}</p>{canScan && <button type="button" onClick={onStartScan} className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-lg border border-amber-400/60 px-3 py-2 text-amber-100 hover:bg-amber-500/15"><Sparkles size={12} aria-hidden="true" /> Iniciar escaneo</button>}</div>;
}

function ModelRow({ file, isActive, onSelectFile, onRevealFile, compact = false }) {
  return <div className={`flex items-center justify-between gap-1 rounded-xl border ${isActive ? 'border-amber-500/70 bg-amber-500/20' : 'border-white/10 bg-black/20 hover:bg-white/10'}`}><button type="button" onClick={() => onSelectFile?.(file)} aria-current={isActive ? 'true' : undefined} className={`flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2.5 text-left ${isActive ? 'text-amber-100' : 'text-gray-100'}`}><span className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase badge-${file.extension}`}>{file.extension}</span><span className="min-w-0 truncate text-xs font-medium">{file.name}</span></button><button type="button" onClick={() => onRevealFile?.(file.id)} className="mr-1 min-h-8 min-w-8 shrink-0 rounded-lg p-2 text-gray-200 hover:bg-white/10 hover:text-amber-100" aria-label={`Mostrar ${file.name} en el Explorador`} title="Mostrar en el Explorador"><ExternalLink size={compact ? 12 : 14} aria-hidden="true" /></button></div>;
}

function FlatModelList({ files, currentFileId, onSelectFile, onRevealFile, panelId, totalCount = files.length, hasMore = false, isLoadingMore = false, onLoadMore }) {
  const statusId = `flat-page-${useId().replace(/:/g, '')}`;
  const remaining = Math.max(0, totalCount - files.length);
  return <>{files.map((file) => <ModelRow key={file.id} file={file} isActive={file.id === currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} />)}{hasMore && <button type="button" onClick={() => { void onLoadMore?.(); }} disabled={isLoadingMore} aria-controls={panelId} aria-describedby={statusId} className="mt-2 min-h-9 w-full rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-gray-100 hover:bg-white/10 disabled:cursor-wait disabled:opacity-70">{isLoadingMore ? 'Cargando más modelos…' : `Mostrar más modelos${remaining ? ` (${remaining} restantes)` : ''}`}</button>}<p id={statusId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">Mostrando {files.length} de {totalCount} modelos.</p></>;
}

function LazyTreeNode({ node, pageKey, treePages, currentFileId, onSelectFile, onRevealFile, onLoadTreeChildren, panelId }) {
  const isRoot = node.type === 'root';
  const [expanded, setExpanded] = useState(isRoot);
  const page = treePages[pageKey];
  const statusId = `tree-page-${useId().replace(/:/g, '')}`;
  const contentId = `tree-items-${useId().replace(/:/g, '')}`;
  const entries = page?.items || [];
  const folders = entries.filter((entry) => entry?.type === 'folder');
  const files = entries.filter((entry) => entry?.type === 'model');
  const directoryName = isRoot ? 'Biblioteca local' : node.name;
  const requestPage = (append = false) => { void onLoadTreeChildren?.(isRoot ? null : node.id, { append }); };
  const toggleExpanded = () => { const nextExpanded = !expanded; setExpanded(nextExpanded); if (nextExpanded && !page) requestPage(); };

  return <div className="text-xs" style={{ paddingLeft: isRoot ? 0 : 10 }}>
    {!isRoot && <button type="button" onClick={toggleExpanded} aria-expanded={expanded} aria-controls={contentId} className="flex min-h-8 w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-gray-100 hover:bg-white/10"><span className="flex min-w-0 items-center gap-2 truncate">{expanded ? <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-amber-200" /> : <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-gray-200" />}<Folder size={15} aria-hidden="true" className="shrink-0 text-amber-200" /><span className="truncate font-medium">{node.name}</span></span><span className="ml-2 rounded border border-emerald-400/30 bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-100">{node.filesCount ?? 0}</span></button>}
    {(isRoot || expanded) && <div id={contentId} className="space-y-0.5">{page?.isLoading && !entries.length && <LoadingLibraryState />}{page?.error && <div className="rounded-lg border border-red-400/40 bg-red-950/30 p-2 text-red-100" role="alert"><p>{page.error}</p><button type="button" onClick={() => requestPage()} className="mt-2 min-h-8 rounded border border-red-300/60 px-2 py-1 text-xs font-semibold hover:bg-red-500/15">Reintentar</button></div>}{folders.map((folder) => <LazyTreeNode key={folder.id} node={folder} pageKey={folder.id} treePages={treePages} currentFileId={currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} onLoadTreeChildren={onLoadTreeChildren} panelId={panelId} />)}{files.map((file) => <ModelRow key={file.id} compact file={file} isActive={file.id === currentFileId} onSelectFile={onSelectFile} onRevealFile={onRevealFile} />)}{page?.nextCursor && <button type="button" onClick={() => requestPage(true)} disabled={page.isLoading} aria-controls={panelId} aria-describedby={statusId} className="mt-1 min-h-9 w-full rounded-lg border border-white/20 px-3 py-2 text-xs font-semibold text-gray-100 hover:bg-white/10 disabled:cursor-wait disabled:opacity-70">{page.isLoading ? 'Cargando elementos…' : `Mostrar más elementos (${Math.max(0, page.total - entries.length)} restantes)`}</button>}{page && <p id={statusId} className="sr-only" role="status" aria-live="polite" aria-atomic="true">Mostrando {entries.length} de {page.total} elementos en {directoryName}.</p>}</div>}
  </div>;
}
