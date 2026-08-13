import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { applyCameraAction } from '../src/utils/camera-controls.js';

function createCameraControls() {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return {
    camera,
    controls: {
      target: new THREE.Vector3(0, 0, 0),
      update: vi.fn()
    }
  };
}

describe('keyboard camera actions', () => {
  it('pans the camera and target together', () => {
    const { camera, controls } = createCameraControls();
    const previousOffset = camera.position.clone().sub(controls.target);

    expect(applyCameraAction(camera, controls, 'pan-right')).toBe(true);
    expect(camera.position.clone().sub(controls.target).distanceTo(previousOffset)).toBeLessThan(1e-9);
    expect(controls.target.x).toBeGreaterThan(0);
    expect(controls.update).toHaveBeenCalledOnce();
  });

  it('orbits while preserving the camera distance', () => {
    const { camera, controls } = createCameraControls();
    const previousDistance = camera.position.distanceTo(controls.target);

    expect(applyCameraAction(camera, controls, 'orbit-left')).toBe(true);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(previousDistance, 9);
    expect(camera.position.x).not.toBeCloseTo(0, 9);
  });

  it('ignores unknown actions without updating controls', () => {
    const { camera, controls } = createCameraControls();
    const previousPosition = camera.position.clone();

    expect(applyCameraAction(camera, controls, 'unsupported')).toBe(false);
    expect(camera.position.equals(previousPosition)).toBe(true);
    expect(controls.update).not.toHaveBeenCalled();
  });
});
