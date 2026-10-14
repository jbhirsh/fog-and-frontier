import type { Activity } from '../data/types';
import { apolloClient } from './apolloClient';
import { SUGGEST_ACTIVITY } from './gqlDocs';
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
