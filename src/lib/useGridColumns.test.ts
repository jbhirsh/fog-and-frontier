import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { columnsOf, rowEnd, useGridColumns } from './useGridColumns';

describe('columnsOf', () => {
  it('counts the tracks a grid lays out', () => {
    expect(columnsOf('300px 300px 300px')).toBe(3);
    expect(columnsOf('  412.5px   412.5px ')).toBe(2);
    expect(columnsOf('980px')).toBe(1);
  });

  it('is one for a grid with nothing to count', () => {
    expect(columnsOf('')).toBe(1);
    expect(columnsOf('   ')).toBe(1);
  });
});

describe('rowEnd', () => {
  it('ends the row the card is in', () => {
    expect(rowEnd(0, 3, 12)).toBe(2);
    expect(rowEnd(2, 3, 12)).toBe(2);
    expect(rowEnd(4, 3, 12)).toBe(5);
    expect(rowEnd(4, 1, 12)).toBe(4);
    expect(rowEnd(5, 2, 12)).toBe(5);
  });

  it('stops at the last card shown in a row that isn’t full', () => {
    expect(rowEnd(6, 3, 8)).toBe(7);
    expect(rowEnd(7, 3, 8)).toBe(7);
  });
});

describe('useGridColumns', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A grid element laying out `template`; its style spy, to change that. */
  function grid(template: string) {
    const el = document.createElement('div');
    const style = vi
      .spyOn(window, 'getComputedStyle')
      .mockImplementation(() => ({ gridTemplateColumns: template }) as CSSStyleDeclaration);
    return { el, style };
  }

  it('is one until the grid is measured', () => {
    const { result } = renderHook(() => useGridColumns<HTMLDivElement>());
    expect(result.current[1]).toBe(1);
  });

  it('measures the grid, and again when it resizes', () => {
    let resized: (() => void) | undefined;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          resized = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { el, style } = grid('300px 300px 300px');
    const { result, unmount } = renderHook(() => useGridColumns<HTMLDivElement>());
    act(() => result.current[0](el));
    expect(result.current[1]).toBe(3);
    expect(observe).toHaveBeenCalledWith(el);
    style.mockImplementation(() => ({ gridTemplateColumns: '400px 400px' }) as CSSStyleDeclaration);
    act(() => resized?.());
    expect(result.current[1]).toBe(2);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it('measures once where nothing reports resizes', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { el } = grid('200px 200px');
    const { result } = renderHook(() => useGridColumns<HTMLDivElement>());
    act(() => result.current[0](el));
    expect(result.current[1]).toBe(2);
  });
});
