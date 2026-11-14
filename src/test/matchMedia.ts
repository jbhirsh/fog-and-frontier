import { vi } from 'vitest';

// jsdom has no window.matchMedia: stubs it so a query matches when `matches`
// says so. Undo with vi.unstubAllGlobals().
export function stubMatchMedia(matches: (query: string) => boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: matches(query),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}
