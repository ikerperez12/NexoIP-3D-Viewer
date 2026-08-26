import { expect, test } from 'vitest';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  exportModelAsGlb,
  exportModelAsObj,
  exportModelAsStl,
} from '../src/utils/exporters.js';
import { disposeModelResources } from '../src/utils/loaders.js';

function createExportScene() {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 4, 6),
    new THREE.MeshStandardMaterial({ color: 0x2dd4bf }),
  );
  mesh.name = 'RoundTripBox';
  mesh.position.set(3, -2, 5);
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  return scene;
}

test('binary STL export can be parsed again with transformed geometry intact', async () => {
  const source = createExportScene();
  const exported = await exportModelAsStl(source);
  const bytes = exported.buffer.slice(exported.byteOffset, exported.byteOffset + exported.byteLength);
  const geometry = new STLLoader().parse(bytes);
  geometry.computeBoundingBox();

  expect(exported).toBeInstanceOf(DataView);
  expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
  expect(geometry.boundingBox.min.toArray()).toEqual([2, -4, 2]);
  expect(geometry.boundingBox.max.toArray()).toEqual([4, 0, 8]);

  geometry.dispose();
  disposeModelResources(source);
});

test('OBJ export can be parsed again with object identity and transformed geometry', async () => {
  const source = createExportScene();
  const exported = await exportModelAsObj(source);
  const reloaded = new OBJLoader().parse(exported);
  const mesh = reloaded.getObjectByName('RoundTripBox');
  const bounds = new THREE.Box3().setFromObject(reloaded);

  expect(exported).toContain('o RoundTripBox');
  expect(mesh?.isMesh).toBe(true);
  expect(bounds.min.toArray()).toEqual([2, -4, 2]);
  expect(bounds.max.toArray()).toEqual([4, 0, 8]);

  disposeModelResources(source);
  disposeModelResources(reloaded);
});

test('all quick exporters reject values that are not 3D objects', async () => {
  await expect(exportModelAsGlb(null)).rejects.toThrow('A valid 3D object is required for export');
  await expect(exportModelAsStl({})).rejects.toThrow('A valid 3D object is required for export');
  await expect(exportModelAsObj('mesh')).rejects.toThrow('A valid 3D object is required for export');
});
