import { useQuery } from '@apollo/client/react';
import type { Activity } from '../data/types';
import { apolloClient } from './apolloClient';
import {
  ACCEPT_SUGGESTION,
  ACTIVITIES_QUERY,
  PENDING_SUGGESTIONS,
  REJECT_SUGGESTION,
  SUGGEST_ACTIVITY,
  type PendingSuggestionRow,
} from './gqlDocs';
import { activityToInput } from './userActivities';

// Suggestions (#73): a signed-in non-owner sends an activity for the owners
// to review. It isn't in the catalog until one of them accepts it, so the
// catalog isn't refetched. `allowDuplicate` sends it even when it looks like
// one already saved, once they've said it's different. Returns the
// suggestion's id.
export async function suggestUserActivity(
  activity: Activity,
  { allowDuplicate = false }: { allowDuplicate?: boolean } = {},
): Promise<string> {
  const { data } = await apolloClient.mutate({
    mutation: SUGGEST_ACTIVITY,
    variables: {
      input: {
        activity: {
          ...activityToInput(activity),
          completed: null,
          completedDate: null,
          contributors: null,
        },
        ...(allowDuplicate ? { allowDuplicate: true } : {}),
      },
    },
  });
  if (!data) throw new Error('Failed to send the suggestion');
  return data.suggestActivity.suggestion.id;
}

export type PendingSuggestion = PendingSuggestionRow;

// The owners' review queue (#73), newest first. Only asked for when `enabled`
// (an owner): for anyone else the server refuses it, so there's nothing to
// show.
export function usePendingSuggestions(enabled: boolean): PendingSuggestion[] {
  const { data } = useQuery(PENDING_SUGGESTIONS, {
    skip: !enabled,
    fetchPolicy: 'cache-and-network',
  });
  return enabled ? (data?.pendingSuggestions ?? []) : [];
}

// Accepting adds it to the catalog, so both lists refetch; road miles too
// (#66), for the new pin. Returns the catalog id it was saved under.
// `allowDuplicate` accepts it even when it looks like one already saved.
export async function acceptSuggestion(
  id: string,
  { allowDuplicate = false }: { allowDuplicate?: boolean } = {},
): Promise<string> {
  const { data } = await apolloClient.mutate({
    mutation: ACCEPT_SUGGESTION,
    variables: { id, ...(allowDuplicate ? { allowDuplicate: true } : {}) },
    refetchQueries: [{ query: ACTIVITIES_QUERY }, { query: PENDING_SUGGESTIONS }, 'DrivingMiles'],
    awaitRefetchQueries: true,
  });
  if (!data) throw new Error('Failed to accept the suggestion');
  return data.acceptSuggestion.activity.id;
}

export async function rejectSuggestion(id: string): Promise<void> {
  await apolloClient.mutate({
    mutation: REJECT_SUGGESTION,
    variables: { id },
    refetchQueries: [{ query: PENDING_SUGGESTIONS }],
    awaitRefetchQueries: true,
  });
}

// After someone else decided a suggestion (another owner, another tab): the
// queue, and the catalog it may have joined, are out of date.
export async function refreshSuggestions(): Promise<void> {
  await apolloClient.refetchQueries({ include: [PENDING_SUGGESTIONS, ACTIVITIES_QUERY] });
}
