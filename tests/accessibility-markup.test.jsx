import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnimationController from '../src/components/AnimationController.jsx';
import { AppRecoveryScreen } from '../src/components/AppErrorBoundary.jsx';
import DropZone from '../src/components/DropZone.jsx';
import FileLibrarySidebar from '../src/components/FileLibrarySidebar.jsx';
import ModelInspector from '../src/components/ModelInspector.jsx';
import Toolbar3D from '../src/components/Toolbar3D.jsx';

describe('server-rendered accessibility contracts', () => {
  it('renders related library tabs, live progress, and a cancellable scan', () => {
    const markup = renderToStaticMarkup(
      <FileLibrarySidebar
        isOpen
        files={[]}
        catalogState={{
          catalogRevision: 1,
          total: 0,
          nextCursor: null,
          filters: { query: '', extension: 'all' },
          isLoading: false,
          isLoadingMore: false,
        }}
        treePages={{ '__catalog-root__': { items: [], total: 0, nextCursor: null, isLoading: false } }}
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

  it('keeps v2 list and tree pagination bounded, labelled, and connected to their result panels', () => {
    const files = Array.from({ length: 100 }, (_, index) => ({
      id: `remote-${index}`,
      name: `remote-entry-${index}.glb`,
      extension: 'glb'
    }));
    const markup = renderToStaticMarkup(
      <FileLibrarySidebar
        isOpen
        catalogState={{
          catalogRevision: 8,
          total: 250,
          nextCursor: 'catalog-next',
          filters: { query: '', extension: 'all' },
          isLoading: false,
          isLoadingMore: false,
        }}
        files={files}
        treePages={{
          '__catalog-root__': {
            items: files.map((file) => ({ ...file, type: 'model' })),
            total: 250,
            nextCursor: 'tree-next',
            isLoading: false,
          }
        }}
        onLoadMoreCatalog={() => undefined}
        onLoadTreeChildren={() => undefined}
        onStartScan={() => undefined}
        bridgeAvailable
      />
    );

    expect(markup).toContain('remote-entry-99.glb');
    expect(markup).toContain('Mostrar más elementos (150 restantes)');
    expect(markup).toContain('Mostrar más modelos (150 restantes)');
    expect(markup).toMatch(/aria-controls="library-[^"]+-panel-tree"/);
    expect(markup).toMatch(/aria-controls="library-[^"]+-panel-flat"/);
    expect(markup).toContain('Mostrando 100 de 250 modelos.');
  });

  it('does not invent a paginated catalog position that the bridge cannot prove', () => {
    const markup = renderToStaticMarkup(<Toolbar3D currentIndex={-1} currentIndexKnown={false} totalCount={250} />);
    expect(markup).toContain('—/250');
    expect(markup).toContain('Navegación de modelos, posición no cargada de 250');
  });

  it('offers an accessible recovery action if the renderer view fails unexpectedly', () => {
    const markup = renderToStaticMarkup(<AppRecoveryScreen onReload={() => undefined} />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain('La vista necesita reiniciarse');
    expect(markup).toContain('No se ha modificado ningún archivo local.');
    expect(markup).toContain('Reiniciar vista');
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
