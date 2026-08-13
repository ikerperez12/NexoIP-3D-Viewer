export const SUPPORTED_MODEL_EXTENSIONS = Object.freeze([
  'glb',
  'gltf',
  'obj',
  'stl',
  'fbx',
  'ply',
  'dae'
]);

export const MAX_DROPPED_FILE_BYTES = 250 * 1024 * 1024;

export const ELECTRON_BRIDGE_ERROR =
  'NexoIP 3D Viewer debe abrirse desde la aplicación de escritorio para acceder a archivos locales.';

export function getNexoipBridge() {
  if (typeof window === 'undefined') return null;
  return window.nexoip || null;
}

export function assertNexoipBridge() {
  const bridge = getNexoipBridge();
  if (!bridge) throw new Error(ELECTRON_BRIDGE_ERROR);
  return bridge;
}

export async function callNexoip(method, ...args) {
  const bridge = assertNexoipBridge();
  if (typeof bridge[method] !== 'function') {
    throw new Error(`La aplicación de escritorio no expone la operación segura “${method}”.`);
  }

  const result = await bridge[method](...args);
  if (result && result.success === false) {
    throw new Error(result.error || result.message || 'La operación local no pudo completarse.');
  }
  return result?.data ?? result;
}

export function responseFiles(response) {
  if (Array.isArray(response)) return response;
  return Array.isArray(response?.files) ? response.files : [];
}

export function responseTree(response) {
  return response?.tree ?? response ?? null;
}

export function responseStatus(response) {
  return response?.status ?? response ?? null;
}

export function responseModel(response) {
  return response?.file ?? response?.model ?? response ?? null;
}

export function responseModelUrl(response) {
  return typeof response === 'string' ? response : response?.url ?? response?.modelUrl ?? null;
}

export function getFileExtension(fileName = '') {
  const extension = String(fileName).split('.').pop()?.toLowerCase();
  return SUPPORTED_MODEL_EXTENSIONS.includes(extension) ? extension : '';
}

export function validateDroppedFile(file) {
  if (!(file instanceof File)) return 'Selecciona un archivo 3D válido.';

  const extension = getFileExtension(file.name);
  if (!extension) {
    return `Formato no compatible. Usa: ${SUPPORTED_MODEL_EXTENSIONS.map((item) => `.${item}`).join(', ')}.`;
  }
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > MAX_DROPPED_FILE_BYTES) {
    return `El archivo supera el límite de ${Math.round(MAX_DROPPED_FILE_BYTES / (1024 * 1024))} MB.`;
  }

  return null;
}

export function isScanInProgress(status) {
  return Boolean(status?.isScanning || status?.status === 'scanning');
}
