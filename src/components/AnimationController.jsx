import React from 'react';
import { Play, Pause, FastForward, RotateCcw, Film } from 'lucide-react';

export default function AnimationController({
  animations,
  currentClipIndex,
  setCurrentClipIndex,
  isPlaying,
  setIsPlaying,
  progress,
  setProgress,
  speed,
  setSpeed
}) {
  if (!animations || animations.length === 0) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 glass-panel px-4 py-2.5 rounded-2xl flex items-center gap-4 shadow-2xl pointer-events-auto max-w-[90vw] md:max-w-2xl border border-rose-500/40">
      {/* Icono + Selector de Clip */}
      <div className="flex items-center gap-2">
        <Film size={18} className="text-rose-400 shrink-0" />
        <select
          value={currentClipIndex}
          onChange={(e) => setCurrentClipIndex(Number(e.target.value))}
          className="bg-black/60 text-gray-200 text-xs font-semibold rounded-xl px-2.5 py-1.5 border border-white/10 outline-none hover:border-rose-500/50 cursor-pointer max-w-[150px] md:max-w-[200px] truncate"
        >
          {animations.map((clip, idx) => (
            <option key={idx} value={idx}>
              {clip.name || `Animación #${idx + 1}`}
            </option>
          ))}
        </select>
      </div>

      {/* Botón Reproducir / Pausa */}
      <button
        onClick={() => setIsPlaying(!isPlaying)}
        className="p-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white shadow-lg transition-all"
        title={isPlaying ? 'Pausar Animación' : 'Reproducir Animación'}
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>

      {/* Barra de Progreso Scrubber */}
      <div className="flex-1 flex items-center gap-2">
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          onChange={(e) => setProgress(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
        />
        <span className="text-xs font-mono text-rose-300 min-w-[36px] text-right font-bold">
          {Math.round(progress * 100)}%
        </span>
      </div>

      {/* Selector de Velocidad */}
      <div className="flex items-center gap-1">
        <FastForward size={14} className="text-gray-400" />
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="bg-black/60 text-gray-300 text-xs font-mono rounded-lg px-2 py-1 border border-white/10 outline-none hover:border-rose-500/50 cursor-pointer"
        >
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1.0x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2.0x</option>
        </select>
      </div>
    </div>
  );
}
