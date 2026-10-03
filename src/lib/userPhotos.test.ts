import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { fileToDataUrl, useUserPhotos } from './userPhotos';

const KEY = 'fogandfrontier.userPhotos.v1';

function makeFile(name: string, body = 'hello'): File {
  return new File([body], name, { type: 'image/png' });
}

describe('fileToDataUrl', () => {
  it('reads a file as a data URL', async () => {
    const url = await fileToDataUrl(makeFile('a.png'));
    expect(url.startsWith('data:image/png')).toBe(true);
  });
});

describe('useUserPhotos', () => {
  it('starts empty for an unknown id', () => {
    const { result } = renderHook(() => useUserPhotos('a'));
    expect(result.current.photos).toEqual([]);
  });

  it('adds photos and persists them across hook instances', async () => {
    const { result } = renderHook(() => useUserPhotos('a'));
    await act(async () => {
      await result.current.addPhotos([makeFile('1.png'), makeFile('2.png')]);
    });
    expect(result.current.photos).toHaveLength(2);

    const second = renderHook(() => useUserPhotos('a'));
    expect(second.result.current.photos).toHaveLength(2);
  });

  it('keeps photos per activity id isolated', async () => {
    const a = renderHook(() => useUserPhotos('a'));
    const b = renderHook(() => useUserPhotos('b'));
    await act(async () => {
      await a.result.current.addPhotos([makeFile('a.png')]);
    });
    expect(a.result.current.photos).toHaveLength(1);
    expect(b.result.current.photos).toHaveLength(0);
  });

  it('removes a photo by index', async () => {
    const { result } = renderHook(() => useUserPhotos('a'));
    await act(async () => {
      await result.current.addPhotos([makeFile('1.png'), makeFile('2.png')]);
    });
    act(() => {
      result.current.removePhoto(0);
    });
    expect(result.current.photos).toHaveLength(1);
  });

  it('shows the new activity\'s photos as soon as the id changes', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: ['data:a'], b: ['data:b'] }));
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useUserPhotos(id),
      { initialProps: { id: 'a' } },
    );
    expect(result.current.photos).toEqual(['data:a']);

    rerender({ id: 'b' });
    expect(result.current.photos).toEqual(['data:b']);

    rerender({ id: 'c' });
    expect(result.current.photos).toEqual([]);
  });

  it('tolerates corrupted localStorage', () => {
    localStorage.setItem('fogandfrontier.userPhotos.v1', '{not json');
    const { result } = renderHook(() => useUserPhotos('a'));
    expect(result.current.photos).toEqual([]);
  });

  describe('malformed stored data', () => {
    it.each([
      ['null', 'null'],
      ['an array', '[1,2]'],
      ['a string', '"photos"'],
    ])('treats a stored %s as no photos', (_label, raw) => {
      localStorage.setItem(KEY, raw);
      const { result } = renderHook(() => useUserPhotos('a'));
      expect(result.current.photos).toEqual([]);
    });

    it('drops an entry that is not a list and keeps only string photos', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ a: 'data:x', b: ['data:1', 2, null, 'data:2'] }),
      );
      const a = renderHook(() => useUserPhotos('a'));
      const b = renderHook(() => useUserPhotos('b'));
      expect(a.result.current.photos).toEqual([]);
      expect(b.result.current.photos).toEqual(['data:1', 'data:2']);
    });

    it('adds a photo on top of a malformed entry without crashing', async () => {
      localStorage.setItem(KEY, JSON.stringify({ a: { not: 'a list' } }));
      const { result } = renderHook(() => useUserPhotos('a'));
      await act(async () => {
        await result.current.addPhotos([makeFile('1.png')]);
      });
      expect(result.current.photos).toHaveLength(1);
      expect(result.current.saveError).toBeNull();
    });
  });

  describe('failed writes', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function failWrites() {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    }

    it('reports a photo that could not be saved instead of rejecting', async () => {
      failWrites();
      const { result } = renderHook(() => useUserPhotos('a'));
      await act(async () => {
        await expect(
          result.current.addPhotos([makeFile('1.png')]),
        ).resolves.toBeUndefined();
      });
      expect(result.current.photos).toEqual([]);
      expect(result.current.saveError).toMatch(/couldn.t save/i);

      act(() => result.current.clearSaveError());
      expect(result.current.saveError).toBeNull();
    });

    it('reports a photo that could not be removed', async () => {
      const { result } = renderHook(() => useUserPhotos('a'));
      await act(async () => {
        await result.current.addPhotos([makeFile('1.png')]);
      });
      failWrites();
      act(() => result.current.removePhoto(0));
      expect(result.current.photos).toHaveLength(1);
      expect(result.current.saveError).toMatch(/couldn.t remove/i);
    });

    it('clears the error when the hook switches to another activity', async () => {
      failWrites();
      const { result, rerender } = renderHook(
        ({ id }: { id: string }) => useUserPhotos(id),
        { initialProps: { id: 'a' } },
      );
      await act(async () => {
        await result.current.addPhotos([makeFile('1.png')]);
      });
      expect(result.current.saveError).not.toBeNull();

      rerender({ id: 'b' });
      expect(result.current.saveError).toBeNull();
    });

    it('ignores a failure for an activity that is no longer showing', async () => {
      failWrites();
      const { result, rerender } = renderHook(
        ({ id }: { id: string }) => useUserPhotos(id),
        { initialProps: { id: 'a' } },
      );
      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.addPhotos([makeFile('1.png')]);
      });
      rerender({ id: 'b' });
      await act(async () => {
        await pending;
      });
      expect(result.current.saveError).toBeNull();

      rerender({ id: 'a' });
      expect(result.current.saveError).toBeNull();
    });

    it('a successful save clears an earlier error', async () => {
      failWrites();
      const { result } = renderHook(() => useUserPhotos('a'));
      await act(async () => {
        await result.current.addPhotos([makeFile('1.png')]);
      });
      expect(result.current.saveError).not.toBeNull();
      vi.restoreAllMocks();
      await act(async () => {
        await result.current.addPhotos([makeFile('1.png')]);
      });
      expect(result.current.saveError).toBeNull();
      expect(result.current.photos).toHaveLength(1);
    });
  });
});
