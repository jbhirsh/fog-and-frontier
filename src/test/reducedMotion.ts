import { stubMatchMedia } from './matchMedia';

// Stubs window.matchMedia so `(prefers-reduced-motion: reduce)` matches when
// `reduce` is set, and every other query doesn't. Undo with
// vi.unstubAllGlobals().
export function stubReducedMotion(reduce = true) {
  stubMatchMedia((query) => reduce && query === '(prefers-reduced-motion: reduce)');
}
