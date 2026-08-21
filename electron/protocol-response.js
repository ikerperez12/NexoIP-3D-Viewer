import { Readable } from 'node:stream';

export function createSecureModelResponse(method, modelAsset, contentType) {
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Length': String(modelAsset.size),
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  };

  if (method === 'HEAD') {
    modelAsset.stream.destroy();
    return new Response(null, { headers });
  }

  return new Response(Readable.toWeb(modelAsset.stream), { headers });
}
