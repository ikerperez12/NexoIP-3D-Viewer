import { describe, expect, it } from 'vitest';
import {
  filterTreeForMatches,
  getTreePage,
  isMatchingFile,
  nextRovingTabIndex,
  scanProgressMessage,
  searchAnnouncement,
  TREE_PAGE_SIZE,
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

  it('prunes unmatched tree branches once while preserving matching descendant counts', () => {
    const chair = { id: 'model-chair', name: 'Chair.glb', extension: 'glb' };
    const lamp = { id: 'model-lamp', name: 'Lamp.obj', extension: 'obj' };
    const tree = {
      id: 'library',
      files: [],
      children: [
        { id: 'furniture', name: 'Furniture', files: [chair], children: [] },
        { id: 'lighting', name: 'Lighting', files: [lamp], children: [] }
      ]
    };

    const filtered = filterTreeForMatches(tree, 'chair', 'all');

    expect(filtered.children).toHaveLength(1);
    expect(filtered.children[0].id).toBe('furniture');
    expect(filtered.children[0].matchingFilesCount).toBe(1);
    expect(filterTreeForMatches(tree, '', 'all')).toBe(tree);
  });

  it('pages folders before files without creating a combined entry list', () => {
    const children = Array.from({ length: TREE_PAGE_SIZE + 5 }, (_, index) => ({ id: `folder-${index}` }));
    const files = Array.from({ length: 8 }, (_, index) => ({ id: `file-${index}` }));

    const firstPage = getTreePage(children, files);
    const nextPage = getTreePage(children, files, TREE_PAGE_SIZE + 7);

    expect(firstPage.visibleChildren).toHaveLength(TREE_PAGE_SIZE);
    expect(firstPage.visibleFiles).toHaveLength(0);
    expect(firstPage.remainingEntries).toBe(13);
    expect(nextPage.visibleChildren).toHaveLength(TREE_PAGE_SIZE + 5);
    expect(nextPage.visibleFiles).toHaveLength(2);
    expect(nextPage.remainingEntries).toBe(6);
  });

  it('caps a ten-thousand-model directory at one accessible tree page', () => {
    const files = Array.from({ length: 10_000 }, (_, index) => ({ id: `model-${index}` }));
    const page = getTreePage([], files);

    expect(page.visibleFiles).toHaveLength(TREE_PAGE_SIZE);
    expect(page.remainingEntries).toBe(10_000 - TREE_PAGE_SIZE);
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
      .toContain('1 archivo no supera la comprobación estructural');
    expect(scanProgressMessage({ status: 'cancelled', foundModels: 2 }, false))
      .toContain('Se conservan los modelos');
  });
});
