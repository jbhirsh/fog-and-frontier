import { useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { apolloClient } from './apolloClient';
import {
  ACTIVITY_REVIEWS_QUERY,
  DELETE_ACTIVITY_REVIEW,
  SAVE_ACTIVITY_REVIEW,
  type ActivityReviewRow,
} from './gqlDocs';

// Owner reviews (#184). One review per owner per activity: an optional 1-5
// rating plus an optional note. Reads are public; the write paths are
// owner-gated server-side (requireOwnerCtx) and self-scoped — the server takes
// the author from the auth token, never from what we send.

export type ActivityReview = ActivityReviewRow;

export const MAX_NOTE_LENGTH = 2000;
export const MIN_RATING = 1;
export const MAX_RATING = 5;

// Reviews for one activity, most recently updated first (the server's order,
// re-applied here because the cached list spans every activity).
export function reviewsForActivity(
  rows: readonly ActivityReview[],
  activityId: string,
): ActivityReview[] {
  return rows
    .filter((r) => r.activityId === activityId)
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function findOwnReview(
  rows: readonly ActivityReview[],
  email: string | null,
): ActivityReview | null {
  if (!email) return null;
  const lower = email.toLowerCase();
  return rows.find((r) => r.authorEmail.toLowerCase() === lower) ?? null;
}

// Display name from the owner's email — Clerk owns real display names and the
// `users` row keeps them null, so the local part is what we have.
// 'jess.hirsh+trips@example.com' -> 'Jess Hirsh'.
export function authorLabel(email: string): string {
  const local = email.split('@')[0]?.split('+')[0] ?? '';
  if (!local) return email;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || email
  );
}

// Fixed locale so the rendered date doesn't drift with the test/CI environment.
export function formatReviewDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Mirrors the server's validation so the UI can disable Save rather than let
// the round-trip fail. Returns null when the draft is saveable.
export function validateDraft(
  rating: number | null,
  note: string,
): string | null {
  const trimmed = note.trim();
  if (rating === null && !trimmed) return 'Add a rating or a note.';
  if (
    rating !== null &&
    (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING)
  ) {
    return 'Rating must be between 1 and 5 stars.';
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return `Note must be ${MAX_NOTE_LENGTH} characters or fewer.`;
  }
  return null;
}

// Upsert/remove a single review in the cached ACTIVITY_REVIEWS_QUERY result.
// Same shape as userCompleted's writeCompletedEntry: the list query is the one
// canonical read, so a mutation has to splice its result in by hand.
function writeReview(
  cache: typeof apolloClient.cache,
  activityId: string,
  authorEmail: string,
  review: ActivityReview | null,
): void {
  const existing = cache.readQuery({
    query: ACTIVITY_REVIEWS_QUERY,
  })?.activityReviews;
  // Nothing cached yet (the list read hasn't resolved): writing here would
  // publish a one-entry list for the whole catalog, which the in-flight read
  // would then overwrite. Let that read land instead.
  if (!existing) return;
  const filtered = existing.filter(
    (r) => !(r.activityId === activityId && r.authorEmail === authorEmail),
  );
  cache.writeQuery({
    query: ACTIVITY_REVIEWS_QUERY,
    data: { activityReviews: review ? [...filtered, review] : filtered },
  });
}

export async function saveActivityReview(input: {
  activityId: string;
  rating: number | null;
  note: string;
}): Promise<void> {
  const note = input.note.trim();
  await apolloClient.mutate({
    mutation: SAVE_ACTIVITY_REVIEW,
    variables: {
      input: {
        activityId: input.activityId,
        rating: input.rating,
        note: note || null,
      },
    },
    update(cache, { data }) {
      const review = data?.saveActivityReview?.review;
      if (!review) return;
      writeReview(cache, review.activityId, review.authorEmail, review);
    },
  });
}

export async function deleteActivityReview(activityId: string): Promise<void> {
  await apolloClient.mutate({
    mutation: DELETE_ACTIVITY_REVIEW,
    variables: { input: { activityId } },
    update(cache, { data }) {
      const result = data?.deleteActivityReview;
      if (!result) return;
      writeReview(cache, result.activityId, result.authorEmail, null);
    },
  });
}

// Public read — cache-and-network so a reopened dialog paints instantly and
// still picks up the other owner's newer review in the background.
//
// `loading` is the *first* load only (no data to show yet). A background
// refetch over cached data doesn't count: callers use this to avoid claiming
// "no reviews yet" before the answer is in, and that question is settled as
// soon as any data has landed.
export function useActivityReviews(activityId: string): {
  reviews: ActivityReview[];
  loading: boolean;
} {
  const { data, loading } = useQuery(ACTIVITY_REVIEWS_QUERY, {
    fetchPolicy: 'cache-and-network',
  });
  const reviews = useMemo(
    () => reviewsForActivity(data?.activityReviews ?? [], activityId),
    [data, activityId],
  );
  return { reviews, loading: loading && !data };
}
