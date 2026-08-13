import React, { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Box, BoxSelect, Camera, ChevronLeft,
  ChevronRight, Grid, Info, Maximize2, Minus, MoveHorizontal, Plus, RotateCw,
  Shuffle
} from 'lucide-react';

const RENDER_MODES = [
  { id: 'pbr', label: 'PBR', title: 'Texturas y luces PBR' },
  { id: 'wireframe', label: 'Malla', title: 'Modo de malla de alambre' },
  { id: 'normals', label: 'Normales', title: 'Mapa de normales' },
  { id: 'xray', label: 'Rayos X', title: 'Transparencia de rayos X' },
  { id: 'unlit', label: 'Plano', title: 'Color plano sin luz' }
];

const CAMERA_PRESETS = [
  { id: 'front', label: 'Frente' },
  { id: 'top', label: 'Superior' },
  { id: 'side', label: 'Lateral' },
  { id: 'iso', label: 'Isométrica' }
];

const CAMERA_ACTIONS = [
  { id: 'orbit-left', label: 'Orbitar a la izquierda', icon: ArrowLeft },
  { id: 'orbit-up', label: 'Orbitar hacia arriba', icon: ArrowUp },
  { id: 'orbit-right', label: 'Orbitar a la derecha', icon: ArrowRight },
  { id: 'orbit-down', label: 'Orbitar hacia abajo', icon: ArrowDown },
  { id: 'pan-left', label: 'Desplazar a la izquierda', icon: ArrowLeft },
  { id: 'pan-up', label: 'Desplazar hacia arriba', icon: ArrowUp },
  { id: 'pan-right', label: 'Desplazar a la derecha', icon: ArrowRight },
  { id: 'pan-down', label: 'Desplazar hacia abajo', icon: ArrowDown },
  { id: 'zoom-in', label: 'Acercar cámara', icon: Plus },
  { id: 'zoom-out', label: 'Alejar cámara', icon: Minus }
];

export default function Toolbar3D({
  currentFile,
  renderMode,
  setRenderMode,
  envPreset,
  setEnvPreset,
  showGrid,
  setShowGrid,
  showAxes,
  setShowAxes,
  autoRotate,
  setAutoRotate,
  resetCamera,
  setCameraPreset,
  takeSnapshot,
  isOrthographic,
  setIsOrthographic,
  sidebarOpen,
  setSidebarOpen,
  inspectorOpen,
  setInspectorOpen,
  onPrevModel,
  onNextModel,
  onRandomModel,
  currentIndex,
  totalCount,
  onCameraControl,
  sidebarTriggerRef,
  inspectorTriggerRef
}) {
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const cameraMenuTriggerRef = useRef(null);
  const cameraMenuId = `camera-controls-${useId().replace(/:/g, '')}`;
  const currentModelPosition = totalCount > 0 ? `${currentIndex + 1} de ${totalCount}` : 'sin modelos en la biblioteca';

  const selectCameraPreset = (event) => {
    const preset = event.target.value;
    if (!preset) return;
    setCameraPreset?.(preset);
    event.target.value = '';
  };

  useEffect(() => {
    if (!cameraMenuOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setCameraMenuOpen(false);
      window.requestAnimationFrame(() => cameraMenuTriggerRef.current?.focus());
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [cameraMenuOpen]);

  return (
    <header className="absolute left-4 right-4 top-4 z-20 flex flex-wrap items-start justify-between gap-2 pointer-events-none 2xl:flex-nowrap 2xl:items-center">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5 pointer-events-auto">
        <button
          type="button"
          ref={sidebarTriggerRef}
          onClick={() => setSidebarOpen?.(!sidebarOpen)}
          className={`glass-panel flex min-h-10 items-center gap-2 rounded-xl p-2.5 text-sm font-semibold transition-all duration-200 ${sidebarOpen ? 'border-amber-500/60 bg-amber-500/30 text-white shadow-amber-500/20' : 'text-gray-200 hover:bg-white/10'}`}
          title="Biblioteca de archivos y árbol 3D"
          aria-label={sidebarOpen ? 'Cerrar biblioteca de modelos' : 'Abrir biblioteca de modelos'}
          aria-expanded={sidebarOpen}
        >
          <BoxSelect size={18} aria-hidden="true" className="text-amber-300" />
          <span className="hidden sm:inline">NexoIP 3D</span>
        </button>

        <div className="glass-panel flex items-center gap-1 rounded-xl border border-white/10 p-1" role="group" aria-label={`Navegación de modelos, ${currentModelPosition}`}>
          <button type="button" onClick={onPrevModel} disabled={totalCount <= 1} className="flex min-h-8 min-w-8 items-center justify-center rounded-lg p-1.5 text-gray-200 transition-all hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" title="Modelo anterior (flecha izquierda)" aria-label="Modelo anterior">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span className="min-w-9 px-1 text-center text-[11px] font-mono font-bold text-amber-200" aria-hidden="true">{totalCount > 0 ? `${currentIndex + 1}/${totalCount}` : '0/0'}</span>
          <button type="button" onClick={onNextModel} disabled={totalCount <= 1} className="flex min-h-8 min-w-8 items-center justify-center rounded-lg p-1.5 text-gray-200 transition-all hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" title="Modelo siguiente (flecha derecha)" aria-label="Modelo siguiente">
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button type="button" onClick={onRandomModel} disabled={totalCount <= 1} className="flex min-h-8 min-w-8 items-center justify-center rounded-lg p-1.5 text-gray-200 transition-all hover:bg-white/10 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40" title="Abrir modelo aleatorio" aria-label="Abrir modelo aleatorio">
            <Shuffle size={14} aria-hidden="true" />
          </button>
        </div>

        {currentFile && (
          <div className="glass-panel flex min-w-0 max-w-44 items-center gap-2 rounded-xl border border-white/10 px-2.5 py-1.5 sm:max-w-60 2xl:max-w-80">
            <span className={`hidden shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-extrabold uppercase sm:inline-block badge-${currentFile.extension}`}>{currentFile.extension}</span>
            <div className="min-w-0">
              <span className="block truncate text-xs font-semibold text-gray-100" title={currentFile.name}>{currentFile.name}</span>
              {currentFile.size > 0 && <span className="block text-[10px] font-mono text-gray-300">{(currentFile.size / (1024 * 1024)).toFixed(2)} MB</span>}
            </div>
          </div>
        )}
      </div>

      <div role="toolbar" aria-label="Herramientas de visualización" className="glass-panel order-3 mx-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-2xl px-3 py-1.5 shadow-2xl pointer-events-auto 2xl:order-none 2xl:mx-0 2xl:overflow-visible">
        <div className="flex shrink-0 items-center gap-1 rounded-xl bg-black/50 p-1" role="group" aria-label="Modo de renderizado">
          {RENDER_MODES.map((mode) => (
            <button
              type="button"
              key={mode.id}
              onClick={() => setRenderMode?.(mode.id)}
              title={mode.title}
              aria-pressed={renderMode === mode.id}
              className={`min-h-8 shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-all ${renderMode === mode.id ? 'bg-amber-400 font-extrabold text-black shadow-lg shadow-amber-500/20' : 'text-gray-200 hover:bg-white/10 hover:text-white'}`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="mx-1 h-4 w-px shrink-0 bg-white/20" aria-hidden="true" />

        <select aria-label="Iluminación y fondo de la escena" value={envPreset} onChange={(event) => setEnvPreset?.(event.target.value)} className="min-h-8 shrink-0 cursor-pointer rounded-xl border border-emerald-400/50 bg-black/60 px-3 py-1.5 text-xs font-semibold text-emerald-200 outline-none hover:border-emerald-300" title="Focos de iluminación y fondos">
          <option value="studio_pro">💡 Focos Pro + negro total</option>
          <option value="cyberpunk">🌆 Focos neón cyberpunk</option>
          <option value="sunset">🌅 Focos atardecer cálido</option>
          <option value="emerald">🟢 Focos esmeralda</option>
          <option value="fireice">🔥 Focos fuego y hielo</option>
          <option value="white">⚪ Estudio blanco / clay</option>
        </select>

        <div className="mx-1 h-4 w-px shrink-0 bg-white/20" aria-hidden="true" />

        <div className="hidden items-center gap-1 lg:flex" role="group" aria-label="Vistas predefinidas de cámara">
          {CAMERA_PRESETS.map((view) => <button type="button" key={view.id} onClick={() => setCameraPreset?.(view.id)} className="min-h-8 rounded-lg px-2 py-1 text-xs font-mono text-gray-200 hover:bg-white/10 hover:text-white" title={`Vista ${view.label}`} aria-label={`Cambiar a vista ${view.label}`}>{view.label}</button>)}
        </div>
        <select className="min-h-8 max-w-28 cursor-pointer rounded-lg border border-white/20 bg-black/60 px-2 text-xs text-gray-100 outline-none lg:hidden" aria-label="Vista predefinida de cámara" defaultValue="" onChange={selectCameraPreset}>
          <option value="" disabled>Vista…</option>
          {CAMERA_PRESETS.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
        </select>

        <div className="mx-1 h-4 w-px shrink-0 bg-white/20" aria-hidden="true" />

        <button type="button" onClick={() => setIsOrthographic?.(!isOrthographic)} className={`min-h-8 shrink-0 rounded-lg p-1.5 text-xs font-mono font-bold transition-all ${isOrthographic ? 'border border-cyan-400/60 bg-cyan-500/30 text-cyan-100' : 'text-gray-200 hover:bg-white/10 hover:text-white'}`} title={isOrthographic ? 'Cámara ortográfica activa' : 'Cámara en perspectiva activa'} aria-label={isOrthographic ? 'Usar cámara en perspectiva' : 'Usar cámara ortográfica'} aria-pressed={isOrthographic}>
          {isOrthographic ? 'ORTHO' : 'PERS'}
        </button>
      </div>

      <div className="flex items-center gap-2 pointer-events-auto">
        <div className="glass-panel flex items-center gap-1 rounded-xl p-1" role="group" aria-label="Ayudas de la escena">
          <button type="button" onClick={() => setShowGrid?.(!showGrid)} className={`flex min-h-8 min-w-8 items-center justify-center rounded-lg p-2 transition-all ${showGrid ? 'bg-amber-500/30 text-amber-200' : 'text-gray-200 hover:bg-white/10 hover:text-white'}`} title="Mostrar u ocultar rejilla" aria-label="Mostrar u ocultar rejilla" aria-pressed={showGrid}><Grid size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => setShowAxes?.(!showAxes)} className={`flex min-h-8 min-w-8 items-center justify-center rounded-lg p-2 transition-all ${showAxes ? 'bg-emerald-500/30 text-emerald-200' : 'text-gray-200 hover:bg-white/10 hover:text-white'}`} title="Mostrar u ocultar ejes 3D" aria-label="Mostrar u ocultar ejes 3D" aria-pressed={showAxes}><Box size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => setAutoRotate?.(!autoRotate)} className={`flex min-h-8 min-w-8 items-center justify-center rounded-lg p-2 transition-all ${autoRotate ? 'bg-rose-500/30 text-rose-200' : 'text-gray-200 hover:bg-white/10 hover:text-white'}`} title="Activar o desactivar giro automático" aria-label="Activar o desactivar giro automático" aria-pressed={autoRotate}><RotateCw size={16} aria-hidden="true" className={autoRotate ? 'animate-spin' : ''} /></button>
          <button type="button" onClick={resetCamera} className="flex min-h-8 min-w-8 items-center justify-center rounded-lg p-2 text-gray-200 transition-all hover:bg-white/10 hover:text-white" title="Reencuadrar modelo" aria-label="Reencuadrar modelo"><Maximize2 size={16} aria-hidden="true" /></button>
          <button type="button" onClick={takeSnapshot} className="flex min-h-8 min-w-8 items-center justify-center rounded-lg p-2 text-cyan-200 transition-all hover:bg-cyan-500/20 hover:text-cyan-100" title="Guardar captura PNG" aria-label="Guardar captura PNG"><Camera size={16} aria-hidden="true" /></button>
        </div>

        <div className="relative">
          <button type="button" ref={cameraMenuTriggerRef} onClick={() => setCameraMenuOpen((open) => !open)} className="glass-panel flex min-h-10 items-center gap-2 rounded-xl p-2.5 text-sm font-semibold text-gray-100 transition-all hover:bg-white/10" aria-expanded={cameraMenuOpen} aria-controls={cameraMenuId} aria-label={cameraMenuOpen ? 'Cerrar controles precisos de cámara' : 'Abrir controles precisos de cámara'}>
            <MoveHorizontal size={18} aria-hidden="true" className="text-cyan-200" />
            <span className="hidden 2xl:inline">Cámara</span>
          </button>
          {cameraMenuOpen && (
            <div id={cameraMenuId} role="group" aria-label="Controles precisos de cámara" className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-cyan-400/50 bg-black/95 p-2 shadow-2xl glass-panel">
              <p className="px-1 pb-1 text-[11px] text-gray-200">Orbita, desplaza o ajusta el zoom sin usar arrastre.</p>
              <CameraControlGroup label="Orbitar" actions={CAMERA_ACTIONS.slice(0, 4)} onCameraControl={onCameraControl} />
              <CameraControlGroup label="Desplazar" actions={CAMERA_ACTIONS.slice(4, 8)} onCameraControl={onCameraControl} />
              <CameraControlGroup label="Zoom" actions={CAMERA_ACTIONS.slice(8)} onCameraControl={onCameraControl} />
              <button type="button" onClick={() => (onCameraControl ? onCameraControl('reset') : resetCamera?.())} className="mt-1 flex min-h-8 w-full items-center justify-center gap-1 rounded-lg border border-cyan-300/50 px-2 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/20"><Maximize2 size={14} aria-hidden="true" /> Restablecer cámara</button>
            </div>
          )}
        </div>

        <button type="button" ref={inspectorTriggerRef} onClick={() => setInspectorOpen?.(!inspectorOpen)} className={`glass-panel flex min-h-10 items-center gap-2 rounded-xl p-2.5 text-sm font-semibold transition-all duration-200 ${inspectorOpen ? 'border-purple-500/60 bg-purple-600/40 text-white' : 'text-gray-200 hover:bg-white/10'}`} title="Inspección de propiedades 3D" aria-label={inspectorOpen ? 'Cerrar propiedades del modelo' : 'Abrir propiedades del modelo'} aria-expanded={inspectorOpen}>
          <Info size={18} aria-hidden="true" className="text-purple-300" />
          <span className="hidden 2xl:inline">Propiedades</span>
        </button>
      </div>
    </header>
  );
}

function CameraControlGroup({ label, actions, onCameraControl }) {
  return (
    <div className="border-t border-white/10 py-1.5 first:border-t-0 first:pt-0" role="group" aria-label={label}>
      <span className="px-1 text-[10px] font-mono font-bold uppercase tracking-wide text-cyan-200">{label}</span>
      <div className="mt-1 grid grid-cols-4 gap-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return <button type="button" key={action.id} onClick={() => onCameraControl?.(action.id)} disabled={!onCameraControl} className="flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-white/10 p-1.5 text-gray-100 hover:border-cyan-300/60 hover:bg-cyan-500/20 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50" aria-label={action.label} title={action.label}><Icon size={15} aria-hidden="true" /></button>;
        })}
      </div>
    </div>
  );
}
