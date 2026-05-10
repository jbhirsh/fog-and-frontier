import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'fogandfrontier.userPhotos.v1';

type PhotoStore = Record<string, string[]>;

function read(): PhotoStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PhotoStore) : {};
  } catch {
    return {};
  }
}

function write(store: PhotoStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent('fogandfrontier:photos-changed'));
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader returned non-string result'));
      }
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

  const addPhotos = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const dataUrls = await Promise.all(list.map(fileToDataUrl));
      const store = read();
      store[activityId] = [...(store[activityId] ?? []), ...dataUrls];
      write(store);
    },
    [activityId],
  );

  const removePhoto = useCallback(
    (index: number) => {
      const store = read();
      const next = [...(store[activityId] ?? [])];
      next.splice(index, 1);
      store[activityId] = next;
      write(store);
    },
    [activityId],
  );

  return { photos, addPhotos, removePhoto };
}
