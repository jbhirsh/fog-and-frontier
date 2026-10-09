import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockedResponse } from '@apollo/client/testing';
import { GraphQLError } from 'graphql';
import {
  ACTIVITY_PHOTOS_QUERY,
  ADD_ACTIVITY_PHOTO,
  PHOTO_UPLOAD,
  REMOVE_ACTIVITY_PHOTO,
} from './gqlDocs';

const { put, toJpeg } = vi.hoisted(() => ({ put: vi.fn(), toJpeg: vi.fn() }));
vi.mock('@vercel/blob/client', () => ({ put }));
vi.mock('./photoResize', () => ({ toJpeg }));

const {
  LEGACY_STORAGE_KEY,
  LOAD_FAILED,
  MAX_PHOTOS_PER_ACTIVITY,
  PHOTO_LIMIT,
  REMOVE_FAILED,
  RECORD_RETRY_MS,
  UPLOAD_FAILED,
  dropLegacyPhotos,
  unreadableMessage,
  useActivityPhotos,
} = await import('./userPhotos');

// A tiny stand-in for the server: the photo list it holds, served by the
// mocks below, so a refetch after a write sees the write.
type Photo = { id: string; activityId: string; url: string; createdAt: string };
let server: Photo[];
let uploads: number;

function photo(id: string, activityId = 'muir'): Photo {
  return { id, activityId, url: `https://blob.test/${id}`, createdAt: '2026-10-01T00:00:00.000Z' };
}

function listMock(activityId = 'muir'): MockedResponse {
  return {
    request: { query: ACTIVITY_PHOTOS_QUERY, variables: { activityId } },
    result: () => ({
      data: {
        activityPhotos: server
          .filter((p) => p.activityId === activityId)
          .map((p) => ({ __typename: 'ActivityPhoto', ...p })),
      },
    }),
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

function uploadMock(): MockedResponse {
  return {
    request: { query: PHOTO_UPLOAD, variables: { input: { activityId: 'muir' } } },
    result: () => {
      uploads += 1;
      return {
        data: {
          photoUpload: {
            __typename: 'PhotoUploadPayload',
            pathname: `photos/muir/p${uploads}.jpg`,
            clientToken: `token-${uploads}`,
          },
        },
      };
    },
    maxUsageCount: Number.POSITIVE_INFINITY,
  };
}

function addMock(n: number): MockedResponse {
  return {
    request: {
      query: ADD_ACTIVITY_PHOTO,
      variables: { input: { activityId: 'muir', pathname: `photos/muir/p${n}.jpg` } },
    },
    result: () => {
      const added = photo(`p${n}`);
      server.push(added);
      return {
        data: {
          addActivityPhoto: {
            __typename: 'AddActivityPhotoPayload',
            photo: { __typename: 'ActivityPhoto', ...added },
          },
        },
      };
    },
  };
}

function removeMock(id: string): MockedResponse {
  return {
    request: { query: REMOVE_ACTIVITY_PHOTO, variables: { input: { id } } },
    result: () => {
      server = server.filter((p) => p.id !== id);
      return {
        data: { removeActivityPhoto: { __typename: 'RemoveActivityPhotoPayload', removedId: id } },
      };
    },
  };
}

function failing(query: MockedResponse['request']['query'], variables: object, appCode?: string) {
  return {
    request: { query, variables },
    result: {
      errors: [
        new GraphQLError('nope', {
          extensions: appCode ? { code: 'CONFLICT', appCode } : { code: 'INTERNAL' },
        }),
      ],
    },
  } satisfies MockedResponse;
}

function wrapperWith(mocks: MockedResponse[]) {
  return ({ children }: { children: ReactNode }) => (
    <MockedProvider mocks={mocks}>{children}</MockedProvider>
  );
}

function file(name: string) {
  return new File(['x'], name, { type: 'image/heic' });
}

beforeEach(() => {
  server = [];
  uploads = 0;
  toJpeg.mockImplementation((f: File) =>
    Promise.resolve(new Blob([f.name], { type: 'image/jpeg' })),
  );
  put.mockResolvedValue({ pathname: 'whatever' });
});

afterEach(() => {
  put.mockReset();
  toJpeg.mockReset();
});

describe('useActivityPhotos', () => {
  it('lists an owner’s photos for the activity', async () => {
    server = [photo('a'), photo('b'), photo('c', 'tam')];
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock()]),
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.uploading).toBe(false);
    expect(result.current.saveError).toBeNull();
    expect(result.current.loadError).toBeNull();
    await waitFor(() => expect(result.current.photos.map((p) => p.id)).toEqual(['a', 'b']));
    expect(result.current.loading).toBe(false);
    expect(result.current.photos[0].url).toBe('https://blob.test/a');
  });

  it('asks for nothing unless enabled', async () => {
    const list = { ...listMock(), result: vi.fn(listMock().result as () => object) };
    const { result } = renderHook(() => useActivityPhotos('muir', false), {
      wrapper: wrapperWith([list]),
    });
    expect(result.current.loading).toBe(false);
    await act(() => Promise.resolve());
    expect(list.result).not.toHaveBeenCalled();
    expect(result.current.photos).toEqual([]);
  });

  it('says when the photos can’t be loaded', async () => {
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([failing(ACTIVITY_PHOTOS_QUERY, { activityId: 'muir' })]),
    });
    await waitFor(() => expect(result.current.loadError).toBe(LOAD_FAILED));
    expect(result.current.saveError).toBeNull();
  });

  it('downscales, uploads straight to Blob, records each photo, then refreshes', async () => {
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), uploadMock(), addMock(1), addMock(2)]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.addPhotos([file('one.heic'), file('two.heic')]);
    });
    expect(result.current.uploading).toBe(true);
    await act(() => pending);

    expect(toJpeg).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenNthCalledWith(1, 'photos/muir/p1.jpg', expect.any(Blob), {
      access: 'private',
      token: 'token-1',
      contentType: 'image/jpeg',
    });
    expect(await (put.mock.calls[1][1] as Blob).text()).toBe('two.heic');
    expect(put.mock.calls[1][2]).toMatchObject({ token: 'token-2' });
    expect(result.current.uploading).toBe(false);
    expect(result.current.saveError).toBeNull();
    await waitFor(() => expect(result.current.photos.map((p) => p.id)).toEqual(['p1', 'p2']));
  });

  it('uploads only as many as fit under the cap, and says so', async () => {
    server = Array.from({ length: MAX_PHOTOS_PER_ACTIVITY - 1 }, (_, i) => photo(`old${i}`));
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), uploadMock(), addMock(1)]),
    });
    await waitFor(() => expect(result.current.photos).toHaveLength(MAX_PHOTOS_PER_ACTIVITY - 1));
    await act(() => result.current.addPhotos([file('a.heic'), file('b.heic')]));
    expect(put).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).toBe(PHOTO_LIMIT);
    await waitFor(() => expect(result.current.photos).toHaveLength(MAX_PHOTOS_PER_ACTIVITY));
  });

  it('reports the server’s cap the same way', async () => {
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([
        listMock(),
        failing(PHOTO_UPLOAD, { input: { activityId: 'muir' } }, 'photo_limit'),
      ]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.addPhotos([file('a.heic')]));
    expect(result.current.saveError).toBe(PHOTO_LIMIT);
    expect(put).not.toHaveBeenCalled();
  });

  it('stops and says so when an upload fails, and the message can be dismissed', async () => {
    put.mockRejectedValueOnce(new Error('blob down'));
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), uploadMock()]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.addPhotos([file('a.heic'), file('b.heic')]));
    expect(put).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).toBe(UPLOAD_FAILED);
    expect(result.current.uploading).toBe(false);
    act(() => result.current.clearSaveError());
    expect(result.current.saveError).toBeNull();
  });

  it('skips a file the browser can’t read, uploads the rest, and says so', async () => {
    toJpeg.mockRejectedValueOnce(new Error('not an image'));
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), uploadMock(), addMock(1)]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.addPhotos([file('a.heic'), file('b.jpg')]));
    expect(put).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).toBe(unreadableMessage(1));
    await waitFor(() => expect(result.current.photos.map((p) => p.id)).toEqual(['p1']));
  });

  it('words the unreadable message for one file or several', () => {
    expect(unreadableMessage(1)).toBe(
      "One file isn't a photo this browser can read, so it wasn't added. Try a JPEG or PNG.",
    );
    expect(unreadableMessage(3)).toBe(
      "3 files aren't photos this browser can read, so they weren't added. Try JPEGs or PNGs.",
    );
  });

  it('retries recording an uploaded photo through a blip, without uploading again', async () => {
    expect(RECORD_RETRY_MS).toEqual([300, 1200]);
    const blip = failing(ADD_ACTIVITY_PHOTO, {
      input: { activityId: 'muir', pathname: 'photos/muir/p1.jpg' },
    });
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), uploadMock(), blip, addMock(1)]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.addPhotos([file('a.heic')]));
    expect(put).toHaveBeenCalledTimes(1);
    expect(result.current.saveError).toBeNull();
    await waitFor(() => expect(result.current.photos.map((p) => p.id)).toEqual(['p1']));
  });

  it('gives up recording after the retries', async () => {
    const blip = () =>
      failing(ADD_ACTIVITY_PHOTO, {
        input: { activityId: 'muir', pathname: 'photos/muir/p1.jpg' },
      });
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), uploadMock(), blip(), blip(), blip(), addMock(1)]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.addPhotos([file('a.heic')]));
    expect(result.current.saveError).toBe(UPLOAD_FAILED);
    expect(result.current.photos).toEqual([]);
  }, 10_000);

  it('doesn’t retry a refusal', async () => {
    const full = failing(
      ADD_ACTIVITY_PHOTO,
      { input: { activityId: 'muir', pathname: 'photos/muir/p1.jpg' } },
      'photo_limit',
    );
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), uploadMock(), full, addMock(1)]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const started = Date.now();
    await act(() => result.current.addPhotos([file('a.heic')]));
    expect(Date.now() - started).toBeLessThan(RECORD_RETRY_MS[0]);
    expect(result.current.saveError).toBe(PHOTO_LIMIT);
    expect(result.current.photos).toEqual([]);
  });

  it('shows the upload as under way only on its own activity', async () => {
    let release!: () => void;
    put.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({}))));
    const { result, rerender } = renderHook(({ id }) => useActivityPhotos(id, true), {
      initialProps: { id: 'muir' },
      wrapper: wrapperWith([listMock(), listMock('tam'), uploadMock(), addMock(1)]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.addPhotos([file('a.heic')]);
    });
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(result.current.uploading).toBe(true);
    rerender({ id: 'tam' });
    expect(result.current.uploading).toBe(false);
    rerender({ id: 'muir' });
    expect(result.current.uploading).toBe(true);
    release();
    await act(() => pending);
    expect(result.current.uploading).toBe(false);
  });

  it('doesn’t throw when the refresh after a write fails', async () => {
    const list = listMock();
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([
        { ...list, maxUsageCount: 1 },
        failing(ACTIVITY_PHOTOS_QUERY, { activityId: 'muir' }),
        uploadMock(),
        addMock(1),
      ]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => expect(result.current.addPhotos([file('a.heic')])).resolves.toBeUndefined());
    await waitFor(() => expect(result.current.loadError).toBe(LOAD_FAILED));
  });

  it('removes a photo and refreshes', async () => {
    server = [photo('a'), photo('b')];
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), removeMock('a')]),
    });
    await waitFor(() => expect(result.current.photos).toHaveLength(2));
    await act(() => result.current.removePhoto('a'));
    await waitFor(() => expect(result.current.photos.map((p) => p.id)).toEqual(['b']));
    expect(result.current.saveError).toBeNull();
  });

  it('clears an earlier failure once a removal goes through', async () => {
    server = [photo('a')];
    put.mockRejectedValueOnce(new Error('blob down'));
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), uploadMock(), removeMock('a')]),
    });
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    await act(() => result.current.addPhotos([file('b.heic')]));
    expect(result.current.saveError).toBe(UPLOAD_FAILED);
    await act(() => result.current.removePhoto('a'));
    expect(result.current.saveError).toBeNull();
  });

  it('takes a photo already gone as removed', async () => {
    server = [photo('a')];
    const gone = {
      request: { query: REMOVE_ACTIVITY_PHOTO, variables: { input: { id: 'a' } } },
      result: { errors: [new GraphQLError('photo not found', { extensions: { code: 'NOT_FOUND' } })] },
    } satisfies MockedResponse;
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), gone]),
    });
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    await act(() => result.current.removePhoto('a'));
    expect(result.current.saveError).toBeNull();
  });

  it('says so when a photo can’t be removed', async () => {
    server = [photo('a')];
    const { result } = renderHook(() => useActivityPhotos('muir', true), {
      wrapper: wrapperWith([listMock(), failing(REMOVE_ACTIVITY_PHOTO, { input: { id: 'a' } })]),
    });
    await waitFor(() => expect(result.current.photos).toHaveLength(1));
    await act(() => result.current.removePhoto('a'));
    expect(result.current.saveError).toBe(REMOVE_FAILED);
    expect(result.current.photos).toHaveLength(1);
  });

  it('keeps one activity’s error off the next one', async () => {
    put.mockRejectedValueOnce(new Error('blob down'));
    const { result, rerender } = renderHook(({ id }) => useActivityPhotos(id, true), {
      initialProps: { id: 'muir' },
      wrapper: wrapperWith([listMock(), listMock('tam'), uploadMock()]),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(() => result.current.addPhotos([file('a.heic')]));
    expect(result.current.saveError).toBe(UPLOAD_FAILED);
    rerender({ id: 'tam' });
    expect(result.current.saveError).toBeNull();
  });
});

describe('dropLegacyPhotos', () => {
  it('frees the old per-device photo store', () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, '{"muir":["data:image/png;base64,AA"]}');
    localStorage.setItem('other', 'kept');
    dropLegacyPhotos();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('other')).toBe('kept');
    expect(LEGACY_STORAGE_KEY).toBe('fogandfrontier.userPhotos.v1');
  });

  it('shrugs off blocked storage', () => {
    const blocked = {
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => dropLegacyPhotos(blocked)).not.toThrow();
  });
});
