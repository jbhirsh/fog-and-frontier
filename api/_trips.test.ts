import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TripRow } from './_trips.js';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any imports that trigger module eval
// ---------------------------------------------------------------------------

const { execute, batch } = vi.hoisted(() => ({
  execute: vi.fn(),
  batch: vi.fn(),
}));

vi.mock('./_db.js', () => ({ db: () => ({ execute, batch }) }));

const { transitionToPast, createTrip, patchTrip } = await import('./_trips.js');

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

// ---------------------------------------------------------------------------
// transitionToPast — the status flip and every completion upsert must land in
// ONE atomic write batch, so a mid-write failure can never freeze the trip
// 'past' with partial completion state (the 409 guard would block any retry).
// ---------------------------------------------------------------------------

describe('transitionToPast', () => {
  afterEach(() => {
    execute.mockReset();
    batch.mockReset();
  });

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

    type Stmt = { sql: string; args: unknown[] };
    const [stmts, mode] = batch.mock.calls[0] as [Stmt[], string];
    expect(mode).toBe('write');
    expect(stmts).toHaveLength(3); // status UPDATE + 1 mark + 1 unmark

    const statusStmt = stmts.find((s) =>
      /UPDATE trips SET status = 'past'/.test(s.sql),
    );
    expect(statusStmt).toBeDefined();
    expect(statusStmt?.args).toEqual([result.markedPastAt, TRIP_ID]);

    const markStmt = stmts.find(
      (s) => /VALUES \(\?, 1\)/.test(s.sql) && s.args[0] === 'act-1',
    );
    expect(markStmt).toBeDefined();

    const unmarkStmt = stmts.find(
      (s) => /VALUES \(\?, 0\)/.test(s.sql) && s.args[0] === 'act-2',
    );
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

type Stmt = { sql: string; args: unknown[] };

function sqlOf(call: unknown[]): string {
  const q = call[0];
  return typeof q === 'string' ? q : (q as { sql: string }).sql;
}

describe('createTrip (atomic)', () => {
  afterEach(() => {
    execute.mockReset();
    batch.mockReset();
  });

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
    expect(stmts.some((s) => /INSERT OR IGNORE INTO trip_members/.test(s.sql))).toBe(
      true,
    );
    const activityInserts = stmts.filter((s) =>
      /INSERT OR IGNORE INTO trip_activities/.test(s.sql),
    );
    expect(activityInserts).toHaveLength(1); // deduped
    expect(activityInserts[0].args[2]).toBe('act-1'); // activity_id column

    // No write ever leaks out through execute() — those calls are reads only.
    const writeExecs = execute.mock.calls.filter((c) =>
      /INSERT|UPDATE|DELETE/.test(sqlOf(c)),
    );
    expect(writeExecs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// patchTrip — the trip UPDATE and the out-of-range slot reset (when the date
// range changes) must commit together in ONE atomic write batch, so a date
// edit never half-applies.
// ---------------------------------------------------------------------------

describe('patchTrip (atomic)', () => {
  afterEach(() => {
    execute.mockReset();
    batch.mockReset();
  });

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
    const writeExecs = execute.mock.calls.filter((c) =>
      /INSERT|UPDATE|DELETE/.test(sqlOf(c)),
    );
    expect(writeExecs).toHaveLength(0);
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
