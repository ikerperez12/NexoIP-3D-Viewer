import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnimationController from '../src/components/AnimationController.jsx';
import DropZone from '../src/components/DropZone.jsx';
import FileLibrarySidebar from '../src/components/FileLibrarySidebar.jsx';
import ModelInspector from '../src/components/ModelInspector.jsx';

describe('server-rendered accessibility contracts', () => {
  it('renders related library tabs, live progress, and a cancellable scan', () => {
    const markup = renderToStaticMarkup(
      <FileLibrarySidebar
        isOpen
        files={[]}
        folderTree={{ id: 'library', files: [], children: [] }}
        onStartScan={() => undefined}
        onCancelScan={() => undefined}
        scanStatus={{ status: 'scanning', foundModels: 2, scannedDirectories: 4 }}
        isScanning
        bridgeAvailable
      />
    );

    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(2);
    expect(markup).toContain('aria-controls="library-');
    expect(markup).toContain('aria-labelledby="library-');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Detener');
    expect(markup).toContain('<progress');
  });

  it('keeps the hidden file input out of the tab order and labels its single trigger', () => {
    const markup = renderToStaticMarkup(<DropZone disabled={false} hasCurrentFile={false} />);
    expect(markup).toContain('type="file"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('Seleccionar un modelo 3D local');
    expect(markup).toContain('Abrir archivo local');
    expect(markup).toContain('Máximo 256 MB');
  });

  it('renders inspector tabs with matching panel relationships and disables exports in progress', () => {
    const markup = renderToStaticMarkup(
      <ModelInspector
        isOpen
        stats={{
          meshes: 1,
          triangles: 1,
          vertices: 3,
          materials: [],
          dimensions: { x: 1, y: 1, z: 1 },
          hierarchy: { uuid: 'root', name: 'Root', visible: true, children: [] }
        }}
        isExporting
      />
    );
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(3);
    expect(markup).toContain('aria-labelledby="inspector-');
    expect(markup).toContain('aria-busy="true"');
    expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('associates animation labels, values, and output with their controls', () => {
    const markup = renderToStaticMarkup(
      <AnimationController
        animations={[{ uuid: 'clip-1', name: 'Walk', duration: 2 }]}
        currentClipIndex={0}
        isPlaying
        progress={0.5}
        speed={1}
      />
    );
    expect(markup).toContain('Clip de animación');
    expect(markup).toContain('Posición de animación');
    expect(markup).toContain('Velocidad de animación');
    expect(markup).toContain('aria-valuetext="50 %, 1.0 de 2.0 segundos"');
    expect(markup).toContain('<output');
  });
});
