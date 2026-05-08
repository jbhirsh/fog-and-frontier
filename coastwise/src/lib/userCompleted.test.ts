import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { isEffectivelyCompleted, useCompleted } from './userCompleted';
import { completedHike, muirWoods } from '../test/fixtures';

const STORAGE_KEY = 'fogandfrontier.completed.v1';

describe('userCompleted', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isEffectivelyCompleted falls back to baseline when no override', () => {
    expect(isEffectivelyCompleted(muirWoods, {})).toBe(false);
    expect(isEffectivelyCompleted(completedHike, {})).toBe(true);
  });

  it('override beats baseline in either direction', () => {
    expect(isEffectivelyCompleted(muirWoods, { [muirWoods.id]: true })).toBe(true);
    expect(
      isEffectivelyCompleted(completedHike, { [completedHike.id]: false }),
    ).toBe(false);
  });

  it('toggle on a non-completed activity stores override and posts', () => {
    const { result } = renderHook(() => useCompleted(muirWoods));
    expect(result.current.completed).toBe(false);

    act(() => result.current.toggle());
    expect(result.current.completed).toBe(true);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored[muirWoods.id]).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/completed',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('toggle back to baseline removes the override (saves storage)', () => {
    const { result } = renderHook(() => useCompleted(muirWoods));
    act(() => result.current.toggle());
    act(() => result.current.toggle());

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored[muirWoods.id]).toBeUndefined();
  });

  it('can unmark a baseline-completed activity', () => {
    const { result } = renderHook(() => useCompleted(completedHike));
    expect(result.current.completed).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.completed).toBe(false);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored[completedHike.id]).toBe(false);
  });
});
