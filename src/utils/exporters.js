export async function exportModelAsGlb(object, animations = []) {
  if (!object?.isObject3D) throw new TypeError('A valid 3D object is required for GLB export.');

  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  return new GLTFExporter().parseAsync(object, {
    animations: Array.isArray(animations) ? animations : [],
    binary: true,
    onlyVisible: false
  });
}
