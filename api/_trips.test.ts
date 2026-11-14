import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TripActivity, TripRow } from './_trips.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger module eval
// ---------------------------------------------------------------------------

const { execute, batch } = vi.hoisted(() => ({
  execute: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));

const {
  addCandidate,
  castVote,
  claimInvite,
  createTrip,
  deleteTripById,
  fetchActivitySnapshot,
  getAllUsers,
  getInviteByToken,
  getTripDetail,
  inviteMember,
  isHHMM,
  isIsoDate,
  listTrips,
  MAX_START_TIMES,
  patchTrip,
  patchTripActivity,
  removeCandidate,
  removeMember,
  revokeInvite,
  rowToTrip,
  rowToTripActivity,
  setStartTimes,
  transitionToPast,
  transitionToPlanning,
  transitionToVoting,
  upsertUserStatement,
} = await import('./_trips.js');

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-abc-123';
const CREATOR_EMAIL = 'owner@example.com';
const EDITOR_EMAIL = 'editor@example.com';

const tripRow: TripRow = {
  id: TRIP_ID,
  creator_email: CREATOR_EMAIL,
  title: 'Test Trip',
  description: null,
  start_date: '2025-07-01',
  end_date: '2025-07-10',
  cover_image_url: null,
  status: 'planning',
  created_at: 1700000000000,
  marked_past_at: null,
};

// Every test starts from fresh mocks and environment.
afterEach(() => {
  execute.mockReset();
  batch.mockReset();
  vi.unstubAllEnvs();
});

type Stmt = { sql: string; args: unknown[] };

function sqlOf(call: unknown[]): string {
  const q = call[0];
  return typeof q === 'string' ? q : (q as { sql: string }).sql;
}

// The writes that went out through execute() rather than a batch.
const writes = () =>
  execute.mock.calls
    .map(([q]: unknown[]) => q as Stmt | string)
    .filter((q): q is Stmt => typeof q !== 'string' && /INSERT|UPDATE|DELETE/.test(q.sql));

// ---------------------------------------------------------------------------
// transitionToPast — the status flip and every completion upsert must land in
// ONE atomic write batch, so a mid-write failure can never freeze the trip
// 'past' with partial completion state (the 409 guard would block any retry).
// ---------------------------------------------------------------------------

describe('transitionToPast', () => {
  function activityRow(overrides: Record<string, unknown>) {
    return {
      trip_id: TRIP_ID,
      snapshot_json: '{}',
      added_by_email: EDITOR_EMAIL,
      added_at: 1,
      start_time: '09:00',
      display_order: 0,
      ...overrides,
    };
  }

  it('flips status and writes all completion upserts in a single batch', async () => {
    // getTripActivities SELECT: two eligible (scheduled, catalog-backed) rows.
    execute.mockResolvedValueOnce({
      rows: [
        activityRow({ id: 'ta-1', activity_id: 'act-1', day_index: 0 }),
        activityRow({ id: 'ta-2', activity_id: 'act-2', day_index: 1 }),
      ],
    });

    const result = await transitionToPast(tripRow, ['act-1']);

    // toMark = ['act-1'] (checked), toUnmark = ['act-2'] (eligible, unchecked)
    expect(result.completedActivityIds).toEqual(['act-1']);
    expect(result.uncompletedActivityIds).toEqual(['act-2']);
    expect(typeof result.markedPastAt).toBe('number');

    // The only execute() is the read; every write goes through one batch.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(batch).toHaveBeenCalledTimes(1);

    const [stmts, mode] = batch.mock.calls[0] as [Stmt[], string];
    expect(mode).toBe('write');
    expect(stmts).toHaveLength(3); // status UPDATE + 1 mark + 1 unmark

    const statusStmt = stmts.find((s) => /UPDATE trips SET status = 'past'/.test(s.sql));
    expect(statusStmt).toBeDefined();
    expect(statusStmt?.args).toEqual([result.markedPastAt, TRIP_ID]);

    const markStmt = stmts.find((s) => /VALUES \(\?, 1\)/.test(s.sql) && s.args[0] === 'act-1');
    expect(markStmt).toBeDefined();

    const unmarkStmt = stmts.find((s) => /VALUES \(\?, 0\)/.test(s.sql) && s.args[0] === 'act-2');
    expect(unmarkStmt).toBeDefined();
  });

  it('rejects an already-past trip (409 CONFLICT) before touching the db', async () => {
    const pastTrip: TripRow = { ...tripRow, status: 'past' };
    await expect(transitionToPast(pastTrip, [])).rejects.toMatchObject({
      extensions: { code: 'CONFLICT' },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createTrip — the trip row, the creator's membership row, and every initial
// candidate must land in ONE atomic write batch. Sequential executes let a
// mid-create failure leave a trip with no creator-member or only some of its
// initial activities (data the app then can't reconcile).
// ---------------------------------------------------------------------------

describe('createTrip (atomic)', () => {
  it('writes trip + creator membership + initial activities in a single batch', async () => {
    // Reads: the initial-activity snapshot lookup and the getTripDetail reload.
    execute.mockImplementation((q: unknown) => {
      const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
      if (/SELECT j FROM a WHERE id = \?/.test(sql)) {
        return Promise.resolve({
          rows: [{ j: JSON.stringify({ id: 'act-1', name: 'Snap' }) }],
        });
      }
      if (/FROM trips WHERE id = \?/.test(sql)) {
        return Promise.resolve({ rows: [tripRow] });
      }
      return Promise.resolve({ rows: [] });
    });
    batch.mockResolvedValue([]);

    const trip = await createTrip(
      {
        title: 'New Trip',
        startDate: '2025-07-01',
        endDate: '2025-07-03',
        initialActivityIds: ['act-1', 'act-1'], // duplicate collapses to one
      },
      CREATOR_EMAIL,
    );

    // Loaded back through getTripDetail (the reload read).
    expect(trip.id).toBe(TRIP_ID);

    // Every write goes through ONE batch('write').
    expect(batch).toHaveBeenCalledTimes(1);
    const [stmts, mode] = batch.mock.calls[0] as [Stmt[], string];
    expect(mode).toBe('write');
    expect(stmts.some((s) => /INSERT INTO trips/.test(s.sql))).toBe(true);
    expect(stmts.some((s) => /INSERT OR IGNORE INTO trip_members/.test(s.sql))).toBe(true);
    const activityInserts = stmts.filter((s) =>
      /INSERT OR IGNORE INTO trip_activities/.test(s.sql),
    );
    expect(activityInserts).toHaveLength(1); // deduped
    expect(activityInserts[0].args[2]).toBe('act-1'); // activity_id column

    // No write ever leaks out through execute() — those calls are reads only.
    expect(writes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// patchTrip — the trip UPDATE and the out-of-range slot reset (when the date
// range changes) must commit together in ONE atomic write batch, so a date
// edit never half-applies.
// ---------------------------------------------------------------------------

describe('patchTrip (atomic)', () => {
  function stubTripReads() {
    execute.mockImplementation((q: unknown) => {
      const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
      if (/FROM trips WHERE id = \?/.test(sql)) {
        return Promise.resolve({ rows: [tripRow] });
      }
      return Promise.resolve({ rows: [] });
    });
    batch.mockResolvedValue([]);
  }

  it('updates trip fields in a single-statement batch when dates are unchanged', async () => {
    stubTripReads();

    await patchTrip(TRIP_ID, { title: 'Renamed' });

    expect(batch).toHaveBeenCalledTimes(1);
    const [stmts, mode] = batch.mock.calls[0] as [Stmt[], string];
    expect(mode).toBe('write');
    expect(stmts).toHaveLength(1);
    expect(/UPDATE trips SET/.test(stmts[0].sql)).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('folds the out-of-range slot reset into the same batch when dates change', async () => {
    stubTripReads();

    // tripRow.start_date is '2025-07-01'; shifting it changes the date range.
    await patchTrip(TRIP_ID, { startDate: '2025-07-02' });

    expect(batch).toHaveBeenCalledTimes(1);
    const [stmts, mode] = batch.mock.calls[0] as [Stmt[], string];
    expect(mode).toBe('write');
    expect(stmts).toHaveLength(2);
    expect(stmts.some((s) => /UPDATE trips SET/.test(s.sql))).toBe(true);
    expect(stmts.some((s) => /UPDATE trip_activities/.test(s.sql))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setStartTimes (#294) — a move swaps two places' times; both land in ONE
// write batch, so a failure never leaves them sharing one.
// ---------------------------------------------------------------------------

describe('setStartTimes (atomic)', () => {
  function onDay(id: string, start_time: string, day_index: number | null = 0) {
    return {
      id,
      trip_id: TRIP_ID,
      activity_id: id,
      snapshot_json: '{}',
      added_by_email: EDITOR_EMAIL,
      added_at: 1,
      day_index,
      start_time,
      display_order: 0,
    };
  }

  it('writes every new time in a single batch, only for this trip', async () => {
    execute.mockResolvedValueOnce({ rows: [onDay('a', '09:00'), onDay('b', '13:00')] });
    batch.mockResolvedValueOnce([]);
    const updated = await setStartTimes(tripRow, [
      { taId: 'a', startTime: '13:00' },
      { taId: 'b', startTime: '09:00' },
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({
      sql: 'SELECT * FROM trip_activities WHERE trip_id = ? AND id IN (?, ?)',
      args: [TRIP_ID, 'a', 'b'],
    });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]).toEqual([
      [
        {
          sql: 'UPDATE trip_activities SET start_time = ? WHERE id = ? AND trip_id = ? AND day_index IS NOT NULL',
          args: ['13:00', 'a', TRIP_ID],
        },
        {
          sql: 'UPDATE trip_activities SET start_time = ? WHERE id = ? AND trip_id = ? AND day_index IS NOT NULL',
          args: ['09:00', 'b', TRIP_ID],
        },
      ],
      'write',
    ]);
    expect(updated.map((ta) => [ta.id, ta.start_time])).toEqual([
      ['a', '13:00'],
      ['b', '09:00'],
    ]);
  });

  it.each([
    ['past', 'trip_past'],
    ['voting', 'voting_locked'],
  ] as const)('refuses a %s trip before touching the db', async (status, appCode) => {
    await expect(
      setStartTimes({ ...tripRow, status }, [{ taId: 'a', startTime: '09:00' }]),
    ).rejects.toMatchObject({ extensions: { code: 'CONFLICT', appCode } });
    expect(execute).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it.each([
    ['none', []],
    [
      'too many',
      Array.from({ length: MAX_START_TIMES + 1 }, (_, i) => ({
        taId: `t${i}`,
        startTime: '09:00',
      })),
    ],
    [
      'a place twice',
      [
        { taId: 'a', startTime: '09:00' },
        { taId: 'a', startTime: '10:00' },
      ],
    ],
    ['a time that isn’t one', [{ taId: 'a', startTime: '9am' }]],
    [
      'one good time and one bad',
      [
        { taId: 'a', startTime: '09:00' },
        { taId: 'b', startTime: '9am' },
      ],
    ],
  ])('refuses %s, writing nothing', async (_label, times) => {
    await expect(setStartTimes(tripRow, times)).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT' },
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it('refuses a place not on this trip, writing nothing', async () => {
    execute.mockResolvedValueOnce({ rows: [onDay('a', '09:00')] });
    await expect(
      setStartTimes(tripRow, [
        { taId: 'a', startTime: '10:00' },
        { taId: 'elsewhere', startTime: '09:00' },
      ]),
    ).rejects.toMatchObject({ extensions: { code: 'NOT_FOUND' } });
    expect(batch).not.toHaveBeenCalled();
  });

  it('takes as many as MAX_START_TIMES', async () => {
    const times = Array.from({ length: MAX_START_TIMES }, (_, i) => ({
      taId: `t${i}`,
      startTime: '09:00',
    }));
    execute.mockResolvedValueOnce({ rows: times.map((t) => onDay(t.taId, '08:00')) });
    batch.mockResolvedValueOnce([]);
    expect(await setStartTimes(tripRow, times)).toHaveLength(MAX_START_TIMES);
  });

  it('refuses when any one place is on no day, writing nothing', async () => {
    execute.mockResolvedValueOnce({ rows: [onDay('a', '09:00'), onDay('b', '09:00', null)] });
    await expect(
      setStartTimes(tripRow, [
        { taId: 'a', startTime: '10:00' },
        { taId: 'b', startTime: '11:00' },
      ]),
    ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    expect(batch).not.toHaveBeenCalled();
  });

  it('refuses a place on no day, writing nothing', async () => {
    execute.mockResolvedValueOnce({ rows: [onDay('a', '09:00', null)] });
    await expect(setStartTimes(tripRow, [{ taId: 'a', startTime: '10:00' }])).rejects.toMatchObject(
      { extensions: { code: 'BAD_USER_INPUT' } },
    );
    expect(batch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Everything else, one function at a time, through the same db mock: reads
// answered by SQL, writes checked statement by statement.
// ---------------------------------------------------------------------------

type Rows = Record<string, unknown>[];

// Answers each read by the first pattern its SQL matches; anything else
// (writes included) gets no rows.
function answer(routes: [RegExp, Rows][]) {
  execute.mockImplementation((q: unknown) => {
    const sql = typeof q === 'string' ? q : (q as { sql: string }).sql;
    const hit = routes.find(([re]) => re.test(sql));
    return Promise.resolve({ rows: hit ? hit[1] : [], rowsAffected: 0 });
  });
  batch.mockResolvedValue([]);
}

const batched = (call = 0) => (batch.mock.calls[call]?.[0] ?? []) as Stmt[];

function taRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ta-1',
    trip_id: TRIP_ID,
    activity_id: 'act-1',
    snapshot_json: '{"id":"act-1"}',
    added_by_email: EDITOR_EMAIL,
    added_at: 5,
    day_index: null,
    start_time: null,
    display_order: 0,
    ...overrides,
  };
}

const ta = (overrides: Record<string, unknown> = {}): TripActivity =>
  rowToTripActivity(taRow(overrides));

const conflictWith = (appCode?: string) => ({
  extensions: appCode ? { code: 'CONFLICT', appCode } : { code: 'CONFLICT' },
});
const badInputMsg = (message: string) => ({ message, extensions: { code: 'BAD_USER_INPUT' } });

describe('isIsoDate / isHHMM', () => {
  // The shape only, YYYY-MM-DD: whether the day exists isn't checked here.
  it.each(['2025-07-01', '0000-00-00'])('%s has a date’s format', (v) =>
    expect(isIsoDate(v)).toBe(true),
  );
  it.each(['2025-7-01', ' 2025-07-01', '2025-07-01x', 20250701, null])('%s has not', (v) =>
    expect(isIsoDate(v)).toBe(false),
  );
  it.each(['00:00', '09:30', '19:59', '23:59'])('%s is a time', (v) =>
    expect(isHHMM(v)).toBe(true),
  );
  it.each(['24:00', '9:30', '09:60', ' 09:30', '09:30 ', 930, undefined])('%s is not', (v) =>
    expect(isHHMM(v)).toBe(false),
  );
});

describe('row mappers', () => {
  it('reads a trip row, whatever types the driver hands back', () => {
    expect(
      rowToTrip({
        id: 12,
        creator_email: CREATOR_EMAIL,
        title: 'T',
        description: null,
        start_date: '2025-07-01',
        end_date: '2025-07-02',
        cover_image_url: undefined,
        status: 'voting',
        created_at: 10n,
        marked_past_at: '20',
      }),
    ).toEqual({
      id: '12',
      creator_email: CREATOR_EMAIL,
      title: 'T',
      description: null,
      start_date: '2025-07-01',
      end_date: '2025-07-02',
      cover_image_url: null,
      status: 'voting',
      created_at: 10,
      marked_past_at: 20,
    });
  });

  it.each([
    ['past', 'past'],
    ['voting', 'voting'],
    ['planning', 'planning'],
    ['archived', 'planning'],
    [null, 'planning'],
  ])('reads status %s as %s', (status, expected) => {
    expect(rowToTrip({ ...tripRow, status }).status).toBe(expected);
  });

  it('reads a candidate row, its snapshot parsed', () => {
    expect(rowToTripActivity(taRow({ day_index: 2n, start_time: '09:00' }))).toEqual({
      id: 'ta-1',
      trip_id: TRIP_ID,
      activity_id: 'act-1',
      added_by_email: EDITOR_EMAIL,
      added_at: 5,
      day_index: 2,
      start_time: '09:00',
      display_order: 0,
      snapshot: { id: 'act-1' },
    });
  });

  it('reads a snapshot that is not JSON as none, and an orphan as no activity', () => {
    const read = rowToTripActivity(taRow({ snapshot_json: '{oops', activity_id: null }));
    expect(read.snapshot).toBeNull();
    expect(read.activity_id).toBeNull();
  });
});

describe('fetchActivitySnapshot', () => {
  it('returns the stored JSON for the id', async () => {
    answer([[/SELECT j FROM a WHERE id = \?/, [{ j: '{"a":1}' }]]]);
    expect(await fetchActivitySnapshot('act-1')).toBe('{"a":1}');
    expect(execute).toHaveBeenCalledWith({ sql: 'SELECT j FROM a WHERE id = ?', args: ['act-1'] });
  });

  it.each([
    ['no row', []],
    ['a JSON that is not text', [{ j: 5 }]],
  ])('returns null for %s', async (_label, rows) => {
    answer([[/SELECT j FROM a/, rows]]);
    expect(await fetchActivitySnapshot('act-1')).toBeNull();
  });
});

describe('getTripDetail', () => {
  it('returns null when there is no trip, reading nothing else', async () => {
    answer([]);
    expect(await getTripDetail(TRIP_ID)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('gathers the trip with its candidates, members, invites and votes', async () => {
    answer([
      [/SELECT \* FROM trips WHERE id = \?/, [tripRow]],
      [/FROM trip_activities/, [taRow()]],
      [
        /FROM trip_members/,
        [
          {
            member_email: CREATOR_EMAIL,
            display_name: 'Jess',
            added_by_email: CREATOR_EMAIL,
            added_at: 1n,
          },
          {
            member_email: EDITOR_EMAIL,
            display_name: null,
            added_by_email: CREATOR_EMAIL,
            added_at: 2,
          },
        ],
      ],
      [
        /FROM trip_invites/,
        [
          {
            invite_token: 'tok',
            invited_email: null,
            invited_by_email: CREATOR_EMAIL,
            invited_at: 3n,
          },
          {
            invite_token: 'tok2',
            invited_email: 'x@y.z',
            invited_by_email: EDITOR_EMAIL,
            invited_at: 4,
          },
        ],
      ],
      [
        /FROM trip_votes/,
        [
          { trip_activity_id: 'ta-1', member_email: CREATOR_EMAIL, value: -1n },
          { trip_activity_id: 'ta-1', member_email: EDITOR_EMAIL, value: 1 },
          { trip_activity_id: 'ta-2', member_email: EDITOR_EMAIL, value: '-1' },
        ],
      ],
    ]);
    const trip = await getTripDetail(TRIP_ID);
    expect(trip).toEqual({
      ...tripRow,
      activities: [ta()],
      members: [
        {
          email: CREATOR_EMAIL,
          display_name: 'Jess',
          added_by_email: CREATOR_EMAIL,
          added_at: 1,
          is_creator: true,
        },
        {
          email: EDITOR_EMAIL,
          display_name: null,
          added_by_email: CREATOR_EMAIL,
          added_at: 2,
          is_creator: false,
        },
      ],
      invites: [
        {
          invite_token: 'tok',
          invited_email: null,
          invited_by_email: CREATOR_EMAIL,
          invited_at: 3,
        },
        {
          invite_token: 'tok2',
          invited_email: 'x@y.z',
          invited_by_email: EDITOR_EMAIL,
          invited_at: 4,
        },
      ],
      votes: [
        { trip_activity_id: 'ta-1', member_email: CREATOR_EMAIL, value: -1 },
        { trip_activity_id: 'ta-1', member_email: EDITOR_EMAIL, value: 1 },
        { trip_activity_id: 'ta-2', member_email: EDITOR_EMAIL, value: -1 },
      ],
    });
    for (const table of ['trip_activities', 'trip_members', 'trip_invites', 'trip_votes']) {
      const read = execute.mock.calls.find(([q]: unknown[]) =>
        sqlOf([q]).includes(`FROM ${table}`),
      );
      expect((read?.[0] as Stmt).args).toEqual([TRIP_ID]);
    }
  });

  // A quirk, not a contract: castVote never stores a 0 (neutral deletes the
  // row), and the reader maps anything not negative to +1, so a 0 that got in
  // some other way would read as an up vote.
  it('reads a stray stored 0 as an up vote, as only a negative reads as down', async () => {
    answer([
      [/SELECT \* FROM trips/, [tripRow]],
      [/FROM trip_votes/, [{ trip_activity_id: 'ta-3', member_email: EDITOR_EMAIL, value: 0 }]],
    ]);
    expect((await getTripDetail(TRIP_ID))?.votes).toEqual([
      { trip_activity_id: 'ta-3', member_email: EDITOR_EMAIL, value: 1 },
    ]);
  });
});

describe('listTrips', () => {
  it('lists the caller’s trips with their scheduled and unscheduled counts', async () => {
    answer([
      [
        /SELECT t\.\* FROM trips t/,
        [
          { ...tripRow, id: 'a' },
          { ...tripRow, id: '7' },
          { ...tripRow, id: '8' },
          { ...tripRow, id: 'none' },
        ],
      ],
      [
        /GROUP BY trip_id/,
        [
          { trip_id: 'a', scheduled: 2, unscheduled: 1n },
          { trip_id: 7, scheduled: null, unscheduled: 3 },
          { trip_id: 8n, scheduled: 4 },
          { trip_id: null, scheduled: 9, unscheduled: 9 },
        ],
      ],
    ]);
    const list = await listTrips(EDITOR_EMAIL);
    expect(list.map((t) => [t.id, t.scheduled_count, t.unscheduled_count])).toEqual([
      ['a', 2, 1],
      ['7', 0, 3],
      ['8', 4, 0],
      ['none', 0, 0],
    ]);
    expect(list[0]).toMatchObject({ title: 'Test Trip', status: 'planning' });
    expect((execute.mock.calls[0]?.[0] as Stmt).args).toEqual([EDITOR_EMAIL]);
  });
});

describe('upsertUserStatement / getAllUsers', () => {
  it.each([
    ['owner@example.com', 'owner'],
    ['editor@example.com', 'editor'],
  ])('gives %s the role %s', (email, role) => {
    vi.stubEnv('OWNER_EMAILS', 'owner@example.com');
    const stmt = upsertUserStatement(email, 'Ann');
    expect(stmt).toMatchObject({ args: [email, 'Ann', expect.any(Number), role] });
  });

  it('keeps the stored name when none is given', () => {
    vi.stubEnv('OWNER_EMAILS', '');
    expect(upsertUserStatement(EDITOR_EMAIL)).toMatchObject({
      args: [EDITOR_EMAIL, null, expect.any(Number), 'editor'],
    });
  });

  it('lists every account for the invite picker', async () => {
    answer([
      [
        /FROM users/,
        [
          { email: 'a@b.c', display_name: null },
          { email: 'd@e.f', display_name: 'D' },
        ],
      ],
    ]);
    expect(await getAllUsers()).toEqual([
      { email: 'a@b.c', display_name: null },
      { email: 'd@e.f', display_name: 'D' },
    ]);
  });
});

describe('createTrip: validation', () => {
  const valid = { title: 'Trip', startDate: '2025-07-01', endDate: '2025-07-03' };

  it.each([
    ['no title', { title: undefined }, 'missing or invalid title'],
    ['a title that is not text', { title: 5 }, 'missing or invalid title'],
    ['a blank title', { title: '   ' }, 'missing or invalid title'],
    ['a title over 200 characters', { title: 'x'.repeat(201) }, 'missing or invalid title'],
    ['no start', { startDate: null }, 'startDate and endDate must be ISO dates (YYYY-MM-DD)'],
    [
      'a bad end',
      { endDate: '2025/07/03' },
      'startDate and endDate must be ISO dates (YYYY-MM-DD)',
    ],
    ['an end before the start', { endDate: '2025-06-30' }, 'endDate must be on or after startDate'],
    ['a blank description', { description: ' ' }, 'invalid description'],
    ['a description over 2000', { description: 'x'.repeat(2001) }, 'invalid description'],
    ['a blank cover', { coverImageUrl: '' }, 'invalid coverImageUrl'],
    ['a cover over 2000', { coverImageUrl: 'x'.repeat(2001) }, 'invalid coverImageUrl'],
    [
      'more than 50 initial activities',
      { initialActivityIds: Array.from({ length: 51 }, (_, i) => `a${i}`) },
      'too many initialActivityIds (max 50)',
    ],
  ])('refuses %s, writing nothing', async (_label, override, message) => {
    answer([]);
    await expect(createTrip({ ...valid, ...override }, CREATOR_EMAIL)).rejects.toMatchObject(
      badInputMsg(message),
    );
    expect(batch).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('saves trimmed fields at their limits, a one-day trip, and opens in voting when asked', async () => {
    answer([[/SELECT \* FROM trips WHERE id = \?/, [tripRow]]]);
    await createTrip(
      {
        title: ` ${'t'.repeat(200)} `,
        startDate: '2025-07-01',
        endDate: '2025-07-01',
        description: ` ${'d'.repeat(2000)} `,
        coverImageUrl: ` ${'c'.repeat(2000)} `,
        initialActivityIds: Array.from({ length: 50 }, () => 5 as unknown as string),
        status: 'voting',
      },
      CREATOR_EMAIL,
    );
    const [trip, member, ...rest] = batched();
    expect(trip?.args).toEqual([
      expect.any(String),
      CREATOR_EMAIL,
      't'.repeat(200),
      'd'.repeat(2000),
      '2025-07-01',
      '2025-07-01',
      'c'.repeat(2000),
      'voting',
      expect.any(Number),
    ]);
    expect(member?.args).toEqual([trip?.args[0], CREATOR_EMAIL, CREATOR_EMAIL, trip?.args[8]]);
    // Ids that aren't text are skipped without a lookup.
    expect(rest).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(5); // the reload: trip, then its four parts
  });

  it.each([
    ['past', 'planning'],
    [null, 'planning'],
    ['planning', 'planning'],
  ] as const)(
    'opens a trip asked to be %s in %s, with no description or cover',
    async (status, expected) => {
      answer([[/SELECT \* FROM trips WHERE id = \?/, [tripRow]]]);
      await createTrip({ ...valid, status, description: null, coverImageUrl: null }, CREATOR_EMAIL);
      expect(batched()[0]?.args.slice(3, 8)).toEqual([
        null,
        '2025-07-01',
        '2025-07-03',
        null,
        expected,
      ]);
    },
  );

  it('skips an initial activity that is not in the catalog', async () => {
    answer([
      [/SELECT \* FROM trips WHERE id = \?/, [tripRow]],
      [/SELECT j FROM a/, []],
    ]);
    await createTrip({ ...valid, initialActivityIds: ['gone'] }, CREATOR_EMAIL);
    expect(batched()).toHaveLength(2);
  });

  it('adds each initial activity with its snapshot, unscheduled', async () => {
    answer([
      [/SELECT \* FROM trips WHERE id = \?/, [tripRow]],
      [/SELECT j FROM a/, [{ j: '{"n":1}' }]],
    ]);
    await createTrip({ ...valid, initialActivityIds: ['act-1', 'act-2'] }, CREATOR_EMAIL);
    const [trip, , a1, a2] = batched();
    expect(a1?.args).toEqual([
      expect.any(String),
      trip?.args[0],
      'act-1',
      '{"n":1}',
      CREATOR_EMAIL,
      trip?.args[8],
    ]);
    expect(a2?.args[2]).toBe('act-2');
    expect(a1?.args[0]).not.toBe(a2?.args[0]);
  });

  it('fails when the new trip can’t be read back', async () => {
    answer([]);
    await expect(createTrip(valid, CREATOR_EMAIL)).rejects.toThrow('failed to load created trip');
  });
});

describe('patchTrip: validation', () => {
  function stub(trip: TripRow = tripRow, after: TripRow | null = trip) {
    let reads = 0;
    execute.mockImplementation(() => {
      reads += 1;
      const row = reads === 1 ? trip : after;
      return Promise.resolve({ rows: row ? [row] : [] });
    });
    batch.mockResolvedValue([]);
  }
  const past: TripRow = { ...tripRow, status: 'past' };

  it('refuses a trip that isn’t there', async () => {
    execute.mockResolvedValue({ rows: [] });
    await expect(patchTrip(TRIP_ID, { title: 'x' })).rejects.toMatchObject({
      extensions: { code: 'NOT_FOUND' },
    });
    expect(execute.mock.calls[0]?.[0]).toEqual({
      sql: 'SELECT * FROM trips WHERE id = ?',
      args: [TRIP_ID],
    });
  });

  it.each([
    ['title', { title: 'x' }],
    ['startDate', { startDate: '2025-07-02' }],
    ['endDate', { endDate: '2025-07-11' }],
  ])('refuses to change a past trip’s %s', async (_label, patch) => {
    stub(past);
    await expect(patchTrip(TRIP_ID, patch)).rejects.toMatchObject(conflictWith('trip_past'));
    expect(batch).not.toHaveBeenCalled();
  });

  it('lets a past trip’s description and cover change', async () => {
    stub(past);
    await patchTrip(TRIP_ID, { description: ' Notes ', coverImageUrl: ' http://img ' });
    expect(batched()).toEqual([
      {
        sql: 'UPDATE trips SET description = ?, cover_image_url = ? WHERE id = ?',
        args: ['Notes', 'http://img', TRIP_ID],
      },
    ]);
  });

  it.each([
    ['a blank title', { title: ' ' }, 'invalid title'],
    ['a title over 200', { title: 'x'.repeat(201) }, 'invalid title'],
    ['a description that isn’t text', { description: 4 }, 'invalid description'],
    ['a description over 2000', { description: 'x'.repeat(2001) }, 'invalid description'],
    ['a bad start', { startDate: '7/1/2025' }, 'invalid startDate'],
    ['a bad end', { endDate: null }, 'invalid endDate'],
    ['a blank cover', { coverImageUrl: '  ' }, 'invalid coverImageUrl'],
    ['an end before the start', { endDate: '2025-06-30' }, 'endDate must be on or after startDate'],
    ['a start after the end', { startDate: '2025-07-11' }, 'endDate must be on or after startDate'],
  ])('refuses %s, writing nothing', async (_label, patch, message) => {
    stub();
    await expect(patchTrip(TRIP_ID, patch as never)).rejects.toMatchObject(badInputMsg(message));
    expect(batch).not.toHaveBeenCalled();
  });

  it('clears the description and cover with null', async () => {
    stub({ ...tripRow, description: 'd', cover_image_url: 'c' });
    await patchTrip(TRIP_ID, { description: null, coverImageUrl: null });
    expect(batched()[0]?.args).toEqual([null, null, TRIP_ID]);
  });

  it('returns the trip unchanged, writing nothing, for an empty patch', async () => {
    stub();
    expect(await patchTrip(TRIP_ID, {})).toEqual(tripRow);
    expect(batch).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('saves every field and slides slots past the new last day back to Unscheduled', async () => {
    const after = { ...tripRow, title: 'New' };
    stub(tripRow, after);
    const updated = await patchTrip(TRIP_ID, {
      title: ' New ',
      startDate: '2025-07-05',
      endDate: '2025-07-07',
    });
    expect(updated).toEqual(after);
    expect(batched()).toEqual([
      {
        sql: 'UPDATE trips SET title = ?, start_date = ?, end_date = ? WHERE id = ?',
        args: ['New', '2025-07-05', '2025-07-07', TRIP_ID],
      },
      {
        sql: expect.stringMatching(
          /UPDATE trip_activities\s+SET day_index = NULL, start_time = NULL\s+WHERE trip_id = \? AND \(day_index < 0 OR day_index >= \?\)/,
        ) as string,
        args: [TRIP_ID, 3],
      },
    ]);
    expect(batch.mock.calls[0]?.[1]).toBe('write');
  });

  it('slides slots when only the end moves', async () => {
    stub();
    await patchTrip(TRIP_ID, { endDate: '2025-07-01' });
    expect(batched()[1]?.args).toEqual([TRIP_ID, 1]);
  });

  it('leaves slots alone when the dates are given unchanged', async () => {
    stub();
    await patchTrip(TRIP_ID, { startDate: tripRow.start_date, endDate: tripRow.end_date });
    expect(batched()).toHaveLength(1);
  });

  it('refuses when the trip is gone once written', async () => {
    stub(tripRow, null);
    await expect(patchTrip(TRIP_ID, { title: 'x' })).rejects.toMatchObject({
      extensions: { code: 'NOT_FOUND' },
    });
  });
});

describe('deleteTripById', () => {
  it('deletes the trip and everything on it in one write batch', async () => {
    batch.mockResolvedValue([]);
    await deleteTripById(TRIP_ID);
    expect(batch.mock.calls[0]).toEqual([
      [
        { sql: 'DELETE FROM trip_votes WHERE trip_id = ?', args: [TRIP_ID] },
        { sql: 'DELETE FROM trip_activities WHERE trip_id = ?', args: [TRIP_ID] },
        { sql: 'DELETE FROM trip_invites WHERE trip_id = ?', args: [TRIP_ID] },
        { sql: 'DELETE FROM trip_members WHERE trip_id = ?', args: [TRIP_ID] },
        { sql: 'DELETE FROM trips WHERE id = ?', args: [TRIP_ID] },
      ],
      'write',
    ]);
  });
});

describe('addCandidate', () => {
  it('refuses a past trip before reading anything', async () => {
    answer([]);
    await expect(
      addCandidate({ ...tripRow, status: 'past' }, 'act-1', EDITOR_EMAIL),
    ).rejects.toMatchObject(conflictWith('trip_past'));
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses an activity already on the trip', async () => {
    answer([[/SELECT id FROM trip_activities/, [{ id: 'ta-1' }]]]);
    await expect(addCandidate(tripRow, 'act-1', EDITOR_EMAIL)).rejects.toMatchObject(
      conflictWith('duplicate'),
    );
    expect(execute.mock.calls[0]?.[0]).toEqual({
      sql: 'SELECT id FROM trip_activities WHERE trip_id = ? AND activity_id = ?',
      args: [TRIP_ID, 'act-1'],
    });
    expect(writes()).toEqual([]);
  });

  it('refuses an activity not in the catalog', async () => {
    answer([]);
    await expect(addCandidate(tripRow, 'gone', EDITOR_EMAIL)).rejects.toMatchObject({
      extensions: { code: 'NOT_FOUND' },
    });
    expect(writes()).toEqual([]);
  });

  it('adds it unscheduled with its snapshot, and returns it', async () => {
    answer([
      [/SELECT j FROM a/, [{ j: '{"id":"act-1"}' }]],
      [/SELECT \* FROM trip_activities WHERE id = \?/, [taRow()]],
    ]);
    expect(await addCandidate(tripRow, 'act-1', EDITOR_EMAIL)).toEqual(ta());
    const [insert] = writes();
    expect(insert?.args).toEqual([
      expect.any(String),
      TRIP_ID,
      'act-1',
      '{"id":"act-1"}',
      EDITOR_EMAIL,
      expect.any(Number),
    ]);
    const reload = execute.mock.calls.at(-1)?.[0] as Stmt;
    expect(reload.args).toEqual([insert?.args[0]]);
  });

  it('fails when the new candidate can’t be read back', async () => {
    answer([[/SELECT j FROM a/, [{ j: '{}' }]]]);
    await expect(addCandidate(tripRow, 'act-1', EDITOR_EMAIL)).rejects.toThrow(
      'failed to load created candidate',
    );
  });
});

describe('patchTripActivity', () => {
  // tripRow runs 2025-07-01..10: ten days, 0..9.
  function stubReload(row: Record<string, unknown> | null = taRow()) {
    answer([[/SELECT \* FROM trip_activities WHERE id = \?/, row ? [row] : []]]);
  }
  const update = () => writes()[0]?.args;
  const voting: TripRow = { ...tripRow, status: 'voting' };

  it('refuses a past trip', async () => {
    stubReload();
    await expect(
      patchTripActivity(ta(), { ...tripRow, status: 'past' }, { displayOrder: 1 }),
    ).rejects.toMatchObject(conflictWith('trip_past'));
    expect(writes()).toEqual([]);
  });

  it.each([{ dayIndex: 0 }, { startTime: '09:00' }, { dayIndex: null }])(
    'locks scheduling while voting (%o)',
    async (patch) => {
      stubReload();
      await expect(patchTripActivity(ta(), voting, patch)).rejects.toMatchObject(
        conflictWith('voting_locked'),
      );
      expect(writes()).toEqual([]);
    },
  );

  it('lets a card be reordered while voting, keeping its slot', async () => {
    stubReload();
    await patchTripActivity(ta({ day_index: 1, start_time: '08:00' }), voting, { displayOrder: 3 });
    expect(update()).toEqual([1, '08:00', 3, 'ta-1']);
  });

  it('schedules a candidate on a day at a time, returning it as read back', async () => {
    stubReload(taRow({ day_index: 9, start_time: '23:59' }));
    const out = await patchTripActivity(ta(), tripRow, { dayIndex: 9, startTime: '23:59' });
    expect(update()).toEqual([9, '23:59', 0, 'ta-1']);
    expect(out).toMatchObject({ day_index: 9, start_time: '23:59' });
  });

  it('moves a scheduled candidate to another day, keeping its time', async () => {
    stubReload();
    await patchTripActivity(ta({ day_index: 1, start_time: '08:00' }), tripRow, { dayIndex: 0 });
    expect(update()).toEqual([0, '08:00', 0, 'ta-1']);
  });

  it('changes only the time of a scheduled candidate', async () => {
    stubReload();
    await patchTripActivity(ta({ day_index: 1, start_time: '08:00' }), tripRow, {
      startTime: '10:15',
    });
    expect(update()).toEqual([1, '10:15', 0, 'ta-1']);
  });

  it('unschedules with both cleared', async () => {
    stubReload();
    await patchTripActivity(ta({ day_index: 1, start_time: '08:00' }), tripRow, {
      dayIndex: null,
      startTime: null,
    });
    expect(update()).toEqual([null, null, 0, 'ta-1']);
  });

  it.each([
    ['a day without a time', { dayIndex: 0 }],
    ['a time without a day', { startTime: '09:00' }],
    ['a day before the first', { dayIndex: -1, startTime: '09:00' }],
    ['a day after the last', { dayIndex: 10, startTime: '09:00' }],
    ['a fractional day', { dayIndex: 1.5, startTime: '09:00' }],
    ['a time that isn’t one', { dayIndex: 0, startTime: '9am' }],
    ['a cleared day with a time', { dayIndex: null, startTime: '09:00' }],
  ])('refuses %s, writing nothing', async (_label, patch) => {
    stubReload();
    await expect(patchTripActivity(ta(), tripRow, patch)).rejects.toMatchObject(
      badInputMsg(
        'dayIndex and startTime must be set together (both null, or dayIndex in 0..9 and startTime HH:MM)',
      ),
    );
    expect(writes()).toEqual([]);
  });

  it('treats a trip with unreadable dates as one day long', async () => {
    stubReload();
    const odd = { ...tripRow, start_date: 'soon', end_date: '2025-07-10' };
    await expect(
      patchTripActivity(ta(), odd, { dayIndex: 1, startTime: '09:00' }),
    ).rejects.toMatchObject(
      badInputMsg(
        'dayIndex and startTime must be set together (both null, or dayIndex in 0..0 and startTime HH:MM)',
      ),
    );
    await patchTripActivity(
      ta(),
      { ...tripRow, end_date: 'later' },
      { dayIndex: 0, startTime: '09:00' },
    );
    await patchTripActivity(
      ta(),
      { ...tripRow, end_date: '2025-06-01' },
      { dayIndex: 0, startTime: '09:00' },
    );
    expect(writes()).toHaveLength(2);
  });

  it.each([1.5, null])('refuses a display order of %s', async (displayOrder) => {
    stubReload();
    await expect(patchTripActivity(ta(), tripRow, { displayOrder })).rejects.toMatchObject(
      badInputMsg('displayOrder must be an integer'),
    );
    expect(writes()).toEqual([]);
  });

  it('fails when the candidate can’t be read back', async () => {
    stubReload(null);
    await expect(patchTripActivity(ta(), tripRow, { displayOrder: 1 })).rejects.toThrow(
      'failed to load updated candidate',
    );
  });
});

describe('removeCandidate', () => {
  const member = { email: EDITOR_EMAIL, role: 'editor' as const, isCreator: false };

  it('refuses a past trip', async () => {
    await expect(
      removeCandidate(ta(), { ...tripRow, status: 'past' }, member),
    ).rejects.toMatchObject(conflictWith('trip_past'));
    expect(batch).not.toHaveBeenCalled();
  });

  it('refuses a member who neither added it nor created the trip', async () => {
    await expect(
      removeCandidate(ta(), tripRow, { ...member, email: 'other@example.com' }),
    ).rejects.toMatchObject({ extensions: { code: 'FORBIDDEN', appCode: 'not_adder' } });
    expect(batch).not.toHaveBeenCalled();
  });

  it.each([
    ['the member who added it', member],
    ['the trip’s creator', { email: CREATOR_EMAIL, role: 'owner' as const, isCreator: true }],
  ])('lets %s drop it with its votes, in one batch', async (_label, ctx) => {
    batch.mockResolvedValue([]);
    await removeCandidate(ta(), tripRow, ctx);
    expect(batch.mock.calls[0]).toEqual([
      [
        { sql: 'DELETE FROM trip_votes WHERE trip_activity_id = ?', args: ['ta-1'] },
        { sql: 'DELETE FROM trip_activities WHERE id = ?', args: ['ta-1'] },
      ],
      'write',
    ]);
  });
});

describe('castVote', () => {
  const voting: TripRow = { ...tripRow, status: 'voting' };

  it.each(['planning', 'past'] as const)('refuses a %s trip', async (status) => {
    answer([]);
    await expect(castVote({ ...tripRow, status }, 'ta-1', 1, EDITOR_EMAIL)).rejects.toMatchObject(
      conflictWith('not_voting'),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a candidate not on this trip', async () => {
    answer([]);
    await expect(castVote(voting, 'ta-x', 1, EDITOR_EMAIL)).rejects.toMatchObject({
      extensions: { code: 'NOT_FOUND' },
    });
    expect(execute.mock.calls[0]?.[0]).toEqual({
      sql: 'SELECT id FROM trip_activities WHERE id = ? AND trip_id = ?',
      args: ['ta-x', TRIP_ID],
    });
    expect(writes()).toEqual([]);
  });

  it('clears a vote with 0', async () => {
    answer([[/SELECT id FROM trip_activities/, [{ id: 'ta-1' }]]]);
    expect(await castVote(voting, 'ta-1', 0, EDITOR_EMAIL)).toBeNull();
    expect(writes()).toEqual([
      {
        sql: expect.stringMatching(/^DELETE FROM trip_votes/) as string,
        args: [TRIP_ID, EDITOR_EMAIL, 'ta-1'],
      },
    ]);
  });

  it.each([1, -1] as const)('records a vote of %s', async (value) => {
    answer([[/SELECT id FROM trip_activities/, [{ id: 'ta-1' }]]]);
    expect(await castVote(voting, 'ta-1', value, EDITOR_EMAIL)).toEqual({
      trip_activity_id: 'ta-1',
      member_email: EDITOR_EMAIL,
      value,
    });
    expect(writes()).toEqual([
      {
        sql: expect.stringMatching(/^INSERT INTO trip_votes/) as string,
        args: [TRIP_ID, EDITOR_EMAIL, 'ta-1', value, expect.any(Number)],
      },
    ]);
  });
});

describe('transitionToPlanning', () => {
  it.each(['planning', 'past'] as const)('refuses a %s trip', async (status) => {
    answer([]);
    await expect(transitionToPlanning({ ...tripRow, status }, [])).rejects.toMatchObject(
      conflictWith('not_voting'),
    );
    expect(batch).not.toHaveBeenCalled();
  });

  it('keeps the chosen candidates in the order chosen, drops the rest with their votes', async () => {
    answer([
      [/FROM trip_activities/, [taRow({ id: 'a' }), taRow({ id: 'b' }), taRow({ id: 'c' })]],
    ]);
    const out = await transitionToPlanning({ ...tripRow, status: 'voting' }, [
      'c',
      7,
      'zzz',
      'a',
      'c',
    ]);
    expect(out).toEqual({ kept: 2 });
    expect(batch.mock.calls[0]).toEqual([
      [
        { sql: 'DELETE FROM trip_votes WHERE trip_activity_id = ?', args: ['b'] },
        { sql: 'DELETE FROM trip_activities WHERE id = ?', args: ['b'] },
        { sql: 'UPDATE trip_activities SET display_order = ? WHERE id = ?', args: [0, 'c'] },
        { sql: 'UPDATE trip_activities SET display_order = ? WHERE id = ?', args: [1, 'a'] },
        { sql: "UPDATE trips SET status = 'planning' WHERE id = ?", args: [TRIP_ID] },
      ],
      'write',
    ]);
  });
});

describe('transitionToVoting', () => {
  it.each([
    ['past', 'past trips cannot reopen voting'],
    ['voting', 'trip is already in voting'],
  ] as const)('refuses a %s trip', async (status, message) => {
    answer([]);
    await expect(transitionToVoting({ ...tripRow, status })).rejects.toMatchObject({
      message,
      ...conflictWith('not_planning'),
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it('unschedules every candidate in its current order and reopens voting', async () => {
    answer([[/FROM trip_activities/, [taRow({ id: 'x' }), taRow({ id: 'y' })]]]);
    await transitionToVoting(tripRow);
    const stmts = batched();
    expect(stmts.map((s) => s.args)).toEqual([[0, 'x'], [1, 'y'], [TRIP_ID]]);
    expect(stmts[0]?.sql).toMatch(/SET day_index = NULL, start_time = NULL, display_order = \?/);
    expect(stmts[2]?.sql).toBe("UPDATE trips SET status = 'voting' WHERE id = ?");
    expect(batch.mock.calls[0]?.[1]).toBe('write');
  });
});

describe('transitionToPast: what counts', () => {
  it('marks only scheduled catalog activities, ignoring ids that aren’t text', async () => {
    answer([
      [
        /FROM trip_activities/,
        [
          taRow({ id: 't1', activity_id: 'on-day', day_index: 0 }),
          taRow({ id: 't2', activity_id: 'unscheduled', day_index: null }),
          taRow({ id: 't3', activity_id: null, day_index: 1 }),
          taRow({ id: 't4', activity_id: 'also-on-day', day_index: 2 }),
        ],
      ],
    ]);
    const out = await transitionToPast(tripRow, [
      5,
      'unscheduled',
      'on-day',
      'on-day',
      'elsewhere',
    ]);
    expect(out.completedActivityIds).toEqual(['on-day']);
    expect(out.uncompletedActivityIds).toEqual(['also-on-day']);
    expect(batched().map((s) => s.args)).toEqual([
      [out.markedPastAt, TRIP_ID],
      ['on-day'],
      ['also-on-day'],
    ]);
  });
});

describe('inviteMember', () => {
  it.each(['not-an-email', 'a@b', '', 'a b@c.d', 'a@b.c d', 5 as unknown as string])(
    'refuses %s',
    async (email) => {
      answer([]);
      await expect(inviteMember(TRIP_ID, email, CREATOR_EMAIL)).rejects.toMatchObject(
        badInputMsg('invalid email'),
      );
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it('refuses someone already a member', async () => {
    answer([[/SELECT 1 FROM trip_members/, [{ 1: 1 }]]]);
    await expect(inviteMember(TRIP_ID, EDITOR_EMAIL, CREATOR_EMAIL)).rejects.toMatchObject(
      conflictWith('already_member'),
    );
    expect(execute.mock.calls[0]?.[0]).toEqual({
      sql: 'SELECT 1 FROM trip_members WHERE trip_id = ? AND member_email = ?',
      args: [TRIP_ID, EDITOR_EMAIL],
    });
    expect(writes()).toEqual([]);
  });

  it('invites by the address trimmed and lower-cased, with a fresh token', async () => {
    answer([]);
    const invite = await inviteMember(TRIP_ID, ' New@Example.COM ', CREATOR_EMAIL);
    expect(invite).toEqual({
      invite_token: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      invited_email: 'new@example.com',
      invited_by_email: CREATOR_EMAIL,
      invited_at: expect.any(Number) as number,
    });
    expect(writes()[0]?.args).toEqual([
      TRIP_ID,
      invite.invite_token,
      'new@example.com',
      CREATOR_EMAIL,
      invite.invited_at,
    ]);
  });
});

describe('removeMember', () => {
  const creator = { email: CREATOR_EMAIL, role: 'owner' as const, isCreator: true };
  const editor = { email: EDITOR_EMAIL, role: 'editor' as const, isCreator: false };

  it.each([' ', null as unknown as string])('refuses no email (%o)', async (email) => {
    await expect(removeMember(TRIP_ID, email, creator)).rejects.toMatchObject(
      badInputMsg('missing email'),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a member removing someone else', async () => {
    await expect(removeMember(TRIP_ID, 'other@example.com', editor)).rejects.toMatchObject({
      extensions: { code: 'FORBIDDEN' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses the creator leaving', async () => {
    await expect(removeMember(TRIP_ID, CREATOR_EMAIL, creator)).rejects.toMatchObject(
      conflictWith('creator_cannot_leave'),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['a member leaves', ` ${EDITOR_EMAIL.toUpperCase()} `, editor, EDITOR_EMAIL],
    ['the creator removes a member', 'Other@Example.com', creator, 'other@example.com'],
  ])('%s', async (_label, raw, ctx, removed) => {
    answer([]);
    expect(await removeMember(TRIP_ID, raw, ctx)).toBe(removed);
    expect(writes()).toEqual([
      {
        sql: 'DELETE FROM trip_members WHERE trip_id = ? AND member_email = ?',
        args: [TRIP_ID, removed],
      },
    ]);
  });
});

describe('invites: revoke and claim', () => {
  const invite = {
    trip_id: TRIP_ID,
    invite_token: 'tok',
    invited_email: null,
    invited_by_email: CREATOR_EMAIL,
    invited_at: 9n,
  };
  const user = { email: 'new@example.com', role: 'editor' as const, firstName: 'Nia' };
  const consumed = {
    sql: 'DELETE FROM trip_invites WHERE trip_id = ? AND invite_token = ?',
    args: [TRIP_ID, 'tok'],
  };

  it('revokes by token', async () => {
    answer([]);
    expect(await revokeInvite(TRIP_ID, 'tok')).toBe('tok');
    expect(writes()).toEqual([consumed]);
  });

  it('reads an invite by its token', async () => {
    answer([[/FROM trip_invites WHERE invite_token = \?/, [invite]]]);
    expect(await getInviteByToken('tok')).toEqual({ ...invite, invited_at: 9 });
    expect((execute.mock.calls[0]?.[0] as Stmt).args).toEqual(['tok']);
  });

  it('claims nothing for a token that isn’t there', async () => {
    answer([]);
    expect(await claimInvite('tok', user)).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('claims nothing for a trip that is gone', async () => {
    answer([[/FROM trip_invites/, [invite]]]);
    expect(await claimInvite('tok', user)).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('only consumes the invite for someone already a member', async () => {
    answer([
      [/FROM trip_invites/, [invite]],
      [/SELECT \* FROM trips/, [tripRow]],
      [/SELECT 1 FROM trip_members/, [{ 1: 1 }]],
    ]);
    expect(await claimInvite('tok', user)).toBe(TRIP_ID);
    expect(writes()).toEqual([consumed]);
  });

  it.each([
    ['their first name', user, 'Nia'],
    ['no name', { email: user.email, role: user.role }, null],
  ])(
    'makes the account (%s), adds the member and consumes the invite',
    async (_label, who, name) => {
      answer([
        [/FROM trip_invites/, [invite]],
        [/SELECT \* FROM trips/, [tripRow]],
      ]);
      expect(await claimInvite('tok', who)).toBe(TRIP_ID);
      expect(batch).not.toHaveBeenCalled();
      const [account, membership, consume, ...rest] = writes();
      expect(account?.sql).toMatch(/INSERT INTO users/);
      expect(account?.args.slice(0, 2)).toEqual([user.email, name]);
      expect(membership?.sql).toMatch(/INSERT OR IGNORE INTO trip_members/);
      expect(membership?.args).toEqual([TRIP_ID, user.email, CREATOR_EMAIL, expect.any(Number)]);
      expect(consume).toEqual(consumed);
      expect(rest).toEqual([]);
    },
  );
});
