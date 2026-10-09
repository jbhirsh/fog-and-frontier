import { useCallback, useState } from 'react';
import { useApolloClient, useQuery } from '@apollo/client/react';
import {
  ACTIVITY_PHOTOS_QUERY,
  ADD_ACTIVITY_PHOTO,
  PHOTO_UPLOAD,
  REMOVE_ACTIVITY_PHOTO,
  type ActivityPhotoRow,
} from './gqlDocs';
import { appCodeOf } from './gqlError';
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

/** The photos of one activity, for an owner; nothing is fetched otherwise. */
export function useActivityPhotos(activityId: string, isOwner: boolean) {
  const client = useApolloClient();
  // Signed links expire within the hour, so each open asks afresh rather than
  // reusing links from the cache.
  const { data, error, loading, refetch } = useQuery(ACTIVITY_PHOTOS_QUERY, {
    variables: { activityId },
    skip: !isOwner,
    fetchPolicy: 'network-only',
  });
  const photos = data?.activityPhotos ?? [];

  // Tagged with its activity, so a late failure for the previous activity
  // never shows on the next one when the detail swaps in place.
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const saveError = failure?.id === activityId ? failure.message : null;
  const clearSaveError = useCallback(() => setFailure(null), []);

  const addPhotos = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const room = Math.max(0, MAX_PHOTOS_PER_ACTIVITY - photos.length);
      const batch = list.slice(0, room);
      let message: string | null = batch.length < list.length ? PHOTO_LIMIT : null;
      setUploading(true);
      try {
        for (const file of batch) {
          const jpeg = await toJpeg(file);
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
          await client.mutate({
            mutation: ADD_ACTIVITY_PHOTO,
            variables: { input: { activityId, pathname } },
          });
        }
      } catch (err) {
        message = appCodeOf(err) === 'photo_limit' ? PHOTO_LIMIT : UPLOAD_FAILED;
      } finally {
        setUploading(false);
      }
      setFailure(message ? { id: activityId, message } : null);
      await refetch();
    },
    [activityId, client, photos.length, refetch],
  );

  const removePhoto = useCallback(
    async (id: string) => {
      try {
        await client.mutate({
          mutation: REMOVE_ACTIVITY_PHOTO,
          variables: { input: { id } },
        });
        setFailure(null);
      } catch {
        setFailure({ id: activityId, message: REMOVE_FAILED });
      }
      await refetch();
    },
    [activityId, client, refetch],
  );

  return {
    photos,
    loading: isOwner && loading && !data,
    loadError: error ? LOAD_FAILED : null,
    uploading,
    addPhotos,
    removePhoto,
    saveError,
    clearSaveError,
  };
}
