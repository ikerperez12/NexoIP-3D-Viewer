import React, { useState, useEffect } from 'react';
import { Box, UploadCloud, Sparkles } from 'lucide-react';

export default function DropZone({ onDropFile }) {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.clientX === 0 && e.clientY === 0) {
        setIsDragging(false);
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const ext = file.name.split('.').pop().toLowerCase();
        const supported = ['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', 'dae'];

        if (supported.includes(ext)) {
          const blobUrl = URL.createObjectURL(file);
          onDropFile({
            name: file.name,
            path: blobUrl,
            extension: ext,
            size: file.size,
            isBlob: true
          });
        }
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [onDropFile]);

  if (!isDragging) return null;

  return (
    <div className="fixed inset-0 z-50 glass-panel bg-indigo-950/80 backdrop-blur-xl flex flex-col items-center justify-center p-8 border-4 border-dashed border-indigo-500/80 animate-fade-in pointer-events-none">
      <div className="bg-indigo-600/30 p-6 rounded-full border border-indigo-400/50 mb-4 animate-bounce">
        <UploadCloud size={64} className="text-indigo-300" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
        <span>Arrastra y Suelta tu Modelo 3D Aquí</span>
        <Sparkles size={24} className="text-indigo-400" />
      </h2>
      <p className="text-sm text-indigo-200 font-mono">
        Soporta archivos .GLB, .GLTF, .OBJ, .STL, .FBX, .PLY y .DAE
      </p>
    </div>
  );
}
