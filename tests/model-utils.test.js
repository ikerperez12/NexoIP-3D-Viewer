import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  getFileExtension,
  responseModelUrl,
  responseStatus,
  SUPPORTED_MODEL_EXTENSIONS
} from '../src/utils/nexoip.js';
import { extractModelStats } from '../src/utils/loaders.js';

describe('renderer model utilities', () => {
  it('allows exactly the seven documented model formats', () => {
    expect(SUPPORTED_MODEL_EXTENSIONS).toEqual(['glb', 'gltf', 'obj', 'stl', 'fbx', 'ply', 'dae']);
    expect(getFileExtension('chair.GLB')).toBe('glb');
    expect(getFileExtension('archive.glb.exe')).toBe('');
    expect(getFileExtension('notes.txt')).toBe('');
  });

  it('accepts both direct IPC status results and wrapped legacy results', () => {
    const status = { status: 'scanning', isScanning: true };
    expect(responseStatus(status)).toBe(status);
    expect(responseStatus({ success: true, status })).toBe(status);
  });

  it('uses only the bridge-provided model URL', () => {
    expect(responseModelUrl('nexoip://app/model/example/asset')).toBe('nexoip://app/model/example/asset');
    expect(responseModelUrl({ url: 'nexoip://app/model/example/asset' })).toBe('nexoip://app/model/example/asset');
    expect(responseModelUrl({ path: 'C:\\private\\model.glb' })).toBeNull();
  });

  it('reports dimensions in source-model units instead of assuming metres', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4));
    const stats = extractModelStats(mesh);

    expect(stats.dimensions).toEqual({ x: 2, y: 3, z: 4, unit: 'u' });
    mesh.geometry.dispose();
  });
});
