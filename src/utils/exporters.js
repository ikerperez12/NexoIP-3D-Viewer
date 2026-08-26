function assertExportableObject(object) {
  if (!object?.isObject3D) throw new TypeError('A valid 3D object is required for export.');
}

export async function exportModelAsGlb(object, animations = []) {
  assertExportableObject(object);

  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  return new GLTFExporter().parseAsync(object, {
    animations: Array.isArray(animations) ? animations : [],
    binary: true,
    onlyVisible: false
  });
}

export async function exportModelAsStl(object) {
  assertExportableObject(object);
  const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
  return new STLExporter().parse(object, { binary: true });
}

export async function exportModelAsObj(object) {
  assertExportableObject(object);
  const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
  return new OBJExporter().parse(object);
}
