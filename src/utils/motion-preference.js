export function prefersReducedMotion(matchMedia = globalThis.window?.matchMedia?.bind(globalThis.window)) {
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}
