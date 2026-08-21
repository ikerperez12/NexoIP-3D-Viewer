import { expect, test } from 'vitest';
import { prefersReducedMotion } from '../src/utils/motion-preference.js';

test('motion preference fails safe and detects the operating-system reduction request', () => {
  expect(prefersReducedMotion()).toBe(false);
  expect(prefersReducedMotion((query) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))).toBe(true);
  expect(prefersReducedMotion(() => { throw new Error('unavailable'); })).toBe(false);
});
