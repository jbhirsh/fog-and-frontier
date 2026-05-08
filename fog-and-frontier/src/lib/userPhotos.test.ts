import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { fileToDataUrl, useUserPhotos } from './userPhotos';

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

  it('tolerates corrupted localStorage', () => {
    localStorage.setItem('fogandfrontier.userPhotos.v1', '{not json');
    const { result } = renderHook(() => useUserPhotos('a'));
    expect(result.current.photos).toEqual([]);
  });
});
