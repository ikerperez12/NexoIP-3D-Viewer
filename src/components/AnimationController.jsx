import React, { useId } from 'react';
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
  const instanceId = useId().replace(/:/g, '');
  if (!animations?.length) return null;

  const selectedClip = animations[currentClipIndex] || animations[0];
  const duration = Number(selectedClip?.duration || 0);
  const elapsed = duration * progress;
  const clipId = `animation-clip-${instanceId}`;
  const progressId = `animation-progress-${instanceId}`;
  const speedId = `animation-speed-${instanceId}`;

  return (
    <section className="pointer-events-auto absolute bottom-6 left-1/2 z-20 flex w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-rose-500/50 px-3 py-2.5 shadow-2xl glass-panel sm:flex-nowrap" aria-label="Controles de animación">
      <div className="flex min-w-0 max-w-full items-center gap-2 sm:max-w-52">
        <Film size={18} aria-hidden="true" className="shrink-0 text-rose-200" />
        <label htmlFor={clipId} className="sr-only">Clip de animación</label>
        <select id={clipId} value={currentClipIndex} onChange={(event) => onClipChange?.(Number(event.target.value))} className="min-h-8 min-w-0 max-w-full flex-1 cursor-pointer truncate rounded-xl border border-white/20 bg-black/70 px-2.5 py-1.5 text-xs font-semibold text-gray-100 outline-none hover:border-rose-300 focus:border-rose-200">
          {animations.map((clip, index) => <option key={`${clip.uuid || clip.name}-${index}`} value={index}>{clip.name || `Animación ${index + 1}`}</option>)}
        </select>
      </div>

      <button type="button" onClick={() => setIsPlaying?.((value) => !value)} className="flex min-h-9 min-w-9 items-center justify-center rounded-xl bg-rose-600 p-2 text-white shadow-lg hover:bg-rose-500" aria-label={isPlaying ? 'Pausar animación' : 'Reproducir animación'} aria-pressed={isPlaying}>
        {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
      </button>

      <div className="flex min-w-36 flex-1 items-center gap-2">
        <label htmlFor={progressId} className="sr-only">Posición de animación</label>
        <input id={progressId} type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => onSeek?.(Number(event.target.value))} className="h-8 w-full cursor-pointer appearance-none rounded-lg bg-gray-700 accent-rose-400" aria-valuetext={`${Math.round(progress * 100)} %, ${elapsed.toFixed(1)} de ${duration.toFixed(1)} segundos`} />
        <output htmlFor={progressId} className="min-w-10 text-right font-mono text-xs font-bold text-rose-100">{Math.round(progress * 100)}%</output>
      </div>

      <div className="flex items-center gap-1">
        <FastForward size={14} aria-hidden="true" className="text-gray-200" />
        <label htmlFor={speedId} className="sr-only">Velocidad de animación</label>
        <select id={speedId} value={speed} onChange={(event) => setSpeed?.(Number(event.target.value))} className="min-h-8 cursor-pointer rounded-lg border border-white/20 bg-black/70 px-2 py-1 text-xs font-mono text-gray-100 outline-none hover:border-rose-300 focus:border-rose-200">
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
