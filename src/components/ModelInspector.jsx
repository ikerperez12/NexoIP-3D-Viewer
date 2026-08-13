import React, { useState } from 'react';
import { 
  X, Info, Eye, EyeOff, Layers, Box, Cpu, Palette, Download, Sparkles, Folder
} from 'lucide-react';

export default function ModelInspector({
  stats,
  isOpen,
  onClose,
  toggleNodeVisibility,
  onExportModel
}) {
  const [activeTab, setActiveTab] = useState('stats');

  if (!isOpen) return null;

  return (
    <aside className="absolute top-20 right-4 bottom-4 w-80 md:w-96 z-20 glass-panel rounded-2xl flex flex-col overflow-hidden shadow-2xl animate-fade-in pointer-events-auto" aria-label="Propiedades del modelo">
      {/* Header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/40">
        <div className="flex items-center gap-2">
          <Info size={18} className="text-purple-400" />
          <h3 className="font-semibold text-gray-100 text-sm">Inspección de Propiedades</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-all"
          aria-label="Cerrar propiedades del modelo"
        >
          <X size={18} />
        </button>
      </div>

      {/* Selector de Pestañas */}
      <div className="flex border-b border-white/10 bg-black/60 p-1 gap-1" role="tablist" aria-label="Secciones de propiedades">
        {[
          { id: 'stats', label: 'Métricas', icon: Cpu },
          { id: 'hierarchy', label: 'Estructura', icon: Layers },
          { id: 'materials', label: 'Materiales', icon: Palette }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`inspector-panel-${tab.id}`}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-purple-600/40 text-purple-200 border border-purple-500/50'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Contenido de la Pestaña */}
      <div id={`inspector-panel-${activeTab}`} role="tabpanel" className="flex-1 overflow-y-auto p-4 space-y-4">
        {!stats ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 py-12">
            <Box size={40} className="mb-2 opacity-30 text-purple-400" />
            <p className="text-sm">Ningún modelo 3D cargado</p>
          </div>
        ) : (
          <>
            {/* Pestaña 1: Métricas de Geometría */}
            {activeTab === 'stats' && (
              <div className="space-y-4">
                {/* Resumen de Tarjetas */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                    <span className="text-[11px] text-gray-400 uppercase font-mono">Polígonos</span>
                    <p className="text-lg font-bold text-amber-300 font-mono">
                      {stats.triangles.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                    <span className="text-[11px] text-gray-400 uppercase font-mono">Vértices</span>
                    <p className="text-lg font-bold text-emerald-300 font-mono">
                      {stats.vertices.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                    <span className="text-[11px] text-gray-400 uppercase font-mono">Mallas</span>
                    <p className="text-lg font-bold text-purple-300 font-mono">
                      {stats.meshes}
                    </p>
                  </div>
                  <div className="bg-black/40 p-3 rounded-xl border border-white/5">
                    <span className="text-[11px] text-gray-400 uppercase font-mono">Materiales</span>
                    <p className="text-lg font-bold text-cyan-300 font-mono">
                      {stats.materials.length}
                    </p>
                  </div>
                </div>

                {/* Dimensiones Bounding Box */}
                <div className="bg-black/40 p-3.5 rounded-xl border border-white/5 space-y-2">
                  <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center justify-between">
                    <span>Dimensiones 3D</span>
                    <span className="text-[10px] text-amber-400 font-mono font-normal">X × Y × Z</span>
                  </h4>
                  <div className="grid grid-cols-3 gap-2 text-center font-mono">
                    <div className="bg-amber-950/40 p-2 rounded-lg border border-amber-500/30">
                      <span className="text-[10px] text-amber-400 block">ANCHO (X)</span>
                      <span className="text-sm font-semibold text-gray-200">{stats.dimensions.x} m</span>
                    </div>
                    <div className="bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/30">
                      <span className="text-[10px] text-emerald-400 block">ALTO (Y)</span>
                      <span className="text-sm font-semibold text-gray-200">{stats.dimensions.y} m</span>
                    </div>
                    <div className="bg-cyan-950/40 p-2 rounded-lg border border-cyan-500/30">
                      <span className="text-[10px] text-cyan-400 block">PROF. (Z)</span>
                      <span className="text-sm font-semibold text-gray-200">{stats.dimensions.z} m</span>
                    </div>
                  </div>
                </div>

                {/* Exportador Rápido */}
                <div className="bg-gradient-to-r from-purple-900/30 to-rose-900/30 p-3.5 rounded-xl border border-purple-500/30 space-y-2">
                  <h4 className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-purple-400" />
                    <span>Exportación Rápida</span>
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    {['glb', 'stl', 'obj'].map(fmt => (
                      <button
                        type="button"
                        key={fmt}
                        onClick={() => onExportModel && onExportModel(fmt)}
                        className="py-1.5 bg-purple-600/40 hover:bg-purple-600/70 text-purple-100 text-xs font-mono font-bold rounded-lg border border-purple-400/40 transition-all flex items-center justify-center gap-1"
                      >
                        <Download size={12} />
                        <span>.{fmt.toUpperCase()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Pestaña 2: Jerarquía de Nodos */}
            {activeTab === 'hierarchy' && (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-400 mb-2">
                  Haz clic en los ojos para ocultar/mostrar elementos de la escena:
                </p>
                <RenderHierarchyNode node={stats.hierarchy} onToggle={toggleNodeVisibility} />
              </div>
            )}

            {/* Pestaña 3: Inspección de Materiales */}
            {activeTab === 'materials' && (
              <div className="space-y-3">
                {stats.materials.map((mat, i) => (
                  <div key={mat.id || i} className="bg-black/40 p-3 rounded-xl border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full border border-white/30 shadow-inner"
                          style={{ backgroundColor: mat.color }}
                        />
                        <span className="text-xs font-semibold text-gray-200 truncate max-w-[180px]">
                          {mat.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono px-2 py-0.5 rounded bg-white/5">
                        {mat.type}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-gray-400 pt-1 border-t border-white/5">
                      <div>Rugosidad: <span className="text-gray-200">{mat.roughness !== null ? mat.roughness : 'N/A'}</span></div>
                      <div>Metalicidad: <span className="text-gray-200">{mat.metalness !== null ? mat.metalness : 'N/A'}</span></div>
                      <div>Texturas: <span className="text-gray-200">{mat.map ? 'Sí' : 'No'}</span></div>
                      <div>Transparente: <span className="text-gray-200">{mat.transparent ? 'Sí' : 'No'}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

function RenderHierarchyNode({ node, level = 0, onToggle }) {
  const [visible, setVisible] = useState(node.visible);

  const handleToggle = (e) => {
    e.stopPropagation();
    const nextState = !visible;
    setVisible(nextState);
    if (onToggle) onToggle(node.uuid, nextState);
  };

  return (
    <div style={{ paddingLeft: `${level * 12}px` }} className="text-xs">
      <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-white/5 group">
        <div className="flex items-center gap-2 truncate">
          <Folder size={14} className={node.isMesh ? "text-purple-400" : "text-amber-400"} />
          <span className={`truncate ${node.isMesh ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
            {node.name}
          </span>
        </div>
        <button
          type="button"
          onClick={handleToggle}
          className="text-gray-500 hover:text-gray-200 p-0.5 rounded opacity-70 group-hover:opacity-100"
          aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${node.name}`}
          aria-pressed={visible}
        >
          {visible ? <Eye size={14} className="text-purple-400" /> : <EyeOff size={14} className="text-gray-600" />}
        </button>
      </div>
      {node.children && node.children.map(child => (
        <RenderHierarchyNode key={child.uuid} node={child} level={level + 1} onToggle={onToggle} />
      ))}
    </div>
  );
}
