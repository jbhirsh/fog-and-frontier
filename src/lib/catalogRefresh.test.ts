import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { renderHook } from '@testing-library/react';
import { apolloClient } from './apolloClient';
import { CATALOG_STALE_MS, useCatalogRefresh } from './catalogRefresh';
import { ACTIVITIES_QUERY, COMPLETED_QUERY } from './gqlDocs';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

let refetch: MockInstance<typeof apolloClient.refetchQueries>;

beforeEach(() => {
  vi.useFakeTimers();
  refetch = vi.spyOn(apolloClient, 'refetchQueries').mockResolvedValue([]);
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useCatalogRefresh', () => {
  it('refetches the catalog and completions on coming back once they are stale', () => {
    renderHook(() => useCatalogRefresh());
    setHidden(true);
    vi.advanceTimersByTime(CATALOG_STALE_MS);
    setHidden(false);
    expect(refetch).toHaveBeenCalledOnce();
    expect(refetch).toHaveBeenCalledWith({ include: [ACTIVITIES_QUERY, COMPLETED_QUERY] });
  });

  it('leaves them be on coming back sooner', () => {
    renderHook(() => useCatalogRefresh());
    setHidden(true);
    vi.advanceTimersByTime(CATALOG_STALE_MS - 1);
    setHidden(false);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('does nothing as the app goes to the background', () => {
    renderHook(() => useCatalogRefresh());
    vi.advanceTimersByTime(CATALOG_STALE_MS);
    setHidden(true);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('counts staleness from the last refetch', () => {
    renderHook(() => useCatalogRefresh());
    vi.advanceTimersByTime(CATALOG_STALE_MS);
    setHidden(true);
    setHidden(false);
    setHidden(true);
    vi.advanceTimersByTime(CATALOG_STALE_MS - 1);
    setHidden(false);
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('stops listening once unmounted', () => {
    const { unmount } = renderHook(() => useCatalogRefresh());
    unmount();
    vi.advanceTimersByTime(CATALOG_STALE_MS);
    setHidden(true);
    setHidden(false);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('swallows a failed refetch: the cached catalog stays', async () => {
    refetch.mockRejectedValue(new Error('offline'));
    renderHook(() => useCatalogRefresh());
    vi.advanceTimersByTime(CATALOG_STALE_MS);
    setHidden(true);
    setHidden(false);
    await vi.runAllTimersAsync();
    expect(refetch).toHaveBeenCalledOnce();
  });
});
