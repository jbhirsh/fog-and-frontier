import { authorLabel } from './activityReviews';

// Who added an activity (#9), as the cards and detail show it: the first two
// names, then a count of the rest ("Tarun, Jessica +1"). Null when there is
// no one to credit, which is always the case for a signed-out visitor (the
// server doesn't send them the list).
export function contributorsLabel(emails: readonly string[] | undefined): string | null {
  if (!emails || emails.length === 0) return null;
  const names = emails.slice(0, 2).map(authorLabel).join(', ');
  return emails.length > 2 ? `${names} +${emails.length - 2}` : names;
}
