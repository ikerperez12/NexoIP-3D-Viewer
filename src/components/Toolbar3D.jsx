import React from 'react';
import { 
  Sun, Moon, Camera, Eye, Grid, Box, RotateCw, Sparkles, 
  FolderOpen, Info, Maximize2, Layers, Download, BoxSelect,
  ChevronLeft, ChevronRight, Shuffle
} from 'lucide-react';

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
  totalCount
}) {
  return (
    <header className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
      {/* Lado Izquierdo: Menú + Navegación Siguiente/Anterior + Título */}
      <div className="flex items-center gap-2.5 pointer-events-auto">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className={`glass-panel p-2.5 rounded-xl transition-all duration-200 flex items-center gap-2 text-sm font-semibold ${
            sidebarOpen ? 'bg-amber-500/30 border-amber-500/60 text-white shadow-amber-500/20' : 'hover:bg-white/10 text-gray-300'
          }`}
          title="Biblioteca de Archivos y Árbol 3D"
        >
          <BoxSelect size={18} className="text-amber-400" />
          <span className="hidden sm:inline">NexoIP 3D</span>
        </button>

        {/* Navegación Rápida Anterior / Siguiente */}
        <div className="glass-panel p-1 rounded-xl flex items-center gap-1 border border-white/10">
          <button
            onClick={onPrevModel}
            disabled={totalCount <= 1}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            title="Modelo Anterior (Flecha Izquierda ←)"
          >
            <ChevronLeft size={18} />
          </button>

          <span className="text-[11px] font-mono text-amber-300 px-1 font-bold">
            {totalCount > 0 ? `${currentIndex + 1}/${totalCount}` : '0/0'}
          </span>

          <button
            onClick={onNextModel}
            disabled={totalCount <= 1}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            title="Siguiente Modelo (Flecha Derecha →)"
          >
            <ChevronRight size={18} />
          </button>

          <button
            onClick={onRandomModel}
            disabled={totalCount <= 1}
            className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-300 hover:bg-white/10 disabled:opacity-30 transition-all"
            title="Modelo Aleatorio"
          >
            <Shuffle size={14} />
          </button>
        </div>

        {/* Nombre e insignia del modelo */}
        {currentFile && (
          <div className="glass-panel px-3.5 py-1.5 rounded-xl flex items-center gap-2.5 border border-white/10">
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-extrabold uppercase badge-${currentFile.extension}`}>
              {currentFile.extension}
            </span>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-gray-100 truncate max-w-[150px] md:max-w-[240px]">
                {currentFile.name}
              </span>
              {currentFile.size > 0 && (
                <span className="text-[10px] text-gray-400 font-mono">
                  {(currentFile.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Centro: Modos de Renderizado y Iluminación de Focos */}
      <div className="glass-panel px-3 py-1.5 rounded-2xl flex items-center gap-1.5 pointer-events-auto shadow-2xl">
        <div className="flex items-center gap-1 bg-black/50 p-1 rounded-xl">
          {[
            { id: 'pbr', label: 'PBR', title: 'Texturas y Luces PBR' },
            { id: 'wireframe', label: 'Malla', title: 'Modo Malla de Alambre' },
            { id: 'normals', label: 'Normales', title: 'Mapa de Normales' },
            { id: 'xray', label: 'Rayos X', title: 'Transparencia Rayos X' },
            { id: 'unlit', label: 'Plano', title: 'Color Plano sin Luz' }
          ].map(mode => (
            <button
              key={mode.id}
              onClick={() => setRenderMode(mode.id)}
              title={mode.title}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
                renderMode === mode.id
                  ? 'bg-amber-500 text-black font-extrabold shadow-lg shadow-amber-500/20'
                  : 'text-gray-300 hover:text-white hover:bg-white/10'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-[1px] bg-white/10 mx-1" />

        {/* Desplegable de Focos e Iluminación */}
        <select
          value={envPreset}
          onChange={(e) => setEnvPreset(e.target.value)}
          className="bg-black/60 text-emerald-300 text-xs rounded-xl px-3 py-1.5 border border-emerald-500/40 outline-none hover:border-emerald-400 cursor-pointer font-semibold"
          title="Focos de Iluminación y Fondos"
        >
          <option value="studio_pro">💡 Focos Pro + Negro Total</option>
          <option value="cyberpunk">🌆 Focos Neón Cyberpunk</option>
          <option value="sunset">🌅 Focos Atardecer Cálido</option>
          <option value="emerald">🟢 Focos Esmeralda Matrix</option>
          <option value="fireice">🔥 Focos Fuego & Hielo</option>
          <option value="white">⚪ Estudio Blanco / Clay (CAD)</option>
        </select>

        <div className="h-4 w-[1px] bg-white/10 mx-1" />

        <div className="flex items-center gap-1">
          {[
            { id: 'front', label: 'Frente' },
            { id: 'top', label: 'Top' },
            { id: 'side', label: 'Lado' },
            { id: 'iso', label: 'Iso' }
          ].map(view => (
            <button
              key={view.id}
              onClick={() => setCameraPreset(view.id)}
              className="px-2 py-1 text-xs font-mono text-gray-400 hover:text-white hover:bg-white/10 rounded-lg"
              title={`Vista ${view.label}`}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div className="h-4 w-[1px] bg-white/10 mx-1" />

        <button
          onClick={() => setIsOrthographic(!isOrthographic)}
          className={`p-1.5 rounded-lg transition-all text-xs font-mono font-bold ${
            isOrthographic ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-500/50' : 'text-gray-400 hover:text-white'
          }`}
          title={isOrthographic ? "Cámara Ortográfica" : "Cámara Perspectiva"}
        >
          {isOrthographic ? 'ORTHO' : 'PERS'}
        </button>
      </div>

      {/* Lado Derecho: Rejilla, Ejes, Captura, Propiedades */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <div className="glass-panel p-1 rounded-xl flex items-center gap-1">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-2 rounded-lg transition-all ${
              showGrid ? 'bg-amber-500/30 text-amber-300' : 'text-gray-400 hover:text-white'
            }`}
            title="Mostrar/Ocultar Rejilla"
          >
            <Grid size={16} />
          </button>

          <button
            onClick={() => setShowAxes(!showAxes)}
            className={`p-2 rounded-lg transition-all ${
              showAxes ? 'bg-emerald-500/30 text-emerald-300' : 'text-gray-400 hover:text-white'
            }`}
            title="Mostrar/Ocultar Ejes 3D"
          >
            <Box size={16} />
          </button>

          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className={`p-2 rounded-lg transition-all ${
              autoRotate ? 'bg-rose-500/30 text-rose-300 animate-spin' : 'text-gray-400 hover:text-white'
            }`}
            title="Giro Automático de Presentación"
          >
            <RotateCw size={16} />
          </button>

          <button
            onClick={resetCamera}
            className="p-2 text-gray-400 hover:text-white rounded-lg transition-all hover:bg-white/10"
            title="Reencuadrar Modelo al Centro"
          >
            <Maximize2 size={16} />
          </button>

          <button
            onClick={takeSnapshot}
            className="p-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20 rounded-lg transition-all"
            title="Captura HD en PNG"
          >
            <Camera size={16} />
          </button>
        </div>

        <button
          onClick={() => setInspectorOpen(!inspectorOpen)}
          className={`glass-panel p-2.5 rounded-xl transition-all duration-200 flex items-center gap-2 text-sm font-semibold ${
            inspectorOpen ? 'bg-purple-600/40 border-purple-500/60 text-white' : 'hover:bg-white/10 text-gray-300'
          }`}
          title="Inspección de Propiedades 3D"
        >
          <Info size={18} className="text-purple-400" />
          <span className="hidden md:inline">Propiedades</span>
        </button>
      </div>
    </header>
  );
}
