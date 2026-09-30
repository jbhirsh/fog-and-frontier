import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApolloProvider } from '@apollo/client/react';
import {
  MAX_NOTE_LENGTH,
  authorLabel,
  deleteActivityReview,
  findOwnReview,
  formatReviewDate,
  reviewsForActivity,
  saveActivityReview,
  useActivityReviews,
  validateDraft,
  type ActivityReview,
} from './activityReviews';
import { apolloClient } from './apolloClient';
import { ACTIVITY_REVIEWS_QUERY } from './gqlDocs';

function review(over: Partial<ActivityReview> = {}): ActivityReview {
  return {
    __typename: 'ActivityReview',
    activityId: 'a1',
    authorEmail: 'jess@example.com',
    rating: 5,
    note: 'Worth the early start.',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...over,
  };
}

describe('reviewsForActivity', () => {
  it('keeps only the reviews for that activity', () => {
    const rows = [review(), review({ activityId: 'a2', authorEmail: 'tarun@example.com' })];
    expect(reviewsForActivity(rows, 'a1')).toEqual([rows[0]]);
  });

  it('orders most recently updated first', () => {
    const older = review({ authorEmail: 'tarun@example.com', updatedAt: '2026-02-01T00:00:00.000Z' });
    const newer = review({ updatedAt: '2026-04-01T00:00:00.000Z' });
    expect(reviewsForActivity([older, newer], 'a1')).toEqual([newer, older]);
  });

  it('does not mutate the input array', () => {
    const rows = [
      review({ authorEmail: 'tarun@example.com', updatedAt: '2026-02-01T00:00:00.000Z' }),
      review({ updatedAt: '2026-04-01T00:00:00.000Z' }),
    ];
    const snapshot = [...rows];
    reviewsForActivity(rows, 'a1');
    expect(rows).toEqual(snapshot);
  });
});

describe('findOwnReview', () => {
  it('matches the caller email case-insensitively', () => {
    const mine = review({ authorEmail: 'Jess@Example.com' });
    expect(findOwnReview([mine], 'jess@example.com')).toBe(mine);
  });

  it('returns null for a signed-out viewer', () => {
    expect(findOwnReview([review()], null)).toBeNull();
  });

  it('returns null when the viewer has not reviewed it', () => {
    expect(findOwnReview([review()], 'tarun@example.com')).toBeNull();
  });
});

describe('authorLabel', () => {
  it.each([
    ['jess@example.com', 'Jess'],
    ['jess.hirsh@example.com', 'Jess Hirsh'],
    ['jess.hirsh+trips@example.com', 'Jess Hirsh'],
    ['tarun_k@example.com', 'Tarun K'],
  ])('renders %s as %s', (email, expected) => {
    expect(authorLabel(email)).toBe(expected);
  });

  it('falls back to the raw value when there is no local part', () => {
    expect(authorLabel('@example.com')).toBe('@example.com');
    expect(authorLabel('+@example.com')).toBe('+@example.com');
  });
});

describe('formatReviewDate', () => {
  it('formats an ISO timestamp', () => {
    expect(formatReviewDate('2026-03-01T12:00:00.000Z')).toMatch(/Mar 1, 2026/);
  });

  it('returns an empty string for an unparseable value', () => {
    expect(formatReviewDate('not-a-date')).toBe('');
  });
});

describe('validateDraft', () => {
  it('accepts a rating without a note', () => {
    expect(validateDraft(4, '   ')).toBeNull();
  });

  it('accepts a note without a rating', () => {
    expect(validateDraft(null, 'Loved it')).toBeNull();
  });

  it('rejects an empty draft', () => {
    expect(validateDraft(null, '  ')).toMatch(/rating or a note/i);
  });

  it.each([0, 6, 3.5])('rejects the out-of-range rating %s', (rating) => {
    expect(validateDraft(rating, 'note')).toMatch(/between 1 and 5/i);
  });

  it('rejects an over-long note', () => {
    expect(validateDraft(5, 'x'.repeat(MAX_NOTE_LENGTH + 1))).toMatch(
      /2000 characters or fewer/i,
    );
  });

  it('accepts a note exactly at the cap', () => {
    expect(validateDraft(null, 'x'.repeat(MAX_NOTE_LENGTH))).toBeNull();
  });
});

// --- data layer against the real apolloClient singleton ---------------------
// Same posture as userCompleted.test.ts: the hook reads through useQuery and
// the mutations write through the module-level client, so we render against
// that client and stub fetch to serve the GraphQL ops.
describe('useActivityReviews / saveActivityReview / deleteActivityReview', () => {
  let saved: { activityId: string; rating: number | null; note: string | null }[];
  let deleted: string[];
  let listed: ActivityReview[];

  function jsonResponse(obj: unknown): Response {
    return new Response(JSON.stringify(obj), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(ApolloProvider, { client: apolloClient, children });
  }

  beforeEach(() => {
    saved = [];
    deleted = [];
    listed = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body) as {
          operationName?: string;
          variables?: {
            input?: { activityId: string; rating?: number | null; note?: string | null };
          };
        };
        const input = body.variables?.input;
        if (body.operationName === 'SaveActivityReview' && input) {
          saved.push({
            activityId: input.activityId,
            rating: input.rating ?? null,
            note: input.note ?? null,
          });
          return Promise.resolve(
            jsonResponse({
              data: {
                saveActivityReview: {
                  __typename: 'SaveActivityReviewPayload',
                  review: review({
                    activityId: input.activityId,
                    rating: input.rating ?? null,
                    note: input.note ?? null,
                  }),
                },
              },
            }),
          );
        }
        if (body.operationName === 'DeleteActivityReview' && input) {
          deleted.push(input.activityId);
          return Promise.resolve(
            jsonResponse({
              data: {
                deleteActivityReview: {
                  __typename: 'DeleteActivityReviewPayload',
                  activityId: input.activityId,
                  authorEmail: 'jess@example.com',
                },
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({ data: { activityReviews: listed } }));
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await apolloClient.clearStore();
  });

  it('exposes only the reviews for the requested activity', async () => {
    listed = [
      review(),
      review({ activityId: 'a2', authorEmail: 'tarun@example.com' }),
    ];
    const { result } = renderHook(() => useActivityReviews('a1'), { wrapper });
    await waitFor(() => expect(result.current.reviews).toHaveLength(1));
    expect(result.current.reviews[0].activityId).toBe('a1');
  });

  it('sends a trimmed note and splices the saved review into the cached list', async () => {
    const { result } = renderHook(() => useActivityReviews('a1'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await saveActivityReview({ activityId: 'a1', rating: 4, note: '  Great  ' });
    });
    expect(saved).toEqual([{ activityId: 'a1', rating: 4, note: 'Great' }]);
    await waitFor(() => expect(result.current.reviews).toHaveLength(1));
  });

  it('sends a null note when the draft is rating-only', async () => {
    await act(async () => {
      await saveActivityReview({ activityId: 'a1', rating: 5, note: '   ' });
    });
    expect(saved).toEqual([{ activityId: 'a1', rating: 5, note: null }]);
  });

  it('reports loading only until the first read lands', async () => {
    listed = [review()];
    const { result } = renderHook(() => useActivityReviews('a1'), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    // A background refetch over cached data is not a first load.
    await act(async () => {
      await apolloClient.refetchQueries({ include: [ACTIVITY_REVIEWS_QUERY] });
    });
    expect(result.current.loading).toBe(false);
  });

  it('leaves the cache alone when a save beats the first read', async () => {
    // Writing here would publish a one-entry list for the whole catalog, which
    // the in-flight read would immediately overwrite.
    await act(async () => {
      await saveActivityReview({ activityId: 'a1', rating: 5, note: '' });
    });
    expect(
      apolloClient.cache.readQuery({ query: ACTIVITY_REVIEWS_QUERY }),
    ).toBeNull();
  });

  it('removes the review from the cached list on delete', async () => {
    listed = [review()];
    const { result } = renderHook(() => useActivityReviews('a1'), { wrapper });
    await waitFor(() => expect(result.current.reviews).toHaveLength(1));
    await act(async () => {
      await deleteActivityReview('a1');
    });
    expect(deleted).toEqual(['a1']);
    await waitFor(() => expect(result.current.reviews).toHaveLength(0));
  });
});
