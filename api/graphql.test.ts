import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
const { AGENT_SEARCH_URL, trailQuestion, trailRequest } = await import('./_allTrailsSearch.js');
const { ENDPOINT } = await import('./_resolvers/gemini.js');
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
  const res = await server.executeOperation({ query, variables }, { contextValue: { caller } });
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
  // Whether a non-owner has an AI draft left today (#73).
  assistLeft: boolean;
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
  if (/SELECT email FROM users WHERE email IN \(/.test(sql)) {
    return { rows: state.usersRows.filter((u) => args.includes(u.email)) };
  }
  if (/SELECT email, display_name FROM users/.test(sql)) {
    return { rows: state.usersRows };
  }
  // A catalog write reports its one row, as Turso does (a create's
  // DO NOTHING reports 0 when the id was taken; tests that race say so).
  if (/^INSERT INTO a \(id, j, t\)/.test(sql)) {
    return { rows: [], rowsAffected: 1 };
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
    assistLeft: true,
    ...partial,
  };
  execute.mockImplementation((q: unknown) => Promise.resolve(routeExecute(q)));
  // A draft's claim (#73) takes both counts in one batch, or neither.
  batch.mockImplementation((stmts: { sql: string }[]) =>
    Promise.resolve(
      stmts.some((s) => /^INSERT INTO gemini_assists/.test(s.sql))
        ? stmts.map(() => ({ rows: [], rowsAffected: state.assistLeft ? 1 : 0 }))
        : [],
    ),
  );
}

afterEach(() => {
  execute.mockReset();
  batch.mockReset();
  vi.unstubAllGlobals();
});

// Routes a mocked global fetch by URL: Gemini endpoint vs Wikimedia.
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
      // Wikimedia cover lookup (#36) — return not-ok so coverImage stays null.
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
            sourceUrl: 'https://www.instagram.com/reel/Ddl9QKSv0D7/',
          }),
        },
      ],
    });
    const r = await run(
      '{ activities { id parkType cuisine priceRange hours reservationUrl menuUrl dietary sourceUrl } }',
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
      sourceUrl: 'https://www.instagram.com/reel/Ddl9QKSv0D7/',
    });
  });

  it('skips rows with no usable id or a JSON payload that is not an object', async () => {
    const valid = (id?: string) => JSON.stringify({ ...(id ? { id } : {}), ...minimalActivity() });
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
    allTrailsRating hikeDistanceMiles hikeElevationFeet cuisine priceRange costTier hours
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
      catalog: [catalogRow('bad-row', { ...validRow, ...patch }), catalogRow('good', validRow)],
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
    setup({
      completedRows: [
        { id: 'a1', v: 1 },
        { id: 'a2', v: 0 },
      ],
    });
    const r = await run('{ completed { id completed } }');
    expect(r.errors).toBeUndefined();
    expect(r.data?.completed).toEqual([
      { id: 'a1', completed: true },
      { id: 'a2', completed: false },
    ]);
  });

  it('stringifies a numeric row id and skips a null id', async () => {
    setup({
      completedRows: [
        { id: 7, v: 1 },
        { id: null, v: 0 },
      ],
    });
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

  it('saveActivity: keeps the park it is part of (#269), and reads it back', async () => {
    setup();
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id parentId } } }',
      { i: { id: 'a1', activity: { ...minimalActivity(), parentId: 'park1' } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'a1', parentId: 'park1' } });
    const write = execute.mock.calls
      .map((c) => c[0] as { sql: string; args: unknown[] })
      .find((q) => typeof q !== 'string' && /^INSERT INTO a /.test(q.sql));
    expect(JSON.parse(write?.args[1] as string)).toMatchObject({ parentId: 'park1' });
    // The parent was looked up, and the activity checked for sub-items of its own.
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls).toContain("SELECT 1 FROM a WHERE json_extract(j, '$.parentId') = ? LIMIT 1");
  });

  it.each([
    ['leaves the park out keeps the stored one', {}, 'park1'],
    ['clears it with null', { parentId: null }, undefined],
  ])('saveActivity: an edit that %s (#269)', async (_, given, kept) => {
    setup({ snapshotJson: JSON.stringify({ id: 'a1', parentId: 'park1' }) });
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id parentId } } }',
      { i: { id: 'a1', activity: { ...minimalActivity(), ...given } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'a1', parentId: kept ?? null } });
    const write = execute.mock.calls
      .map((c) => c[0] as { sql: string; args: unknown[] })
      .find((q) => typeof q !== 'string' && /^INSERT INTO a /.test(q.sql));
    expect((JSON.parse(write?.args[1] as string) as Row).parentId ?? undefined).toBe(kept);
  });

  it('saveActivity: saves a region as the one it names, and refuses none (#274)', async () => {
    const SAVE =
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { region } } }';
    const writes = () =>
      execute.mock.calls
        .map((c) => c[0] as { sql: string; args: unknown[] })
        .filter((q) => typeof q !== 'string' && /^INSERT INTO a /.test(q.sql));
    for (const [given, saved] of [
      ['oregon', 'US-OR'],
      ['jp-26', 'JP-26'],
      ['north-bay', 'north-bay'],
    ]) {
      setup();
      const r = await run(
        SAVE,
        { i: { id: 'a1', activity: { ...minimalActivity(), region: given } } },
        OWNER,
      );
      expect(r.errors).toBeUndefined();
      expect(r.data?.saveActivity).toEqual({ activity: { region: saved } });
      expect((JSON.parse(writes().at(-1)?.args[1] as string) as Row).region).toBe(saved);
    }
    execute.mockClear();
    setup();
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), region: 'Utah' } } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(r.errors?.[0]?.message).toBe('region must be a California area or an ISO 3166 code');
    expect(writes()).toHaveLength(0);
  });

  it('activities: a region saved before #274 reads as the one it is now', async () => {
    setup({
      catalog: [
        { id: 'cb', j: JSON.stringify({ ...minimalActivity(), coverImage: '', region: 'oregon' }) },
      ],
    });
    const r = await run('{ activities { id region } }');
    expect(r.data?.activities).toEqual([{ id: 'cb', region: 'US-OR' }]);
  });

  it('saveActivity: refuses to make an activity part of itself, and saves nothing (#269)', async () => {
    setup();
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id } } }',
      { i: { id: 'a1', activity: { ...minimalActivity(), parentId: 'a1' } } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(r.errors?.[0]?.message).toBe("an activity can't be part of itself");
    const sqls = execute.mock.calls.map((c) =>
      typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql,
    );
    expect(sqls.some((q) => /^INSERT INTO a /.test(q))).toBe(false);
  });

  it('activities: a parent naming the row itself reads as none (#269)', async () => {
    setup({
      catalog: [
        {
          id: 'loop',
          j: JSON.stringify({ ...minimalActivity(), coverImage: '', parentId: 'loop' }),
        },
        {
          id: 'hike',
          j: JSON.stringify({ ...minimalActivity(), coverImage: '', parentId: 'park1' }),
        },
      ],
    });
    const r = await run('{ activities { id parentId } }');
    expect(r.data?.activities).toEqual([
      { id: 'loop', parentId: null },
      { id: 'hike', parentId: 'park1' },
    ]);
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

  it('saveActivity: persists coverCredit and activities reads it back (#36)', async () => {
    setup();
    const credit = 'Photo: Jo, CC BY-SA 4.0, via Wikimedia Commons';
    const r = await run(
      'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id coverCredit } } }',
      { i: { id: 'c1', activity: { ...minimalActivity(), coverCredit: credit } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect((r.data?.saveActivity as Row).activity).toEqual({ id: 'c1', coverCredit: credit });
    const insert = execute.mock.calls.find((c) => {
      const sql = typeof c[0] === 'string' ? c[0] : (c[0] as { sql: string }).sql;
      return /INSERT INTO a /.test(sql);
    });
    const stored = (insert?.[0] as { args: unknown[] }).args[1] as string;
    expect(JSON.parse(stored)).toMatchObject({ coverCredit: credit });

    setup({ catalog: [{ id: 'c1', j: stored }] });
    const read = await run('{ activities { id coverCredit } }');
    expect(read.errors).toBeUndefined();
    expect(read.data?.activities).toEqual([{ id: 'c1', coverCredit: credit }]);
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

  it('deleteActivity: drops the activity, its reviews and its photos, and frees its hikes and stops, in one batch', async () => {
    setup();
    await run(
      'mutation($i: DeleteActivityInput!){ deleteActivity(input:$i){ deletedId } }',
      { i: { id: 'a1' } },
      OWNER,
    );
    expect(batch).toHaveBeenCalledTimes(1);
    const [stmts, mode] = batch.mock.calls[0] as [{ sql: string; args: unknown[] }[], string];
    expect(mode).toBe('write');
    expect(stmts.map((s) => s.sql)).toEqual([
      'DELETE FROM a WHERE id = ?',
      'DELETE FROM activity_reviews WHERE activity_id = ?',
      'DELETE FROM activity_photos WHERE activity_id = ? RETURNING pathname',
      "UPDATE a SET j = json_remove(j, '$.parentId') WHERE json_extract(j, '$.parentId') = ?",
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

describe('contributors (#9)', () => {
  const SAVE =
    'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id contributors } } }';
  const TARUN = 'tarun@example.com';
  const users = (...emails: string[]) => emails.map((email) => ({ email, display_name: null }));

  function storedJson(): Row {
    return JSON.parse(executeWrites()[0]?.args[1] as string) as Row;
  }
  function reads(): { sql: string; args: unknown[] }[] {
    return execute.mock.calls
      .map((c) => c[0] as { sql: string; args: unknown[] })
      .filter((q) => /^SELECT/.test(q.sql));
  }

  it('a new activity with no list credits the caller', async () => {
    setup({ snapshotJson: null });
    const r = await run(SAVE, { i: { id: 'n1', activity: minimalActivity() } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({
      activity: { id: 'n1', contributors: [OWNER.email] },
    });
    expect(storedJson().contributors).toEqual([OWNER.email]);
    expect(reads()).toEqual([{ sql: 'SELECT j FROM a WHERE id = ?', args: ['n1'] }]);
  });

  it('an edit with no list keeps the stored contributors', async () => {
    setup({ snapshotJson: JSON.stringify({ id: 'a1', contributors: [TARUN, 7] }) });
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), contributors: null } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(storedJson().contributors).toEqual([TARUN]);
  });

  it.each([
    ['saved before #9', JSON.stringify({ id: 'a1' })],
    ['a stored non-list', JSON.stringify({ id: 'a1', contributors: TARUN })],
    ['an empty stored list', JSON.stringify({ id: 'a1', contributors: [] })],
    ['malformed JSON', 'not json'],
    ['a JSON null', 'null'],
  ])('an edit of a row %s leaves it uncredited, for the backfill', async (_label, j) => {
    setup({ snapshotJson: j });
    const r = await run(SAVE, { i: { id: 'a1', activity: minimalActivity() } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'a1', contributors: null } });
    expect(storedJson()).not.toHaveProperty('contributors');
  });

  it('a given list is trimmed, lower-cased, de-duplicated and checked against users', async () => {
    setup({ usersRows: users(OWNER.email, TARUN) });
    const r = await run(
      SAVE,
      {
        i: {
          id: 'a1',
          activity: {
            ...minimalActivity(),
            contributors: [' Tarun@Example.com', TARUN, OWNER.email],
          },
        },
      },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(storedJson().contributors).toEqual([TARUN, OWNER.email]);
    expect(reads()).toEqual([
      { sql: 'SELECT j FROM a WHERE id = ?', args: ['a1'] },
      {
        sql: 'SELECT email FROM users WHERE email IN (?, ?)',
        args: [TARUN, OWNER.email],
      },
    ]);
  });

  it('checks only the names an edit adds, so a stored one without a users row stays', async () => {
    const gone = 'gone@example.com'; // credited, but no users row (e.g. a preview DB)
    setup({
      snapshotJson: JSON.stringify({ id: 'a1', contributors: [gone] }),
      usersRows: users(TARUN),
    });
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), contributors: [gone, TARUN] } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(storedJson().contributors).toEqual([gone, TARUN]);
    expect(reads()[1]).toEqual({
      sql: 'SELECT email FROM users WHERE email IN (?)',
      args: [TARUN],
    });
  });

  it('an unchanged list is saved without looking anyone up', async () => {
    setup({ snapshotJson: JSON.stringify({ id: 'a1', contributors: [TARUN] }) });
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), contributors: [TARUN] } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(storedJson().contributors).toEqual([TARUN]);
    expect(reads()).toEqual([{ sql: 'SELECT j FROM a WHERE id = ?', args: ['a1'] }]);
  });

  it.each([
    ['an empty list', [], 'contributors must name at least one person'],
    ['only blanks', ['  ', ''], 'contributors must name at least one person'],
    [
      'an unknown account',
      [TARUN, 'stranger@example.com'],
      'not a known account: stranger@example.com',
    ],
  ])('%s → BAD_USER_INPUT, nothing written', async (_label, contributors, message) => {
    setup({ usersRows: users(TARUN) });
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), contributors } } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(r.errors?.[0]?.message).toBe(message);
    expect(executeWrites()).toEqual([]);
  });

  it('takes up to ten contributors and refuses an eleventh', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `p${i}@example.com`);
    const eleven = [...ten, 'p10@example.com'];
    setup({ usersRows: users(...eleven) });
    const ok = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), contributors: ten } } },
      OWNER,
    );
    expect(ok.errors).toBeUndefined();
    expect(storedJson().contributors).toEqual(ten);

    execute.mockClear();
    const tooMany = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), contributors: eleven } } },
      OWNER,
    );
    expect(code(tooMany)).toBe('BAD_USER_INPUT');
    expect(tooMany.errors?.[0]?.message).toBe('at most 10 contributors');
    expect(executeWrites()).toEqual([]);
  });

  it('activities shows contributors to a signed-in caller and hides them otherwise', async () => {
    const row = { id: 'a1', ...minimalActivity(), contributors: [TARUN] };
    setup({ catalog: [{ id: 'a1', j: JSON.stringify(row) }] });
    const signedIn = await run('{ activities { id contributors } }', {}, EDITOR);
    const signedOut = await run('{ activities { id contributors } }');
    expect(signedIn.data?.activities).toEqual([{ id: 'a1', contributors: [TARUN] }]);
    expect(signedOut.data?.activities).toEqual([{ id: 'a1', contributors: null }]);
  });

  it('a trip snapshot carries the contributors it was copied with', async () => {
    setup({
      activities: [
        taRow({
          snapshot_json: JSON.stringify({ id: 'act1', name: 'Snap', contributors: [TARUN] }),
        }),
      ],
    });
    const r = await run(
      'query($id: ID!){ trip(id:$id){ activities { snapshot { contributors } } } }',
      { id: 'trip1' },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.trip).toEqual({ activities: [{ snapshot: { contributors: [TARUN] } }] });
  });
});

describe('costTier (#85)', () => {
  const SAVE =
    'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id costTier } } }';

  it('matches the tiers Gemini is asked for', async () => {
    const { COST_TIERS } = await import('./_gqlMap.js');
    const { COST_TIER_VALUES } = await import('./_resolvers/gemini.js');
    expect([...COST_TIERS]).toEqual([...COST_TIER_VALUES]);
  });

  it.each(['free', '$', '$$', '$$$'])('saves and reads back %s', async (tier) => {
    setup();
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), costTier: tier } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'a1', costTier: tier } });
    const stored = executeWrites()[0]?.args[1] as string;
    setup({ catalog: [{ id: 'a1', j: stored }] });
    const read = await run('{ activities { id costTier } }');
    expect(read.data?.activities).toEqual([{ id: 'a1', costTier: tier }]);
  });

  it('saves where an activity was found (#6)', async () => {
    setup();
    const reel = 'https://www.instagram.com/reel/Ddl9QKSv0D7/';
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), sourceUrl: reel } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(JSON.parse(executeWrites()[0]?.args[1] as string)).toMatchObject({ sourceUrl: reel });
  });

  it.each(['javascript:alert(1)', 'not a link'])(
    'refuses %s as where it was found, writing nothing',
    async (bad) => {
      setup();
      const refused = await run(
        SAVE,
        { i: { id: 'a1', activity: { ...minimalActivity(), sourceUrl: bad } } },
        OWNER,
      );
      expect(code(refused)).toBe('BAD_USER_INPUT');
      expect(refused.errors?.[0]?.message).toBe('sourceUrl must be a web address');
      expect(executeWrites()).toEqual([]);
    },
  );

  it('refuses a tier outside the set, writing nothing', async () => {
    setup();
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), costTier: '$$$$' } } },
      OWNER,
    );
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(r.errors?.[0]?.message).toBe('costTier must be free, $, $$ or $$$');
    expect(executeWrites()).toEqual([]);
  });

  it('clears it with null', async () => {
    setup();
    const r = await run(
      SAVE,
      { i: { id: 'a1', activity: { ...minimalActivity(), costTier: null } } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'a1', costTier: null } });
  });

  it('reads a stored tier outside the set as null rather than failing the catalog', async () => {
    setup({
      catalog: [
        { id: 'a1', j: JSON.stringify({ id: 'a1', ...minimalActivity(), costTier: 'cheap' }) },
      ],
    });
    const read = await run('{ activities { id costTier } }');
    expect(read.errors).toBeUndefined();
    expect(read.data?.activities).toEqual([{ id: 'a1', costTier: null }]);
  });
});

describe('duplicates (#17)', () => {
  const CASTLE = {
    id: 'castle',
    ...minimalActivity(),
    name: 'Castle Rock',
    location: { city: 'Los Gatos', coords: { lat: 37.2309, lng: -122.0961 } },
  };
  const catalog = [{ id: 'castle', j: JSON.stringify(CASTLE) }];
  const CHECK =
    'query($n: String!, $lat: Float!, $lng: Float!){ checkDuplicate(name:$n, lat:$lat, lng:$lng){ id name city distanceMeters confidence } }';
  const SAVE = 'mutation($i: SaveActivityInput!){ saveActivity(input:$i){ activity { id } } }';
  const newCastle = (over: Record<string, unknown> = {}) => ({
    id: 'castle-rock',
    create: true,
    activity: {
      ...minimalActivity(),
      name: 'Castle Rock!',
      location: { city: 'Los Gatos', coords: { lat: 37.2312, lng: -122.0961 } },
    },
    ...over,
  });

  it('checkDuplicate: anyone can ask, and gets the look-alikes', async () => {
    setup({ catalog });
    const r = await run(CHECK, { n: 'castle rock', lat: 37.2312, lng: -122.0961 });
    expect(r.errors).toBeUndefined();
    expect(r.data?.checkDuplicate).toEqual([
      {
        id: 'castle',
        name: 'Castle Rock',
        city: 'Los Gatos',
        distanceMeters: 33,
        confidence: 'high',
      },
    ]);
  });

  it('checkDuplicate: refuses a name over 200 characters', async () => {
    setup({ catalog });
    const ok = await run(CHECK, { n: 'x'.repeat(200), lat: 0, lng: 0 });
    expect(ok.errors).toBeUndefined();
    const r = await run(CHECK, { n: 'x'.repeat(201), lat: 0, lng: 0 });
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(r.errors?.[0]?.message).toBe('name too long');
  });

  it('saveActivity: refuses a new activity that looks saved, writing nothing', async () => {
    setup({ catalog, snapshotJson: null });
    const r = await run(SAVE, { i: newCastle() }, OWNER);
    expect(code(r)).toBe('CONFLICT');
    expect(appCode(r)).toBe('duplicate');
    expect(r.errors?.[0]?.message).toBe('looks like a duplicate of Castle Rock');
    expect(executeWrites()).toEqual([]);
  });

  it('saveActivity: creates it anyway when told to', async () => {
    setup({ catalog, snapshotJson: null });
    const r = await run(SAVE, { i: newCastle({ allowDuplicate: true }) }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'castle-rock' } });
    expect(executeWrites()).toHaveLength(1);
  });

  it('saveActivity: lets a merely possible match through', async () => {
    setup({ catalog, snapshotJson: null });
    // Same name 50 km away: possible, not high.
    const far = newCastle();
    (far.activity as { location: unknown }).location = {
      city: 'Elsewhere',
      coords: { lat: 37.68, lng: -122.0961 },
    };
    const r = await run(SAVE, { i: far }, OWNER);
    expect(r.errors).toBeUndefined();
  });

  it('saveActivity: never creates over another activity, taking the next free id', async () => {
    // The slug is taken by a place whose name no longer matches.
    setup({ catalog: [], snapshotJson: JSON.stringify({ id: 'castle-rock', name: 'Renamed' }) });
    execute.mockImplementation((q: unknown) => {
      const { sql, args } = q as { sql?: string; args?: unknown[] };
      if (sql === 'SELECT j FROM a WHERE id = ?') {
        const taken = args?.[0] === 'castle-rock' || args?.[0] === 'castle-rock-2';
        return Promise.resolve({ rows: taken ? [{ j: '{}' }] : [] });
      }
      return Promise.resolve(routeExecute(q));
    });
    const r = await run(SAVE, { i: newCastle() }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'castle-rock-3' } });
    const write = executeWrites()[0];
    expect(write?.args[0]).toBe('castle-rock-3');
    // A new row credits its creator, not whatever the taken one had.
    expect(JSON.parse(write?.args[1] as string)).toMatchObject({
      id: 'castle-rock-3',
      contributors: [OWNER.email],
    });
  });

  it('saveActivity: a create that loses the race for an id takes the next one, never replacing', async () => {
    // castle-rock looked free, but another create wrote it first.
    setup({ catalog: [], snapshotJson: null });
    const taken = new Set<string>();
    execute.mockImplementation((q: unknown) => {
      const { sql, args } = q as { sql?: string; args?: unknown[] };
      if (sql === 'SELECT j FROM a WHERE id = ?') {
        return Promise.resolve({ rows: taken.has(args?.[0] as string) ? [{ j: '{}' }] : [] });
      }
      if (sql?.startsWith('INSERT INTO a (id, j, t)')) {
        const first = args?.[0] === 'castle-rock' && !taken.has('castle-rock');
        taken.add(args?.[0] as string);
        return Promise.resolve({ rows: [], rowsAffected: first ? 0 : 1 });
      }
      return Promise.resolve(routeExecute(q));
    });
    const r = await run(SAVE, { i: newCastle() }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(r.data?.saveActivity).toEqual({ activity: { id: 'castle-rock-2' } });
    const writes = executeWrites();
    expect(writes.map((w) => w.args[0])).toEqual(['castle-rock', 'castle-rock-2']);
    for (const w of writes) {
      expect(w.sql).toBe('INSERT INTO a (id, j, t) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING');
    }
    expect(JSON.parse(writes[1]?.args[1] as string)).toMatchObject({ id: 'castle-rock-2' });
  });

  it('saveActivity: a create that keeps losing gives up rather than overwrite', async () => {
    setup({ catalog: [], snapshotJson: null });
    execute.mockImplementation((q: unknown) => {
      const { sql } = q as { sql?: string };
      if (sql?.startsWith('INSERT INTO a (id, j, t)'))
        return Promise.resolve({ rows: [], rowsAffected: 0 });
      return Promise.resolve(routeExecute(q));
    });
    const r = await run(SAVE, { i: newCastle() }, OWNER);
    expect(r.errors?.[0]?.message).toMatch(/took this id/);
    expect(executeWrites()).toHaveLength(3);
  });

  it('saveActivity: an edit (no create) upserts its own id, unchecked', async () => {
    setup({ catalog, snapshotJson: JSON.stringify({ id: 'castle-rock' }) });
    const { create: _create, ...edit } = newCastle();
    void _create;
    const r = await run(SAVE, { i: edit }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(executeWrites()[0]?.args[0]).toBe('castle-rock');
    expect(executeWrites()[0]?.sql).toMatch(/ON CONFLICT\(id\) DO UPDATE/);
  });
});

describe('Mutation.suggestTripActivities (#78)', () => {
  const SUGGEST =
    'mutation($i: SuggestTripActivitiesInput!){ suggestTripActivities(input:$i){ suggestions { activityId reason activity { id name } } } }';
  const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    j: JSON.stringify({ id, ...minimalActivity(), name, ...extra }),
  });
  const catalog = [
    row('a', 'Fort Funston', { dogFriendly: true }),
    row('b', 'Muir Woods'),
    row('c', 'Exploratorium'),
  ];
  const picks = (...items: [string, string][]) =>
    geminiText(
      JSON.stringify({
        suggestions: items.map(([activityId, reason]) => ({ activityId, reason })),
      }),
    );
  const sentBody = () =>
    JSON.parse(((vi.mocked(fetch).mock.calls[0] as unknown[])[1] as { body: string }).body) as {
      contents: { parts: { text: string }[] }[];
      tools?: unknown;
    };

  it('is owner-only', async () => {
    setup({ catalog });
    expect(code(await run(SUGGEST, { i: { prompt: 'dogs' } }, EDITOR))).toBe('FORBIDDEN');
    expect(code(await run(SUGGEST, { i: { prompt: 'dogs' } }))).toBe('UNAUTHENTICATED');
  });

  it('keeps only real, unrepeated, unexcluded picks, with their activities', async () => {
    setup({ catalog });
    stubFetch(
      picks(
        ['a', 'dogs on the beach'],
        ['zzz', 'made up'],
        ['a', 'again'],
        ['c', ' rainy day '],
        ['b', 'excluded'],
      ),
    );
    const r = await run(
      SUGGEST,
      { i: { prompt: '  a dog day  ', excludeActivityIds: ['b'] } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
    expect(r.data?.suggestTripActivities).toEqual({
      suggestions: [
        {
          activityId: 'a',
          reason: 'dogs on the beach',
          activity: { id: 'a', name: 'Fort Funston' },
        },
        { activityId: 'c', reason: 'rainy day', activity: { id: 'c', name: 'Exploratorium' } },
      ],
    });
    // Gemini sees the trimmed request and only the candidates not excluded,
    // with no search tools.
    const body = sentBody();
    const text = body.contents[0].parts[0].text;
    expect(text.startsWith('Request: a dog day\n\nCatalog:\n')).toBe(true);
    const sent = JSON.parse(text.split('Catalog:\n')[1]) as {
      id: string;
      city: string;
      dogFriendly: boolean | null;
    }[];
    expect(sent.map((c) => c.id)).toEqual(['a', 'c']);
    expect(sent[0]).toMatchObject({ city: 'X', dogFriendly: true });
    expect(body.tools).toBeUndefined();
  });

  it('caps the picks at twelve', async () => {
    const many = Array.from({ length: 14 }, (_, i) => row(`p${i}`, `Place ${i}`));
    setup({ catalog: many });
    stubFetch(picks(...many.map((m) => [m.id, 'fits'] as [string, string])));
    const r = await run(SUGGEST, { i: { prompt: 'anything' } }, OWNER);
    expect((r.data?.suggestTripActivities as { suggestions: unknown[] }).suggestions).toHaveLength(
      12,
    );
  });

  it('asks nothing when every activity is excluded', async () => {
    setup({ catalog: [row('a', 'Fort Funston')] });
    stubFetch(picks(['a', 'x']));
    const r = await run(SUGGEST, { i: { prompt: 'anything', excludeActivityIds: ['a'] } }, OWNER);
    expect(r.data?.suggestTripActivities).toEqual({ suggestions: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ prompt: '   ' }, 'prompt is required'],
    [{ prompt: 'x'.repeat(2001) }, 'prompt too long'],
    [
      { prompt: 'x', excludeActivityIds: Array.from({ length: 51 }, (_, i) => `e${i}`) },
      'at most 50 excluded activities',
    ],
  ])('refuses bad input: %#', async (i, message) => {
    setup({ catalog });
    stubFetch(picks());
    const r = await run(SUGGEST, { i }, OWNER);
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(r.errors?.[0]?.message).toBe(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('takes 2000 characters and 50 exclusions', async () => {
    setup({ catalog });
    stubFetch(picks());
    const r = await run(
      SUGGEST,
      {
        i: {
          prompt: 'x'.repeat(2000),
          excludeActivityIds: Array.from({ length: 50 }, (_, i) => `e${i}`),
        },
      },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
  });

  it('reads an answer without a list as no picks', async () => {
    setup({ catalog });
    stubFetch(geminiText(JSON.stringify({ nope: true })));
    const r = await run(SUGGEST, { i: { prompt: 'x' } }, OWNER);
    expect(r.data?.suggestTripActivities).toEqual({ suggestions: [] });
  });

  it('gives a pick with no reason an empty one', async () => {
    setup({ catalog });
    stubFetch(geminiText(JSON.stringify({ suggestions: [{ activityId: 'a' }] })));
    const r = await run(SUGGEST, { i: { prompt: 'x' } }, OWNER);
    expect(
      (r.data?.suggestTripActivities as { suggestions: { reason: string }[] }).suggestions[0]
        .reason,
    ).toBe('');
  });

  it('turns an upstream failure or a non-JSON answer into BAD_GATEWAY', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({ catalog });
    stubFetch({}, { ok: false });
    const failed = await run(SUGGEST, { i: { prompt: 'x' } }, OWNER);
    expect(code(failed)).toBe('BAD_GATEWAY');
    expect(failed.errors?.[0]?.message).toBe('gemini request failed');
    stubFetch(geminiText('not json'));
    const garbled = await run(SUGGEST, { i: { prompt: 'x' } }, OWNER);
    expect(garbled.errors?.[0]?.message).toBe('gemini returned non-JSON');
    stubFetch({ candidates: [] });
    const empty = await run(SUGGEST, { i: { prompt: 'x' } }, OWNER);
    expect(empty.errors?.[0]?.message).toBe('gemini returned non-JSON');
    errSpy.mockRestore();
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

  const DRAFT =
    'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name } } }';
  // The claim statements sent: the account's count and the shared one.
  const assistClaims = () =>
    (batch.mock.calls as [{ sql: string }[]][])
      .flatMap(([stmts]) => stmts)
      .filter((s) => /^INSERT INTO gemini_assists/.test(s.sql)).length;
  function stubCastleRock() {
    stubFetch(
      geminiText(
        JSON.stringify({
          name: 'Castle Rock',
          shortDescription: 'Ridgeline hike',
          category: 'hiking',
          region: 'south-bay',
          city: 'Los Gatos',
          lat: 37.2,
          lng: -122.1,
          duration: 'Half Day',
        }),
      ),
    );
  }

  it('findSharedPlaces (#6): owners only, and only for an Instagram link', async () => {
    const FIND =
      'mutation($u: String!){ findSharedPlaces(url: $u){ places { name } read { caption } } }';
    const reel = { u: 'https://www.instagram.com/reel/Ddl9QKSv0D7/' };
    expect(code(await run(FIND, reel))).toBe('UNAUTHENTICATED');
    expect(code(await run(FIND, reel, EDITOR))).toBe('FORBIDDEN');
    const r = await run(FIND, { u: 'https://example.com/reel/Ddl9QKSv0D7/' }, OWNER);
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(r.errors?.[0]?.message).toBe("That isn't a link to an Instagram post or reel");
  });

  it('generateActivity: anon → UNAUTHENTICATED', async () => {
    setup();
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } });
    expect(code(r)).toBe('UNAUTHENTICATED');
  });

  it('generateActivity: a signed-in non-owner with drafts left gets one (#73)', async () => {
    setup();
    stubCastleRock();
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors).toBeUndefined();
    expect(r.data?.generateActivity).toEqual({ activity: { name: 'Castle Rock' } });
    // The account's claim, then the shared one.
    expect(assistClaims()).toBe(2);
  });

  it('generateActivity: a non-owner out of drafts → FORBIDDEN assist_limit, no Gemini call', async () => {
    setup({ assistLeft: false });
    stubCastleRock();
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(code(r)).toBe('FORBIDDEN');
    expect(appCode(r)).toBe('assist_limit');
    expect(r.errors?.[0]?.message).toBe("You've used today's AI drafts. Try again tomorrow.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it('generateActivity: a non-owner with no title spends no draft', async () => {
    setup();
    const r = await run(DRAFT, { i: { title: ' ' } }, EDITOR);
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(assistClaims()).toBe(0);
  });

  it.each([
    ['a long title', { title: 'x'.repeat(201) }, 'title is too long'],
    ['long notes', { title: 'Castle Rock', notes: 'x'.repeat(2001) }, 'notes are too long'],
    [
      'more than five links',
      {
        title: 'Castle Rock',
        notes: Array.from({ length: 6 }, (_, i) => `https://e.example/${i}`).join(' '),
      },
      'a draft can include at most 5 links',
    ],
    [
      'links split between the title and notes',
      {
        title: 'http://a.co http://b.co http://c.co',
        notes: 'https://d.example https://e.example https://f.example',
      },
      'a draft can include at most 5 links',
    ],
    [
      'more than five links in the title',
      { title: Array.from({ length: 6 }, (_, i) => `http://a${i}.co`).join(' ') },
      'a draft can include at most 5 links',
    ],
  ])(
    'generateActivity: a non-owner with %s → BAD_USER_INPUT, no draft spent',
    async (_name, input, message) => {
      setup();
      stubCastleRock();
      const r = await run(DRAFT, { i: input }, EDITOR);
      expect(code(r)).toBe('BAD_USER_INPUT');
      expect(r.errors?.[0]?.message).toBe(message);
      expect(assistClaims()).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('generateActivity: a non-owner at each limit still gets a draft', async () => {
    setup();
    stubCastleRock();
    const notes = `${Array.from({ length: 5 }, (_, i) => `HTTP://e.example/${i}`).join(' ')} `;
    const r = await run(
      DRAFT,
      { i: { title: 'x'.repeat(200), notes: notes.padEnd(2000, 'n') } },
      EDITOR,
    );
    expect(r.errors).toBeUndefined();
    expect(assistClaims()).toBe(2);
  });

  it('generateActivity: owners have no such limits', async () => {
    setup();
    stubCastleRock();
    const r = await run(
      DRAFT,
      { i: { title: 'x'.repeat(300), notes: 'https://e.example/ '.repeat(10).padEnd(3000, 'n') } },
      OWNER,
    );
    expect(r.errors).toBeUndefined();
  });

  const givenBack = () =>
    batch.mock.calls.filter(([stmts]: unknown[]) =>
      (stmts as { sql: string }[]).some((s) => /^UPDATE gemini_assists SET n = n - 1/.test(s.sql)),
    );

  it("generateActivity: a non-owner's draft is given back when Gemini fails the request", async () => {
    setup();
    stubFetch({ error: 'unavailable' }, { ok: false });
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors?.[0]?.message).toBe('gemini request failed');
    expect(assistClaims()).toBe(2);
    // Both counts, the account's and everyone's, in one write.
    expect(givenBack()).toHaveLength(1);
    const [stmts, mode] = givenBack()[0] as [{ args: unknown[] }[], string];
    expect(mode).toBe('write');
    expect(stmts.map((s) => s.args[1])).toEqual([EDITOR.email, '*']);
  });

  it("generateActivity: a non-owner's draft is given back when the request never connects", async () => {
    setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('socket hang up'))),
    );
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors).toBeDefined();
    expect(givenBack()).toHaveLength(1);
  });

  it('generateActivity: a draft Gemini answered stays spent, however unusable', async () => {
    // It was billed: giving it back would let a draft that can't be parsed
    // be retried past the cap.
    setup();
    stubFetch(geminiText('not json'));
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors?.[0]?.message).toBe('gemini returned non-JSON');
    expect(givenBack()).toHaveLength(0);
  });

  it("generateActivity: a give-back that fails doesn't hide Gemini's failure", async () => {
    setup();
    stubFetch({ error: 'unavailable' }, { ok: false });
    // The claim goes through; the give-back after Gemini's failure doesn't.
    const claimOnly = batch.getMockImplementation() as (
      stmts: { sql: string }[],
    ) => Promise<unknown>;
    batch.mockImplementation((stmts: { sql: string }[]) =>
      stmts.some((s) => /^UPDATE gemini_assists/.test(s.sql))
        ? Promise.reject(new Error('db down'))
        : claimOnly(stmts),
    );
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors?.[0]?.message).toBe('gemini request failed');
  });

  it("generateActivity: an owner's failed request has nothing to give back", async () => {
    setup();
    stubFetch({ error: 'unavailable' }, { ok: false });
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors?.[0]?.message).toBe('gemini request failed');
    expect(givenBack()).toHaveLength(0);
  });

  // The info lines a draft logged, by event.
  function infoEvents() {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    info.mockClear();
    return (event: string) =>
      info.mock.calls.map((c) => JSON.parse(String(c[0])) as Row).filter((e) => e.event === event);
  }
  const CASTLE_ROCK = {
    name: 'Castle Rock',
    shortDescription: 'Ridgeline hike',
    category: 'scenic',
    region: 'south-bay',
    city: 'Los Gatos',
    lat: 37.2,
    lng: -122.1,
    duration: 'Half Day',
  };
  const TIMED_OUT = () =>
    Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));

  it('generateActivity: gives a draft 90 seconds, then gives it back and says to try again', async () => {
    setup();
    const events = infoEvents();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetchMock = vi.fn<(url: string, init?: { signal?: unknown }) => Promise<never>>(() =>
      TIMED_OUT(),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors?.[0]?.message).toBe('the draft took too long; try again');
    expect(code(r)).toBe('BAD_GATEWAY');
    expect(timeout.mock.calls).toEqual([[90_000]]);
    const made = (timeout.mock.results[0] as { value: unknown } | undefined)?.value;
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(made);
    // No answer came, so the draft is given back.
    expect(givenBack()).toHaveLength(1);
    const [timedOut] = events('draft.timed_out');
    // Time taken, not a clock reading.
    expect(timedOut?.ms).toBeGreaterThanOrEqual(0);
    expect(timedOut?.ms).toBeLessThan(60_000);
    timeout.mockRestore();
  });

  it("generateActivity: a refusal whose message doesn't come in time is still the refusal", async () => {
    setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 503, text: TIMED_OUT })),
    );
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors?.[0]?.message).toBe('gemini request failed');
    expect(givenBack()).toHaveLength(1);
  });

  it('generateActivity: a draft that runs out of time mid-answer stays spent', async () => {
    setup();
    infoEvents();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: TIMED_OUT })),
    );
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors?.[0]?.message).toBe('the draft took too long; try again');
    expect(givenBack()).toHaveLength(0);
  });

  it('generateActivity: a request that fails without an error is no time-out', async () => {
    setup();
    const events = infoEvents();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A rejection with nothing, as a broken fetch might give.
    const nothing = { then: (_: unknown, reject: (reason: unknown) => void) => reject(null) };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => nothing as unknown as Promise<Response>),
    );
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors).toBeDefined();
    expect(events('draft.timed_out')).toEqual([]);
  });

  it('generateActivity: any other failure reading the answer is no time-out', async () => {
    setup();
    const events = infoEvents();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError('bad body')),
        }),
      ),
    );
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, EDITOR);
    expect(r.errors?.[0]?.message).not.toBe('the draft took too long; try again');
    expect(events('draft.timed_out')).toEqual([]);
  });

  it('generateActivity: logs what the draft searched, read and spent, and where its time went', async () => {
    setup();
    const events = infoEvents();
    stubFetch({
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify(CASTLE_ROCK) }] },
          finishReason: 'STOP',
          groundingMetadata: { webSearchQueries: ['castle rock state park', 7, 'fees'] },
          urlContextMetadata: { urlMetadata: [{}, {}] },
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        toolUsePromptTokenCount: 50,
        thoughtsTokenCount: 900,
        candidatesTokenCount: 300,
      },
    });
    // A clock that moves 100 ms each time it's read.
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 100));
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    const [generated] = events('draft.generated');
    expect(generated).toEqual(
      expect.objectContaining({
        queries: ['castle rock state park', 'fees'],
        pagesRead: 2,
        tokens: { prompt: 100, tools: 50, thinking: 900, output: 300 },
        finish: 'STOP',
      }),
    );
    const [timing] = events('draft.timing');
    expect(timing?.geminiMs).toBe(generated?.ms);
    expect(timing?.geminiMs).toBeGreaterThan(0);
    expect(timing?.lookupsMs).toBeGreaterThan(0);
    expect(timing?.ms).toBe((timing?.geminiMs as number) + (timing?.lookupsMs as number));
    // Time taken, not a clock reading.
    expect(timing?.ms).toBeLessThan(60_000);
  });

  it('generateActivity: logs a draft Gemini answered with nothing', async () => {
    for (const body of [{}, { candidates: [] }]) {
      setup();
      const events = infoEvents();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      stubFetch(body);
      const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, OWNER);
      expect(r.errors?.[0]?.message).toBe('no content in gemini response');
      expect(events('draft.generated')).toEqual([
        expect.objectContaining({ queries: [], pagesRead: 0, tokens: {} }),
      ]);
    }
  });

  it('generateActivity: logs a draft without search or token details as none', async () => {
    setup();
    const events = infoEvents();
    stubFetch(geminiText(JSON.stringify(CASTLE_ROCK)));
    await run(DRAFT, { i: { title: 'Castle Rock' } }, OWNER);
    expect(events('draft.generated')).toEqual([
      expect.objectContaining({ queries: [], pagesRead: 0, tokens: {} }),
    ]);
    stubFetch({
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify(CASTLE_ROCK) }] },
          groundingMetadata: { webSearchQueries: 'castle rock' },
          urlContextMetadata: { urlMetadata: {} },
        },
      ],
    });
    await run(DRAFT, { i: { title: 'Castle Rock' } }, OWNER);
    expect(events('draft.generated')[1]).toEqual(
      expect.objectContaining({ queries: [], pagesRead: 0 }),
    );
  });

  it("generateActivity: owners aren't counted", async () => {
    setup({ assistLeft: false });
    stubCastleRock();
    const r = await run(DRAFT, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect(assistClaims()).toBe(0);
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

  describe('generateActivity: the region of a draft (#274)', () => {
    const DRAFT = {
      name: 'Navajo Loop',
      shortDescription: 'Down among the hoodoos of Bryce Canyon',
      category: 'hiking',
      city: 'Bryce Canyon City',
      lat: 37.6229,
      lng: -112.1668,
      duration: '1-2 Hours',
    };
    const REGIONED =
      'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name region } } }';

    it('names it as the list writes it', async () => {
      setup();
      stubFetch(geminiText(JSON.stringify({ ...DRAFT, region: 'us-ut' })));
      const r = await run(REGIONED, { i: { title: 'Navajo Loop' } }, OWNER);
      expect(r.errors).toBeUndefined();
      expect(r.data?.generateActivity).toEqual({
        activity: { name: 'Navajo Loop', region: 'US-UT' },
      });
    });

    it('leaves it for the form to ask when Gemini names none on the list', async () => {
      for (const region of ['Utah', undefined]) {
        setup();
        stubFetch(geminiText(JSON.stringify({ ...DRAFT, region })));
        const r = await run(REGIONED, { i: { title: 'Navajo Loop' } }, OWNER);
        expect(r.errors).toBeUndefined();
        expect(r.data?.generateActivity).toEqual({
          activity: { name: 'Navajo Loop', region: null },
        });
      }
    });
  });

  describe('generateActivity: the saved park a draft is part of (#269)', () => {
    const PARK = {
      id: 'point-reyes-seashore',
      name: 'Point Reyes National Seashore',
      shortDescription: 'Windswept peninsula',
      category: 'hiking',
      region: 'north-bay',
      location: { city: 'Point Reyes Station', coords: { lat: 38.0405, lng: -122.7993 } },
      duration: 'Full Day',
      coverImage: '',
    };
    const DRAFT = {
      name: 'Point Reyes Lighthouse',
      shortDescription: 'An 1870 lighthouse down 313 steps',
      category: 'scenic',
      region: 'north-bay',
      city: 'Inverness',
      lat: 37.9956,
      lng: -123.0224,
      duration: 'Full Day',
    };
    const PARENTED =
      'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name parentId } } }';

    it('names the saved park Gemini says it is inside', async () => {
      setup({ catalog: [{ id: PARK.id, j: JSON.stringify(PARK) }] });
      stubFetch(geminiText(JSON.stringify({ ...DRAFT, partOf: 'Point Reyes National Seashore' })));
      const r = await run(PARENTED, { i: { title: 'Point Reyes Lighthouse' } }, OWNER);
      expect(r.errors).toBeUndefined();
      expect(r.data?.generateActivity).toEqual({
        activity: { name: 'Point Reyes Lighthouse', parentId: 'point-reyes-seashore' },
      });
    });

    it('names none when Gemini gives no park, or one that isn’t saved', async () => {
      for (const partOf of [undefined, 'Golden Gate National Recreation Area']) {
        setup({ catalog: [{ id: PARK.id, j: JSON.stringify(PARK) }] });
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        info.mockClear();
        stubFetch(geminiText(JSON.stringify({ ...DRAFT, partOf })));
        const r = await run(PARENTED, { i: { title: 'Point Reyes Lighthouse' } }, OWNER);
        expect((r.data?.generateActivity as { activity: Row }).activity.parentId).toBeNull();
        const logged = info.mock.calls
          .map((c) => JSON.parse(String(c[0])) as Row)
          .filter((e) => e.event === 'draft.parent');
        expect(logged).toEqual([
          expect.objectContaining({ partOf: partOf ?? null, matched: false }),
        ]);
      }
    });

    it('still drafts when the catalog can’t be read', async () => {
      setup();
      execute.mockImplementation((q: unknown) => {
        const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
        return /SELECT id, j FROM a ORDER BY t DESC/.test(sql)
          ? Promise.reject(new Error('no database'))
          : Promise.resolve({ rows: [] });
      });
      stubFetch(geminiText(JSON.stringify({ ...DRAFT, partOf: 'Point Reyes National Seashore' })));
      const r = await run(PARENTED, { i: { title: 'Point Reyes Lighthouse' } }, OWNER);
      expect(r.errors).toBeUndefined();
      expect(r.data?.generateActivity).toEqual({
        activity: { name: 'Point Reyes Lighthouse', parentId: null },
      });
    });
    it('names the saved park even when Gemini’s answer ran on past its name', async () => {
      setup({ catalog: [{ id: PARK.id, j: JSON.stringify(PARK) }] });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      const partOf = 'Point Reyes National Seashore   allTrailsUrl: "https://www.alltrails.com/x';
      stubFetch(geminiText(JSON.stringify({ ...DRAFT, partOf })));
      const r = await run(PARENTED, { i: { title: 'Point Reyes Lighthouse' } }, OWNER);
      expect((r.data?.generateActivity as { activity: Row }).activity.parentId).toBe(PARK.id);
      // Logged with the name it matched on.
      const logged = info.mock.calls
        .map((c) => JSON.parse(String(c[0])) as Row)
        .filter((e) => e.event === 'draft.parent');
      expect(logged).toEqual([
        expect.objectContaining({ partOf: 'Point Reyes National Seashore', matched: true }),
      ]);
    });

    it('names the saved park the draft’s own name holds, when Gemini names none', async () => {
      setup({ catalog: [{ id: PARK.id, j: JSON.stringify(PARK) }] });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      info.mockClear();
      stubFetch(
        geminiText(
          JSON.stringify({ ...DRAFT, name: 'Tide pools of Point Reyes National Seashore' }),
        ),
      );
      const r = await run(PARENTED, { i: { title: 'Point Reyes tide pools' } }, OWNER);
      expect((r.data?.generateActivity as { activity: Row }).activity.parentId).toBe(PARK.id);
      const logged = info.mock.calls
        .map((c) => JSON.parse(String(c[0])) as Row)
        .filter((e) => e.event === 'draft.parent');
      expect(logged).toEqual([expect.objectContaining({ partOf: null, matched: true })]);
    });
  });

  describe('generateActivity: a hike’s AllTrails page, searched on AllTrails (#6)', () => {
    const HIKE = {
      name: 'Dragon Mountain Peak',
      shortDescription: 'The 450-step Stairway to Heaven',
      longDescription: 'A Buddhist sanctuary above Calaveras Road.',
      category: 'hiking',
      region: 'south-bay',
      city: 'Milpitas',
      lat: 37.4524,
      lng: -121.8505,
      duration: 'Half Day',
    };
    const STAIRS = 'https://www.alltrails.com/trail/us/california/dragon-mountain-stairs';
    const OTHER = 'https://www.alltrails.com/trail/us/california/dragon-mountain-trail-2';
    const LINKED =
      'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name allTrailsUrl } } }';
    type Answer = { ok: boolean; body: unknown } | Error;
    type Sent = { url: string; body: Row; signal: unknown; headers: unknown };

    beforeEach(() => {
      vi.stubEnv('AGENT_SEARCH_API_KEY', 'test-search-key');
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    /**
     * Answers each Gemini request in turn, and each AllTrails search with the
     * pages found for its query (or `searchFails`); Commons finds nothing.
     */
    function stubGemini(answers: Answer[], searchFails?: Answer) {
      const asked: Sent[] = [];
      const searched: Sent[] = [];
      const reply = (next: Answer) => {
        if (next instanceof Error) return Promise.reject(next);
        const { ok, body } = next;
        return Promise.resolve({
          ok,
          status: ok ? 200 : 503,
          body: null,
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
        });
      };
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init?: { body?: string; signal?: unknown; headers?: unknown }) => {
          const sent = {
            url,
            body: JSON.parse(init?.body ?? '{}') as Row,
            signal: init?.signal,
            headers: init?.headers,
          };
          const host = new URL(url).hostname;
          if (host === 'discoveryengine.googleapis.com') {
            searched.push(sent);
            if (searchFails) return reply(searchFails);
            const found = sent.body.query === 'dragon mountain stairs' ? [STAIRS] : [];
            return reply({
              ok: true,
              body: {
                results: found.map((link) => ({
                  document: { derivedStructData: { link, title: 'Dragon Mountain Stairs' } },
                })),
              },
            });
          }
          if (host === 'generativelanguage.googleapis.com') {
            asked.push(sent);
            return reply(answers.shift() ?? { ok: false, body: {} });
          }
          return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
        }),
      );
      return { asked, searched };
    }
    const answer = (value: unknown): Answer => ({
      ok: true,
      body: geminiText(JSON.stringify(value)),
    });
    /** Gemini's reply calling one of the search's tools. */
    const calling = (name: string, args: Row): Answer => ({
      ok: true,
      body: {
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }],
      },
    });
    const searching = calling('search_alltrails', { query: 'dragon mountain stairs' });
    const choosing = (url?: string) => calling('choose_trail', url ? { url } : {});
    const linkOf = (r: { data?: Row | null }) =>
      (r.data?.generateActivity as { activity: Row }).activity.allTrailsUrl;
    // The draft's search events from here on.
    function trailEvents() {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      info.mockClear();
      return () =>
        info.mock.calls
          .map((c) => JSON.parse(String(c[0])) as Row)
          .filter((e) => String(e.event).startsWith('draft.trail_search'));
    }

    it('lets Gemini search AllTrails, and keeps the trail it chose from what came back', async () => {
      setup();
      const events = trailEvents();
      const { asked, searched } = stubGemini([answer(HIKE), searching, choosing(STAIRS)]);
      const r = await run(LINKED, { i: { title: 'Dragon Mountain Peak, Milpitas' } }, OWNER);
      expect(r.errors).toBeUndefined();
      expect(r.data?.generateActivity).toEqual({
        activity: { name: 'Dragon Mountain Peak', allTrailsUrl: STAIRS },
      });
      // The Agent Search app, with its own key, on the search's time limit.
      expect(searched).toEqual([
        {
          url: `${AGENT_SEARCH_URL}?key=test-search-key`,
          body: {
            query: 'dragon mountain stairs',
            pageSize: 10,
            contentSearchSpec: { snippetSpec: { returnSnippet: true } },
          },
          signal: expect.any(AbortSignal) as AbortSignal,
          headers: { 'content-type': 'application/json' },
        },
      ]);
      // Gemini, told the draft's facts, with the search as its tool.
      expect(asked).toHaveLength(3);
      const question = [{ role: 'user', parts: [{ text: trailQuestion(HIKE) }] }];
      expect(asked[1]).toEqual({
        url: `${ENDPOINT}?key=test-gemini-key`,
        body: trailRequest(question, false),
        signal: searched[0]?.signal,
        headers: { 'content-type': 'application/json' },
      });
      expect(events()).toEqual([
        expect.objectContaining({
          event: 'draft.trail_search',
          queries: ['dragon mountain stairs'],
          results: 1,
          kept: true,
        }),
      ]);
    });

    it('gives the draft 90 seconds, then the search 45 in all', async () => {
      setup();
      const timeout = vi.spyOn(AbortSignal, 'timeout');
      trailEvents();
      stubGemini([answer(HIKE), choosing()]);
      await run(LINKED, { i: { title: 'Dragon Mountain Peak' } }, OWNER);
      expect(timeout.mock.calls).toEqual([[90_000], [45_000]]);
      timeout.mockRestore();
    });

    it('replaces the draft’s own link with what it finds, none included', async () => {
      for (const [chosen, kept] of [
        [STAIRS, STAIRS],
        [undefined, null],
      ] as const) {
        setup();
        trailEvents();
        const { asked } = stubGemini([
          answer({ ...HIKE, allTrailsUrl: OTHER }),
          searching,
          choosing(chosen),
        ]);
        const r = await run(LINKED, { i: { title: 'Dragon Mountain Peak' } }, OWNER);
        expect(linkOf(r)).toBe(kept);
        // The draft's own link goes to Gemini as a lead to check.
        const sent = asked[1]?.body as { contents: { parts: { text: string }[] }[] };
        expect(sent.contents[0]?.parts[0]?.text).toContain(`A web search suggested ${OTHER}`);
      }
    });

    it('keeps the draft’s own link when a request fails, and says which and why', async () => {
      const timedOut = Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      const cases: [Answer[], Answer | undefined, Row][] = [
        [
          [{ ok: false, body: { error: 'overloaded' } }],
          undefined,
          { step: 'gemini', status: 503, detail: '{"error":"overloaded"}' },
        ],
        [[timedOut], undefined, { step: 'gemini', error: 'TimeoutError' }],
        [[searching], { ok: false, body: {} }, { step: 'search', status: 503, detail: '{}' }],
        // Only the start of a long refusal.
        [
          [searching],
          { ok: false, body: { error: 'x'.repeat(400) } },
          {
            step: 'search',
            status: 503,
            detail: JSON.stringify({ error: 'x'.repeat(400) }).slice(0, 300),
          },
        ],
        [[searching], new TypeError('fetch failed'), { step: 'search', error: 'TypeError' }],
      ];
      for (const [answers, searchFails, logged] of cases) {
        setup();
        const events = trailEvents();
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        stubGemini([answer({ ...HIKE, allTrailsUrl: OTHER }), ...answers], searchFails);
        const r = await run(LINKED, { i: { title: 'Dragon Mountain Peak' } }, OWNER);
        expect(r.errors).toBeUndefined();
        expect(linkOf(r)).toBe(OTHER);
        expect(events()).toEqual([
          {
            level: 'info',
            source: 'api',
            ts: expect.any(String) as string,
            event: 'draft.trail_search_failed',
            ms: expect.any(Number) as number,
            ...logged,
          },
        ]);
        // The draft succeeded, so nothing reads as a server error.
        expect(errors).not.toHaveBeenCalled();
        errors.mockRestore();
      }
    });

    it('counts a non-owner’s draft once, and keeps it counted when the search fails', async () => {
      for (const answers of [[searching, choosing(STAIRS)], [{ ok: false, body: {} }]]) {
        setup();
        // Counted per draft: the last one's writes go.
        batch.mockClear();
        trailEvents();
        stubGemini([answer(HIKE), ...answers]);
        const r = await run(LINKED, { i: { title: 'Dragon Mountain Peak' } }, EDITOR);
        expect(r.errors).toBeUndefined();
        // The account's claim and the shared one, and nothing given back:
        // Gemini answered the draft, which was billed.
        expect(assistClaims()).toBe(2);
        expect(givenBack()).toHaveLength(0);
      }
    });

    it('searches for nothing but a hike, and not at all without its key', async () => {
      const cases: [Row, string | undefined][] = [
        [{ ...HIKE, category: 'scenic' }, 'test-search-key'],
        [{ ...HIKE, category: 'camping' }, 'test-search-key'],
        [{ ...HIKE, allTrailsUrl: OTHER }, undefined],
        [{ ...HIKE, allTrailsUrl: OTHER }, ''],
      ];
      for (const [draft, key] of cases) {
        setup();
        vi.stubEnv('AGENT_SEARCH_API_KEY', key);
        const { asked, searched } = stubGemini([answer(draft), searching, choosing(STAIRS)]);
        const r = await run(LINKED, { i: { title: 'Dragon Mountain Peak' } }, OWNER);
        expect(linkOf(r)).toBe(draft.allTrailsUrl ?? null);
        expect(asked).toHaveLength(1);
        expect(searched).toHaveLength(0);
      }
    });

    it('searches when the draft’s own link was dropped as unsavable', async () => {
      setup();
      trailEvents();
      const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
      const { asked } = stubGemini([
        answer({ ...HIKE, allTrailsUrl: redirect }),
        searching,
        choosing(STAIRS),
      ]);
      const r = await run(LINKED, { i: { title: 'Dragon Mountain Peak' } }, OWNER);
      expect(linkOf(r)).toBe(STAIRS);
      const sent = asked[1]?.body as { contents: { parts: { text: string }[] }[] };
      expect(sent.contents[0]?.parts[0]?.text).not.toContain('suggested');
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
      activity: {
        name: 'Manresa',
        cuisine: 'Californian',
        priceRange: '$$$$',
        dietary: ['vegetarian'],
      },
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
    'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { name category difficulty parkType priceRange costTier coverImage } } }';

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
          costTier: 'pricey',
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
      costTier: null,
    });
  });

  it('generateActivity: keeps in-range optional enums', async () => {
    setup();
    stubFetch(geminiText(JSON.stringify({ ...castleRock, priceRange: '$$', costTier: 'free' })));
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect((r.data?.generateActivity as { activity: Row }).activity).toMatchObject({
      difficulty: 'moderate',
      parkType: 'state',
      priceRange: '$$',
      costTier: 'free',
    });
  });

  it('generateActivity: drops redirect, non-web and off-host links, keeps real ones', async () => {
    setup();
    stubFetch(
      geminiText(
        JSON.stringify({
          ...castleRock,
          allTrailsUrl: 'https://www.alltrails.com/explore?q=castle+rock',
          menuUrl: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc',
          reservationUrl: 'javascript:alert(1)',
        }),
      ),
    );
    const LINKS =
      'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { allTrailsUrl menuUrl reservationUrl } } }';
    const dropped = await run(LINKS, { i: { title: 'Castle Rock' } }, OWNER);
    expect(dropped.errors).toBeUndefined();
    expect((dropped.data?.generateActivity as { activity: Row }).activity).toEqual({
      allTrailsUrl: null,
      menuUrl: null,
      reservationUrl: null,
    });

    stubFetch(
      geminiText(
        JSON.stringify({
          ...castleRock,
          allTrailsUrl: 'https://www.alltrails.com/trail/us/california/castle-rock',
          menuUrl: 'http://cafe.example.com/menu',
          reservationUrl: 'not a url',
        }),
      ),
    );
    const kept = await run(LINKS, { i: { title: 'Castle Rock' } }, OWNER);
    expect((kept.data?.generateActivity as { activity: Row }).activity).toEqual({
      allTrailsUrl: 'https://www.alltrails.com/trail/us/california/castle-rock',
      menuUrl: 'http://cafe.example.com/menu',
      reservationUrl: null,
    });

    // A trail path on another host isn't an AllTrails link.
    stubFetch(
      geminiText(
        JSON.stringify({ ...castleRock, allTrailsUrl: 'https://example.com/trail/castle-rock' }),
      ),
    );
    const offHost = await run(LINKS, { i: { title: 'Castle Rock' } }, OWNER);
    expect((offHost.data?.generateActivity as { activity: Row }).activity).toMatchObject({
      allTrailsUrl: null,
    });
  });

  it('generateActivity: reads a reply split across parts, skipping thoughts', async () => {
    setup();
    const json = JSON.stringify(castleRock);
    stubFetch({
      candidates: [
        {
          content: {
            parts: [
              { text: '{"thinking": true}', thought: true },
              { text: json.slice(0, 20) },
              {},
              { text: json.slice(20) },
            ],
          },
        },
      ],
    });
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect((r.data?.generateActivity as { activity: Row }).activity).toMatchObject({
      name: 'Castle Rock',
    });
  });

  it('generateActivity: a reply with only thoughts → BAD_GATEWAY', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    stubFetch({ candidates: [{ content: { parts: [{ text: '{}', thought: true }] } }] });
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(code(r)).toBe('BAD_GATEWAY');
    expect(r.errors?.[0].message).toBe('no content in gemini response');
    errSpy.mockRestore();
  });

  // Each Gemini call is grounded (Google Search + URL context), asks for JSON
  // against a schema, and leaves Gemini 3's temperature at its default.
  it.each([
    ['generateActivity', GENERATE, { i: { title: 'Castle Rock' } }, 'medium', 'name'],
    [
      'alltrailsLookup',
      'mutation($i: AlltrailsLookupInput!){ alltrailsLookup(input:$i){ lookup { allTrailsRating } } }',
      { i: { url: 'https://www.alltrails.com/trail/x' } },
      'low',
      'allTrailsRating',
    ],
    ['discover', '{ discover(range: weekend){ range } }', {}, 'medium', 'items'],
  ])(
    '%s: sends a grounded, schema-shaped Gemini 3 request',
    async (_name, query, vars, level, key) => {
      setup();
      stubFetch(geminiText(JSON.stringify(castleRock)));
      await run(query, vars, OWNER);
      // stubFetch's mock takes (url: string, init); the resolvers pass a JSON body.
      const calls = vi.mocked(fetch).mock.calls as unknown as [string, { body: string }][];
      const call = calls.find(([url]) => url.includes('generativelanguage'));
      expect(call?.[0]).toContain('/models/gemini-3.8-flash:generateContent');
      const body = JSON.parse(call?.[1].body ?? '{}') as Row;
      expect(body.tools).toEqual([{ googleSearch: {} }, { urlContext: {} }]);
      const config = body.generationConfig as Row;
      expect(config).toMatchObject({
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: level },
      });
      // Its own schema: the activity's fields, the lookup's numbers, or an event list.
      const schema = config.responseJsonSchema as Row;
      expect(key === 'items' ? schema : schema.properties).toHaveProperty(key);
      expect(config).not.toHaveProperty('temperature');
    },
  );

  it('generateActivity: gemini JSON that is not an object → BAD_GATEWAY', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setup();
    stubFetch(geminiText('null'));
    const r = await run(GENERATE, { i: { title: 'Castle Rock' } }, OWNER);
    expect(code(r)).toBe('BAD_GATEWAY');
    errSpy.mockRestore();
  });

  // Routes Gemini to `geminiBody` and the Wikimedia Commons cover lookup (#36)
  // to one geotagged file with the given imageinfo; Wikipedia finds nothing.
  function stubFetchWithCommons(geminiBody: unknown, imageinfo: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        let body: unknown = { query: {} };
        if (url.includes('generativelanguage')) body = geminiBody;
        else if (url.includes('list=geosearch')) {
          body = {
            query: { geosearch: [{ title: 'File:Castle Rock view.jpg', dist: 120 }] },
          };
        } else if (url.includes('prop=imageinfo')) {
          body = {
            query: { pages: [{ title: 'File:Castle Rock view.jpg', imageinfo: [imageinfo] }] },
          };
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
          text: () => Promise.resolve(JSON.stringify(body)),
        });
      }),
    );
  }

  const GENERATE_COVER =
    'mutation($i: GenerateActivityInput!){ generateActivity(input:$i){ activity { coverImage coverCredit } } }';

  it('generateActivity: sets the Commons cover image and its credit', async () => {
    setup();
    stubFetchWithCommons(geminiText(JSON.stringify(castleRock)), {
      mime: 'image/jpeg',
      width: 4000,
      height: 3000,
      url: 'https://upload.wikimedia.org/castle.jpg',
      thumburl: 'https://upload.wikimedia.org/thumb/castle.jpg/1280px-castle.jpg',
      extmetadata: {
        Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Jo">Jo</a>' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
      },
    });
    const r = await run(GENERATE_COVER, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect((r.data?.generateActivity as { activity: Row }).activity).toEqual({
      coverImage: 'https://upload.wikimedia.org/thumb/castle.jpg/1280px-castle.jpg',
      coverCredit: 'Photo: Jo, CC BY-SA 4.0, via Wikimedia Commons',
    });
  });

  it('generateActivity: no usable Commons image → no cover and no credit', async () => {
    setup();
    stubFetchWithCommons(geminiText(JSON.stringify(castleRock)), {
      mime: 'image/svg+xml',
      width: 4000,
      height: 3000,
      url: 'https://upload.wikimedia.org/castle.svg',
    });
    const r = await run(GENERATE_COVER, { i: { title: 'Castle Rock' } }, OWNER);
    expect(r.errors).toBeUndefined();
    expect((r.data?.generateActivity as { activity: Row }).activity).toEqual({
      coverImage: null,
      coverCredit: null,
    });
  });

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
    expect(r.data?.trips).toEqual([{ id: 'trip1', scheduledCount: 2, unscheduledCount: 1 }]);
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
    ([q]: unknown[]) =>
      typeof q !== 'string' && /UPDATE trip_activities/.test((q as { sql: string }).sql),
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
