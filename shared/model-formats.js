// Canonical advertised model-format identifiers shared by the trusted main
// process and sandboxed renderer. Format-specific parsing remains isolated.
export const SUPPORTED_MODEL_FORMATS = Object.freeze([
  'glb',
  'gltf',
  'obj',
  'stl',
  'fbx',
  'ply',
  'dae',
]);
