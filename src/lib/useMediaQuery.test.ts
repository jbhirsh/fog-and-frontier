import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

// A controllable matchMedia: each query has a current `matches` value, and
// `setMatches` flips it and fires `change` on that query's live lists.
function stubMatchMedia(initial: Record<string, boolean>) {
  const state = { ...initial };
  const listeners = new Map<string, Set<() => void>>();
  vi.stubGlobal('matchMedia', (query: string) => {
    const set = listeners.get(query) ?? new Set<() => void>();
    listeners.set(query, set);
    return {
      media: query,
      get matches() {
        return state[query] ?? false;
      },
      addEventListener: (_type: string, fn: () => void) => set.add(fn),
      removeEventListener: (_type: string, fn: () => void) => set.delete(fn),
    } as unknown as MediaQueryList;
  });
  return {
    setMatches(query: string, value: boolean) {
      state[query] = value;
      act(() => {
        listeners.get(query)?.forEach((fn) => fn());
      });
    },
    listenerCount(query: string) {
      return listeners.get(query)?.size ?? 0;
    },
  };
}

const LG = '(min-width: 1024px)';
const SM = '(min-width: 640px)';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('reports false where matchMedia is missing (jsdom)', () => {
    const seen: boolean[] = [];
    const { result } = renderHook(() => {
      const m = useMediaQuery(LG);
      seen.push(m);
      return m;
    });
    expect(result.current).toBe(false);
    expect(seen.every((m) => m === false)).toBe(true);
  });

  it('reports a matching query as true from the very first render', () => {
    stubMatchMedia({ [LG]: true });
    const seen: boolean[] = [];
    renderHook(() => {
      const m = useMediaQuery(LG);
      seen.push(m);
      return m;
    });
    expect(seen[0]).toBe(true);
  });

  it('reports a non-matching query as false', () => {
    stubMatchMedia({ [LG]: false });
    const { result } = renderHook(() => useMediaQuery(LG));
    expect(result.current).toBe(false);
  });

  it('re-renders when the query starts or stops matching', () => {
    const mm = stubMatchMedia({ [LG]: false });
    const { result } = renderHook(() => useMediaQuery(LG));
    mm.setMatches(LG, true);
    expect(result.current).toBe(true);
    mm.setMatches(LG, false);
    expect(result.current).toBe(false);
  });

  it('follows a new query passed on re-render', () => {
    const mm = stubMatchMedia({ [LG]: false, [SM]: true });
    const { result, rerender } = renderHook(({ q }) => useMediaQuery(q), {
      initialProps: { q: LG },
    });
    expect(result.current).toBe(false);
    rerender({ q: SM });
    expect(result.current).toBe(true);
    // Now listening to the new query, not the old one.
    expect(mm.listenerCount(LG)).toBe(0);
    mm.setMatches(SM, false);
    expect(result.current).toBe(false);
  });

  it('stops listening on unmount', () => {
    const mm = stubMatchMedia({ [LG]: false });
    const { unmount } = renderHook(() => useMediaQuery(LG));
    expect(mm.listenerCount(LG)).toBe(1);
    unmount();
    expect(mm.listenerCount(LG)).toBe(0);
  });
});
