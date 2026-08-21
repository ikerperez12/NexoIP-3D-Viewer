import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toolbar3D from './components/Toolbar3D.jsx';
import ModelInspector from './components/ModelInspector.jsx';
import AnimationController from './components/AnimationController.jsx';
import FileLibrarySidebar from './components/FileLibrarySidebar.jsx';
import DropZone from './components/DropZone.jsx';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { exportModelAsGlb } from './utils/exporters.js';
import {
  CATALOG_PAGE_LIMIT,
  CATALOG_TREE_ROOT_PAGE_KEY,
  createCatalogRefreshQueue,
  createCatalogRequestGuard,
  getPublishedModelCount,
  mergeCatalogPage,
  normalizeCatalogFilters,
  responseCatalogChange,
  responseCatalogNeighbor,
  responseCatalogPage,
  supportsCatalogChangeSubscription,
  supportsCatalogV2,
} from './utils/catalog-request.js';
import { prefersReducedMotion } from './utils/motion-preference.js';
import {
  callNexoip,
  ELECTRON_BRIDGE_ERROR,
  getNexoipBridge,
  isScanInProgress,
  responseModel,
  responseStatus,
  validateDroppedFile
} from './utils/nexoip.js';

const Viewport3D = React.lazy(() => import('./components/Viewport3D.jsx'));

function isCompactViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 48rem)').matches;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function createInitialCatalogState() {
  return {
    catalogRevision: null,
    scanId: null,
    total: 0,
    nextCursor: null,
    filters: normalizeCatalogFilters(),
    isLoading: false,
    isLoadingMore: false,
  };
}

function sameCatalogFilters(left, right) {
  return left.query === right.query
    && left.extension === right.extension
    && left.sortBy === right.sortBy
    && left.order === right.order;
}

export default function App() {
  const bridge = getNexoipBridge();
  const bridgeAvailable = Boolean(bridge);
  const catalogV2Available = supportsCatalogV2(bridge);
  const catalogChangeSubscriptionAvailable = supportsCatalogChangeSubscription(bridge);
  const [currentFile, setCurrentFile] = useState(null);
  const [filesList, setFilesList] = useState([]);
  const [catalogState, setCatalogState] = useState(createInitialCatalogState);
  const [treePages, setTreePages] = useState({});
  const [scanStatus, setScanStatus] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanRequestPending, setScanRequestPending] = useState(false);
  const [isCancellingScan, setIsCancellingScan] = useState(false);
  const [catalogError, setCatalogError] = useState(() => {
    if (!bridgeAvailable) return ELECTRON_BRIDGE_ERROR;
    return catalogV2Available ? null : 'Esta versión no incluye el catálogo paginado obligatorio.';
  });

  const [renderMode, setRenderMode] = useState('pbr');
  const [envPreset, setEnvPreset] = useState('studio_pro');
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isOrthographic, setIsOrthographic] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(() => !isCompactViewport());
  const [compactLayout, setCompactLayout] = useState(isCompactViewport);

  const [modelData, setModelData] = useState(null);
  const [cameraPresetRequest, setCameraPresetRequest] = useState(null);
  const [cameraControlRequest, setCameraControlRequest] = useState(null);
  const [resetCameraRequest, setResetCameraRequest] = useState(0);
  const [snapshotRequest, setSnapshotRequest] = useState(0);
  const [nodeVisibilityToggle, setNodeVisibilityToggle] = useState(null);
  const reducedMotionRef = useRef(prefersReducedMotion());

  const [animations, setAnimations] = useState([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(() => !prefersReducedMotion());
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [seekRequest, setSeekRequest] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const scanWasActiveRef = useRef(false);
  const exportInProgressRef = useRef(false);
  const sidebarTriggerRef = useRef(null);
  const inspectorTriggerRef = useRef(null);
  const currentFileRef = useRef(null);
  const catalogStateRef = useRef(createInitialCatalogState());
  const treePagesRef = useRef({});
  const treeRequestTokensRef = useRef(new Map());
  const scanStatusRequestRef = useRef(null);
  const publishedCatalogCountRef = useRef(null);
  const finalScanCatalogRefreshRef = useRef(null);
  const catalogRefreshQueueRef = useRef(null);
  const [catalogRequestGuard] = useState(createCatalogRequestGuard);
  const [navigationRequestGuard] = useState(createCatalogRequestGuard);
  const latestCatalogChangeRevisionRef = useRef(null);

  const updateCatalogState = useCallback((nextState) => {
    catalogStateRef.current = nextState;
    setCatalogState(nextState);
  }, []);

  const updateTreePages = useCallback((nextPages) => {
    treePagesRef.current = nextPages;
    setTreePages(nextPages);
  }, []);

  const clearLoadedModelState = useCallback(() => {
    setModelData(null);
    setAnimations([]);
    setCurrentClipIndex(0);
    setIsPlaying(!reducedMotionRef.current);
    setProgress(0);
    setSeekRequest({ value: 0, timestamp: Date.now() });
  }, []);

  const changeCurrentFile = useCallback((nextFile) => {
    const identityChanged = currentFileRef.current?.id !== nextFile?.id;
    currentFileRef.current = nextFile;
    setCurrentFile(nextFile);
    if (identityChanged) clearLoadedModelState();
  }, [clearLoadedModelState]);

  const currentIndex = useMemo(
    () => filesList.findIndex((file) => file.id === currentFile?.id),
    [currentFile?.id, filesList]
  );
  const activeModelData = modelData?.modelId === currentFile?.id ? modelData : null;
  const activeAnimations = activeModelData ? animations : [];

  const showToast = useCallback((message, type = 'success') => {
    window.clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimerRef.current), []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 48rem)');
    const updateLayout = (event) => {
      setCompactLayout(event.matches);
      if (event.matches) setInspectorOpen(false);
    };
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = (event) => {
      reducedMotionRef.current = event.matches;
      if (event.matches) setIsPlaying(false);
    };
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  const refreshScanStatus = useCallback(() => {
    if (!bridgeAvailable) return Promise.resolve(null);

    const pendingRequest = scanStatusRequestRef.current;
    if (pendingRequest) return pendingRequest.promise;

    const requestToken = Symbol('scan-status');
    const request = callNexoip('getScanStatus')
      .then((response) => {
        const status = responseStatus(response);
        const active = isScanInProgress(status);
        setScanStatus(status);
        setIsScanning(active);
        return {
          status,
          active,
          publishedModelCount: getPublishedModelCount(status),
        };
      })
      .finally(() => {
        if (scanStatusRequestRef.current?.token === requestToken) {
          scanStatusRequestRef.current = null;
        }
      });

    scanStatusRequestRef.current = { token: requestToken, promise: request };
    return request;
  }, [bridgeAvailable]);

  const loadCatalogV2Once = useCallback(async ({ announce = false } = {}) => {
    const requestGeneration = catalogRequestGuard.begin();
    const previousState = catalogStateRef.current;
    const filters = previousState.filters;
    updateCatalogState({
      ...previousState,
      isLoading: true,
      isLoadingMore: false,
      nextCursor: null,
    });

    try {
      let page = responseCatalogPage(await callNexoip('getCatalogPage', {
        filters,
        limit: CATALOG_PAGE_LIMIT,
      }));
      if (!page || page.items.length > CATALOG_PAGE_LIMIT) {
        throw new Error('La respuesta paginada de la biblioteca no es válida.');
      }
      if (page.reset) {
        page = responseCatalogPage(await callNexoip('getCatalogPage', {
          filters,
          limit: CATALOG_PAGE_LIMIT,
        }));
        if (!page || page.reset || page.items.length > CATALOG_PAGE_LIMIT) {
          throw new Error('La biblioteca cambió antes de poder actualizarse.');
        }
      }
      if (!catalogRequestGuard.isCurrent(requestGeneration)) return false;

      const nextCatalog = mergeCatalogPage(null, page);
      setFilesList(nextCatalog.items);
      treeRequestTokensRef.current.clear();
      updateTreePages({});
      updateCatalogState({
        ...previousState,
        ...nextCatalog,
        filters,
        isLoading: false,
        isLoadingMore: false,
      });
      setIsScanning(page.isScanning);

      const previous = currentFileRef.current;
      const selected = previous && nextCatalog.items.find((file) => file.id === previous.id);
      if (selected) changeCurrentFile(selected);
      else if (!previous) changeCurrentFile(nextCatalog.items[0] || null);

      setCatalogError(null);
      if (announce) showToast(`${nextCatalog.total} modelos disponibles en la biblioteca.`);
      return true;
    } catch (error) {
      if (!catalogRequestGuard.isCurrent(requestGeneration)) return false;
      updateCatalogState({ ...catalogStateRef.current, isLoading: false, isLoadingMore: false });
      const message = getErrorMessage(error, 'No se pudo cargar la biblioteca local.');
      setCatalogError(message);
      if (announce) showToast(message, 'error');
      return false;
    }
  }, [catalogRequestGuard, changeCurrentFile, showToast, updateCatalogState, updateTreePages]);

  const loadCatalogOnce = useCallback((options = {}) => {
    if (!bridgeAvailable || !catalogV2Available) return Promise.resolve(false);
    return loadCatalogV2Once(options);
  }, [bridgeAvailable, catalogV2Available, loadCatalogV2Once]);

  const loadCatalog = useCallback((options = {}) => {
    if (!bridgeAvailable || !catalogV2Available) return Promise.resolve(false);
    if (!catalogRefreshQueueRef.current) {
      catalogRefreshQueueRef.current = createCatalogRefreshQueue(loadCatalogOnce);
    }
    return catalogRefreshQueueRef.current.request(options);
  }, [bridgeAvailable, catalogV2Available, loadCatalogOnce]);

  const loadNextCatalogPage = useCallback(async () => {
    if (!catalogV2Available) return false;

    const snapshot = catalogStateRef.current;
    if (snapshot.catalogRevision === null || !snapshot.nextCursor || snapshot.isLoading || snapshot.isLoadingMore) {
      return false;
    }

    const requestGeneration = catalogRequestGuard.begin();
    updateCatalogState({ ...snapshot, isLoadingMore: true });
    try {
      const page = responseCatalogPage(await callNexoip('getCatalogPage', {
        revision: snapshot.catalogRevision,
        cursor: snapshot.nextCursor,
        filters: snapshot.filters,
        limit: CATALOG_PAGE_LIMIT,
      }));
      if (!page || page.items.length > CATALOG_PAGE_LIMIT) {
        throw new Error('La siguiente página de la biblioteca no es válida.');
      }
      if (!catalogRequestGuard.isCurrent(requestGeneration)) return false;
      if (page.reset || page.catalogRevision !== snapshot.catalogRevision) {
        updateCatalogState({ ...catalogStateRef.current, isLoadingMore: false });
        return loadCatalog({ preserveCurrentSelection: true });
      }

      const nextCatalog = mergeCatalogPage(snapshot, page, { append: true });
      setFilesList(nextCatalog.items);
      updateCatalogState({
        ...catalogStateRef.current,
        ...nextCatalog,
        filters: snapshot.filters,
        isLoading: false,
        isLoadingMore: false,
      });
      const current = currentFileRef.current;
      const refreshedCurrent = current && nextCatalog.items.find((file) => file.id === current.id);
      if (refreshedCurrent) changeCurrentFile(refreshedCurrent);
      setIsScanning(page.isScanning);
      return true;
    } catch (error) {
      if (!catalogRequestGuard.isCurrent(requestGeneration)) return false;
      updateCatalogState({ ...catalogStateRef.current, isLoadingMore: false });
      setCatalogError(getErrorMessage(error, 'No se pudo cargar más modelos de la biblioteca.'));
      return false;
    }
  }, [catalogRequestGuard, catalogV2Available, changeCurrentFile, loadCatalog, updateCatalogState]);

  const loadTreeChildren = useCallback(async (parentId, { append = false } = {}) => {
    if (!catalogV2Available) return false;

    const pageKey = parentId || CATALOG_TREE_ROOT_PAGE_KEY;
    const snapshot = catalogStateRef.current;
    const existingPage = treePagesRef.current[pageKey];
    if (snapshot.catalogRevision === null || existingPage?.isLoading || (append && !existingPage?.nextCursor)) {
      return false;
    }

    const token = Symbol(`tree:${pageKey}`);
    treeRequestTokensRef.current.set(pageKey, token);
    updateTreePages({
      ...treePagesRef.current,
      [pageKey]: {
        ...existingPage,
        items: append ? existingPage?.items || [] : [],
        isLoading: true,
        error: null,
      },
    });

    try {
      const page = responseCatalogPage(await callNexoip('getTreeChildren', {
        ...(parentId ? { parentId } : {}),
        revision: snapshot.catalogRevision,
        ...(append ? { cursor: existingPage.nextCursor } : {}),
        limit: CATALOG_PAGE_LIMIT,
      }));
      if (!page || page.items.length > CATALOG_PAGE_LIMIT) {
        throw new Error('La respuesta paginada del árbol no es válida.');
      }
      if (treeRequestTokensRef.current.get(pageKey) !== token) return false;
      if (page.reset || page.catalogRevision !== snapshot.catalogRevision) {
        const nextPages = { ...treePagesRef.current };
        delete nextPages[pageKey];
        updateTreePages(nextPages);
        return loadCatalog({ preserveCurrentSelection: true });
      }

      const nextPage = mergeCatalogPage(existingPage, page, { append });
      updateTreePages({
        ...treePagesRef.current,
        [pageKey]: {
          ...nextPage,
          isLoading: false,
          error: null,
        },
      });
      setIsScanning(page.isScanning);
      return true;
    } catch (error) {
      if (treeRequestTokensRef.current.get(pageKey) !== token) return false;
      updateTreePages({
        ...treePagesRef.current,
        [pageKey]: {
          ...existingPage,
          items: append ? existingPage?.items || [] : [],
          isLoading: false,
          error: getErrorMessage(error, 'No se pudo cargar esta carpeta.'),
        },
      });
      return false;
    }
  }, [catalogV2Available, loadCatalog, updateTreePages]);

  const handleCatalogFiltersChange = useCallback((filters) => {
    if (!catalogV2Available) return;
    const normalizedFilters = normalizeCatalogFilters(filters);
    const previousState = catalogStateRef.current;
    if (sameCatalogFilters(previousState.filters, normalizedFilters)) return;

    catalogRequestGuard.invalidate();
    navigationRequestGuard.invalidate();
    treeRequestTokensRef.current.clear();
    updateTreePages({});
    setFilesList([]);
    updateCatalogState({
      ...previousState,
      filters: normalizedFilters,
      total: 0,
      nextCursor: null,
      isLoading: true,
      isLoadingMore: false,
    });
    void loadCatalog({ preserveCurrentSelection: true });
  }, [catalogRequestGuard, catalogV2Available, loadCatalog, navigationRequestGuard, updateCatalogState, updateTreePages]);

  const refreshFinalScanCatalog = useCallback(() => {
    if (!finalScanCatalogRefreshRef.current) {
      finalScanCatalogRefreshRef.current = loadCatalog();
    }
    return finalScanCatalogRefreshRef.current;
  }, [loadCatalog]);

  useEffect(() => {
    if (!bridgeAvailable || !catalogV2Available) return undefined;
    const startupTask = window.setTimeout(() => {
      void callNexoip('consumeStartupModel')
        .then((registered) => {
          if (registered?.id) {
            catalogRequestGuard.invalidate();
            setFilesList([registered]);
            changeCurrentFile(registered);
            showToast(`Cargando ${registered.name}…`);
            return loadCatalog();
          }
          return loadCatalog();
        })
        .catch((error) => setCatalogError(getErrorMessage(error, 'No se pudo abrir el modelo de inicio.')));
      void refreshScanStatus().catch((error) => setCatalogError(getErrorMessage(error, 'No se pudo consultar el escáner local.')));
    }, 0);
    return () => window.clearTimeout(startupTask);
  }, [bridgeAvailable, catalogRequestGuard, catalogV2Available, changeCurrentFile, loadCatalog, refreshScanStatus, showToast]);

  useEffect(() => {
    const bridge = getNexoipBridge();
    if (!bridgeAvailable || typeof bridge?.onModelOpened !== 'function') return undefined;
    bridge.onModelOpened((registered) => {
      if (!registered?.id) return;
      catalogRequestGuard.invalidate();
      setFilesList((previous) => [registered, ...previous.filter((item) => item.id !== registered.id)]);
      changeCurrentFile(registered);
      showToast(`Cargando ${registered.name}…`);
      void loadCatalog({ preserveCurrentSelection: true });
    });
    return undefined;
  }, [bridgeAvailable, catalogRequestGuard, catalogV2Available, changeCurrentFile, loadCatalog, showToast]);

  useEffect(() => {
    if (!bridgeAvailable || !catalogChangeSubscriptionAvailable) return undefined;
    const bridge = getNexoipBridge();
    let disposed = false;
    let unsubscribe = null;

    try {
      unsubscribe = bridge.subscribeCatalogChanges((event) => {
        if (disposed) return;
        const change = responseCatalogChange(event);
        if (!change) return;

        const currentRevision = catalogStateRef.current.catalogRevision;
        const latestRevision = latestCatalogChangeRevisionRef.current;
        if ((latestRevision !== null && change.catalogRevision < latestRevision)
          || (currentRevision !== null && change.catalogRevision < currentRevision)) {
          return;
        }
        latestCatalogChangeRevisionRef.current = change.catalogRevision;
        setScanStatus((previous) => ({
          ...previous,
          catalogRevision: change.catalogRevision,
          scanId: change.scanId,
          foundModels: change.modelCount,
          availableModels: change.modelCount,
          isScanning: change.isScanning,
          status: change.status,
        }));
        setIsScanning(change.isScanning);
        scanWasActiveRef.current = change.isScanning;

        if (currentRevision === change.catalogRevision) return;

        catalogRequestGuard.invalidate();
        navigationRequestGuard.invalidate();
        treeRequestTokensRef.current.clear();
        updateTreePages({});
        void loadCatalog({ preserveCurrentSelection: true });
      });
    } catch (error) {
      queueMicrotask(() => {
        if (!disposed) setCatalogError(getErrorMessage(error, 'No se pudieron recibir los cambios de la biblioteca.'));
      });
    }

    return () => {
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [
    bridgeAvailable,
    catalogChangeSubscriptionAvailable,
    catalogRequestGuard,
    loadCatalog,
    navigationRequestGuard,
    updateTreePages,
  ]);

  useEffect(() => {
    if (!bridgeAvailable
      || catalogChangeSubscriptionAvailable
      || (!isScanning && !scanRequestPending)) return undefined;

    const reportPollingError = (error) => {
      const message = getErrorMessage(error, 'No se pudo actualizar el progreso del escaneo.');
      setCatalogError((previous) => previous === message ? previous : message);
    };

    const refreshPublishedCatalog = (publishedModelCount) => {
      if (publishedModelCount === null || publishedModelCount === publishedCatalogCountRef.current) {
        return;
      }

      publishedCatalogCountRef.current = publishedModelCount;
      void loadCatalog({ preserveCurrentSelection: true })
        .then((updated) => {
          // A transient IPC failure must not prevent a later poll with the
          // same available count from repairing the visible catalog.
          if (!updated && publishedCatalogCountRef.current === publishedModelCount) {
            publishedCatalogCountRef.current = null;
          }
        })
        .catch(reportPollingError);
    };

    const pollScanStatus = () => {
      void refreshScanStatus()
        .then((scanResult) => {
          if (!scanResult) return;

          const { active, publishedModelCount } = scanResult;
          if (active) {
            if (!scanWasActiveRef.current) {
              scanWasActiveRef.current = true;
              publishedCatalogCountRef.current = null;
              // A catalog read that began before the scan may return an older
              // snapshot after progressive publication has started.
              catalogRequestGuard.invalidate();
            }
            refreshPublishedCatalog(publishedModelCount);
            return;
          }

          if (scanWasActiveRef.current && !active) {
            scanWasActiveRef.current = false;
            setIsScanning(false);
            publishedCatalogCountRef.current = null;
            void refreshFinalScanCatalog().catch(reportPollingError);
          }
        })
        .catch(reportPollingError);
    };

    pollScanStatus();
    const interval = window.setInterval(pollScanStatus, 1000);

    return () => window.clearInterval(interval);
  }, [
    bridgeAvailable,
    catalogChangeSubscriptionAvailable,
    catalogRequestGuard,
    isScanning,
    loadCatalog,
    refreshFinalScanCatalog,
    refreshScanStatus,
    scanRequestPending,
  ]);

  const handleStartScan = useCallback(async () => {
    if (!bridgeAvailable) {
      showToast(ELECTRON_BRIDGE_ERROR, 'error');
      return;
    }

    try {
      setScanRequestPending(true);
      scanWasActiveRef.current = false;
      publishedCatalogCountRef.current = null;
      finalScanCatalogRefreshRef.current = null;
      showToast('Elige una o más carpetas para iniciar el escaneo local.');
      const result = await callNexoip('scan');
      const status = responseStatus(result);
      const active = isScanInProgress(status);
      setScanStatus(status);
      setIsScanning(active);
      scanWasActiveRef.current = active;
      setScanRequestPending(false);
      setIsCancellingScan(false);
      if (result?.cancelled && typeof result?.status !== 'string') {
        showToast('No se seleccionaron carpetas. La biblioteca no se ha modificado.');
      } else if (result?.cancelled || status?.status === 'cancelled') {
        await refreshFinalScanCatalog();
        showToast(`Escaneo detenido: ${result?.count ?? 0} modelos precomprobados siguen disponibles.`);
      } else if (active) {
        catalogRequestGuard.invalidate();
        showToast('Escaneo local en curso.');
      } else {
        await refreshFinalScanCatalog();
        showToast(`Escaneo completado: ${result?.count ?? 0} modelos indexados.`);
      }
    } catch (error) {
      setScanRequestPending(false);
      setIsScanning(false);
      setIsCancellingScan(false);
      showToast(getErrorMessage(error, 'No se pudo iniciar el escaneo local.'), 'error');
    }
  }, [bridgeAvailable, catalogRequestGuard, refreshFinalScanCatalog, showToast]);

  const handleCancelScan = useCallback(async () => {
    if (!bridgeAvailable || isCancellingScan) return;

    let cancellationRequested = false;
    try {
      setIsCancellingScan(true);
      const result = await callNexoip('cancelScan');
      const status = responseStatus(result);
      setScanStatus(status);
      if (result?.cancelled) {
        cancellationRequested = true;
        showToast('Deteniendo el escaneo de forma segura…');
      } else {
        setIsScanning(false);
        showToast('No hay ningún escaneo activo.');
      }
    } catch (error) {
      showToast(getErrorMessage(error, 'No se pudo detener el escaneo local.'), 'error');
    } finally {
      if (!cancellationRequested) setIsCancellingScan(false);
    }
  }, [bridgeAvailable, isCancellingScan, showToast]);

  const selectFileById = useCallback((fileOrId) => {
    const fileId = typeof fileOrId === 'string' ? fileOrId : fileOrId?.id;
    const nextFile = typeof fileOrId === 'object' && fileOrId?.id
      ? fileOrId
      : filesList.find((file) => file.id === fileId);
    if (!nextFile) {
      showToast('El modelo seleccionado ya no está disponible. Actualiza la biblioteca.', 'error');
      return;
    }
    changeCurrentFile(nextFile);
    showToast(`Cargando ${nextFile.name}…`);
  }, [changeCurrentFile, filesList, showToast]);

  const selectCatalogNeighbor = useCallback(async (relation) => {
    if (!catalogV2Available) return false;
    const snapshot = catalogStateRef.current;
    const current = currentFileRef.current;
    if (snapshot.catalogRevision === null || (relation !== 'random' && !current?.id)) {
      if (!current && filesList[0]) selectFileById(filesList[0]);
      return false;
    }

    const requestGeneration = navigationRequestGuard.begin();
    try {
      const neighbor = responseCatalogNeighbor(await callNexoip('getCatalogNeighbor', {
        relation,
        ...(current?.id ? { id: current.id } : {}),
        revision: snapshot.catalogRevision,
        filters: snapshot.filters,
      }));
      if (!navigationRequestGuard.isCurrent(requestGeneration)) return false;
      if (!neighbor) throw new Error('La respuesta de navegación de la biblioteca no es válida.');
      if (neighbor.reset || neighbor.catalogRevision !== snapshot.catalogRevision) {
        await loadCatalog({ preserveCurrentSelection: true });
        return false;
      }
      if (!neighbor.model) {
        showToast('No hay otro modelo disponible con los filtros actuales.');
        return false;
      }
      selectFileById(neighbor.model);
      return true;
    } catch (error) {
      if (!navigationRequestGuard.isCurrent(requestGeneration)) return false;
      showToast(getErrorMessage(error, 'No se pudo cambiar de modelo.'), 'error');
      return false;
    }
  }, [catalogV2Available, filesList, loadCatalog, navigationRequestGuard, selectFileById, showToast]);

  const selectRelativeModel = useCallback((offset) => {
    void selectCatalogNeighbor(offset < 0 ? 'previous' : 'next');
  }, [selectCatalogNeighbor]);

  const handleRandomModel = useCallback(() => {
    void selectCatalogNeighbor('random');
  }, [selectCatalogNeighbor]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const element = event.target;
      const isTextEntry = element instanceof HTMLElement && (
        element.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(element.tagName)
      );
      const isViewportControl = element instanceof HTMLElement && Boolean(element.closest('[data-viewport-controls]'));
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTextEntry || isViewportControl) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        selectRelativeModel(1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        selectRelativeModel(-1);
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        setResetCameraRequest(Date.now());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectRelativeModel]);

  const handleModelLoaded = useCallback(({ modelId, object, exportObject, animations: nextAnimations, stats, metadata }) => {
    setModelData({
      modelId,
      object,
      exportObject: exportObject || object,
      animations: nextAnimations || [],
      stats,
      metadata: metadata || null
    });
    setAnimations(nextAnimations || []);
    setCurrentClipIndex(0);
    setIsPlaying(!reducedMotionRef.current);
    setProgress(0);
    setSeekRequest({ value: 0, timestamp: Date.now() });
  }, []);

  const handleAnimationProgress = useCallback((nextProgress) => {
    setProgress((previous) => Math.abs(previous - nextProgress) > 0.001 ? nextProgress : previous);
  }, []);

  const handleClipChange = useCallback((clipIndex) => {
    setCurrentClipIndex(clipIndex);
    setProgress(0);
    setIsPlaying(!reducedMotionRef.current);
    setSeekRequest({ value: 0, timestamp: Date.now() });
  }, []);

  const handleSeek = useCallback((nextProgress) => {
    const value = Math.max(0, Math.min(1, nextProgress));
    setProgress(value);
    setSeekRequest({ value, timestamp: Date.now() });
  }, []);

  const handleRevealModel = useCallback(async (fileId) => {
    try {
      await callNexoip('revealModel', fileId);
    } catch (error) {
      showToast(getErrorMessage(error, 'No se pudo abrir el Explorador de archivos.'), 'error');
    }
  }, [showToast]);

  const handleDroppedFile = useCallback(async (file) => {
    const validationError = validateDroppedFile(file);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }

    try {
      const registered = responseModel(await callNexoip('registerDropped', file));
      if (!registered?.id) throw new Error('La aplicación no pudo registrar el archivo local.');
      catalogRequestGuard.invalidate();
      setFilesList((previous) => [registered, ...previous.filter((item) => item.id !== registered.id)]);
      changeCurrentFile(registered);
      showToast(`Cargando ${registered.name}…`);
      void loadCatalog({ preserveCurrentSelection: true });
    } catch (error) {
      showToast(getErrorMessage(error, 'No se pudo abrir el archivo local.'), 'error');
    }
  }, [catalogRequestGuard, changeCurrentFile, loadCatalog, showToast]);

  const downloadBlob = useCallback((blob, fileName) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }, []);

  const handleExportModel = useCallback(async (format) => {
    const exportObject = activeModelData?.exportObject || activeModelData?.object;
    if (!exportObject) {
      showToast('No hay modelo cargado para exportar.', 'error');
      return;
    }

    if (exportInProgressRef.current) {
      showToast('Ya hay una exportación en curso.', 'error');
      return;
    }

    const name = (currentFile?.name || 'modelo_3d').replace(/[^a-z0-9._-]+/gi, '_').replace(/\.[^.]+$/, '');
    exportInProgressRef.current = true;
    setIsExporting(true);
    try {
      if (format === 'stl') {
        const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
        const result = new STLExporter().parse(exportObject, { binary: true });
        downloadBlob(new Blob([result], { type: 'application/octet-stream' }), `${name}.stl`);
        showToast(`Geometría original exportada como ${name}.stl. Este formato no conserva materiales ni animaciones.`);
      } else if (format === 'obj') {
        const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
        const result = new OBJExporter().parse(exportObject);
        downloadBlob(new Blob([result], { type: 'text/plain' }), `${name}.obj`);
        showToast(`Geometría original exportada como ${name}.obj. Las texturas no se incluyen en este archivo.`);
      } else if (format === 'glb') {
        const gltf = await exportModelAsGlb(exportObject, activeModelData.animations || []);
        downloadBlob(new Blob([gltf], { type: 'model/gltf-binary' }), `${name}.glb`);
        const clipCount = activeModelData.animations?.length || 0;
        showToast(`Activo original exportado como ${name}.glb${clipCount ? ` con ${clipCount} animaciones` : ''}.`);
      } else {
        throw new Error('Formato de exportación no compatible.');
      }
      // Exporters may reuse the clean source clone with transient GPU resources;
      // the live viewport remains the authoritative owner until the model changes.
    } catch (error) {
      showToast(getErrorMessage(error, 'No se pudo exportar el modelo.'), 'error');
    } finally {
      exportInProgressRef.current = false;
      setIsExporting(false);
    }
  }, [activeModelData, currentFile?.name, downloadBlob, showToast]);

  return (
    <main
      className="relative h-full w-full overflow-hidden bg-black"
      aria-label="NexoIP 3D Viewer"
      data-loaded-model-id={activeModelData?.modelId || undefined}
    >
      <React.Suspense fallback={<div className="flex h-full w-full items-center justify-center bg-black text-sm text-gray-200" role="status">Preparando el visor 3D…</div>}>
        <Viewport3D
          currentFile={currentFile}
          renderMode={renderMode}
          envPreset={envPreset}
          showGrid={showGrid}
          showAxes={showAxes}
          autoRotate={autoRotate}
          isOrthographic={isOrthographic}
          cameraPresetRequest={cameraPresetRequest}
          resetCameraRequest={resetCameraRequest}
          cameraControlRequest={cameraControlRequest}
          snapshotRequest={snapshotRequest}
          selectedClipIndex={currentClipIndex}
          isPlaying={isPlaying}
          playbackSpeed={speed}
          seekRequest={seekRequest}
          onModelLoaded={handleModelLoaded}
          onAnimationProgress={handleAnimationProgress}
          onSnapshotResult={(error) => showToast(error || 'Captura guardada.', error ? 'error' : 'success')}
          onModelError={() => {
            setModelData(null);
            setAnimations([]);
          }}
          onChooseAnotherModel={() => {
            changeCurrentFile(null);
            setSidebarOpen(true);
          }}
          nodeVisibilityToggle={nodeVisibilityToggle}
        />
      </React.Suspense>

      <Toolbar3D
        currentFile={currentFile}
        renderMode={renderMode}
        setRenderMode={setRenderMode}
        envPreset={envPreset}
        setEnvPreset={setEnvPreset}
        showGrid={showGrid}
        setShowGrid={setShowGrid}
        showAxes={showAxes}
        setShowAxes={setShowAxes}
        autoRotate={autoRotate}
        setAutoRotate={setAutoRotate}
        resetCamera={() => setResetCameraRequest(Date.now())}
        setCameraPreset={(preset) => setCameraPresetRequest({ preset, timestamp: Date.now() })}
        onCameraControl={(action) => {
          if (action === 'reset') setResetCameraRequest(Date.now());
          else setCameraControlRequest({ action, timestamp: Date.now() });
        }}
        takeSnapshot={() => setSnapshotRequest(Date.now())}
        isOrthographic={isOrthographic}
        setIsOrthographic={setIsOrthographic}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={(nextOpen) => {
          setSidebarOpen(nextOpen);
          if (nextOpen && compactLayout) setInspectorOpen(false);
        }}
        inspectorOpen={inspectorOpen}
        setInspectorOpen={(nextOpen) => {
          setInspectorOpen(nextOpen);
          if (nextOpen && compactLayout) setSidebarOpen(false);
        }}
        onPrevModel={() => selectRelativeModel(-1)}
        onNextModel={() => selectRelativeModel(1)}
        onRandomModel={handleRandomModel}
        currentIndex={currentIndex}
        currentIndexKnown={currentIndex >= 0}
        totalCount={catalogState.total}
        sidebarTriggerRef={sidebarTriggerRef}
        inspectorTriggerRef={inspectorTriggerRef}
      />

      <FileLibrarySidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onRequestClose={() => setSidebarOpen(false)}
        triggerRef={sidebarTriggerRef}
        files={filesList}
        folderTree={null}
        catalogV2
        catalogState={catalogState}
        treePages={treePages}
        currentFileId={currentFile?.id}
        onSelectFile={selectFileById}
        onRevealFile={handleRevealModel}
        onRefresh={() => loadCatalog({ announce: true })}
        onLoadMoreCatalog={loadNextCatalogPage}
        onLoadTreeChildren={loadTreeChildren}
        onCatalogFiltersChange={handleCatalogFiltersChange}
        onStartScan={handleStartScan}
        onCancelScan={handleCancelScan}
        scanStatus={scanStatus}
        isScanning={isScanning || scanRequestPending}
        isCancellingScan={isCancellingScan}
        bridgeAvailable={bridgeAvailable}
      />

      <ModelInspector
        stats={activeModelData?.stats || null}
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        onRequestClose={() => setInspectorOpen(false)}
        triggerRef={inspectorTriggerRef}
        toggleNodeVisibility={(uuid, visible) => setNodeVisibilityToggle({ uuid, visible, timestamp: Date.now() })}
        onExportModel={handleExportModel}
        isExporting={isExporting}
      />

      <AnimationController
        animations={activeAnimations}
        currentClipIndex={currentClipIndex}
        onClipChange={handleClipChange}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        progress={progress}
        onSeek={handleSeek}
        speed={speed}
        setSpeed={setSpeed}
      />

      <DropZone disabled={!bridgeAvailable} hasCurrentFile={Boolean(currentFile)} onDropFile={handleDroppedFile} onError={(message) => showToast(message, 'error')} />

      {catalogError && (
        <div className="absolute top-20 left-1/2 z-30 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-amber-400/50 bg-black/90 px-4 py-3 text-center text-sm text-amber-100 shadow-2xl" role="alert">
          {catalogError}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl glass-panel ${
          toast.type === 'error' ? 'border-red-500/60 text-red-100' : 'border-emerald-500/60 text-emerald-100'
        }`} role={toast.type === 'error' ? 'alert' : 'status'}>
          {toast.type === 'error' ? <AlertCircle size={18} aria-hidden="true" className="text-red-400" /> : <CheckCircle2 size={18} aria-hidden="true" className="text-emerald-400" />}
          <span className="text-xs font-semibold">{toast.message}</span>
        </div>
      )}
    </main>
  );
}
