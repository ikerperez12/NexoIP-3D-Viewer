import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  X, Info, Eye, EyeOff, Layers, Box, ChevronDown, ChevronRight, Cpu, Palette, Download, Sparkles, Folder
} from 'lucide-react';

const INSPECTOR_TABS = [
  { id: 'stats', label: 'Métricas', icon: Cpu },
  { id: 'hierarchy', label: 'Estructura', icon: Layers },
  { id: 'materials', label: 'Materiales', icon: Palette }
];

function nextTabIndex(currentIndex, key) {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % INSPECTOR_TABS.length;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
  if (key === 'Home') return 0;
  if (key === 'End') return INSPECTOR_TABS.length - 1;
  return null;
}

function restoreFocus(triggerRef) {
  const focusTrigger = () => triggerRef?.current?.focus?.();
  if (typeof window !== 'undefined') window.requestAnimationFrame(focusTrigger);
  else focusTrigger();
}

export default function ModelInspector({
  stats,
  isOpen,
  onClose,
  onRequestClose,
  triggerRef,
  toggleNodeVisibility,
  onExportModel,
  isExporting = false
}) {
  const [activeTab, setActiveTab] = useState('stats');
  const tabRefs = useRef([]);
  const instanceId = useId().replace(/:/g, '');
  const materials = stats?.materials || [];

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

  const handleTabKeyDown = (event, index) => {
    const nextIndex = nextTabIndex(index, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveTab(INSPECTOR_TABS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  if (!isOpen) return null;

  return (
    <aside className="absolute bottom-4 right-4 top-32 z-20 flex w-[min(18rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl shadow-2xl glass-panel animate-fade-in pointer-events-auto lg:w-80 2xl:top-20 2xl:w-96" aria-label="Propiedades del modelo">
      <div className="flex items-center justify-between border-b border-white/10 bg-black/40 p-4">
        <div className="flex items-center gap-2">
          <Info size={18} aria-hidden="true" className="text-purple-300" />
          <h2 className="text-sm font-semibold text-gray-100">Inspección de propiedades</h2>
        </div>
        <button type="button" onClick={requestClose} className="min-h-8 min-w-8 rounded-lg p-2 text-gray-200 hover:bg-white/10 hover:text-white transition-all" aria-label="Cerrar propiedades del modelo">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex gap-1 border-b border-white/10 bg-black/60 p-1" role="tablist" aria-label="Secciones de propiedades">
        {INSPECTOR_TABS.map((tab, index) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              type="button"
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element; }}
              id={`inspector-${instanceId}-tab-${tab.id}`}
              role="tab"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls={`inspector-${instanceId}-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition-all ${selected ? 'border border-purple-400/70 bg-purple-600/40 text-purple-100' : 'text-gray-200 hover:bg-white/10 hover:text-white'}`}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {INSPECTOR_TABS.map((tab) => (
          <div key={tab.id} id={`inspector-${instanceId}-panel-${tab.id}`} role="tabpanel" aria-labelledby={`inspector-${instanceId}-tab-${tab.id}`} hidden={activeTab !== tab.id} className="space-y-4">
            {!stats ? <EmptyInspectorState /> : (
              <>
                {tab.id === 'stats' && <StatisticsTab stats={stats} onExportModel={onExportModel} isExporting={isExporting} />}
                {tab.id === 'hierarchy' && <HierarchyTab node={stats.hierarchy} onToggle={toggleNodeVisibility} />}
                {tab.id === 'materials' && <MaterialsTab materials={materials} />}
              </>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function EmptyInspectorState() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-12 text-center text-gray-300">
      <Box size={40} aria-hidden="true" className="mb-2 text-purple-300/60" />
      <p className="text-sm">No hay ningún modelo 3D cargado.</p>
      <p className="mt-1 text-xs text-gray-400">Abre un archivo local para consultar sus métricas y estructura.</p>
    </div>
  );
}

function StatisticsTab({ stats, onExportModel, isExporting }) {
  const dimensions = stats.dimensions || {};
  const metrics = [
    { label: 'Polígonos', value: stats.triangles, color: 'text-amber-200' },
    { label: 'Vértices', value: stats.vertices, color: 'text-emerald-200' },
    { label: 'Mallas', value: stats.meshes, color: 'text-purple-200' },
    { label: 'Materiales', value: (stats.materials || []).length, color: 'text-cyan-200' }
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-white/10 bg-black/40 p-3">
            <span className="text-[11px] uppercase font-mono text-gray-300">{metric.label}</span>
            <p className={`text-lg font-bold font-mono ${metric.color}`}>{Number(metric.value || 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3.5">
        <h3 className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-gray-200">
          <span>Dimensiones 3D</span>
          <span className="text-[10px] font-mono font-normal text-amber-200">X × Y × Z</span>
        </h3>
        <div className="grid grid-cols-3 gap-2 text-center font-mono">
          <DimensionMetric label="Ancho (X)" value={dimensions.x} color="amber" unit={dimensions.unit} />
          <DimensionMetric label="Alto (Y)" value={dimensions.y} color="emerald" unit={dimensions.unit} />
          <DimensionMetric label="Prof. (Z)" value={dimensions.z} color="cyan" unit={dimensions.unit} />
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-purple-400/40 bg-gradient-to-r from-purple-900/30 to-rose-900/30 p-3.5">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-purple-100">
          <Sparkles size={14} aria-hidden="true" className="text-purple-300" />
          <span>Exportación rápida</span>
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {['glb', 'stl', 'obj'].map((format) => (
            <button
              type="button"
              key={format}
              disabled={!onExportModel || isExporting}
              onClick={() => onExportModel?.(format)}
              aria-busy={isExporting}
              className="flex min-h-8 items-center justify-center gap-1 rounded-lg border border-purple-300/50 bg-purple-600/40 px-2 py-1.5 text-xs font-mono font-bold text-purple-50 transition-all hover:bg-purple-600/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download size={12} aria-hidden="true" />
              <span>{isExporting ? 'Exportando…' : `.${format.toUpperCase()}`}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DimensionMetric({ label, value, color, unit = 'u' }) {
  const colors = {
    amber: 'border-amber-400/40 bg-amber-950/40 text-amber-200',
    emerald: 'border-emerald-400/40 bg-emerald-950/40 text-emerald-200',
    cyan: 'border-cyan-400/40 bg-cyan-950/40 text-cyan-200'
  };
  return (
    <div className={`rounded-lg border p-2 ${colors[color]}`}>
      <span className="block text-[10px]">{label}</span>
      <span className="text-sm font-semibold text-gray-100">{value ?? 0} {unit}</span>
    </div>
  );
}

function HierarchyTab({ node, onToggle }) {
  if (!node) {
    return <p className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-gray-300">El modelo no expone una jerarquía de nodos.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-300">Usa los controles de visibilidad para mostrar u ocultar elementos de la escena.</p>
      <RenderHierarchyNode key={node.uuid} node={node} onToggle={onToggle} />
    </div>
  );
}

function MaterialsTab({ materials }) {
  if (!materials.length) {
    return <p className="rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-gray-300">El modelo no contiene materiales inspectables.</p>;
  }
  return (
    <div className="space-y-3">
      {materials.map((material, index) => (
        <div key={material.id || `${material.name}-${index}`} className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="h-4 w-4 shrink-0 rounded-full border border-white/40 shadow-inner" style={{ backgroundColor: material.color }} aria-hidden="true" />
              <span className="truncate text-xs font-semibold text-gray-100">{material.name || `Material ${index + 1}`}</span>
            </div>
            <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-mono text-gray-200">{material.type || 'Material'}</span>
          </div>
          <dl className="grid grid-cols-2 gap-2 border-t border-white/10 pt-2 text-[11px] font-mono text-gray-300">
            <div><dt className="inline">Rugosidad: </dt><dd className="inline text-gray-100">{material.roughness ?? 'N/D'}</dd></div>
            <div><dt className="inline">Metallicidad: </dt><dd className="inline text-gray-100">{material.metalness ?? 'N/D'}</dd></div>
            <div><dt className="inline">Texturas: </dt><dd className="inline text-gray-100">{material.map ? 'Sí' : 'No'}</dd></div>
            <div><dt className="inline">Transparente: </dt><dd className="inline text-gray-100">{material.transparent ? 'Sí' : 'No'}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  );
}

function RenderHierarchyNode({ node, level = 0, onToggle }) {
  const [visible, setVisible] = useState(Boolean(node?.visible));
  const [expanded, setExpanded] = useState(level === 0);

  if (!node) return null;
  const hasChildren = Boolean(node.children?.length);

  const handleToggle = () => {
    const nextState = !visible;
    setVisible(nextState);
    onToggle?.(node.uuid, nextState);
  };

  return (
    <div className="text-xs">
      <div className="group flex min-h-8 items-center justify-between rounded px-2 py-1 hover:bg-white/10">
        <div className="flex min-w-0 items-center gap-2 truncate">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="min-h-8 min-w-8 shrink-0 rounded p-1.5 text-gray-200 hover:bg-white/10 hover:text-white"
              aria-label={`${expanded ? 'Contraer' : 'Expandir'} ${node.name || 'nodo sin nombre'}`}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            </button>
          ) : <span className="w-8 shrink-0" aria-hidden="true" />}
          <Folder size={14} aria-hidden="true" className={node.isMesh ? 'text-purple-300' : 'text-amber-200'} />
          <span className={`truncate ${node.isMesh ? 'font-medium text-gray-100' : 'text-gray-300'}`}>{node.name || 'Nodo sin nombre'}</span>
          {node.truncated && <span className="shrink-0 text-[10px] text-amber-200">límite</span>}
        </div>
        <button type="button" onClick={handleToggle} className="min-h-8 min-w-8 rounded p-1.5 text-gray-200 hover:bg-white/10 hover:text-white" aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${node.name || 'nodo sin nombre'}`} aria-pressed={visible}>
          {visible ? <Eye size={14} aria-hidden="true" className="text-purple-300" /> : <EyeOff size={14} aria-hidden="true" className="text-gray-300" />}
        </button>
      </div>
      {expanded && hasChildren && (
        <div className="ml-3 border-l border-white/10 pl-2">
          {node.children.map((child) => <RenderHierarchyNode key={child.uuid || child.name} node={child} level={level + 1} onToggle={onToggle} />)}
        </div>
      )}
    </div>
  );
}
