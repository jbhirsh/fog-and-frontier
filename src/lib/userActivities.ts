import { useEffect, useMemo, useState } from 'react';
import type { Activity } from '../data/types';
import { activities as STATIC_ACTIVITIES } from '../data/activities';
import { authedFetch } from './authedFetch';

const STORAGE_KEY = 'fogandfrontier.activities.v1';
const EVENT = 'fogandfrontier:activities-changed';

type Store = Record<string, Activity>;

const STATIC_IDS = new Set(STATIC_ACTIVITIES.map((a) => a.id));

// Curated activities ship in src/data/activities.ts and are only editable by
// changing source. Anything not in that seed list was added through the app
// and can be edited through the UI (issue #49). Delete is unrestricted —
// see ActivityDetail — but Edit is gated on this so we don't accidentally
// surface an in-place editor for entries whose canonical copy lives in code.
export function isUserActivity(id: string): boolean {
  return !STATIC_IDS.has(id);
}

function readLocal(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function writeLocal(store: Store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(EVENT));
}

let pulled = false;
async function pullRemote() {
  if (pulled) return;
  pulled = true;
  try {
    const res = await fetch('/api/activities');
    if (!res.ok) return;
    const remote = (await res.json()) as Store;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* offline — keep local cache */
  }
}

export async function saveUserActivity(
  activity: Activity,
  token: string | null,
): Promise<void> {
  const store = readLocal();
  store[activity.id] = activity;
  writeLocal(store);
  try {
    await authedFetch(
      '/api/activities',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: activity.id, activity }),
      },
      token,
    );
  } catch {
    /* queued in local cache; will retry on next save */
  }
}

export async function deleteUserActivity(
  id: string,
  token: string | null,
): Promise<void> {
  const store = readLocal();
  delete store[id];
  writeLocal(store);
  try {
    await authedFetch(
      `/api/activities?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      token,
    );
  } catch {
    /* offline */
  }
}

export function useUserActivities(): Activity[] {
  const [store, setStore] = useState<Store>(() => readLocal());

  useEffect(() => {
    const sync = () => setStore(readLocal());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    void pullRemote();
  }, []);

  return useMemo(() => Object.values(store), [store]);
}

export function useAllActivities(): Activity[] {
  return useUserActivities();
}
