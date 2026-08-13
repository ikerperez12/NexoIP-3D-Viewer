import * as THREE from 'three';

export function applyCameraAction(camera, controls, action) {
  if (!camera || !controls || typeof action !== 'string') return false;
  if (!/^(orbit|pan)-(left|right|up|down)$/.test(action) && !/^zoom-(in|out)$/.test(action)) return false;

  const target = controls.target;
  const offset = camera.position.clone().sub(target);
  const distance = Math.max(offset.length(), 0.001);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  const orbitStep = THREE.MathUtils.degToRad(10);
  const panStep = Math.max(distance * 0.08, 0.01);

  if (action === 'orbit-left') spherical.theta -= orbitStep;
  if (action === 'orbit-right') spherical.theta += orbitStep;
  if (action === 'orbit-up') spherical.phi = Math.max(0.01, spherical.phi - orbitStep);
  if (action === 'orbit-down') spherical.phi = Math.min(Math.PI - 0.01, spherical.phi + orbitStep);
  if (action.startsWith('orbit-')) camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(spherical));

  if (action.startsWith('pan-')) {
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const movement = new THREE.Vector3();
    if (action === 'pan-left') movement.addScaledVector(right, -panStep);
    if (action === 'pan-right') movement.addScaledVector(right, panStep);
    if (action === 'pan-up') movement.addScaledVector(up, panStep);
    if (action === 'pan-down') movement.addScaledVector(up, -panStep);
    camera.position.add(movement);
    target.add(movement);
  }

  if (action === 'zoom-in' || action === 'zoom-out') {
    const scale = action === 'zoom-in' ? 0.82 : 1.22;
    if (camera.isOrthographicCamera) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom / scale, 0.01, 100);
      camera.updateProjectionMatrix();
    } else {
      camera.position.copy(target).add(offset.multiplyScalar(scale));
    }
  }

  camera.lookAt(target);
  controls.update();
  return true;
}
