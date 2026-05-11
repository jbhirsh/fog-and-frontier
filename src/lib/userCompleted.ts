import { useCallback, useEffect, useState } from 'react';
import type { Activity } from '../data/types';

const STORAGE_KEY = 'fogandfrontier.completed.v1';
const EVENT = 'fogandfrontier:completed-changed';

export type Overrides = Record<string, boolean>;

function readLocal(): Overrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Overrides) : {};
  } catch {
    return {};
  }
}

function writeLocal(store: Overrides) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent(EVENT));
}

let pulled = false;
async function pullRemote() {
  if (pulled) return;
  pulled = true;
  try {
    const res = await fetch('/api/completed');
    if (!res.ok) return;
    const remote = (await res.json()) as Overrides;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* offline — keep local cache */
  }
}

async function pushRemote(id: string, v: boolean | null) {
  try {
    await fetch('/api/completed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, v }),
    });
  } catch {
    /* offline — local cache already updated */
  }
}

export function isEffectivelyCompleted(
  activity: Activity,
  overrides: Overrides,
): boolean {
  return overrides[activity.id] ?? !!activity.completed;
}

export function useOverrides(): Overrides {
  const [overrides, setOverrides] = useState<Overrides>(() => readLocal());

  useEffect(() => {
    const sync = () => setOverrides(readLocal());
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

  return overrides;
}

export function useCompleted(activity: Activity) {
  const overrides = useOverrides();
  const completed = isEffectivelyCompleted(activity, overrides);

  const toggle = useCallback(() => {
    const next = !completed;
    const baseline = !!activity.completed;
    const store = readLocal();
    if (next === baseline) {
      delete store[activity.id];
      writeLocal(store);
      void pushRemote(activity.id, null);
    } else {
      store[activity.id] = next;
      writeLocal(store);
      void pushRemote(activity.id, next);
    }
  }, [activity.id, activity.completed, completed]);

  return { completed, toggle };
}
