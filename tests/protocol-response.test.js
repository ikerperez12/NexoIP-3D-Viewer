import { PassThrough } from 'node:stream';
import { expect, test } from 'vitest';
import { createSecureModelResponse } from '../electron/protocol-response.js';

test('HEAD model responses close their verified stream and preserve safe metadata', async () => {
  const stream = new PassThrough();
  const closed = new Promise((resolve) => stream.once('close', resolve));

  const response = createSecureModelResponse('HEAD', { path: 'scene.gltf', size: 42, stream }, 'model/gltf+json');
  expect(response.body).toBeNull();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-length')).toBe('42');
  expect(response.headers.get('content-type')).toBe('model/gltf+json');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  await closed;
});
