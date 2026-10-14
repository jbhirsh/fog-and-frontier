import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApolloServer } from '@apollo/server';

// Suggestions (#73). Same posture as reviews.test.ts: exercise behavior
// THROUGH the schema and mock only at the `db` boundary, with auth supplied
// directly via contextValue. The mock keeps real in-memory `suggestions`, `a`
// and `users` tables, so the queue's states, the credit and the catalog id are
// asserted rather than stubbed.

const { execute, batch } = vi.hoisted(() => ({ execute: vi.fn(), batch: vi.fn() }));
vi.mock('../_db.js', () => ({ db: () => ({ execute, batch }) }));

process.env.OWNER_EMAILS = 'owner@example.com';

const { typeDefs } = await import('../_schema.js');
const { resolvers } = await import('./index.js');

const server = new ApolloServer({ typeDefs, resolvers });
beforeAll(() => server.start());

const OWNER = { email: 'owner@example.com', role: 'owner' as const };
const FRIEND = { email: 'friend@example.com', role: 'editor' as const };

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
  const res = await server.executeOperation({ query, variables }, { contextValue: { caller } });
  if (res.body.kind !== 'single') throw new Error('expected single result');
  return res.body.singleResult as SingleResult;
}

function code(r: SingleResult): unknown {
  return r.errors?.[0]?.extensions?.code;
}

// --- in-memory tables -------------------------------------------------------
type Suggestion = { id: string; j: string; t: number; suggested_by: string; status: string };
let suggestions: Map<string, Suggestion>;
let catalog: Map<string, string>;
let users: Set<string>;

type Stmt = string | { sql: string; args?: unknown[] };
const sqlOf = (q: Stmt) => (typeof q === 'string' ? q : q.sql);
const argsOf = (q: Stmt) => (typeof q === 'string' ? [] : (q.args ?? []));

function runSql(q: Stmt) {
  const sql = sqlOf(q);
  const args = argsOf(q);
  if (/^INSERT INTO suggestions/.test(sql)) {
    const [id, j, t, by, countFor, cap] = args as [string, string, number, string, string, number];
    const waiting = [...suggestions.values()].filter(
      (s) => s.suggested_by === countFor && s.status === 'pending',
    ).length;
    if (waiting >= cap) return { rows: [], rowsAffected: 0 };
    suggestions.set(id, { id, j, t, suggested_by: by, status: 'pending' });
    return { rows: [], rowsAffected: 1 };
  }
  if (/FROM suggestions\s+WHERE status = 'pending' ORDER BY t DESC LIMIT \?/.test(sql)) {
    const rows = [...suggestions.values()]
      .filter((s) => s.status === 'pending')
      .sort((x, y) => y.t - x.t)
      .slice(0, args[0] as number);
    return { rows };
  }
  if (/^SELECT j, suggested_by FROM suggestions WHERE id = \? AND status = 'pending'/.test(sql)) {
    const s = suggestions.get(args[0] as string);
    return { rows: s?.status === 'pending' ? [s] : [] };
  }
  if (/^UPDATE suggestions SET status = '(\w+)' WHERE id = \? AND status = 'pending'/.test(sql)) {
    const status = /'(\w+)'/.exec(sql)?.[1] ?? '';
    const s = suggestions.get(args[0] as string);
    if (s?.status !== 'pending') return { rows: [], rowsAffected: 0 };
    // An accept only counts if its own activity is the one in the catalog.
    if (/AND EXISTS \(SELECT 1 FROM a WHERE id = \? AND j = \?\)/.test(sql)) {
      const [, activityId, j] = args as [string, string, string];
      if (catalog.get(activityId) !== j) return { rows: [], rowsAffected: 0 };
    }
    s.status = status;
    return { rows: [], rowsAffected: 1 };
  }
  if (/^INSERT INTO a \(id, j, t\)\s+SELECT/.test(sql)) {
    const [id, j, , suggestionId] = args as [string, string, number, string];
    if (suggestions.get(suggestionId)?.status !== 'pending') return { rows: [], rowsAffected: 0 };
    // ON CONFLICT(id) DO NOTHING: a taken id is left as it is.
    expect(sql).toMatch(/ON CONFLICT\(id\) DO NOTHING$/);
    if (catalog.has(id)) return { rows: [], rowsAffected: 0 };
    catalog.set(id, j);
    return { rows: [], rowsAffected: 1 };
  }
  if (/^SELECT j FROM a WHERE id = \?/.test(sql)) {
    const j = catalog.get(args[0] as string);
    return { rows: j === undefined ? [] : [{ j }] };
  }
  if (/^SELECT id, j FROM a ORDER BY t DESC/.test(sql)) {
    return { rows: [...catalog].map(([id, j]) => ({ id, j })) };
  }
  if (/^INSERT INTO users/.test(sql)) {
    users.add(args[0] as string);
    return { rows: [], rowsAffected: 1 };
  }
  return { rows: [] };
}

beforeEach(() => {
  suggestions = new Map();
  catalog = new Map();
  users = new Set();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-01T00:00:00Z'));
  execute.mockImplementation((q: Stmt) => Promise.resolve(runSql(q)));
  batch.mockImplementation((stmts: Stmt[]) => Promise.resolve(stmts.map(runSql)));
});

afterEach(() => {
  vi.useRealTimers();
  execute.mockReset();
  batch.mockReset();
});

function activity(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Fort Funston',
    shortDescription: 'Bluffs and hang gliders',
    category: 'scenic',
    region: 'sf',
    location: { city: 'San Francisco', coords: { lat: 37.715, lng: -122.502 } },
    duration: 'Half Day',
    coverImage: 'https://img.example/ff.jpg',
    ...overrides,
  };
}

const SUGGEST =
  'mutation($i: SuggestActivityInput!){ suggestActivity(input:$i){ suggestion { id } } }';
const PENDING =
  '{ pendingSuggestions { id suggestedBy suggestedAt activity { id name category } } }';
const ACCEPT =
  'mutation($id: ID!){ acceptSuggestion(id:$id){ activity { id name contributors } } }';
const REJECT = 'mutation($id: ID!){ rejectSuggestion(id:$id){ id } }';

async function suggest(caller: Caller = FRIEND, overrides: Record<string, unknown> = {}) {
  const r = await run(SUGGEST, { i: { activity: activity(overrides) } }, caller);
  return (r.data?.suggestActivity as { suggestion: { id: string } } | undefined)?.suggestion.id;
}

describe('suggestActivity', () => {
  it('anon → UNAUTHENTICATED, and nothing is stored', async () => {
    const r = await run(SUGGEST, { i: { activity: activity() } });
    expect(code(r)).toBe('UNAUTHENTICATED');
    expect(suggestions.size).toBe(0);
  });

  it('a signed-in non-owner suggests: a pending row, credited to no one yet', async () => {
    const id = await suggest();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const row = suggestions.get(id ?? '');
    expect(row).toMatchObject({ suggested_by: FRIEND.email, status: 'pending' });
    expect(row?.t).toBe(Date.parse('2026-03-01T00:00:00Z'));
    const stored = JSON.parse(row?.j ?? '{}') as Record<string, unknown>;
    expect(stored).toMatchObject({ id, name: 'Fort Funston' });
    expect(stored).not.toHaveProperty('contributors');
    // Nothing else is written: not the catalog, and not the users list,
    // which only gains the suggester if it's accepted.
    expect(catalog.size).toBe(0);
    expect(users.size).toBe(0);
    expect(execute).toHaveBeenCalledTimes(2); // the duplicate check's read, then the insert
  });

  it('keeps only real web pages as links', async () => {
    const id = await suggest(FRIEND, {
      coverImage: 'javascript:alert(1)',
      coverCredit: 'Someone',
      galleryImages: ['https://img.example/1.jpg', 'data:image/png;base64,AAAA'],
      allTrailsUrl: 'https://evil.example/trail/x',
      reservationUrl: 'ftp://example.com/book',
      menuUrl: 'https://example.com/menu',
    });
    const stored = JSON.parse(suggestions.get(id ?? '')?.j ?? '{}') as Record<string, unknown>;
    expect(stored).toMatchObject({
      coverImage: '',
      coverCredit: null,
      galleryImages: ['https://img.example/1.jpg'],
      allTrailsUrl: null,
      reservationUrl: null,
      menuUrl: 'https://example.com/menu',
    });
  });

  it('holds at most ten waiting per account', async () => {
    for (let i = 0; i < 10; i += 1) expect(await suggest(FRIEND, { name: `Place ${i}` })).toBeTruthy();
    const r = await run(SUGGEST, { i: { activity: activity({ name: 'One more' }) } }, FRIEND);
    expect(code(r)).toBe('FORBIDDEN');
    expect(r.errors?.[0]?.extensions?.appCode).toBe('suggestion_limit');
    expect(r.errors?.[0]?.message).toBe(
      'You have 10 suggestions waiting for review. Try again once the owners have looked at them.',
    );
    expect(suggestions.size).toBe(10);
    // Another account has its own room, and a decided one frees a place.
    expect(await suggest(OWNER, { name: 'Owner idea' })).toBeTruthy();
    [...suggestions.values()][0].status = 'rejected';
    expect(await suggest(FRIEND, { name: 'One more' })).toBeTruthy();
  });

  it('drops completion and contributors the suggester sent', async () => {
    const id = await suggest(FRIEND, {
      completed: true,
      completedDate: '2026-02-01',
      contributors: ['someone@example.com'],
    });
    const stored = JSON.parse(suggestions.get(id ?? '')?.j ?? '{}') as Record<string, unknown>;
    expect(stored).not.toHaveProperty('completed');
    expect(stored).not.toHaveProperty('completedDate');
    expect(stored).not.toHaveProperty('contributors');
  });

  it('refuses a cost tier outside the set', async () => {
    const r = await run(SUGGEST, { i: { activity: activity({ costTier: '$$$$' }) } }, FRIEND);
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(suggestions.size).toBe(0);
  });

  it('stores up to the catalog\'s size cap, and refuses one past it', async () => {
    // Measure what a one-character description stores, then pad to the cap.
    const probe = await suggest(FRIEND, { longDescription: 'x' });
    const base = suggestions.get(probe ?? '')?.j.length ?? 0;
    suggestions.clear();
    const atCap = 'x'.repeat(1 + 8000 - base);
    expect(await suggest(FRIEND, { longDescription: atCap })).toBeTruthy();
    expect([...suggestions.values()][0].j).toHaveLength(8000);
    const r = await run(
      SUGGEST,
      { i: { activity: activity({ longDescription: `${atCap}x` }) } },
      FRIEND,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(r.errors?.[0]?.message).toBe('activity too large');
    expect(suggestions.size).toBe(1);
  });

  it('refuses a high-confidence duplicate unless told to go ahead', async () => {
    catalog.set('fort-funston', JSON.stringify({ id: 'fort-funston', ...activity() }));
    const refused = await run(SUGGEST, { i: { activity: activity() } }, FRIEND);
    expect(code(refused)).toBe('CONFLICT');
    expect(refused.errors?.[0]?.extensions?.appCode).toBe('duplicate');
    expect(suggestions.size).toBe(0);

    const allowed = await run(
      SUGGEST,
      { i: { activity: activity(), allowDuplicate: true } },
      FRIEND,
    );
    expect(allowed.errors).toBeUndefined();
    expect(suggestions.size).toBe(1);
  });
});

describe('pendingSuggestions', () => {
  it('non-owner → FORBIDDEN; anon → UNAUTHENTICATED', async () => {
    expect(code(await run(PENDING, {}, FRIEND))).toBe('FORBIDDEN');
    expect(code(await run(PENDING))).toBe('UNAUTHENTICATED');
  });

  it('lists pending ones newest first, skipping decided and unreadable rows', async () => {
    const older = await suggest(FRIEND, { name: 'Older' });
    vi.setSystemTime(new Date('2026-03-02T00:00:00Z'));
    const newer = await suggest(FRIEND, { name: 'Newer' });
    const decided = await suggest(FRIEND, { name: 'Decided' });
    suggestions.get(decided ?? '')!.status = 'rejected';
    suggestions.set('broken', {
      id: 'broken', j: 'not json', t: 1, suggested_by: FRIEND.email, status: 'pending',
    });
    suggestions.set('partial', {
      id: 'partial', j: '{"name":"No category"}', t: 2, suggested_by: FRIEND.email, status: 'pending',
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await run(PENDING, {}, OWNER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.pendingSuggestions).toEqual([
      {
        id: newer,
        suggestedBy: FRIEND.email,
        suggestedAt: '2026-03-02T00:00:00.000Z',
        activity: { id: newer, name: 'Newer', category: 'scenic' },
      },
      {
        id: older,
        suggestedBy: FRIEND.email,
        suggestedAt: '2026-03-01T00:00:00.000Z',
        activity: { id: older, name: 'Older', category: 'scenic' },
      },
    ]);
    expect(errors).toHaveBeenCalledTimes(2);
    const logged = errors.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>);
    expect(logged.map((l) => l.detail).sort()).toEqual([
      'pendingSuggestions: broken',
      'pendingSuggestions: partial',
    ]);
    expect(logged[0]).toMatchObject({ route: '/api/graphql' });
    errors.mockRestore();
  });

  it('lists at most 200', async () => {
    for (let i = 0; i < 201; i += 1) {
      suggestions.set(`s${i}`, {
        id: `s${i}`,
        j: JSON.stringify({ id: `s${i}`, ...activity() }),
        t: i,
        suggested_by: FRIEND.email,
        status: 'pending',
      });
    }
    const r = await run('{ pendingSuggestions { id } }', {}, OWNER);
    const list = r.data?.pendingSuggestions as { id: string }[];
    expect(list).toHaveLength(200);
    expect(list[0].id).toBe('s200');
  });
});

describe('acceptSuggestion', () => {
  it('non-owner → FORBIDDEN, and the suggestion stays pending', async () => {
    const id = await suggest();
    const r = await run(ACCEPT, { id }, FRIEND);
    expect(code(r)).toBe('FORBIDDEN');
    expect(suggestions.get(id ?? '')?.status).toBe('pending');
    expect(catalog.size).toBe(0);
  });

  it('adds it to the catalog under its name, crediting the suggester, in one write', async () => {
    const id = await suggest();
    const r = await run(ACCEPT, { id }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.acceptSuggestion).toEqual({
      activity: { id: 'fort-funston', name: 'Fort Funston', contributors: [FRIEND.email] },
    });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][1]).toBe('write');
    expect(suggestions.get(id ?? '')?.status).toBe('accepted');
    // The suggester is now someone the owners can credit and pick.
    expect(users.has(FRIEND.email)).toBe(true);
    const saved = JSON.parse(catalog.get('fort-funston') ?? '{}') as Record<string, unknown>;
    expect(saved).toMatchObject({
      id: 'fort-funston',
      name: 'Fort Funston',
      contributors: [FRIEND.email],
    });
  });

  it('refuses a look-alike added since, unless told to go ahead', async () => {
    const id = await suggest();
    catalog.set('ff', JSON.stringify({ id: 'ff', ...activity() }));
    const refused = await run(ACCEPT, { id }, OWNER);
    expect(code(refused)).toBe('CONFLICT');
    expect(refused.errors?.[0]?.extensions?.appCode).toBe('duplicate');
    expect(batch).not.toHaveBeenCalled();
    const r = await run(
      'mutation($id: ID!){ acceptSuggestion(id:$id, allowDuplicate: true){ activity { id } } }',
      { id },
      OWNER,
    );
    expect(r.data?.acceptSuggestion).toEqual({ activity: { id: 'fort-funston' } });
  });

  it('refuses one too large for the catalog', async () => {
    suggestions.set('big', {
      id: 'big',
      j: JSON.stringify({ id: 'big', ...activity({ longDescription: 'x'.repeat(8000) }) }),
      t: 1,
      suggested_by: FRIEND.email,
      status: 'pending',
    });
    const r = await run(ACCEPT, { id: 'big' }, OWNER);
    expect(r.errors?.[0]?.message).toBe('activity too large');
    expect(batch).not.toHaveBeenCalled();
  });

  it('takes the next free id when the name is already one', async () => {
    catalog.set('fort-funston', JSON.stringify({ id: 'fort-funston', ...activity() }));
    const id = await suggest(FRIEND, {
      location: { city: 'Daly City', coords: { lat: 37.7, lng: -122.4 } },
    });
    const r = await run(ACCEPT, { id }, OWNER);
    expect((r.data?.acceptSuggestion as { activity: { id: string } }).activity.id).toBe(
      'fort-funston-2',
    );
    expect(catalog.has('fort-funston-2')).toBe(true);
  });

  it('a decided or unknown suggestion → NOT_FOUND', async () => {
    const id = await suggest();
    await run(ACCEPT, { id }, OWNER);
    const again = await run(ACCEPT, { id }, OWNER);
    expect(code(again)).toBe('NOT_FOUND');
    expect(code(await run(ACCEPT, { id: 'nope' }, OWNER))).toBe('NOT_FOUND');
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('refuses a stored row that is not a whole activity', async () => {
    suggestions.set('partial', {
      id: 'partial', j: '{"name":"No category"}', t: 1, suggested_by: FRIEND.email, status: 'pending',
    });
    const r = await run(ACCEPT, { id: 'partial' }, OWNER);
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(batch).not.toHaveBeenCalled();
    expect(suggestions.get('partial')?.status).toBe('pending');
  });

  it('takes the next free id when another create wins the race for it, never replacing', async () => {
    const id = await suggest();
    const theirs = JSON.stringify({ id: 'fort-funston', name: 'Someone else' });
    // fort-funston looked free, but another create wrote it first.
    batch.mockImplementationOnce((stmts: Stmt[]) => {
      catalog.set('fort-funston', theirs);
      return Promise.resolve(stmts.map(runSql));
    });
    const r = await run(ACCEPT, { id }, OWNER);
    expect(r.errors).toBeUndefined();
    expect((r.data?.acceptSuggestion as { activity: { id: string } }).activity.id).toBe(
      'fort-funston-2',
    );
    expect(catalog.get('fort-funston')).toBe(theirs);
    expect(JSON.parse(catalog.get('fort-funston-2') ?? '{}')).toMatchObject({ name: 'Fort Funston' });
    expect(suggestions.get(id ?? '')?.status).toBe('accepted');
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it('gives up rather than overwrite when it keeps losing, and stays pending', async () => {
    const id = await suggest();
    // Every id it picks is taken just before its write lands.
    batch.mockImplementation((stmts: Stmt[]) => {
      const first = stmts[0] as { args: unknown[] };
      catalog.set(first.args[0] as string, '{"name":"taken"}');
      return Promise.resolve(stmts.map(runSql));
    });
    const r = await run(ACCEPT, { id }, OWNER);
    expect(code(r)).toBe('CONFLICT');
    expect(r.errors?.[0]?.message).toBe('another activity took this id; try accepting again');
    expect(batch).toHaveBeenCalledTimes(3);
    expect(suggestions.get(id ?? '')?.status).toBe('pending');
    expect([...catalog.values()].every((j) => j === '{"name":"taken"}')).toBe(true);
  });

  it('adds nothing when the suggestion was decided between the read and the write', async () => {
    const id = await suggest();
    batch.mockImplementationOnce((stmts: Stmt[]) => {
      suggestions.get(id ?? '')!.status = 'rejected';
      return Promise.resolve(stmts.map(runSql));
    });
    const r = await run(ACCEPT, { id }, OWNER);
    expect(code(r)).toBe('NOT_FOUND');
    expect(catalog.size).toBe(0);
    expect(suggestions.get(id ?? '')?.status).toBe('rejected');
  });
});

describe('rejectSuggestion', () => {
  it('non-owner → FORBIDDEN', async () => {
    const id = await suggest();
    expect(code(await run(REJECT, { id }, FRIEND))).toBe('FORBIDDEN');
    expect(suggestions.get(id ?? '')?.status).toBe('pending');
  });

  it('marks it rejected, keeping the row, and leaves the catalog alone', async () => {
    const id = await suggest();
    const r = await run(REJECT, { id }, OWNER);
    expect(r.data?.rejectSuggestion).toEqual({ id });
    expect(suggestions.get(id ?? '')?.status).toBe('rejected');
    expect(catalog.size).toBe(0);
    expect(code(await run(REJECT, { id }, OWNER))).toBe('NOT_FOUND');
    expect(code(await run(REJECT, { id: 'nope' }, OWNER))).toBe('NOT_FOUND');
  });
});
