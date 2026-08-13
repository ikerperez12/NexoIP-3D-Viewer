import React, { useState, useEffect, useRef } from 'react';
import Viewport3D from './components/Viewport3D.jsx';
import Toolbar3D from './components/Toolbar3D.jsx';
import ModelInspector from './components/ModelInspector.jsx';
import AnimationController from './components/AnimationController.jsx';
import FileLibrarySidebar from './components/FileLibrarySidebar.jsx';
import DropZone from './components/DropZone.jsx';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export default function App() {
  const [currentFile, setCurrentFile] = useState(null);
  const [filesList, setFilesList] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Preset de iluminación predeterminado: Focos Pro + Negro Total (#000000)
  const [renderMode, setRenderMode] = useState('pbr');
  const [envPreset, setEnvPreset] = useState('studio_pro');
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isOrthographic, setIsOrthographic] = useState(false);

  // Estados de interfaz
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  // Estados de datos del modelo 3D
  const [modelData, setModelData] = useState(null);
  const [cameraPresetRequest, setCameraPresetRequest] = useState(null);
  const [resetCameraRequest, setResetCameraRequest] = useState(0);
  const [snapshotRequest, setSnapshotRequest] = useState(0);
  const [nodeVisibilityToggle, setNodeVisibilityToggle] = useState(null);

  // Estados de animación
  const [animations, setAnimations] = useState([]);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1);
  const currentActionRef = useRef(null);

  // Toast Notifications
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Cargar catálogo de archivos 3D
  const loadCatalog = async () => {
    try {
      const res = await fetch('/api/files?sortBy=name');
      const data = await res.json();
      if (data.success && data.files.length > 0) {
        setFilesList(data.files);
        if (!currentFile) {
          setCurrentFile(data.files[0]);
          setCurrentIndex(0);
        }
      }
    } catch (err) {
      console.error('Error cargando catálogo inicial:', err);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  // Navegación: Siguiente Modelo
  const handleNextModel = () => {
    if (filesList.length === 0) return;
    const nextIdx = (currentIndex + 1) % filesList.length;
    setCurrentIndex(nextIdx);
    setCurrentFile(filesList[nextIdx]);
    showToast(`Modelo (${nextIdx + 1}/${filesList.length}): ${filesList[nextIdx].name}`);
  };

  // Navegación: Modelo Anterior
  const handlePrevModel = () => {
    if (filesList.length === 0) return;
    const prevIdx = (currentIndex - 1 + filesList.length) % filesList.length;
    setCurrentIndex(prevIdx);
    setCurrentFile(filesList[prevIdx]);
    showToast(`Modelo (${prevIdx + 1}/${filesList.length}): ${filesList[prevIdx].name}`);
  };

  // Navegación: Modelo Aleatorio
  const handleRandomModel = () => {
    if (filesList.length <= 1) return;
    let randIdx = Math.floor(Math.random() * filesList.length);
    if (randIdx === currentIndex) randIdx = (randIdx + 1) % filesList.length;
    setCurrentIndex(randIdx);
    setCurrentFile(filesList[randIdx]);
    showToast(`Modelo Aleatorio (${randIdx + 1}/${filesList.length}): ${filesList[randIdx].name}`);
  };

  // Atajos de teclado (Flechas ← y →)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextModel();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevModel();
      } else if (e.key === 'r' || e.key === 'R') {
        setResetCameraRequest(Date.now());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filesList, currentIndex]);

  const handleModelLoaded = ({ object, animations: anims, stats, mixer }) => {
    setModelData({ object, stats });
    setAnimations(anims || []);
    setCurrentClipIndex(0);
    setIsPlaying(true);
    setProgress(0);

    if (anims && anims.length > 0 && mixer) {
      const clip = anims[0];
      const action = mixer.clipAction(clip);
      action.play();
      currentActionRef.current = action;
    }
  };

  useEffect(() => {
    if (!modelData || !animations || animations.length === 0) return;

    if (currentActionRef.current) {
      currentActionRef.current.setEffectiveTimeScale(speed);
      if (isPlaying) {
        currentActionRef.current.play();
      } else {
        currentActionRef.current.pause();
      }
    }
  }, [isPlaying, speed]);

  const handleExportModel = (format) => {
    if (!modelData || !modelData.object) {
      showToast('No hay modelo cargado para exportar', 'error');
      return;
    }

    const name = currentFile ? currentFile.name.split('.')[0] : 'modelo_3d';

    if (format === 'stl') {
      const exporter = new STLExporter();
      const result = exporter.parse(modelData.object, { binary: true });
      downloadBlob(new Blob([result], { type: 'application/octet-stream' }), `${name}.stl`);
      showToast(`Modelo exportado a ${name}.stl correctamente`);
    } else if (format === 'obj') {
      const exporter = new OBJExporter();
      const result = exporter.parse(modelData.object);
      downloadBlob(new Blob([result], { type: 'text/plain' }), `${name}.obj`);
      showToast(`Modelo exportado a ${name}.obj correctamente`);
    } else if (format === 'glb') {
      const exporter = new GLTFExporter();
      exporter.parse(
        modelData.object,
        (gltf) => {
          downloadBlob(new Blob([gltf], { type: 'model/gltf-binary' }), `${name}.glb`);
          showToast(`Modelo exportado a ${name}.glb correctamente`);
        },
        (err) => showToast('Error exportando a GLB', 'error'),
        { binary: true }
      );
    }
  };

  const downloadBlob = (blob, filename) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      {/* Visualizador 3D Canvas con Fondo Negro Total */}
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
        onModelLoaded={handleModelLoaded}
        nodeVisibilityToggle={nodeVisibilityToggle}
      />

      {/* Toolbar Superior */}
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
        takeSnapshot={() => {
          setSnapshotRequest(Date.now());
          showToast('Captura de pantalla HD guardada');
        }}
        isOrthographic={isOrthographic}
        setIsOrthographic={setIsOrthographic}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        inspectorOpen={inspectorOpen}
        setInspectorOpen={setInspectorOpen}
        onPrevModel={handlePrevModel}
        onNextModel={handleNextModel}
        onRandomModel={handleRandomModel}
        currentIndex={currentIndex}
        totalCount={filesList.length}
      />

      {/* Biblioteca de Archivos y Árbol 3D */}
      <FileLibrarySidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelectFile={(file) => {
          setCurrentFile(file);
          const foundIdx = filesList.findIndex(f => f.path === file.path);
          if (foundIdx !== -1) setCurrentIndex(foundIdx);
          showToast(`Cargando ${file.name}...`);
        }}
        currentFile={currentFile}
      />

      {/* Inspector de Propiedades */}
      <ModelInspector
        stats={modelData ? modelData.stats : null}
        isOpen={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        toggleNodeVisibility={(uuid, visible) => setNodeVisibilityToggle({ uuid, visible, ts: Date.now() })}
        onExportModel={handleExportModel}
      />

      {/* Controlador de Animación */}
      <AnimationController
        animations={animations}
        currentClipIndex={currentClipIndex}
        setCurrentClipIndex={setCurrentClipIndex}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        progress={progress}
        setProgress={setProgress}
        speed={speed}
        setSpeed={setSpeed}
      />

      {/* Zona de Arrastrar Archivos */}
      <DropZone
        onDropFile={(file) => {
          setCurrentFile(file);
          showToast(`Abriendo archivo soltado: ${file.name}`);
        }}
      />

      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 glass-panel px-4 py-3 rounded-xl flex items-center gap-3 shadow-2xl border ${
          toast.type === 'error' ? 'border-red-500/60 text-red-200' : 'border-indigo-500/60 text-indigo-200'
        }`}>
          {toast.type === 'error' ? <AlertCircle size={18} className="text-red-400" /> : <CheckCircle2 size={18} className="text-emerald-400" />}
          <span className="text-xs font-semibold">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
