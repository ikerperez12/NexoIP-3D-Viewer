import React from 'react';
import { FastForward, Film, Pause, Play } from 'lucide-react';

export default function AnimationController({
  animations,
  currentClipIndex,
  onClipChange,
  isPlaying,
  setIsPlaying,
  progress,
  onSeek,
  speed,
  setSpeed
}) {
  if (!animations?.length) return null;
  const selectedClip = animations[currentClipIndex] || animations[0];
  const duration = Number(selectedClip?.duration || 0);
  const elapsed = duration * progress;

  return (
    <section className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-rose-500/40 px-4 py-2.5 shadow-2xl glass-panel" aria-label="Controles de animación">
      <div className="flex min-w-0 items-center gap-2">
        <Film size={18} aria-hidden="true" className="shrink-0 text-rose-300" />
        <label htmlFor="animation-clip" className="sr-only">Clip de animación</label>
        <select id="animation-clip" value={currentClipIndex} onChange={(event) => onClipChange(Number(event.target.value))} className="max-w-36 cursor-pointer truncate rounded-xl border border-white/15 bg-black/70 px-2.5 py-1.5 text-xs font-semibold text-gray-100 outline-none hover:border-rose-400 focus:border-rose-300 md:max-w-52">
          {animations.map((clip, index) => <option key={`${clip.uuid || clip.name}-${index}`} value={index}>{clip.name || `Animación ${index + 1}`}</option>)}
        </select>
      </div>

      <button type="button" onClick={() => setIsPlaying((value) => !value)} className="rounded-xl bg-rose-600 p-2 text-white shadow-lg hover:bg-rose-500" aria-label={isPlaying ? 'Pausar animación' : 'Reproducir animación'} aria-pressed={isPlaying}>
        {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
      </button>

      <div className="flex min-w-24 flex-1 items-center gap-2">
        <label htmlFor="animation-progress" className="sr-only">Posición de animación</label>
        <input id="animation-progress" type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => onSeek(Number(event.target.value))} className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-700 accent-rose-500" aria-valuetext={`${Math.round(progress * 100)}%, ${elapsed.toFixed(1)} de ${duration.toFixed(1)} segundos`} />
        <output htmlFor="animation-progress" className="min-w-10 text-right font-mono text-xs font-bold text-rose-200">{Math.round(progress * 100)}%</output>
      </div>

      <div className="flex items-center gap-1">
        <FastForward size={14} aria-hidden="true" className="text-gray-300" />
        <label htmlFor="animation-speed" className="sr-only">Velocidad de animación</label>
        <select id="animation-speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="cursor-pointer rounded-lg border border-white/15 bg-black/70 px-2 py-1 text-xs font-mono text-gray-100 outline-none hover:border-rose-400 focus:border-rose-300">
          <option value={0.25}>0.25×</option>
          <option value={0.5}>0.5×</option>
          <option value={1}>1.0×</option>
          <option value={1.5}>1.5×</option>
          <option value={2}>2.0×</option>
        </select>
      </div>
    </section>
  );
}
