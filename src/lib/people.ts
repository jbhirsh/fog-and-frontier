import { createContext, useContext } from 'react';
import { authorLabel } from './activityReviews';

// People by their first name ("Tarun", "Jessica"), as their account gives
// it: the server keeps each account's first name in its `users` row. Anyone
// it has none for (not signed in since, or no name on the account) is named
// from their email, as before ("Tarunkhubchandani").

/**
 * Each email (lowercased) to its first name, from the users list. Two
 * accounts that share a first name keep their email names, so they can still
 * be told apart.
 */
export function namesByEmail(
  users: readonly { email: string; displayName?: string | null }[],
): ReadonlyMap<string, string> {
  const named = users.flatMap(({ email, displayName }) => {
    const name = displayName?.trim();
    return name ? [{ email: email.trim().toLowerCase(), name }] : [];
  });
  const counts = new Map<string, number>();
  for (const { name } of named) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Map(named.filter(({ name }) => counts.get(name) === 1).map((p) => [p.email, p.name]));
}

/** A person's first name if known, else the name their email gives. */
export function personLabel(email: string, names: ReadonlyMap<string, string>): string {
  return names.get(email.trim().toLowerCase()) ?? authorLabel(email);
}

/** Names people; with no provider above, by their email alone. */
export const PersonLabelCtx = createContext<(email: string) => string>(authorLabel);

/** How to name a person, from the nearest PeopleProvider. */
export function usePersonLabel(): (email: string) => string {
  return useContext(PersonLabelCtx);
}
