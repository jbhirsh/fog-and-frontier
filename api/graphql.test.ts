import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApolloServer } from '@apollo/server';

// Integration tests for the consolidated GraphQL API (issue #91). We test
// behavior THROUGH the schema (server.executeOperation) and mock ONLY at the
// `db` boundary — a SQL-routing mock so we don't have to sequence the many
// reads. Auth is supplied directly via contextValue ({ caller }), which is the
// exact shape buildContext produces; the token→caller resolution itself is
// covered in _auth.test.ts. Deterministic: no real network/DB/clock.

const { execute, batch } = vi.hoisted(() => ({
  execute: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));

process.env.OWNER_EMAILS = 'owner@example.com';
process.env.GEMINI_API_KEY = 'test-gemini-key';

const { typeDefs } = await import('./_schema.js');
const { resolvers } = await import('./_resolvers/index.js');

const server = new ApolloServer({ typeDefs, resolvers });

beforeAll(async () => {
  await server.start();
});

// --- auth tiers ------------------------------------------------------------
const OWNER = { email: 'owner@example.com', role: 'owner' as const };
const EDITOR = { email: 'editor@example.com', role: 'editor' as const };
const OUTSIDER = { email: 'outsider@example.com', role: 'editor' as const };

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
function appCode(r: SingleResult): unknown {
  return r.errors?.[0]?.extensions?.appCode;
}

// --- SQL-routing db mock ----------------------------------------------------
type Row = Record<string, unknown>;
type State = {
  trip: Row | null;
  members: Set<string>;
  tripActivityRow: Row | null;
  activities: Row[];
  dup: boolean;
  taOnTrip: boolean;
  snapshotJson: string | null;
  catalog: Row[];
  completedRows: Row[];
  usersRows: Row[];
  memberRows: Row[];
  inviteRows: Row[];
  voteRows: Row[];
  invite: Row | null;
  tripList: Row[];
  counts: Row[];
};

let state: State;

function routeExecute(q: unknown) {
  const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
  const args = typeof q === 'string' ? [] : ((q as { args?: unknown[] }).args ?? []);

  if (/SELECT \* FROM trip_activities WHERE id = \?/.test(sql)) {
    return { rows: state.tripActivityRow ? [state.tripActivityRow] : [] };
  }
  if (/SELECT id FROM trip_activities WHERE trip_id = \? AND activity_id/.test(sql)) {
    return { rows: state.dup ? [{ id: 'dup' }] : [] };
  }
  if (/SELECT id FROM trip_activities WHERE id = \? AND trip_id/.test(sql)) {
    return { rows: state.taOnTrip ? [{ id: 'ta1' }] : [] };
  }
  if (/SELECT \* FROM trip_activities\s+WHERE trip_id = \?/.test(sql)) {
    return { rows: state.activities };
  }
  if (/SELECT trip_id,\s+SUM/.test(sql)) {
    return { rows: state.counts };
  }
  if (/FROM trips t\s+JOIN trip_members/.test(sql)) {
    return { rows: state.tripList };
  }
  if (/FROM trips WHERE id = \?/.test(sql)) {
    return { rows: state.trip ? [state.trip] : [] };
  }
  if (/SELECT 1 FROM trip_members WHERE trip_id = \? AND member_email/.test(sql)) {
    const email = typeof args[1] === 'string' ? args[1] : '';
    return { rows: state.members.has(email) ? [{ '1': 1 }] : [] };
  }
  if (/FROM trip_members m\s+LEFT JOIN users/.test(sql)) {
    return { rows: state.memberRows };
  }
  if (/FROM trip_invites WHERE invite_token/.test(sql)) {
    return { rows: state.invite ? [state.invite] : [] };
  }
  if (/FROM trip_invites\s+WHERE trip_id/.test(sql)) {
    return { rows: state.inviteRows };
  }
  if (/FROM trip_votes\s+WHERE trip_id/.test(sql)) {
    return { rows: state.voteRows };
  }
  if (/SELECT j FROM a WHERE id/.test(sql)) {
    return { rows: state.snapshotJson ? [{ j: state.snapshotJson }] : [] };
  }
  if (/SELECT id, j FROM a ORDER BY t DESC/.test(sql)) {
    return { rows: state.catalog };
  }
  if (/SELECT id, v FROM c/.test(sql)) {
    return { rows: state.completedRows };
  }
  if (/SELECT email, display_name FROM users/.test(sql)) {
    return { rows: state.usersRows };
  }
  return { rows: [] };
}

function tripRow(overrides: Row = {}): Row {
  return {
    id: 'trip1',
    creator_email: OWNER.email,
    title: 'Test Trip',
    description: null,
    start_date: '2025-07-01',
    end_date: '2025-07-03',
    cover_image_url: null,
    status: 'voting',
    created_at: 1700000000000,
    marked_past_at: null,
    ...overrides,
  };
}

function taRow(overrides: Row = {}): Row {
  return {
    id: 'ta1',
    trip_id: 'trip1',
    activity_id: 'act1',
    snapshot_json: JSON.stringify({ id: 'act1', name: 'Snap' }),
    added_by_email: OWNER.email,
    added_at: 1700000000000,
    day_index: null,
    start_time: null,
    display_order: 0,
    ...overrides,
  };
}

function setup(partial: Partial<State> = {}) {
  state = {
    trip: tripRow(),
    members: new Set([OWNER.email]),
    tripActivityRow: null,
    activities: [],
    dup: false,
    taOnTrip: true,
    snapshotJson: JSON.stringify({ id: 'act1', name: 'X' }),
    catalog: [],
    completedRows: [],
    usersRows: [],
    memberRows: [],
    inviteRows: [],
    voteRows: [],
    invite: null,
    tripList: [],
    counts: [],
    ...partial,
  };
  execute.mockImplementation((q: unknown) => Promise.resolve(routeExecute(q)));
  batch.mockResolvedValue([]);
}

afterEach(() => {
  execute.mockReset();
  batch.mockReset();
  vi.unstubAllGlobals();
});

// Routes a mocked global fetch by URL: Gemini endpoint vs Wikipedia.
function stubFetch(geminiBody: unknown, opts: { ok?: boolean } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('generativelanguage')) {
        return Promise.resolve({
          ok: opts.ok ?? true,
          status: opts.ok === false ? 502 : 200,
          json: () => Promise.resolve(geminiBody),
          text: () => Promise.resolve(JSON.stringify(geminiBody)),
        });
      }
      // Wikipedia thumbnail lookup — return not-ok so coverImage stays null.
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    }),
  );
}

function geminiText(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

// ===========================================================================
// Public reads
// ===========================================================================
describe('Query.activities (public)', () => {
  it('maps catalog rows and skips malformed JSON', async () => {
    setup({
      catalog: [
        {
          id: 'a1',
          j: JSON.stringify({
            id: 'a1',
            name: 'Trail',
            shortDescription: 's',
            category: 'hiking',
            region: 'sf',
            location: { city: 'X', coords: { lat: 1, lng: 2 } },
            duration: 'Half Day',
            coverImage: 'http://img',
          }),
        },
        { id: 'bad', j: 'not json' },
      ],
    });
    const r = await run('{ activities { id name category } }');
    expect(r.errors).toBeUndefined();
    const acts = r.data?.activities as Row[];
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ id: 'a1', name: 'Trail', category: 'hiking' });
  });

  it('passes through parkType + restaurant fields (extended schema @1f99970)', async () => {
    setup({
      catalog: [
        {
          id: 'r1',
          j: JSON.stringify({
            id: 'r1',
            name: 'Manresa',
            shortDescription: 's',
            category: 'food',
            region: 'south-bay',
            location: { city: 'Los Gatos', coords: { lat: 1, lng: 2 } },
            duration: 'Half Day',
            coverImage: 'http://img',
            parkType: 'none',
            cuisine: 'Californian',
            priceRange: '$$$$',
            hours: 'Wed–Sun',
            reservationUrl: 'http://resy',
            menuUrl: 'http://menu',
            dietary: ['vegetarian', 'vegan'],
          }),
        },
      ],
    });
    const r = await run(
      '{ activities { id parkType cuisine priceRange hours reservationUrl menuUrl dietary } }',
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.activities as Row[])[0]).toEqual({
      id: 'r1',
      parkType: 'none',
      cuisine: 'Californian',
      priceRange: '$$$$',
      hours: 'Wed–Sun',
      reservationUrl: 'http://resy',
      menuUrl: 'http://menu',
      dietary: ['vegetarian', 'vegan'],
    });
  });

  it('skips rows with no usable id or a JSON payload that is not an object', async () => {
    const valid = (id?: string) =>
      JSON.stringify({ ...(id ? { id } : {}), ...minimalActivity() });
    setup({
      catalog: [
        { id: 'a1', j: valid('a1') },
        // A null row id is skipped even when the payload carries its own id.
        { id: null, j: valid('ghost') },
        { id: '', j: valid('empty') },
        // Parseable JSON that isn't an object can't be an activity.
        { id: 'num', j: '42' },
        { id: 'str', j: '"just a string"' },
        { id: 'nul', j: 'null' },
      ],
    });
    const r = await run('{ activities { id name } }');
    expect(r.errors).toBeUndefined();
    expect(r.data?.activities).toEqual([{ id: 'a1', name: 'Trail' }]);
  });

  it('stringifies a numeric row id, including 0', async () => {
    setup({ catalog: [{ id: 0, j: JSON.stringify(minimalActivity()) }] });
    const r = await run('{ activities { id name } }');
    expect(r.errors).toBeUndefined();
    expect(r.data?.activities).toEqual([{ id: '0', name: 'Trail' }]);
  });
});

describe('Query.activities: malformed rows (data boundary)', () => {
  // Every field the client's ACTIVITIES_QUERY selects, so a value graphql can't
  // serialize anywhere in the row would surface as an error here.
  const FULL_SELECTION = `{ activities { id name shortDescription longDescription
    category region parkType location { city coords { lat lng } } duration
    durationDetail difficulty dogFriendly coverImage galleryImages allTrailsUrl
    allTrailsRating hikeDistanceMiles hikeElevationFeet cuisine priceRange hours
    reservationUrl menuUrl dietary completed completedDate notes } }`;

  const validRow = {
    id: 'good',
    name: 'Trail',
    shortDescription: 's',
    category: 'hiking',
    region: 'sf',
    location: { city: 'X', coords: { lat: 1, lng: 2 } },
    duration: 'Half Day',
    coverImage: 'http://img',
  };

  function catalogRow(id: string, fields: Row): Row {
    return { id, j: JSON.stringify({ ...fields, id }) };
  }

  function loggedLines(spy: { mock: { calls: unknown[][] } }): string {
    return spy.mock.calls.map((c) => String(c[0])).join('\n');
  }

  const REQUIRED = [
    'name',
    'shortDescription',
    'category',
    'region',
    'location',
    'duration',
    'coverImage',
  ] as const;

  it.each(REQUIRED)(
    'a row missing required %s is skipped and logged; the rest still load',
    async (field) => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const bad: Row = { ...validRow };
      delete bad[field];
      setup({ catalog: [catalogRow('good', validRow), catalogRow('bad-row', bad)] });
      const r = await run(FULL_SELECTION);
      expect(r.errors).toBeUndefined();
      expect((r.data?.activities as Row[]).map((a) => a.id)).toEqual(['good']);
      const logged = loggedLines(errSpy);
      expect(logged).toContain('bad-row');
      expect(logged).toContain(field);
      errSpy.mockRestore();
    },
  );

  it.each([
    ['an out-of-range category', { category: 'skiing' }],
    ['a location without coords', { location: { city: 'X' } }],
    ['a non-numeric latitude', { location: { city: 'X', coords: { lat: '1', lng: 2 } } }],
    ['a non-string name', { name: 42 }],
  ])('a row with %s is skipped; the rest still load', async (_label, patch) => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({
      catalog: [
        catalogRow('bad-row', { ...validRow, ...patch }),
        catalogRow('good', validRow),
      ],
    });
    const r = await run(FULL_SELECTION);
    expect(r.errors).toBeUndefined();
    expect((r.data?.activities as Row[]).map((a) => a.id)).toEqual(['good']);
    expect(loggedLines(errSpy)).toContain('bad-row');
    errSpy.mockRestore();
  });

  it('a JSON row that is not an object is skipped and logged', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({
      catalog: [{ id: 'arr', j: '[1,2]' }, catalogRow('good', validRow)],
    });
    const r = await run(FULL_SELECTION);
    expect(r.errors).toBeUndefined();
    expect((r.data?.activities as Row[]).map((a) => a.id)).toEqual(['good']);
    expect(loggedLines(errSpy)).toContain('arr');
    errSpy.mockRestore();
  });

  it('bad optional fields become null instead of failing the query', async () => {
    setup({
      catalog: [
        catalogRow('good', {
          ...validRow,
          difficulty: 'extreme',
          parkType: 'tribal',
          dogFriendly: 'yes',
          allTrailsRating: 'n/a',
          galleryImages: ['http://g1', 7],
          dietary: 'vegan',
          longDescription: { text: 'x' },
          completedDate: 'last summer',
        }),
      ],
    });
    const r = await run(FULL_SELECTION);
    expect(r.errors).toBeUndefined();
    expect((r.data?.activities as Row[])[0]).toMatchObject({
      id: 'good',
      name: 'Trail',
      difficulty: null,
      parkType: null,
      dogFriendly: null,
      allTrailsRating: null,
      galleryImages: ['http://g1'],
      dietary: null,
      longDescription: null,
      completedDate: null,
    });
  });

  it('falls back to the row id when the JSON has none', async () => {
    const noId: Row = { ...validRow };
    delete noId.id;
    setup({ catalog: [{ id: 'from-row', j: JSON.stringify(noId) }] });
    const r = await run('{ activities { id name } }');
    expect(r.errors).toBeUndefined();
    expect(r.data?.activities).toEqual([{ id: 'from-row', name: 'Trail' }]);
  });
});

describe('Query.completed (public)', () => {
  it('returns completion entries', async () => {
    setup({ completedRows: [{ id: 'a1', v: 1 }, { id: 'a2', v: 0 }] });
    const r = await run('{ completed { id completed } }');
    expect(r.errors).toBeUndefined();
    expect(r.data?.completed).toEqual([
      { id: 'a1', completed: true },
      { id: 'a2', completed: false },
    ]);
  });

  it('stringifies a numeric row id and skips a null id', async () => {
    setup({ completedRows: [{ id: 7, v: 1 }, { id: null, v: 0 }] });
    const r = await run('{ completed { id completed } }');
    expect(r.errors).toBeUndefined();
    // Numeric id → '7'; the null-id row is dropped (rowIdToString → null).
    expect(r.data?.completed).toEqual([{ id: '7', completed: true }]);
  });
});

// ===========================================================================
// Auth tiers — owner gate
// ===========================================================================
describe('owner-gated mutations', () => {
  it('saveActivity: anon → UNAUTHENTICATED', async () => {
    setup();
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id } } }',
      { i: { id: 'a1', activity: minimalActivity() } },
      null,
    );
    expect(code(r)).toBe('UNAUTHENTICATED');
  });

  it('saveActivity: signed-in non-owner → FORBIDDEN', async () => {
    setup();
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id } } }',
      { i: { id: 'a1', activity: minimalActivity() } },
      EDITOR,
    );
    expect(code(r)).toBe('FORBIDDEN');
  });

  it('saveActivity: owner → persists and echoes the activity', async () => {
    setup();
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id name } } }',
      { i: { id: 'a1', activity: minimalActivity() } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'a1', name: 'Trail' } });
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls.some((s) => /INSERT INTO a /.test(s))).toBe(true);
  });

  it('saveActivity: round-trips + persists parkType + restaurant fields', async () => {
    setup();
    const activity = {
      ...minimalActivity(),
      category: 'food',
      parkType: 'none',
      cuisine: 'Thai',
      priceRange: '$$',
      dietary: ['vegan'],
    };
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id parkType cuisine priceRange dietary } } }',
      { i: { id: 'r1', activity } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.saveActivity as Row).activity).toEqual({
      id: 'r1',
      parkType: 'none',
      cuisine: 'Thai',
      priceRange: '$$',
      dietary: ['vegan'],
    });
    // The persisted JSON carries the new fields through to storage.
    const insert = execute.mock.calls.find((c) => {
      const sql = typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql;
      return /INSERT INTO a /.test(sql);
    });
    const stored = (insert?.[0] as { args: unknown[] }).args[1] as string;
    expect(JSON.parse(stored)).toMatchObject({
      parkType: 'none',
      cuisine: 'Thai',
      dietary: ['vegan'],
    });
  });

  it('saveActivity: over-size JSON (>8000 chars) → BAD_USER_INPUT', async () => {
    setup();
    const big = { ...minimalActivity(), notes: 'x'.repeat(8001) };
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id } } }',
      { i: { id: 'a1', activity: big } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
  });

  it('deleteActivity: owner → returns deletedId', async () => {
    setup();
    const r = await run(
      'mutation($i: DeleteActivityInput!){ deleteActivity(input:$i){ deletedId } }',
      { i: { id: 'a1' } },
      OWNER,
    );
    expect(r.data?.deleteActivity).toEqual({ deletedId: 'a1' });
  });

  it('deleteActivity: drops the activity and its reviews in one batch', async () => {
    setup();
    await run(
      'mutation($i: DeleteActivityInput!){ deleteActivity(input:$i){ deletedId } }',
      { i: { id: 'a1' } },
      OWNER,
    );
    expect(batch).toHaveBeenCalledTimes(1);
    const [stmts, mode] = batch.mock.calls[0] as [
      { sql: string; args: unknown[] }[],
      string,
    ];
    expect(mode).toBe('write');
    expect(stmts.map((s) => s.sql)).toEqual([
      'DELETE FROM a WHERE id = ?',
      'DELETE FROM activity_reviews WHERE activity_id = ?',
    ]);
    expect(stmts.every((s) => s.args[0] === 'a1')).toBe(true);
  });

  it('setCompleted: value true sets, value null clears', async () => {
    setup();
    const set = await run(
      'mutation($i: SetCompletedInput!){ setCompleted(input:$i){ id completed } }',
      { i: { id: 'a1', value: true } },
      OWNER,
    );
    expect(set.data?.setCompleted).toEqual({ id: 'a1', completed: true });
    const cleared = await run(
      'mutation($i: SetCompletedInput!){ setCompleted(input:$i){ id completed } }',
      { i: { id: 'a1', value: null } },
      OWNER,
    );
    expect(cleared.data?.setCompleted).toEqual({ id: 'a1', completed: null });
  });

  it('saveActivity: persists a completedDate through the Date scalar', async () => {
    setup();
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id } } }',
      {
        i: {
          id: 'a1',
          activity: { ...minimalActivity(), completedDate: '2025-07-01' },
        },
      },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    const insert = execute.mock.calls.find((c) => {
      const sql = typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql;
      return /INSERT INTO a /.test(sql);
    });
    const stored = (insert?.[0] as { args: unknown[] }).args[1] as string;
    // buildStoredActivity normalizes the Date scalar back to 'YYYY-MM-DD'.
    expect(JSON.parse(stored)).toMatchObject({ completedDate: '2025-07-01' });
  });
});

// Every write the catalog mutations made through execute(), as { sql, args }.
function executeWrites(): { sql: string; args: unknown[] }[] {
  return execute.mock.calls
    .map((c) => c[0] as unknown)
    .filter((q): q is { sql: string; args: unknown[] } => typeof q === 'object' && q !== null)
    .filter((q) => /^(INSERT|DELETE|UPDATE)/.test(q.sql));
}

describe('catalog mutations: owner gate on every write', () => {
  const DELETE = 'mutation($i: DeleteActivityInput!){ deleteActivity(input:$i){ deletedId } }';
  const SET = 'mutation($i: SetCompletedInput!){ setCompleted(input:$i){ id completed } }';

  it('deleteActivity: anon → UNAUTHENTICATED, nothing deleted', async () => {
    setup();
    const r = await run(DELETE, { i: { id: 'a1' } }, null);
    expect(code(r)).toBe('UNAUTHENTICATED');
    expect(batch).not.toHaveBeenCalled();
  });

  it('deleteActivity: signed-in non-owner → FORBIDDEN, nothing deleted', async () => {
    setup();
    const r = await run(DELETE, { i: { id: 'a1' } }, EDITOR);
    expect(code(r)).toBe('FORBIDDEN');
    expect(batch).not.toHaveBeenCalled();
  });

  it('setCompleted: anon → UNAUTHENTICATED, nothing written', async () => {
    setup();
    const r = await run(SET, { i: { id: 'a1', value: true } }, null);
    expect(code(r)).toBe('UNAUTHENTICATED');
    expect(executeWrites()).toEqual([]);
  });

  it('setCompleted: signed-in non-owner → FORBIDDEN, nothing written', async () => {
    setup();
    const r = await run(SET, { i: { id: 'a1', value: null } }, EDITOR);
    expect(code(r)).toBe('FORBIDDEN');
    expect(executeWrites()).toEqual([]);
  });
});

describe('catalog mutations: input validation and persistence', () => {
  const SAVE = 'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id } } }';
  const DELETE = 'mutation($i: DeleteActivityInput!){ deleteActivity(input:$i){ deletedId } }';
  const SET = 'mutation($i: SetCompletedInput!){ setCompleted(input:$i){ id completed } }';

  it('an empty id → BAD_USER_INPUT on every catalog mutation, nothing written', async () => {
    setup();
    const save = await run(SAVE, { i: { id: '', activity: minimalActivity() } }, OWNER);
    const del = await run(DELETE, { i: { id: '' } }, OWNER);
    const set = await run(SET, { i: { id: '', value: true } }, OWNER);
    expect([code(save), code(del), code(set)]).toEqual([
      'BAD_USER_INPUT',
      'BAD_USER_INPUT',
      'BAD_USER_INPUT',
    ]);
    expect(executeWrites()).toEqual([]);
    expect(batch).not.toHaveBeenCalled();
  });

  it('saveActivity: stored JSON of exactly 8000 chars is accepted, 8001 is not', async () => {
    // Measure the stored JSON with empty notes, then pad notes so the stored
    // JSON lands exactly on the limit ("> 8000" is the rejection rule).
    setup();
    await run(SAVE, { i: { id: 'a1', activity: { ...minimalActivity(), notes: '' } } }, OWNER);
    const base = (executeWrites()[0]?.args[1] as string).length;
    const atLimit = { ...minimalActivity(), notes: 'x'.repeat(8000 - base) };
    const overLimit = { ...minimalActivity(), notes: 'x'.repeat(8001 - base) };

    execute.mockClear();
    const ok = await run(SAVE, { i: { id: 'a1', activity: atLimit } }, OWNER);
    expect(ok.errors).toBeUndefined();
    expect((executeWrites()[0]?.args[1] as string).length).toBe(8000);

    execute.mockClear();
    const tooBig = await run(SAVE, { i: { id: 'a1', activity: overLimit } }, OWNER);
    expect(code(tooBig)).toBe('BAD_USER_INPUT');
    expect(executeWrites()).toEqual([]);
  });

  it('setCompleted: true / false upsert v = 1 / 0 for the id', async () => {
    setup();
    const on = await run(SET, { i: { id: 'a1', value: true } }, OWNER);
    const off = await run(SET, { i: { id: 'a2', value: false } }, OWNER);
    expect(on.data?.setCompleted).toEqual({ id: 'a1', completed: true });
    expect(off.data?.setCompleted).toEqual({ id: 'a2', completed: false });
    const writes = executeWrites();
    expect(writes.map((w) => w.args)).toEqual([
      ['a1', 1],
      ['a2', 0],
    ]);
    expect(writes.every((w) => /^INSERT INTO c /.test(w.sql))).toBe(true);
  });

  it('setCompleted: null clears the override with a DELETE, never an upsert', async () => {
    setup();
    const r = await run(SET, { i: { id: 'a1', value: null } }, OWNER);
    expect(r.data?.setCompleted).toEqual({ id: 'a1', completed: null });
    expect(executeWrites()).toEqual([{ sql: 'DELETE FROM c WHERE id = ?', args: ['a1'] }]);
  });
});

function minimalActivity() {
  return {
    name: 'Trail',
    shortDescription: 's',
    category: 'hiking',
    region: 'sf',
    location: { city: 'X', coords: { lat: 1, lng: 2 } },
    duration: 'Half Day',
    coverImage: 'http://img',
  };
}

// ===========================================================================
// Gemini ops (owner)
// ===========================================================================
describe('Gemini ops', () => {
  it('discover: non-owner → FORBIDDEN', async () => {
    setup();
    const r = await run('{ discover(range: weekend){ range } }', {}, EDITOR);
    expect(code(r)).toBe('FORBIDDEN');
  });

  it('discover: owner → events + sources', async () => {
    setup();
    stubFetch({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify([
                  { name: 'Market', dateText: 'Sat', location: 'LG', blurb: 'b', sourceUrl: 'u' },
                ]),
              },
            ],
          },
          groundingMetadata: {
            groundingChunks: [{ web: { uri: 'http://s', title: 'Src' } }],
          },
        },
      ],
    });
    const r = await run(
      '{ discover(range: weekend){ range events { name location } sources { uri title } } }',
      {},
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    const d = r.data?.discover as Row;
    expect(d.range).toBe('weekend');
    expect((d.events as Row[])[0]).toMatchObject({ name: 'Market', location: 'LG' });
    expect((d.sources as Row[])[0]).toMatchObject({ uri: 'http://s', title: 'Src' });
  });

  it('generateActivity: owner with no title → BAD_USER_INPUT', async () => {
    setup();
    const r = await run(
      'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name } } }',
      { i: { title: '   ' } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
  });

  it('generateActivity: owner happy path returns the generated activity', async () => {
    setup();
    stubFetch(
      geminiText(
        JSON.stringify({
          name: 'Castle Rock',
          shortDescription: 'Ridgeline hike',
          category: 'hiking',
          region: 'south-bay',
          parkType: 'state',
          city: 'Los Gatos',
          lat: 37.2,
          lng: -122.1,
          duration: 'Half Day',
          difficulty: 'moderate',
          dogFriendly: true,
        }),
      ),
    );
    const r = await run(
      'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name category city parkType } } }',
      { i: { title: 'Castle Rock' } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.generateActivity).toEqual({
      activity: { name: 'Castle Rock', category: 'hiking', city: 'Los Gatos', parkType: 'state' },
    });
  });

  it('generateActivity: passes through restaurant fields when present', async () => {
    setup();
    stubFetch(
      geminiText(
        JSON.stringify({
          name: 'Manresa',
          shortDescription: 'Tasting menu',
          category: 'food',
          region: 'south-bay',
          city: 'Los Gatos',
          lat: 37.2,
          lng: -122.1,
          duration: 'Half Day',
          difficulty: 'easy',
          dogFriendly: false,
          cuisine: 'Californian',
          priceRange: '$$$$',
          dietary: ['vegetarian'],
        }),
      ),
    );
    const r = await run(
      'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name cuisine priceRange dietary } } }',
      { i: { title: 'Manresa' } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.generateActivity).toEqual({
      activity: { name: 'Manresa', cuisine: 'Californian', priceRange: '$$$$', dietary: ['vegetarian'] },
    });
  });

  it('generateActivity: gemini omits required fields → BAD_GATEWAY (parity guard m3)', async () => {
    setup();
    // Valid JSON, but `name` + `lat` (both non-null in GeneratedActivity) are
    // omitted. Without the guard these surface as opaque non-null GraphQL errors;
    // the guard rejects with a clear BAD_GATEWAY naming the missing fields.
    stubFetch(
      geminiText(
        JSON.stringify({
          shortDescription: 'Ridgeline hike',
          category: 'hiking',
          region: 'south-bay',
          city: 'Los Gatos',
          lng: -122.1,
          duration: 'Half Day',
        }),
      ),
    );
    const r = await run(
      'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name } } }',
      { i: { title: 'Castle Rock' } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_GATEWAY');
    expect(r.errors?.[0].message).toMatch(/name/);
    expect(r.errors?.[0].message).toMatch(/lat/);
  });

  const castleRock = {
    name: 'Castle Rock',
    shortDescription: 'Ridgeline hike',
    category: 'hiking',
    region: 'south-bay',
    parkType: 'state',
    city: 'Los Gatos',
    lat: 37.2,
    lng: -122.1,
    duration: 'Half Day',
    difficulty: 'moderate',
    dogFriendly: true,
  };
  const GENERATE =
    'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name category difficulty parkType priceRange coverImage } } }';

  it('generateActivity: out-of-range category → BAD_GATEWAY naming it', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    stubFetch(geminiText(JSON.stringify({ ...castleRock, category: 'skiing' })));
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(code(r)).toBe('BAD_GATEWAY');
    expect(r.errors?.[0].message).toContain('category');
    errSpy.mockRestore();
  });

  it('generateActivity: drops out-of-range optional enums, keeps the rest', async () => {
    setup();
    stubFetch(
      geminiText(
        JSON.stringify({
          ...castleRock,
          difficulty: 'extreme',
          parkType: 'tribal',
          priceRange: 'cheap',
        }),
      ),
    );
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect((r.data?.generateActivity as { activity: Row }).activity).toMatchObject({
      name: 'Castle Rock',
      category: 'hiking',
      difficulty: null,
      parkType: null,
      priceRange: null,
    });
  });

  it('generateActivity: keeps in-range optional enums', async () => {
    setup();
    stubFetch(geminiText(JSON.stringify({ ...castleRock, priceRange: '$$' })));
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect((r.data?.generateActivity as { activity: Row }).activity).toMatchObject({
      difficulty: 'moderate',
      parkType: 'state',
      priceRange: '$$',
    });
  });

  it('generateActivity: gemini JSON that is not an object → BAD_GATEWAY', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    stubFetch(geminiText('null'));
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(code(r)).toBe('BAD_GATEWAY');
    errSpy.mockRestore();
  });

  // Routes Gemini to `geminiBody` and every Wikipedia lookup to a page whose
  // thumbnail source is `thumb`.
  function stubFetchWithThumbnail(geminiBody: unknown, thumb: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body = url.includes('generativelanguage')
          ? geminiBody
          : { query: { pages: { '1': { thumbnail: { source: thumb } } } } };
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
        });
      }),
    );
  }

  it('generateActivity: uses an https Wikipedia thumbnail as the cover image', async () => {
    setup();
    stubFetchWithThumbnail(
      geminiText(JSON.stringify(castleRock)),
      'https://upload.wikimedia.org/castle.jpg',
    );
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(
      (r.data?.generateActivity as { activity: Row }).activity.coverImage,
    ).toBe('https://upload.wikimedia.org/castle.jpg');
  });

  it.each([
    ['a javascript: URL', 'javascript:alert(1)'],
    ['an http URL', 'http://upload.wikimedia.org/castle.jpg'],
    ['not a URL', 'castle.jpg'],
    ['a number', 42],
    ['an object', { url: 'https://x' }],
  ])(
    'generateActivity: ignores a Wikipedia thumbnail that is %s',
    async (_label, thumb) => {
      setup();
      stubFetchWithThumbnail(geminiText(JSON.stringify(castleRock)), thumb);
      const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
      expect(r.errors).toBeUndefined();
      expect(
        (r.data?.generateActivity as { activity: Row }).activity.coverImage,
      ).toBeNull();
    },
  );

  it('alltrailsLookup: non-alltrails URL → BAD_USER_INPUT', async () => {
    setup();
    const r = await run(
      'mutation($i: AlltrailsLookupInput!){ alltrailsLookup(input:$i){ lookup { allTrailsRating } } }',
      { i: { url: 'https://example.com/trail' } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
  });

  it('alltrailsLookup: owner happy path returns numbers', async () => {
    setup();
    stubFetch(
      geminiText(
        JSON.stringify({ allTrailsRating: 4.6, hikeDistanceMiles: 5.1, hikeElevationFeet: 1200 }),
      ),
    );
    const r = await run(
      'mutation($i: AlltrailsLookupInput!){ alltrailsLookup(input:$i){ lookup { allTrailsRating hikeDistanceMiles hikeElevationFeet } } }',
      { i: { url: 'https://www.alltrails.com/trail/us/california/x' } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.alltrailsLookup).toEqual({
      lookup: { allTrailsRating: 4.6, hikeDistanceMiles: 5.1, hikeElevationFeet: 1200 },
    });
  });
});

// ===========================================================================
// Trips
// ===========================================================================
describe('Query.trips / trip', () => {
  it('trips: anon → UNAUTHENTICATED', async () => {
    setup();
    const r = await run('{ trips { id } }', {}, null);
    expect(code(r)).toBe('UNAUTHENTICATED');
  });

  it('trips: member-scoped list with counts', async () => {
    setup({
      tripList: [tripRow({ status: 'planning' })],
      counts: [{ trip_id: 'trip1', scheduled: 2, unscheduled: 1 }],
    });
    const r = await run('{ trips { id scheduledCount unscheduledCount } }', {}, OWNER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.trips).toEqual([
      { id: 'trip1', scheduledCount: 2, unscheduledCount: 1 },
    ]);
  });

  it('trip(id): anon → UNAUTHENTICATED', async () => {
    setup();
    const r = await run('query($id: ID!){ trip(id:$id){ id } }', { id: 'trip1' }, null);
    expect(code(r)).toBe('UNAUTHENTICATED');
  });

  it('trip(id): non-member → null (existence hidden)', async () => {
    setup({ members: new Set([OWNER.email]) });
    const r = await run('query($id: ID!){ trip(id:$id){ id } }', { id: 'trip1' }, OUTSIDER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.trip).toBeNull();
  });

  it('trip(id): member → full trip, snapshot null-coerced (no 500)', async () => {
    setup({
      activities: [
        taRow({
          id: 'ta1',
          snapshot_json: JSON.stringify({
            id: 'act1',
            name: 'Half Dome',
            category: 'NOT_A_CATEGORY', // invalid enum → coerced to null
            parkType: 'moon', // invalid enum → coerced to null
            cuisine: 'Thai', // valid restaurant field → preserved
            location: 'totally malformed', // invalid shape → coerced to null
          }),
        }),
      ],
      memberRows: [
        {
          member_email: OWNER.email,
          added_by_email: OWNER.email,
          added_at: 1700000000000,
          display_name: 'Owner',
        },
      ],
      voteRows: [{ trip_activity_id: 'ta1', member_email: OWNER.email, value: 1 }],
    });
    const r = await run(
      `query($id: ID!){ trip(id:$id){
         id createdAt
         activities { id snapshot { name category parkType cuisine location { city } } }
         members { email isCreator }
         votes { tripActivityId value }
       } }`,
      { id: 'trip1' },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    const trip = r.data?.trip as Row;
    expect(trip.id).toBe('trip1');
    // createdAt epoch-ms serialized to ISO by the DateTimeISO scalar.
    expect(trip.createdAt).toBe('2023-11-14T22:13:20.000Z');
    const snap = (trip.activities as Row[])[0].snapshot as Row;
    expect(snap.name).toBe('Half Dome'); // valid field survives
    expect(snap.category).toBeNull(); // bad enum → null
    expect(snap.parkType).toBeNull(); // bad enum → null
    expect(snap.cuisine).toBe('Thai'); // valid restaurant field survives
    expect(snap.location).toBeNull(); // bad shape → null
    expect((trip.members as Row[])[0]).toEqual({ email: OWNER.email, isCreator: true });
  });
});

describe('Mutation.createTrip / patchTrip / deleteTrip', () => {
  it('createTrip: non-owner → FORBIDDEN', async () => {
    setup();
    const r = await run(
      'mutation($i: CreateTripInput!){ createTrip(input:$i){ trip { id } } }',
      { i: { title: 'T', startDate: '2025-07-01', endDate: '2025-07-03' } },
      EDITOR,
    );
    expect(code(r)).toBe('FORBIDDEN');
  });

  it('createTrip: endDate before startDate → BAD_USER_INPUT', async () => {
    setup();
    const r = await run(
      'mutation($i: CreateTripInput!){ createTrip(input:$i){ trip { id } } }',
      { i: { title: 'T', startDate: '2025-07-05', endDate: '2025-07-01' } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
  });

  it('createTrip: owner happy path returns the created trip', async () => {
    // After insert, getTripDetail loads the header from `trip`.
    setup({ trip: tripRow({ status: 'planning' }), memberRows: [] });
    const r = await run(
      'mutation($i: CreateTripInput!){ createTrip(input:$i){ trip { id title status } } }',
      { i: { title: 'New', startDate: '2025-07-01', endDate: '2025-07-03', status: voting() } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.createTrip as Row).trip).toMatchObject({ id: 'trip1' });
  });

  it('patchTrip: non-member → NOT_FOUND (existence hidden)', async () => {
    setup({ members: new Set([OWNER.email]) });
    const r = await run(
      'mutation($i: PatchTripInput!){ patchTrip(input:$i){ trip { id } } }',
      { i: { id: 'trip1', patch: { title: 'New' } } },
      OUTSIDER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });

  it('patchTrip: title on a PAST trip → CONFLICT trip_past', async () => {
    setup({ trip: tripRow({ status: 'past' }) });
    const r = await run(
      'mutation($i: PatchTripInput!){ patchTrip(input:$i){ trip { id } } }',
      { i: { id: 'trip1', patch: { title: 'New' } } },
      OWNER,
    );
    expect(code(r)).toBe('CONFLICT');
    expect(appCode(r)).toBe('trip_past');
  });

  it('patchTrip: description-only on a PAST trip is allowed (absent-vs-null)', async () => {
    setup({ trip: tripRow({ status: 'past' }) });
    const r = await run(
      'mutation($i: PatchTripInput!){ patchTrip(input:$i){ trip { id } } }',
      { i: { id: 'trip1', patch: { description: 'note' } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.patchTrip as Row).trip).toMatchObject({ id: 'trip1' });
    expect(batch).toHaveBeenCalledWith(
      [{ sql: 'UPDATE trips SET description = ? WHERE id = ?', args: ['note', 'trip1'] }],
      'write',
    );
  });

  it('patchTrip: forwards a title edit', async () => {
    setup({ trip: tripRow({ status: 'planning' }) });
    const r = await run(
      'mutation($i: PatchTripInput!){ patchTrip(input:$i){ trip { id } } }',
      { i: { id: 'trip1', patch: { title: 'Renamed' } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(batch).toHaveBeenCalledWith(
      [{ sql: 'UPDATE trips SET title = ? WHERE id = ?', args: ['Renamed', 'trip1'] }],
      'write',
    );
  });

  it('patchTrip: an explicit null description clears it (absent-vs-null)', async () => {
    setup({ trip: tripRow({ status: 'planning', description: 'old' }) });
    const r = await run(
      'mutation($i: PatchTripInput!){ patchTrip(input:$i){ trip { id } } }',
      { i: { id: 'trip1', patch: { description: null } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(batch).toHaveBeenCalledWith(
      [{ sql: 'UPDATE trips SET description = ? WHERE id = ?', args: [null, 'trip1'] }],
      'write',
    );
  });

  it('patchTrip: trip removed before the payload reload → NOT_FOUND', async () => {
    // Reads of the trip row: membership guard, patchTrip's own load, its
    // post-write reload, then the resolver's getTripDetail. The trip vanishes
    // only on that last one (a concurrent delete), which must surface as
    // NOT_FOUND rather than a crash mapping a missing trip.
    let tripSelects = 0;
    execute.mockImplementation((q: unknown) => {
      const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
      if (/SELECT \* FROM trips WHERE id = \?/.test(sql)) {
        tripSelects += 1;
        return Promise.resolve({
          rows: tripSelects <= 3 ? [tripRow({ status: 'planning' })] : [],
        });
      }
      if (/SELECT 1 FROM trip_members WHERE trip_id = \? AND member_email/.test(sql)) {
        return Promise.resolve({ rows: [{ '1': 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    batch.mockResolvedValue([]);
    const r = await run(
      'mutation($i: PatchTripInput!){ patchTrip(input:$i){ trip { id } } }',
      { i: { id: 'trip1', patch: { description: 'note' } } },
      OWNER,
    );
    expect(tripSelects).toBe(4);
    expect(code(r)).toBe('NOT_FOUND');
  });

  it('deleteTrip: non-creator member → FORBIDDEN', async () => {
    setup({ members: new Set([OWNER.email, EDITOR.email]) });
    const r = await run(
      'mutation($i: DeleteTripInput!){ deleteTrip(input:$i){ deletedId } }',
      { i: { id: 'trip1' } },
      EDITOR,
    );
    expect(code(r)).toBe('FORBIDDEN');
  });

  it('deleteTrip: creator → deletedId + cascade batch', async () => {
    setup();
    const r = await run(
      'mutation($i: DeleteTripInput!){ deleteTrip(input:$i){ deletedId } }',
      { i: { id: 'trip1' } },
      OWNER,
    );
    expect(r.data?.deleteTrip).toEqual({ deletedId: 'trip1' });
    expect(batch).toHaveBeenCalledOnce();
  });

  it('patchTrip: forwards startDate/endDate/coverImageUrl patch keys', async () => {
    setup({ trip: tripRow({ status: 'planning' }) });
    const r = await run(
      'mutation($i: PatchTripInput!){ patchTrip(input:$i){ trip { id } } }',
      {
        i: {
          id: 'trip1',
          patch: {
            startDate: '2025-07-02',
            endDate: '2025-07-05',
            coverImageUrl: 'http://cover',
          },
        },
      },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.patchTrip as Row).trip).toMatchObject({ id: 'trip1' });
    const [stmts] = batch.mock.calls[0] as [{ sql: string; args: unknown[] }[]];
    expect(stmts[0]).toEqual({
      sql: 'UPDATE trips SET start_date = ?, end_date = ?, cover_image_url = ? WHERE id = ?',
      args: ['2025-07-02', '2025-07-05', 'http://cover', 'trip1'],
    });
  });
});

function voting() {
  return 'voting';
}

// ===========================================================================
// Trip activities
// ===========================================================================
describe('Mutation.addTripActivity', () => {
  it('non-member → NOT_FOUND', async () => {
    setup({ members: new Set([OWNER.email]) });
    const r = await run(
      'mutation($i: AddTripActivityInput!){ addTripActivity(input:$i){ tripActivity { id } } }',
      { i: { tripId: 'trip1', activityId: 'act1' } },
      OUTSIDER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });

  it('member → creates a candidate', async () => {
    setup({ tripActivityRow: taRow(), activities: [taRow()] });
    const r = await run(
      'mutation($i: AddTripActivityInput!){ addTripActivity(input:$i){ tripActivity { id tripId } } }',
      { i: { tripId: 'trip1', activityId: 'act1' } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.addTripActivity as Row).tripActivity).toMatchObject({
      id: 'ta1',
      tripId: 'trip1',
    });
  });

  it('duplicate → CONFLICT duplicate', async () => {
    setup({ dup: true });
    const r = await run(
      'mutation($i: AddTripActivityInput!){ addTripActivity(input:$i){ tripActivity { id } } }',
      { i: { tripId: 'trip1', activityId: 'act1' } },
      OWNER,
    );
    expect(code(r)).toBe('CONFLICT');
    expect(appCode(r)).toBe('duplicate');
  });

  it('past trip → CONFLICT trip_past', async () => {
    setup({ trip: tripRow({ status: 'past' }) });
    const r = await run(
      'mutation($i: AddTripActivityInput!){ addTripActivity(input:$i){ tripActivity { id } } }',
      { i: { tripId: 'trip1', activityId: 'act1' } },
      OWNER,
    );
    expect(appCode(r)).toBe('trip_past');
  });

  it('unknown activity (no snapshot) → NOT_FOUND', async () => {
    setup({ snapshotJson: null });
    const r = await run(
      'mutation($i: AddTripActivityInput!){ addTripActivity(input:$i){ tripActivity { id } } }',
      { i: { tripId: 'trip1', activityId: 'ghost' } },
      OWNER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });

  it('trip removed between the membership check and the reload → NOT_FOUND', async () => {
    // The 1st `SELECT * FROM trips` (membership guard in requireMemberCtx) sees
    // the trip; the 2nd (the resolver's own reload) finds it gone — exercises
    // addTripActivity's defensive post-guard NOT_FOUND (a delete/TOCTOU race).
    let tripSelects = 0;
    execute.mockImplementation((q: unknown) => {
      const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
      if (/SELECT \* FROM trips WHERE id = \?/.test(sql)) {
        tripSelects += 1;
        return Promise.resolve({ rows: tripSelects === 1 ? [tripRow()] : [] });
      }
      if (/SELECT 1 FROM trip_members WHERE trip_id = \? AND member_email/.test(sql)) {
        return Promise.resolve({ rows: [{ '1': 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await run(
      'mutation($i: AddTripActivityInput!){ addTripActivity(input:$i){ tripActivity { id } } }',
      { i: { tripId: 'trip1', activityId: 'act1' } },
      OWNER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });
});

// Args of the slot UPDATE patchTripActivity wrote: [day_index, start_time,
// display_order, id].
function slotUpdateArgs(): unknown {
  const call = execute.mock.calls.find(
    ([q]) => typeof q !== 'string' && /UPDATE trip_activities/.test((q as { sql: string }).sql),
  );
  return (call?.[0] as { args: unknown[] } | undefined)?.args;
}

describe('Mutation.assignSlot / setDisplayOrder', () => {
  it('unknown candidate → NOT_FOUND', async () => {
    setup({ tripActivityRow: null });
    const r = await run(
      'mutation($i: AssignSlotInput!){ assignSlot(input:$i){ tripActivity { id } } }',
      { i: { taId: 'ghost', displayOrder: 1 } },
      OWNER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });

  it('assignSlot dayIndex during voting → CONFLICT voting_locked', async () => {
    setup({ tripActivityRow: taRow(), trip: tripRow({ status: 'voting' }) });
    const r = await run(
      'mutation($i: AssignSlotInput!){ assignSlot(input:$i){ tripActivity { id } } }',
      { i: { taId: 'ta1', dayIndex: 0, startTime: '09:00' } },
      OWNER,
    );
    expect(appCode(r)).toBe('voting_locked');
  });

  it('assignSlot displayOrder-only during voting is allowed (absent-vs-null)', async () => {
    setup({ tripActivityRow: taRow(), trip: tripRow({ status: 'voting' }) });
    const r = await run(
      'mutation($i: AssignSlotInput!){ assignSlot(input:$i){ tripActivity { id displayOrder } } }',
      { i: { taId: 'ta1', displayOrder: 3 } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.assignSlot as Row).tripActivity).toMatchObject({ id: 'ta1' });
    expect(slotUpdateArgs()).toEqual([null, null, 3, 'ta1']);
  });

  it('assignSlot valid slot during planning → updates', async () => {
    setup({ tripActivityRow: taRow(), trip: tripRow({ status: 'planning' }) });
    const r = await run(
      'mutation($i: AssignSlotInput!){ assignSlot(input:$i){ tripActivity { id } } }',
      { i: { taId: 'ta1', dayIndex: 0, startTime: '09:00' } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(slotUpdateArgs()).toEqual([0, '09:00', 0, 'ta1']);
  });

  it('assignSlot inconsistent (only dayIndex, no time) during planning → BAD_USER_INPUT', async () => {
    setup({ tripActivityRow: taRow(), trip: tripRow({ status: 'planning' }) });
    const r = await run(
      'mutation($i: AssignSlotInput!){ assignSlot(input:$i){ tripActivity { id } } }',
      { i: { taId: 'ta1', dayIndex: 0 } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
  });

  it('setDisplayOrder during voting → allowed', async () => {
    setup({ tripActivityRow: taRow(), trip: tripRow({ status: 'voting' }) });
    const r = await run(
      'mutation($i: SetDisplayOrderInput!){ setDisplayOrder(input:$i){ tripActivity { id } } }',
      { i: { taId: 'ta1', displayOrder: 5 } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(slotUpdateArgs()).toEqual([null, null, 5, 'ta1']);
  });

  it('trip removed after loading the candidate → NOT_FOUND', async () => {
    // loadTaForMember: the candidate loads and membership passes on the 1st
    // trips read, but the reload (2nd read) finds the trip gone — exercises the
    // shared taId-keyed path's defensive post-guard NOT_FOUND.
    let tripSelects = 0;
    execute.mockImplementation((q: unknown) => {
      const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
      if (/SELECT \* FROM trip_activities WHERE id = \?/.test(sql)) {
        return Promise.resolve({ rows: [taRow()] });
      }
      if (/SELECT \* FROM trips WHERE id = \?/.test(sql)) {
        tripSelects += 1;
        return Promise.resolve({ rows: tripSelects === 1 ? [tripRow()] : [] });
      }
      if (/SELECT 1 FROM trip_members WHERE trip_id = \? AND member_email/.test(sql)) {
        return Promise.resolve({ rows: [{ '1': 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const r = await run(
      'mutation($i: AssignSlotInput!){ assignSlot(input:$i){ tripActivity { id } } }',
      { i: { taId: 'ta1', displayOrder: 1 } },
      OWNER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });
});

describe('Mutation.removeTripActivity', () => {
  it('non-adder non-creator member → FORBIDDEN not_adder', async () => {
    setup({
      members: new Set([OWNER.email, EDITOR.email]),
      tripActivityRow: taRow({ added_by_email: OWNER.email }),
    });
    const r = await run(
      'mutation($i: RemoveTripActivityInput!){ removeTripActivity(input:$i){ deletedId } }',
      { i: { taId: 'ta1' } },
      EDITOR,
    );
    expect(appCode(r)).toBe('not_adder');
  });

  it('adder → removes', async () => {
    setup({ tripActivityRow: taRow({ added_by_email: OWNER.email }) });
    const r = await run(
      'mutation($i: RemoveTripActivityInput!){ removeTripActivity(input:$i){ deletedId } }',
      { i: { taId: 'ta1' } },
      OWNER,
    );
    expect(r.data?.removeTripActivity).toEqual({ deletedId: 'ta1' });
    expect(batch).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// Voting + lifecycle
// ===========================================================================
// The trip row is visible to the first `reads` loads (the membership guard),
// then gone: a concurrent delete landing between the guard and the resolver's
// own reload.
function mockTripVanishesAfter(reads: number) {
  let tripSelects = 0;
  execute.mockImplementation((q: unknown) => {
    const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
    if (/SELECT \* FROM trips WHERE id = \?/.test(sql)) {
      tripSelects += 1;
      return Promise.resolve({ rows: tripSelects <= reads ? [tripRow()] : [] });
    }
    if (/SELECT 1 FROM trip_members WHERE trip_id = \? AND member_email/.test(sql)) {
      return Promise.resolve({ rows: [{ '1': 1 }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('Mutation.castVote', () => {
  it('invalid value 2 → BAD_USER_INPUT', async () => {
    setup();
    const r = await run(
      'mutation($i: CastVoteInput!){ castVote(input:$i){ vote { value } } }',
      { i: { tripId: 'trip1', tripActivityId: 'ta1', value: 2 } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
  });

  it('not voting → CONFLICT not_voting', async () => {
    setup({ trip: tripRow({ status: 'planning' }) });
    const r = await run(
      'mutation($i: CastVoteInput!){ castVote(input:$i){ vote { value } } }',
      { i: { tripId: 'trip1', tripActivityId: 'ta1', value: 1 } },
      OWNER,
    );
    expect(appCode(r)).toBe('not_voting');
  });

  it('value 1 → returns the vote', async () => {
    setup();
    const r = await run(
      'mutation($i: CastVoteInput!){ castVote(input:$i){ vote { tripActivityId memberEmail value } } }',
      { i: { tripId: 'trip1', tripActivityId: 'ta1', value: 1 } },
      OWNER,
    );
    expect((r.data?.castVote as Row).vote).toEqual({
      tripActivityId: 'ta1',
      memberEmail: OWNER.email,
      value: 1,
    });
  });

  it('value -1 → returns the downvote', async () => {
    setup();
    const r = await run(
      'mutation($i: CastVoteInput!){ castVote(input:$i){ vote { tripActivityId memberEmail value } } }',
      { i: { tripId: 'trip1', tripActivityId: 'ta1', value: -1 } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.castVote as Row).vote).toEqual({
      tripActivityId: 'ta1',
      memberEmail: OWNER.email,
      value: -1,
    });
  });

  it('trip removed between the membership check and the reload → NOT_FOUND', async () => {
    mockTripVanishesAfter(1);
    const r = await run(
      'mutation($i: CastVoteInput!){ castVote(input:$i){ vote { value } } }',
      { i: { tripId: 'trip1', tripActivityId: 'ta1', value: 1 } },
      OWNER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });

  it('value 0 → vote removed (null payload)', async () => {
    setup();
    const r = await run(
      'mutation($i: CastVoteInput!){ castVote(input:$i){ vote { value } } }',
      { i: { tripId: 'trip1', tripActivityId: 'ta1', value: 0 } },
      OWNER,
    );
    expect(r.data?.castVote).toEqual({ vote: null });
  });

  it('candidate not on trip → NOT_FOUND', async () => {
    setup({ taOnTrip: false });
    const r = await run(
      'mutation($i: CastVoteInput!){ castVote(input:$i){ vote { value } } }',
      { i: { tripId: 'trip1', tripActivityId: 'ghost', value: 1 } },
      OWNER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });
});

describe('Mutation.transitionTrip', () => {
  it('non-creator → FORBIDDEN', async () => {
    setup({
      members: new Set([OWNER.email, EDITOR.email]),
      trip: tripRow({ creator_email: OWNER.email }),
    });
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok } }',
      { i: { id: 'trip1', to: planning() } },
      EDITOR,
    );
    expect(code(r)).toBe('FORBIDDEN');
  });

  it('to=planning when not voting → CONFLICT not_voting', async () => {
    setup({ trip: tripRow({ status: 'planning' }) });
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok } }',
      { i: { id: 'trip1', to: planning(), keptActivityIds: [] } },
      OWNER,
    );
    expect(appCode(r)).toBe('not_voting');
  });

  it('to=voting on a past trip → CONFLICT not_planning', async () => {
    setup({ trip: tripRow({ status: 'past' }) });
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok } }',
      { i: { id: 'trip1', to: votingStatus() } },
      OWNER,
    );
    expect(appCode(r)).toBe('not_planning');
  });

  it('to=planning culls + flips, returns kept count', async () => {
    setup({
      trip: tripRow({ status: 'voting' }),
      activities: [{ id: 'a' }, { id: 'b' }],
    });
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok status kept } }',
      { i: { id: 'trip1', to: planning(), keptActivityIds: ['a'] } },
      OWNER,
    );
    expect(r.data?.transitionTrip).toEqual({ ok: true, status: 'planning', kept: 1 });
  });

  it('to=past freezes + returns markedPastAt (completedActivityIds omitted → default)', async () => {
    setup({ trip: tripRow({ status: 'planning' }), activities: [] });
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok status markedPastAt completedActivityIds } }',
      { i: { id: 'trip1', to: past() } }, // completedActivityIds absent → `?? []`
      OWNER,
    );
    const t = r.data?.transitionTrip as Row;
    expect(t.ok).toBe(true);
    expect(t.status).toBe('past');
    expect(t.markedPastAt).toBeTruthy();
  });

  it('to=voting reopens a planning trip and returns status voting', async () => {
    setup({ trip: tripRow({ status: 'planning' }), activities: [] });
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok status } }',
      { i: { id: 'trip1', to: votingStatus() } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.transitionTrip).toEqual({ ok: true, status: 'voting' });
    expect(batch).toHaveBeenCalled();
  });

  it('to=planning defaults keptActivityIds when the field is omitted', async () => {
    setup({ trip: tripRow({ status: 'voting' }), activities: [] });
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok status kept } }',
      { i: { id: 'trip1', to: planning() } }, // keptActivityIds absent → `?? []`
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.transitionTrip).toEqual({ ok: true, status: 'planning', kept: 0 });
  });

  it('trip removed between the creator check and the reload → NOT_FOUND', async () => {
    mockTripVanishesAfter(1);
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok } }',
      { i: { id: 'trip1', to: votingStatus() } },
      OWNER,
    );
    expect(code(r)).toBe('NOT_FOUND');
  });

  it('to=past when already past → CONFLICT', async () => {
    setup({ trip: tripRow({ status: 'past' }) });
    const r = await run(
      'mutation($i: TransitionTripInput!){ transitionTrip(input:$i){ ok } }',
      { i: { id: 'trip1', to: past(), completedActivityIds: [] } },
      OWNER,
    );
    expect(code(r)).toBe('CONFLICT');
  });
});

function planning() {
  return 'planning';
}
function votingStatus() {
  return 'voting';
}
function past() {
  return 'past';
}

// ===========================================================================
// Membership
// ===========================================================================
describe('Query.users', () => {
  it('anon → UNAUTHENTICATED', async () => {
    setup();
    const r = await run('{ users { email } }', {}, null);
    expect(code(r)).toBe('UNAUTHENTICATED');
  });

  it('authed → mapped list with displayName', async () => {
    setup({ usersRows: [{ email: 'a@b.com', display_name: 'Ada' }] });
    const r = await run('{ users { email displayName } }', {}, EDITOR);
    expect(r.data?.users).toEqual([{ email: 'a@b.com', displayName: 'Ada' }]);
  });
});

describe('Mutation.inviteMember / removeMember / revokeInvite', () => {
  it('inviteMember: invalid email → BAD_USER_INPUT', async () => {
    setup();
    const r = await run(
      'mutation($i: InviteMemberInput!){ inviteMember(input:$i){ invite { inviteToken } } }',
      { i: { tripId: 'trip1', email: 'not-an-email' } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
  });

  it('inviteMember: already a member → CONFLICT already_member', async () => {
    setup({ members: new Set([OWNER.email, 'dup@example.com']) });
    const r = await run(
      'mutation($i: InviteMemberInput!){ inviteMember(input:$i){ invite { inviteToken } } }',
      { i: { tripId: 'trip1', email: 'dup@example.com' } },
      OWNER,
    );
    expect(appCode(r)).toBe('already_member');
  });

  it('inviteMember: happy path returns the invite', async () => {
    setup();
    const r = await run(
      'mutation($i: InviteMemberInput!){ inviteMember(input:$i){ invite { inviteToken invitedEmail } } }',
      { i: { tripId: 'trip1', email: 'new@example.com' } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    const inv = (r.data?.inviteMember as Row).invite as Row;
    expect(inv.invitedEmail).toBe('new@example.com');
    expect(typeof inv.inviteToken).toBe('string');
  });

  it('removeMember: non-creator removing someone else → FORBIDDEN', async () => {
    setup({ members: new Set([OWNER.email, EDITOR.email, 'other@example.com']) });
    const r = await run(
      'mutation($i: RemoveMemberInput!){ removeMember(input:$i){ removedEmail } }',
      { i: { tripId: 'trip1', email: 'other@example.com' } },
      EDITOR,
    );
    expect(code(r)).toBe('FORBIDDEN');
  });

  it('removeMember: creator self-leave → CONFLICT creator_cannot_leave', async () => {
    setup();
    const r = await run(
      'mutation($i: RemoveMemberInput!){ removeMember(input:$i){ removedEmail } }',
      { i: { tripId: 'trip1', email: OWNER.email } },
      OWNER,
    );
    expect(appCode(r)).toBe('creator_cannot_leave');
  });

  it('removeMember: member self-leave → ok', async () => {
    setup({ members: new Set([OWNER.email, EDITOR.email]) });
    const r = await run(
      'mutation($i: RemoveMemberInput!){ removeMember(input:$i){ removedEmail } }',
      { i: { tripId: 'trip1', email: EDITOR.email } },
      EDITOR,
    );
    expect(r.data?.removeMember).toEqual({ removedEmail: EDITOR.email });
  });

  it('revokeInvite: member → revokedToken', async () => {
    setup();
    const r = await run(
      'mutation($i: RevokeInviteInput!){ revokeInvite(input:$i){ revokedToken } }',
      { i: { tripId: 'trip1', token: 'tok' } },
      OWNER,
    );
    expect(r.data?.revokeInvite).toEqual({ revokedToken: 'tok' });
  });
});

describe('Mutation.claimInvite', () => {
  const invite = {
    trip_id: 'trip1',
    invite_token: 'tok',
    invited_email: 'invited@example.com',
    invited_by_email: OWNER.email,
    invited_at: 1,
  };

  it('anon → UNAUTHENTICATED', async () => {
    setup();
    const r = await run(
      'mutation($i: ClaimInviteInput!){ claimInvite(input:$i){ tripId } }',
      { i: { inviteToken: 'tok' } },
      null,
    );
    expect(code(r)).toBe('UNAUTHENTICATED');
  });

  it('invalid token → tripId null', async () => {
    setup({ invite: null });
    const r = await run(
      'mutation($i: ClaimInviteInput!){ claimInvite(input:$i){ tripId } }',
      { i: { inviteToken: 'nope' } },
      EDITOR,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.claimInvite).toEqual({ tripId: null });
  });

  it('valid token → adds member and returns tripId', async () => {
    setup({ invite, members: new Set([OWNER.email]) });
    const r = await run(
      'mutation($i: ClaimInviteInput!){ claimInvite(input:$i){ tripId } }',
      { i: { inviteToken: 'tok' } },
      EDITOR,
    );
    expect(r.data?.claimInvite).toEqual({ tripId: 'trip1' });
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls.some((s) => /INSERT OR IGNORE INTO trip_members/.test(s))).toBe(true);
  });

  it('idempotent when already a member', async () => {
    setup({ invite, members: new Set([OWNER.email, EDITOR.email]) });
    const r = await run(
      'mutation($i: ClaimInviteInput!){ claimInvite(input:$i){ tripId } }',
      { i: { inviteToken: 'tok' } },
      EDITOR,
    );
    expect(r.data?.claimInvite).toEqual({ tripId: 'trip1' });
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls.some((s) => /INSERT OR IGNORE INTO trip_members/.test(s))).toBe(false);
    expect(sqls.some((s) => /DELETE FROM trip_invites/.test(s))).toBe(true);
  });
});
