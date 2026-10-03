import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'fogandfrontier.userPhotos.v1';

type PhotoStore = Record<string, string[]>;

// Stored data is checked once, here: it's the browser's to keep, so it can be
// anything an older build (or a hand edit) left behind. Anything that isn't an
// object of string lists reads as no photos, and a non-string photo is dropped.
function read(): PhotoStore {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const store: PhotoStore = {};
  for (const [id, photos] of Object.entries(parsed)) {
    if (!Array.isArray(photos)) continue;
    store[id] = photos.filter((p): p is string => typeof p === 'string');
  }
  return store;
}

// Photos are data URLs, so the storage quota is easy to hit. Report a failed
// write instead of throwing, so the caller can tell the user.
function write(store: PhotoStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent('fogandfrontier:photos-changed'));
  return true;
}

const SAVE_FAILED =
  "Couldn't save that photo. Your browser's storage may be full.";
const REMOVE_FAILED = "Couldn't remove that photo. Try again.";

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === 'string') resolve(r);
      else reject(new Error('FileReader returned non-string result'));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

export function useUserPhotos(activityId: string) {
  const [photos, setPhotos] = useState<string[]>(() => read()[activityId] ?? []);

  useEffect(() => {
    const sync = () => setPhotos(read()[activityId] ?? []);
    window.addEventListener('fogandfrontier:photos-changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('fogandfrontier:photos-changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, [activityId]);

  // The error is tagged with the activity it belongs to, so a late failure
  // for the previous activity never shows on the next one.
  const [error, setError] = useState<{ id: string; message: string } | null>(
    null,
  );

  // ActivityDetail switches activities in place, so when the id changes the
  // new activity's photos load right away (the listeners above only fire on
  // a later write) and any error banner is dropped rather than carried over.
  const [scope, setScope] = useState(activityId);
  if (scope !== activityId) {
    setScope(activityId);
    setPhotos(read()[activityId] ?? []);
    setError(null);
  }
  const saveError = error?.id === activityId ? error.message : null;
  const setSaveError = useCallback(
    (message: string | null) =>
      setError((prev) =>
        message
          ? { id: activityId, message }
          : prev?.id === activityId
            ? null
            : prev,
      ),
    [activityId],
  );
  const clearSaveError = useCallback(() => setError(null), []);

  const addPhotos = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      let dataUrls: string[];
      try {
        dataUrls = await Promise.all(list.map(fileToDataUrl));
      } catch {
        setSaveError(SAVE_FAILED);
        return;
      }
      const store = read();
      store[activityId] = [...(store[activityId] ?? []), ...dataUrls];
      setSaveError(write(store) ? null : SAVE_FAILED);
    },
    [activityId, setSaveError],
  );

  const removePhoto = useCallback(
    (index: number) => {
      const store = read();
      const next = [...(store[activityId] ?? [])];
      next.splice(index, 1);
      store[activityId] = next;
      setSaveError(write(store) ? null : REMOVE_FAILED);
    },
    [activityId, setSaveError],
  );

  return { photos, addPhotos, removePhoto, saveError, clearSaveError };
}
