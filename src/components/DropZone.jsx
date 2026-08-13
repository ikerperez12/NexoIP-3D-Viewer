import React, { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { SUPPORTED_MODEL_EXTENSIONS, validateDroppedFile } from '../utils/nexoip.js';

const ACCEPTED_TYPES = SUPPORTED_MODEL_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export default function DropZone({ disabled = false, hasCurrentFile, onDropFile, onError }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);
  const dragDepthRef = useRef(0);

  const processFiles = useCallback((fileList) => {
    if (disabled) {
      onError?.('Abrir archivos locales está disponible solo desde la aplicación de escritorio.');
      return;
    }
    const files = Array.from(fileList || []);
    if (files.length !== 1) {
      onError?.('Selecciona o suelta un único modelo cada vez.');
      return;
    }
    const error = validateDroppedFile(files[0]);
    if (error) {
      onError?.(error);
      return;
    }
    onDropFile?.(files[0]);
  }, [disabled, onDropFile, onError]);

  useEffect(() => {
    const handleDragEnter = (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setIsDragging(true);
    };
    const handleDragOver = (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const handleDragLeave = (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setIsDragging(false);
    };
    const handleDrop = (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDragging(false);
      processFiles(event.dataTransfer.files);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [processFiles]);

  return (
    <>
      <input ref={inputRef} id="open-local-model" type="file" disabled={disabled} accept={ACCEPTED_TYPES} className="sr-only" onChange={(event) => {
        processFiles(event.target.files);
        event.target.value = '';
      }} />
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className={`absolute z-20 inline-flex items-center gap-2 rounded-xl border border-amber-400/50 bg-black/85 px-3 py-2 text-sm font-semibold text-amber-100 shadow-xl hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 ${hasCurrentFile ? 'bottom-5 left-5' : 'bottom-12 left-1/2 -translate-x-1/2'}`} aria-describedby="open-local-model-help">
        <UploadCloud size={17} aria-hidden="true" /> Abrir archivo local
      </button>
      <span id="open-local-model-help" className="sr-only">{disabled ? 'Disponible solo desde la aplicación de escritorio.' : 'Admite GLB, GLTF, OBJ, STL, FBX, PLY y DAE. Máximo 250 MB.'}</span>

      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center border-4 border-dashed border-amber-400/80 bg-black/85 p-8 text-center backdrop-blur-xl" role="status" aria-live="polite">
          <div className="mb-4 rounded-full border border-amber-300/50 bg-amber-500/20 p-6 text-amber-200">
            <UploadCloud size={64} aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-white">Suelta un modelo 3D para abrirlo</h2>
          <p className="text-sm text-gray-200">GLB, GLTF, OBJ, STL, FBX, PLY o DAE · máximo 250 MB</p>
        </div>
      )}
    </>
  );
}
