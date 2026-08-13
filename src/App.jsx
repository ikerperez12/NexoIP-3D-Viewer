import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toolbar3D from './components/Toolbar3D.jsx';
import ModelInspector from './components/ModelInspector.jsx';
import AnimationController from './components/AnimationController.jsx';
import FileLibrarySidebar from './components/FileLibrarySidebar.jsx';
import DropZone from './components/DropZone.jsx';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
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
  const [catalogError, setCatalogError] = useState(bridgeAvailable ? null : ELECTRON_BRIDGE_ERROR);

  const [renderMode, setRenderMode] = useState('pbr');
  const [envPreset, setEnvPreset] = useState('studio_pro');
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isOrthographic, setIsOrthographic] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const [modelData, setModelData] = useState(null);
  const [cameraPresetRequest, setCameraPresetRequest] = useState(null);
  const [resetCameraRequest, setResetCameraRequest] = useState(0);
  const [snapshotRequest, setSnapshotRequest] = useState(0);
  const [nodeVisibilityToggle, setNodeVisibilityToggle] = useState(null);

  const [animations, setAnimations] = useState([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [seekRequest, setSeekRequest] = useState(null);

  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const scanWasActiveRef = useRef(false);

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
      void loadCatalog();
      void refreshScanStatus().catch((error) => setCatalogError(getErrorMessage(error, 'No se pudo consultar el escáner local.')));
    }, 0);
    return () => window.clearTimeout(startupTask);
  }, [bridgeAvailable, loadCatalog, refreshScanStatus]);

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
      if (result?.cancelled) {
        showToast('Escaneo cancelado. La biblioteca no se ha modificado.');
      } else if (active) {
        showToast('Escaneo local en curso.');
      } else {
        await loadCatalog({ announce: true });
        showToast(`Escaneo completado: ${result?.count ?? 0} modelos indexados.`);
      }
    } catch (error) {
      setScanRequestPending(false);
      setIsScanning(false);
      showToast(getErrorMessage(error, 'No se pudo iniciar el escaneo local.'), 'error');
    }
  }, [bridgeAvailable, loadCatalog, showToast]);

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
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTextEntry) return;

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

  const handleModelLoaded = useCallback(({ object, animations: nextAnimations, stats }) => {
    setModelData({ object, stats });
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
    if (!modelData?.object) {
      showToast('No hay modelo cargado para exportar.', 'error');
      return;
    }

    const name = (currentFile?.name || 'modelo_3d').replace(/[^a-z0-9._-]+/gi, '_').replace(/\.[^.]+$/, '');
    try {
      if (format === 'stl') {
        const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
        const result = new STLExporter().parse(modelData.object, { binary: true });
        downloadBlob(new Blob([result], { type: 'application/octet-stream' }), `${name}.stl`);
        showToast(`Modelo exportado como ${name}.stl.`);
      } else if (format === 'obj') {
        const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
        const result = new OBJExporter().parse(modelData.object);
        downloadBlob(new Blob([result], { type: 'text/plain' }), `${name}.obj`);
        showToast(`Modelo exportado como ${name}.obj.`);
      } else if (format === 'glb') {
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        new GLTFExporter().parse(
          modelData.object,
          (gltf) => {
            downloadBlob(new Blob([gltf], { type: 'model/gltf-binary' }), `${name}.glb`);
            showToast(`Modelo exportado como ${name}.glb.`);
          },
          () => showToast('No se pudo exportar el modelo a GLB.', 'error'),
          { binary: true }
        );
      }
    } catch (error) {
      showToast(getErrorMessage(error, 'No se pudo exportar el modelo.'), 'error');
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
        takeSnapshot={() => setSnapshotRequest(Date.now())}
        isOrthographic={isOrthographic}
        setIsOrthographic={setIsOrthographic}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        inspectorOpen={inspectorOpen}
        setInspectorOpen={setInspectorOpen}
        onPrevModel={() => selectRelativeModel(-1)}
        onNextModel={() => selectRelativeModel(1)}
        onRandomModel={handleRandomModel}
        currentIndex={currentIndex}
        totalCount={filesList.length}
      />

      <FileLibrarySidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        files={filesList}
        folderTree={folderTree}
        currentFileId={currentFile?.id}
        onSelectFile={selectFileById}
        onRevealFile={handleRevealModel}
        onRefresh={() => loadCatalog({ announce: true })}
        onStartScan={handleStartScan}
        scanStatus={scanStatus}
        isScanning={isScanning || scanRequestPending}
        bridgeAvailable={bridgeAvailable}
      />

      <ModelInspector
        stats={modelData?.stats || null}
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        toggleNodeVisibility={(uuid, visible) => setNodeVisibilityToggle({ uuid, visible, timestamp: Date.now() })}
        onExportModel={handleExportModel}
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

      <div className="sr-only" role="status" aria-live="polite">{toast?.message || ''}</div>
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
