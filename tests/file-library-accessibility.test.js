import { describe, expect, it } from 'vitest';
import {
  isMatchingFile,
  nextRovingTabIndex,
  scanProgressMessage,
  searchAnnouncement,
  treeHasMatches
} from '../src/components/FileLibrarySidebar.jsx';

describe('file library accessibility helpers', () => {
  it('implements cyclic APG tab navigation including Home and End', () => {
    expect(nextRovingTabIndex(0, 2, 'ArrowRight')).toBe(1);
    expect(nextRovingTabIndex(0, 2, 'ArrowLeft')).toBe(1);
    expect(nextRovingTabIndex(1, 2, 'ArrowDown')).toBe(0);
    expect(nextRovingTabIndex(1, 2, 'Home')).toBe(0);
    expect(nextRovingTabIndex(0, 2, 'End')).toBe(1);
    expect(nextRovingTabIndex(0, 2, 'Enter')).toBeNull();
  });

  it('uses the same active filters for flat and tree views', () => {
    const glb = { id: 'model-a', name: 'StudioChair.GLB', extension: 'glb' };
    const obj = { id: 'model-b', name: 'Lamp.obj', extension: 'obj' };
    const tree = { files: [], children: [{ files: [glb, obj], children: [] }] };

    expect(isMatchingFile(glb, 'chair', 'glb')).toBe(true);
    expect(isMatchingFile(obj, 'chair', 'glb')).toBe(false);
    expect(treeHasMatches(tree, 'chair', 'glb')).toBe(true);
    expect(treeHasMatches(tree, 'chair', 'fbx')).toBe(false);
  });

  it('creates concise, filter-specific live announcements', () => {
    expect(searchAnnouncement('', 'all', 2)).toBe('');
    expect(searchAnnouncement('silla', 'glb', 1)).toBe('1 modelo encontrado para “silla” en formato .GLB.');
    expect(searchAnnouncement('', 'obj', 3)).toBe('3 modelos encontrados en formato .OBJ.');
  });

  it('reports scan progress from the scanner contract and warns about truncation', () => {
    expect(scanProgressMessage({ status: 'scanning', foundModels: 4, scannedDirectories: 9 }, true))
      .toBe('Escaneando: 4 modelos encontrados en 9 carpetas.');
    expect(scanProgressMessage({ status: 'completed', truncated: true }, false))
      .toContain('resultados pueden ser parciales');
    expect(scanProgressMessage({ status: 'cancelled', foundModels: 2 }, false))
      .toContain('Se conservan los modelos');
  });
});
