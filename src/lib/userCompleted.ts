import { useCallback, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import type { Activity } from '../data/types';
import { apolloClient } from './apolloClient';
import { COMPLETED_QUERY, SET_COMPLETED } from './gqlDocs';

// id -> completed override. An entry overrides the activity's baseline
// `completed` flag; absence falls back to the baseline.
export type Overrides = Record<string, boolean>;

export function isEffectivelyCompleted(
  activity: Activity,
  overrides: Overrides,
): boolean {
  return overrides[activity.id] ?? !!activity.completed;
}

// Upsert/remove a single completed entry in the normalized COMPLETED_QUERY
// result. `completed === null` clears the override (removes the row).
function writeCompletedEntry(
  cache: typeof apolloClient.cache,
  id: string,
  completed: boolean | null | undefined,
): void {
  const existing = cache.readQuery({ query: COMPLETED_QUERY })?.completed ?? [];
  const filtered = existing.filter((e) => e.id !== id);
  const next =
    completed === null || completed === undefined
      ? filtered
      : [...filtered, { __typename: 'CompletedEntry' as const, id, completed }];
  cache.writeQuery({ query: COMPLETED_QUERY, data: { completed: next } });
}

export async function setCompleted(
  id: string,
  value: boolean | null,
): Promise<void> {
  await apolloClient.mutate({
    mutation: SET_COMPLETED,
    variables: { input: { id, value } },
    optimisticResponse: {
      setCompleted: { __typename: 'SetCompletedPayload', id, completed: value },
    },
    update(cache, { data }) {
      const result = data?.setCompleted;
      if (!result) return;
      writeCompletedEntry(cache, result.id, result.completed);
    },
  });
}

// Mirror the server-side completion write-through (after transitionTrip to=past)
// into the local cache so badges on Curated / Map / Adventures update without a
// refresh. Replaces the old localStorage mirror. Unchecked-but-eligible
// activities get false to override stale baselines.
export function applyCompletionMirror(
  completed: string[],
  uncompleted: string[] = [],
): void {
  if (completed.length === 0 && uncompleted.length === 0) return;
  const cache = apolloClient.cache;
  const existing = cache.readQuery({ query: COMPLETED_QUERY })?.completed ?? [];
  const map = new Map<string, boolean>(existing.map((e) => [e.id, e.completed]));
  for (const id of completed) map.set(id, true);
  for (const id of uncompleted) map.set(id, false);
  cache.writeQuery({
    query: COMPLETED_QUERY,
    data: {
      completed: [...map].map(([id, c]) => ({
        __typename: 'CompletedEntry' as const,
        id,
        completed: c,
      })),
    },
  });
  // Also reflect onto the normalized Activity.completed baseline (N5).
  const setActivityCompleted = (id: string, c: boolean) =>
    cache.modify({
      id: cache.identify({ __typename: 'Activity', id }),
      fields: { completed: () => c },
    });
  for (const id of completed) setActivityCompleted(id, true);
  for (const id of uncompleted) setActivityCompleted(id, false);
}

export function useOverrides(): Overrides {
  const { data } = useQuery(COMPLETED_QUERY, {
    fetchPolicy: 'cache-and-network',
  });
  return useMemo(() => {
    const out: Overrides = {};
    for (const e of data?.completed ?? []) out[e.id] = e.completed;
    return out;
  }, [data]);
}

export function useCompleted(activity: Activity) {
  const overrides = useOverrides();
  const completed = isEffectivelyCompleted(activity, overrides);

  const toggle = useCallback(() => {
    const next = !completed;
    const baseline = !!activity.completed;
    // Back to baseline clears the override; otherwise persist the new value.
    void setCompleted(activity.id, next === baseline ? null : next);
  }, [activity.id, activity.completed, completed]);

  return { completed, toggle };
}
