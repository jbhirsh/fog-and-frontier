import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApolloServer } from '@apollo/server';

// Owner reviews (#184). Same posture as graphql.test.ts: exercise behavior
// THROUGH the schema and mock only at the `db` boundary, with auth supplied
// directly via contextValue (the exact shape buildContext produces). The
// db mock keeps a real in-memory table keyed by (activity_id, author_email) so
// the upsert semantics — created_at preserved, per-author isolation — are
// actually asserted rather than stubbed.

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../_db.js', () => ({ db: () => ({ execute }) }));

process.env.OWNER_EMAILS = 'jess@example.com,tarun@example.com';

const { typeDefs } = await import('../_schema.js');
const { resolvers } = await import('./index.js');
const { MAX_NOTE_LENGTH } = await import('./reviews.js');

const server = new ApolloServer({ typeDefs, resolvers });
beforeAll(() => server.start());

const JESS = { email: 'jess@example.com', role: 'owner' as const };
const TARUN = { email: 'tarun@example.com', role: 'owner' as const };
const EDITOR = { email: 'editor@example.com', role: 'editor' as const };

type Caller = { email: string; role: 'owner' | 'editor' } | null;
type SingleResult = {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

async function run(
  query: string,
  variables: Record<string, unknown> = {},
  caller: Caller = null,
): Promise<SingleResult> {
  const res = await server.executeOperation(
    { query, variables },
    { contextValue: { caller } },
  );
  if (res.body.kind !== 'single') throw new Error('expected single result');
  return res.body.singleResult as SingleResult;
}

function code(r: SingleResult): unknown {
  return r.errors?.[0]?.extensions?.code;
}

// --- in-memory `activity_reviews` -------------------------------------------
type Row = {
  activity_id: string;
  author_email: string;
  rating: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
};
let table: Map<string, Row>;
const key = (a: string, e: string) => `${a}::${e}`;

beforeEach(() => {
  table = new Map();
  // Only Date is faked — Apollo's own async scheduling still uses real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
  execute.mockImplementation((q: unknown) => {
    const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
    const args: unknown[] =
      typeof q === 'string' ? [] : ((q as { args?: unknown[] }).args ?? []);
    if (/^INSERT INTO activity_reviews/.test(sql)) {
      const [activityId, email, rating, note, createdAt, updatedAt] = args as [
        string, string, number | null, string | null, number, number,
      ];
      const existing = table.get(key(activityId, email));
      table.set(key(activityId, email), {
        activity_id: activityId,
        author_email: email,
        rating,
        note,
        created_at: existing?.created_at ?? createdAt,
        updated_at: updatedAt,
      });
      return Promise.resolve({ rows: [] });
    }
    if (/^DELETE FROM activity_reviews/.test(sql)) {
      table.delete(key(args[0] as string, args[1] as string));
      return Promise.resolve({ rows: [] });
    }
    if (/WHERE activity_id = \? AND author_email = \?/.test(sql)) {
      const row = table.get(key(args[0] as string, args[1] as string));
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    if (/FROM activity_reviews/.test(sql)) {
      return Promise.resolve({
        rows: [...table.values()].sort((a, b) => b.updated_at - a.updated_at),
      });
    }
    return Promise.resolve({ rows: [] });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const SAVE = /* GraphQL */ `
  mutation Save($input: SaveActivityReviewInput!) {
    saveActivityReview(input: $input) {
      review { activityId authorEmail rating note createdAt updatedAt }
    }
  }
`;
const DELETE = /* GraphQL */ `
  mutation Del($input: DeleteActivityReviewInput!) {
    deleteActivityReview(input: $input) { activityId authorEmail }
  }
`;
const LIST = /* GraphQL */ `
  query Reviews {
    activityReviews { activityId authorEmail rating note createdAt updatedAt }
  }
`;

type ReviewRow = {
  activityId: string;
  authorEmail: string;
  rating: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};
function list(r: SingleResult): ReviewRow[] {
  return (r.data?.activityReviews ?? []) as ReviewRow[];
}

describe('Query.activityReviews (public)', () => {
  it('is readable by an anonymous visitor', async () => {
    await run(SAVE, { input: { activityId: 'a1', rating: 5, note: 'Worth it' } }, JESS);
    const res = await run(LIST, {}, null);
    expect(res.errors).toBeUndefined();
    expect(list(res)).toEqual([
      expect.objectContaining({
        activityId: 'a1',
        authorEmail: 'jess@example.com',
        rating: 5,
        note: 'Worth it',
      }),
    ]);
  });

  it('serializes timestamps as ISO strings', async () => {
    await run(SAVE, { input: { activityId: 'a1', rating: 4 } }, JESS);
    const [row] = list(await run(LIST));
    expect(row.createdAt).toBe('2026-03-01T00:00:00.000Z');
    expect(row.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('skips rows missing their identity columns', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        { activity_id: null, author_email: 'jess@example.com', created_at: 1, updated_at: 1 },
        { activity_id: 'a1', author_email: null, created_at: 1, updated_at: 1 },
        { activity_id: 'a1', author_email: 'jess@example.com', created_at: null, updated_at: 1 },
        { activity_id: 'a2', author_email: 'jess@example.com', rating: null, note: 42, created_at: 7, updated_at: 8 },
      ],
    });
    const rows = list(await run(LIST));
    expect(rows).toEqual([
      expect.objectContaining({ activityId: 'a2', rating: null, note: null }),
    ]);
  });
});

describe('Mutation.saveActivityReview', () => {
  it('rejects an anonymous caller', async () => {
    const res = await run(SAVE, { input: { activityId: 'a1', rating: 5 } }, null);
    expect(code(res)).toBe('UNAUTHENTICATED');
    expect(table.size).toBe(0);
  });

  it('rejects a signed-in non-owner', async () => {
    const res = await run(SAVE, { input: { activityId: 'a1', rating: 5 } }, EDITOR);
    expect(code(res)).toBe('FORBIDDEN');
    expect(table.size).toBe(0);
  });

  it('stores the review against the caller, ignoring any author in input', async () => {
    const res = await run(SAVE, { input: { activityId: 'a1', note: '  Great views  ' } }, TARUN);
    expect(res.errors).toBeUndefined();
    const review = (res.data?.saveActivityReview as { review: ReviewRow }).review;
    expect(review.authorEmail).toBe('tarun@example.com');
    expect(review.note).toBe('Great views');
    expect(review.rating).toBeNull();
  });

  it('keeps each owner review separate for the same activity', async () => {
    await run(SAVE, { input: { activityId: 'a1', rating: 5, note: 'Jess loved it' } }, JESS);
    await run(SAVE, { input: { activityId: 'a1', rating: 3, note: 'Tarun was cold' } }, TARUN);
    const rows = list(await run(LIST));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.authorEmail, r.rating])).toEqual(
      expect.arrayContaining([
        ['jess@example.com', 5],
        ['tarun@example.com', 3],
      ]),
    );
  });

  it('upserts an edit in place, preserving createdAt and moving updatedAt', async () => {
    await run(SAVE, { input: { activityId: 'a1', rating: 5 } }, JESS);
    vi.setSystemTime(new Date('2026-03-02T00:00:00Z'));
    const res = await run(SAVE, { input: { activityId: 'a1', rating: 2, note: 'Downgraded' } }, JESS);
    const review = (res.data?.saveActivityReview as { review: ReviewRow }).review;
    expect(review.createdAt).toBe('2026-03-01T00:00:00.000Z');
    expect(review.updatedAt).toBe('2026-03-02T00:00:00.000Z');
    expect(review.rating).toBe(2);
    expect(list(await run(LIST))).toHaveLength(1);
  });

  it('falls back to the written values when the read-back row is gone', async () => {
    execute.mockResolvedValueOnce({ rows: [] }); // the INSERT
    execute.mockResolvedValueOnce({ rows: [] }); // the read-back
    const res = await run(SAVE, { input: { activityId: 'a1', rating: 4 } }, JESS);
    const review = (res.data?.saveActivityReview as { review: ReviewRow }).review;
    expect(review).toEqual(
      expect.objectContaining({ activityId: 'a1', authorEmail: 'jess@example.com', rating: 4 }),
    );
  });

  it.each([
    ['a rating below range', { activityId: 'a1', rating: 0 }],
    ['a rating above range', { activityId: 'a1', rating: 6 }],
    ['a non-integer rating', { activityId: 'a1', rating: 4.5 }],
    ['an empty activityId', { activityId: '', rating: 4 }],
  ])('rejects %s', async (_label, input) => {
    const res = await run(SAVE, { input }, JESS);
    expect(code(res)).toBe('BAD_USER_INPUT');
  });

  it('rejects a note longer than the cap', async () => {
    const res = await run(
      SAVE,
      { input: { activityId: 'a1', note: 'x'.repeat(MAX_NOTE_LENGTH + 1) } },
      JESS,
    );
    expect(code(res)).toBe('BAD_USER_INPUT');
  });

  it('rejects a review with neither a rating nor a note', async () => {
    const res = await run(SAVE, { input: { activityId: 'a1', note: '   ' } }, JESS);
    expect(code(res)).toBe('BAD_USER_INPUT');
    expect(table.size).toBe(0);
  });
});

describe('Mutation.deleteActivityReview', () => {
  it('rejects an anonymous caller', async () => {
    expect(code(await run(DELETE, { input: { activityId: 'a1' } }, null))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('rejects a signed-in non-owner', async () => {
    expect(code(await run(DELETE, { input: { activityId: 'a1' } }, EDITOR))).toBe(
      'FORBIDDEN',
    );
  });

  it('rejects an empty activityId', async () => {
    expect(code(await run(DELETE, { input: { activityId: '' } }, JESS))).toBe(
      'BAD_USER_INPUT',
    );
  });

  it("removes only the caller's own review", async () => {
    await run(SAVE, { input: { activityId: 'a1', rating: 5 } }, JESS);
    await run(SAVE, { input: { activityId: 'a1', rating: 3 } }, TARUN);
    const res = await run(DELETE, { input: { activityId: 'a1' } }, JESS);
    expect(res.data?.deleteActivityReview).toEqual({
      activityId: 'a1',
      authorEmail: 'jess@example.com',
    });
    const rows = list(await run(LIST));
    expect(rows).toEqual([
      expect.objectContaining({ authorEmail: 'tarun@example.com', rating: 3 }),
    ]);
  });
});
