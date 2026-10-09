import { useCallback, useState } from 'react';
import { useApolloClient, useQuery } from '@apollo/client/react';
import {
  ACTIVITY_PHOTOS_QUERY,
  ADD_ACTIVITY_PHOTO,
  PHOTO_UPLOAD,
  REMOVE_ACTIVITY_PHOTO,
  type ActivityPhotoRow,
} from './gqlDocs';
import { appCodeOf, errorCodeOf } from './gqlError';
import { toJpeg } from './photoResize';

// Owner photos (#19), kept in private Vercel Blob storage so they sync across
// the owners' devices and survive a cleared browser. Owners only, read and
// write: the server gates every call (requireOwnerCtx), and the client asks
// only when the viewer is an owner.
//
// An upload is three steps: ask the server for a pathname and a token that
// can write only there; send the downscaled JPEG straight to Blob with it (so
// the bytes never pass through the API function); then record the photo.

export type ActivityPhoto = ActivityPhotoRow;

/** Mirrors the server's cap (api/_resolvers/photos.ts). */
export const MAX_PHOTOS_PER_ACTIVITY = 20;

export const UPLOAD_FAILED = "Couldn't upload that photo. Try again.";
export const REMOVE_FAILED = "Couldn't remove that photo. Try again.";
export const LOAD_FAILED = "Couldn't load your photos. Try again in a moment.";
export const PHOTO_LIMIT = `An activity can hold up to ${MAX_PHOTOS_PER_ACTIVITY} photos.`;

/** For files the browser can't decode (HEIC outside Safari, say). */
export function unreadableMessage(count: number): string {
  return count === 1
    ? "One file isn't a photo this browser can read, so it wasn't added. Try a JPEG or PNG."
    : `${count} files aren't photos this browser can read, so they weren't added. Try JPEGs or PNGs.`;
}

/** Where the pre-#19 build kept photos, as data URLs, on each device. */
export const LEGACY_STORAGE_KEY = 'fogandfrontier.userPhotos.v1';

/**
 * Frees the space the old per-device photos took. They were never synced, and
 * the owners chose to drop them rather than import them (#19).
 */
export function dropLegacyPhotos(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode, disabled cookies): nothing to free.
  }
}

/**
 * Waits before each retry of recording an uploaded photo. The upload itself
 * has already been paid for, so a blip there is worth riding out rather than
 * sending the photo again.
 */
export const RECORD_RETRY_MS = [300, 1200];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A refusal the server meant (full, gone, bad input), not a blip. */
function isRefusal(err: unknown): boolean {
  const code = errorCodeOf(err);
  return code !== null && code !== 'INTERNAL';
}

/**
 * The photos of one activity. Nothing is fetched unless `enabled` (an owner,
 * with the photos section showing).
 */
export function useActivityPhotos(activityId: string, enabled: boolean) {
  const client = useApolloClient();
  // Signed links expire within the hour, so each open asks afresh rather than
  // reusing links from the cache.
  const { data, error, loading, refetch } = useQuery(ACTIVITY_PHOTOS_QUERY, {
    variables: { activityId },
    skip: !enabled,
    fetchPolicy: 'network-only',
  });
  const photos = data?.activityPhotos ?? [];
  // A failed refresh shows as loadError; it isn't the caller's to handle.
  const refresh = useCallback(() => refetch().then(() => undefined, () => undefined), [refetch]);

  // Both tagged with their activity, so when the detail swaps in place a late
  // failure, or an upload still finishing, for the previous activity never
  // shows on the next one.
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const saveError = failure?.id === activityId ? failure.message : null;
  const clearSaveError = useCallback(() => setFailure(null), []);

  const record = useCallback(
    async (pathname: string) => {
      for (let attempt = 0; ; attempt++) {
        try {
          await client.mutate({
            mutation: ADD_ACTIVITY_PHOTO,
            variables: { input: { activityId, pathname } },
          });
          return;
        } catch (err) {
          if (isRefusal(err) || attempt >= RECORD_RETRY_MS.length) throw err;
          await wait(RECORD_RETRY_MS[attempt]);
        }
      }
    },
    [activityId, client],
  );

  const addPhotos = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const room = Math.max(0, MAX_PHOTOS_PER_ACTIVITY - photos.length);
      const batch = list.slice(0, room);
      let unreadable = 0;
      let message: string | null = null;
      setUploadingFor(activityId);
      try {
        for (const file of batch) {
          let jpeg: Blob;
          try {
            jpeg = await toJpeg(file);
          } catch {
            unreadable += 1;
            continue;
          }
          const { data: target } = await client.mutate({
            mutation: PHOTO_UPLOAD,
            variables: { input: { activityId } },
          });
          if (!target) throw new Error('no upload target');
          const { pathname, clientToken } = target.photoUpload;
          // Loaded on first upload: only owners upload, so visitors never
          // download the Blob client.
          const { put } = await import('@vercel/blob/client');
          await put(pathname, jpeg, {
            access: 'private',
            token: clientToken,
            contentType: 'image/jpeg',
          });
          await record(pathname);
        }
      } catch (err) {
        message = appCodeOf(err) === 'photo_limit' ? PHOTO_LIMIT : UPLOAD_FAILED;
      } finally {
        setUploadingFor(null);
      }
      message ??=
        batch.length < list.length ? PHOTO_LIMIT : unreadable > 0 ? unreadableMessage(unreadable) : null;
      setFailure(message ? { id: activityId, message } : null);
      await refresh();
    },
    [activityId, client, photos.length, record, refresh],
  );

  const removePhoto = useCallback(
    async (id: string) => {
      try {
        await client.mutate({
          mutation: REMOVE_ACTIVITY_PHOTO,
          variables: { input: { id } },
        });
        setFailure(null);
      } catch (err) {
        // Already gone (a second tap): that's what was asked for.
        if (errorCodeOf(err) === 'NOT_FOUND') setFailure(null);
        else setFailure({ id: activityId, message: REMOVE_FAILED });
      }
      await refresh();
    },
    [activityId, client, refresh],
  );

  return {
    photos,
    loading: loading && !data,
    loadError: error ? LOAD_FAILED : null,
    uploading: uploadingFor === activityId,
    addPhotos,
    removePhoto,
    saveError,
    clearSaveError,
  };
}
