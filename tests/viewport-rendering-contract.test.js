import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const viewportSource = await readFile(new URL('../src/components/Viewport3D.jsx', import.meta.url), 'utf8');

describe('viewport rendering lifecycle contract', () => {
  it('contains renderer construction failures inside the recoverable lifecycle', () => {
    const constructor = viewportSource.indexOf('new THREE.WebGLRenderer');
    const guardedBlock = viewportSource.slice(viewportSource.lastIndexOf('try {', constructor), viewportSource.indexOf('return () => {', constructor));

    expect(constructor).toBeGreaterThan(-1);
    expect(guardedBlock).toContain('catch (rendererError)');
    expect(guardedBlock).toContain('setContextLost(true)');
    expect(guardedBlock).toContain('Recuperar vista');
  });

  it('replaces the WebGL generation for manual and automatic recovery', () => {
    expect(viewportSource).toContain("container.dataset.rendererGeneration = String(rendererGeneration)");
    expect(viewportSource.match(/setRendererGeneration\(\(value\) => value \+ 1\)/g)).toHaveLength(2);
    expect(viewportSource).toContain("}, [rendererGeneration]);");
  });

  it('uses the demand scheduler and preserves model identity evidence', () => {
    expect(viewportSource).toContain('createDemandRenderScheduler');
    expect(viewportSource).toContain("container.dataset.renderLoop = 'demand'");
    expect(viewportSource).not.toContain('requestAnimationFrame(renderFrame)');
    expect(viewportSource).not.toContain('new THREE.Clock');
    expect(viewportSource).toContain('onModelLoaded?.({ modelId: currentFile.id');
  });
});
