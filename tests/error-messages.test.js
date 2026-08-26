import { describe, expect, it } from 'vitest';
import { getUserErrorMessage } from '../src/utils/error-messages.js';

describe('getUserErrorMessage', () => {
  it('removes absolute Windows paths while preserving useful context', () => {
    const message = getUserErrorMessage(
      new Error('No se pudo abrir C:\\Users\\Iker\\Models\\scene.gltf: recurso no válido.'),
      'fallback',
    );

    expect(message).toBe('No se pudo abrir [ruta local]: recurso no válido.');
  });

  it('removes file URLs and control characters', () => {
    const message = getUserErrorMessage(
      new Error('Falló file:///C:/Users/Iker/Models/scene.gltf\u0007'),
      'fallback',
    );

    expect(message).toBe('Falló [ruta local]');
  });

  it('bounds oversized parser diagnostics', () => {
    const message = getUserErrorMessage(new Error('x'.repeat(500)), 'fallback');

    expect(message).toHaveLength(320);
    expect(message.endsWith('…')).toBe(true);
  });

  it('uses the fallback for empty or non-error values', () => {
    expect(getUserErrorMessage(null, 'No disponible.')).toBe('No disponible.');
    expect(getUserErrorMessage(new Error(''), 'No disponible.')).toBe('No disponible.');
  });
});
