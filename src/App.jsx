import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toolbar3D from './components/Toolbar3D.jsx';
import ModelInspector from './components/ModelInspector.jsx';
import AnimationController from './components/AnimationController.jsx';
import FileLibrarySidebar from './components/FileLibrarySidebar.jsx';
import DropZone from './components/DropZone.jsx';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { exportModelAsGlb } from './utils/exporters.js';
import {
  callNexoip,
  ELECTRON_BRIDGE_ERROR,
  getNexoipBridge,
  isScanInProgress,
  responseFiles,
  responseModel,
  responseStatus,
  responseTree,
  validateDroppedFile
} from './utils/nexoip.js';

const Viewport3D = React.lazy(() => import('./components/Viewport3D.jsx'));

function isCompactViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 48rem)').matches;
}

function getErrorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function App() {
  const bridgeAvailable = Boolean(getNexoipBridge());
  const [currentFile, setCurrentFile] = useState(null);
  const [filesList, setFilesList] = useState([]);
  const [folderTree, setFolderTree] = useState(null);
  const [scanStatus, setScanStatus] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanRequestPending, setScanRequestPending] = useState(false);
  const [isCancellingScan, setIsCancellingScan] = useState(false);
  const [catalogError, setCatalogError] = useState(bridgeAvailable ? null : ELECTRON_BRIDGE_ERROR);

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

  const [animations, setAnimations] = useState([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
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

  const currentIndex = useMemo(
    () => filesList.findIndex((file) => file.id === currentFile?.id),
    [currentFile?.id, filesList]
  );

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

  const refreshScanStatus = useCallback(async () => {
    if (!bridgeAvailable) return null;
    const status = responseStatus(await callNexoip('getScanStatus'));
    const active = isScanInProgress(status);
    setScanStatus(status);
    setIsScanning(active);
    return { status, active };
  }, [bridgeAvailable]);

  const loadCatalog = useCallback(async ({ announce = false } = {}) => {
    if (!bridgeAvailable) return false;

    try {
      const [modelsResponse, treeResponse] = await Promise.all([
        callNexoip('listModels', { sortBy: 'name', order: 'asc' }),
        callNexoip('getTree')
      ]);
      const nextFiles = responseFiles(modelsResponse).filter((file) => file?.id);
      setFilesList(nextFiles);
      setFolderTree(responseTree(treeResponse));
      if (nextFiles.length === 0) {
        setModelData(null);
        setAnimations([]);
        setProgress(0);
      }
      setCurrentFile((previous) => {
        const selected = previous && nextFiles.find((file) => file.id === previous.id);
        return selected || nextFiles[0] || null;
      });
      setCatalogError(null);
      if (announce) showToast(`${nextFiles.length} modelos disponibles en la biblioteca.`);
      return true;
    } catch (error) {
      const message = getErrorMessage(error, 'No se pudo cargar la biblioteca local.');
      setCatalogError(message);
      if (announce) showToast(message, 'error');
      return false;
    }
  }, [bridgeAvailable, showToast]);

  useEffect(() => {
    if (!bridgeAvailable) return undefined;
    const startupTask = window.setTimeout(() => {
      void callNexoip('consumeStartupModel')
        .then((registered) => {
          if (registered?.id) {
            setFilesList([registered]);
            setCurrentFile(registered);
            setModelData(null);
            showToast(`Cargando ${registered.name}…`);
            return loadCatalog();
          }
          return loadCatalog();
        })
        .catch((error) => setCatalogError(getErrorMessage(error, 'No se pudo abrir el modelo de inicio.')));
      void refreshScanStatus().catch((error) => setCatalogError(getErrorMessage(error, 'No se pudo consultar el escáner local.')));
    }, 0);
    return () => window.clearTimeout(startupTask);
  }, [bridgeAvailable, loadCatalog, refreshScanStatus, showToast]);

  useEffect(() => {
    const bridge = getNexoipBridge();
    if (!bridgeAvailable || typeof bridge?.onModelOpened !== 'function') return undefined;
    bridge.onModelOpened((registered) => {
      if (!registered?.id) return;
      setFilesList((previous) => [registered, ...previous.filter((item) => item.id !== registered.id)]);
      setCurrentFile(registered);
      setModelData(null);
      showToast(`Cargando ${registered.name}…`);
    });
    return undefined;
  }, [bridgeAvailable, showToast]);

  useEffect(() => {
    if (!bridgeAvailable || (!isScanning && !scanRequestPending)) return undefined;

    scanWasActiveRef.current = true;
    const interval = window.setInterval(() => {
      void refreshScanStatus()
        .then(({ active }) => {
          if (active) scanWasActiveRef.current = true;
          if (scanWasActiveRef.current && !active) {
            scanWasActiveRef.current = false;
            setIsScanning(false);
            void loadCatalog({ announce: true });
          }
        })
        .catch((error) => {
          setCatalogError(getErrorMessage(error, 'No se pudo actualizar el progreso del escaneo.'));
        });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [bridgeAvailable, isScanning, loadCatalog, refreshScanStatus, scanRequestPending]);

  const handleStartScan = useCallback(async () => {
    if (!bridgeAvailable) {
      showToast(ELECTRON_BRIDGE_ERROR, 'error');
      return;
    }

    try {
      setScanRequestPending(true);
      scanWasActiveRef.current = false;
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
        await loadCatalog();
        showToast(`Escaneo detenido: se conservan ${result?.count ?? 0} modelos indexados hasta ese momento.`);
      } else if (active) {
        showToast('Escaneo local en curso.');
      } else {
        await loadCatalog({ announce: true });
        showToast(`Escaneo completado: ${result?.count ?? 0} modelos indexados.`);
      }
    } catch (error) {
      setScanRequestPending(false);
      setIsScanning(false);
      setIsCancellingScan(false);
      showToast(getErrorMessage(error, 'No se pudo iniciar el escaneo local.'), 'error');
    }
  }, [bridgeAvailable, loadCatalog, showToast]);

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

  const selectFileById = useCallback((fileId) => {
    const nextFile = filesList.find((file) => file.id === fileId);
    if (!nextFile) {
      showToast('El modelo seleccionado ya no está disponible. Actualiza la biblioteca.', 'error');
      return;
    }
    setCurrentFile(nextFile);
    setModelData(null);
    showToast(`Cargando ${nextFile.name}…`);
  }, [filesList, showToast]);

  const selectRelativeModel = useCallback((offset) => {
    if (filesList.length === 0) return;
    const index = currentIndex < 0 ? 0 : (currentIndex + offset + filesList.length) % filesList.length;
    selectFileById(filesList[index].id);
  }, [currentIndex, filesList, selectFileById]);

  const handleRandomModel = useCallback(() => {
    if (filesList.length <= 1) return;
    let index = Math.floor(Math.random() * filesList.length);
    if (index === currentIndex) index = (index + 1) % filesList.length;
    selectFileById(filesList[index].id);
  }, [currentIndex, filesList, selectFileById]);

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

  const handleModelLoaded = useCallback(({ object, exportObject, animations: nextAnimations, stats, metadata }) => {
    setModelData({
      object,
      exportObject: exportObject || object,
      animations: nextAnimations || [],
      stats,
      metadata: metadata || null
    });
    setAnimations(nextAnimations || []);
    setCurrentClipIndex(0);
    setIsPlaying(true);
    setProgress(0);
    setSeekRequest({ value: 0, timestamp: Date.now() });
  }, []);

  const handleAnimationProgress = useCallback((nextProgress) => {
    setProgress((previous) => Math.abs(previous - nextProgress) > 0.001 ? nextProgress : previous);
  }, []);

  const handleClipChange = useCallback((clipIndex) => {
    setCurrentClipIndex(clipIndex);
    setProgress(0);
    setIsPlaying(true);
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
      setFilesList((previous) => [registered, ...previous.filter((item) => item.id !== registered.id)]);
      setCurrentFile(registered);
      setModelData(null);
      showToast(`Cargando ${registered.name}…`);
    } catch (error) {
      showToast(getErrorMessage(error, 'No se pudo abrir el archivo local.'), 'error');
    }
  }, [showToast]);

  const downloadBlob = useCallback((blob, fileName) => {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }, []);

  const handleExportModel = useCallback(async (format) => {
    const exportObject = modelData?.exportObject || modelData?.object;
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
        const gltf = await exportModelAsGlb(exportObject, modelData.animations || []);
        downloadBlob(new Blob([gltf], { type: 'model/gltf-binary' }), `${name}.glb`);
        const clipCount = modelData.animations?.length || 0;
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
  }, [currentFile?.name, downloadBlob, modelData, showToast]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black" aria-label="NexoIP 3D Viewer">
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
          onModelError={(message) => {
            setModelData(null);
            setAnimations([]);
            showToast(message, 'error');
          }}
          onChooseAnotherModel={() => {
            setCurrentFile(null);
            setModelData(null);
            setAnimations([]);
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
        totalCount={filesList.length}
        sidebarTriggerRef={sidebarTriggerRef}
        inspectorTriggerRef={inspectorTriggerRef}
      />

      <FileLibrarySidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onRequestClose={() => setSidebarOpen(false)}
        triggerRef={sidebarTriggerRef}
        files={filesList}
        folderTree={folderTree}
        currentFileId={currentFile?.id}
        onSelectFile={selectFileById}
        onRevealFile={handleRevealModel}
        onRefresh={() => loadCatalog({ announce: true })}
        onStartScan={handleStartScan}
        onCancelScan={handleCancelScan}
        scanStatus={scanStatus}
        isScanning={isScanning || scanRequestPending}
        isCancellingScan={isCancellingScan}
        bridgeAvailable={bridgeAvailable}
      />

      <ModelInspector
        stats={modelData?.stats || null}
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        onRequestClose={() => setInspectorOpen(false)}
        triggerRef={inspectorTriggerRef}
        toggleNodeVisibility={(uuid, visible) => setNodeVisibilityToggle({ uuid, visible, timestamp: Date.now() })}
        onExportModel={handleExportModel}
        isExporting={isExporting}
      />

      <AnimationController
        animations={animations}
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
