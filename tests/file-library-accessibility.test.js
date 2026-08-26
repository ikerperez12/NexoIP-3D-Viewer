import { describe, expect, it } from 'vitest';
import {
  getScanLiveAnnouncement,
  nextRovingTabIndex,
  scanProgressMessage,
  searchAnnouncement
} from '../src/components/FileLibrarySidebar.jsx';
import { panelContainsFocusedElement } from '../src/utils/panel-focus.js';

describe('file library accessibility helpers', () => {
  it('implements cyclic APG tab navigation including Home and End', () => {
    expect(nextRovingTabIndex(0, 2, 'ArrowRight')).toBe(1);
    expect(nextRovingTabIndex(0, 2, 'ArrowLeft')).toBe(1);
    expect(nextRovingTabIndex(1, 2, 'ArrowDown')).toBe(0);
    expect(nextRovingTabIndex(1, 2, 'Home')).toBe(0);
    expect(nextRovingTabIndex(0, 2, 'End')).toBe(1);
    expect(nextRovingTabIndex(0, 2, 'Enter')).toBeNull();
  });

  it('creates concise, filter-specific live announcements', () => {
    expect(searchAnnouncement('', 'all', 2)).toBe('');
    expect(searchAnnouncement('silla', 'glb', 1)).toBe('1 modelo encontrado para “silla” en formato .GLB.');
    expect(searchAnnouncement('', 'obj', 3)).toBe('3 modelos encontrados en formato .OBJ.');
  });

  it('reports scan progress from the scanner contract without presenting a capped library as complete', () => {
    expect(scanProgressMessage({ status: 'scanning', foundModels: 4, availableModels: 7, scannedDirectories: 9 }, true))
      .toBe('Escaneando: 4 modelos precomprobados; 7 disponibles en 9 carpetas.');
    expect(scanProgressMessage({ status: 'completed', foundModels: 24 }, false))
      .toBe('Escaneo completo: 24 modelos compatibles indexados.');
    expect(scanProgressMessage({ status: 'completed', foundModels: 24, skippedEntries: 2, oversizedModels: 1 }, false))
      .toContain('1 archivo supera los 256 MB');
    expect(scanProgressMessage({ status: 'completed', foundModels: 24, skippedEntries: 2, oversizedModels: 1 }, false))
      .toContain('1 elemento no se pudo indexar de forma segura');
    expect(scanProgressMessage({ status: 'completed', foundModels: 24, skippedEntries: 1, invalidModels: 1 }, false))
      .toContain('1 archivo no supera la precomprobación de formato y geometría');
    expect(scanProgressMessage({ status: 'cancelled', foundModels: 2 }, false))
      .toContain('Se conservan los modelos');
  });

  it('announces scan lifecycle events and useful discovery milestones without repeating every candidate', () => {
    let state = { status: 'idle', milestone: 0 };
    let update = getScanLiveAnnouncement({ status: 'scanning', availableModels: 0 }, true, state);
    expect(update.message).toContain('Escaneo iniciado');
    state = update.state;

    update = getScanLiveAnnouncement({ status: 'scanning', availableModels: 1 }, true, state);
    expect(update.message).toContain('1 modelo precomprobado');
    state = update.state;

    update = getScanLiveAnnouncement({ status: 'scanning', availableModels: 9 }, true, state);
    expect(update.message).toBe('');
    state = update.state;

    update = getScanLiveAnnouncement({ status: 'scanning', availableModels: 10 }, true, state);
    expect(update.message).toContain('10 modelos precomprobados');
    state = update.state;

    update = getScanLiveAnnouncement({ status: 'scanning', availableModels: 24 }, true, state);
    expect(update.message).toBe('');
    state = update.state;

    update = getScanLiveAnnouncement({ status: 'completed', foundModels: 26 }, false, state);
    expect(update.message).toBe('Escaneo completo: 26 modelos compatibles indexados.');
  });

  it('identifies the panel that actually contains focus before Escape can close it', () => {
    const focusedInside = {};
    const focusedOutside = {};
    const panel = { contains: (element) => element === focusedInside };

    expect(panelContainsFocusedElement(panel, focusedInside)).toBe(true);
    expect(panelContainsFocusedElement(panel, focusedOutside)).toBe(false);
    expect(panelContainsFocusedElement(null, focusedInside)).toBe(false);
  });
});
