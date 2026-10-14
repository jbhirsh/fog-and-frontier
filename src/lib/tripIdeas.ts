import { apolloClient } from './apolloClient';
import { SUGGEST_TRIP_ACTIVITIES } from './gqlDocs';

// AI trip ideas (#78): catalog activities Gemini picked for a free-form
// request, best first, each with a one-line reason. A paid, owner-only call.
export type TripIdea = {
  activityId: string;
  reason: string;
  name: string;
  category: string;
  city: string;
};

export async function suggestTripActivities(
  prompt: string,
  excludeActivityIds: readonly string[],
): Promise<TripIdea[]> {
  const { data } = await apolloClient.mutate({
    mutation: SUGGEST_TRIP_ACTIVITIES,
    variables: { input: { prompt, excludeActivityIds: [...excludeActivityIds] } },
  });
  return (data?.suggestTripActivities.suggestions ?? []).map((s) => ({
    activityId: s.activityId,
    reason: s.reason,
    name: s.activity.name,
    category: s.activity.category,
    city: s.activity.location.city,
  }));
}

/** A new trip's starting activities: those brought in, then the ideas picked, once each. */
export function startingActivityIds(
  seeded: readonly string[],
  picked: readonly string[],
): string[] {
  return [...new Set([...seeded, ...picked])];
}
