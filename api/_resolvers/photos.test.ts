import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApolloServer } from '@apollo/server';

// Owner photos (#19). Same posture as reviews.test.ts: behavior is exercised
// THROUGH the schema, mocking only the boundaries — the `db` (a real in-memory
// `activity_photos` table, so the cap and the retry path are actually run) and
// the Blob SDK (no network).

const { execute, batch, issueSignedToken, presignUrl, del, clientToken, logServerError } =
  vi.hoisted(() => ({
    execute: vi.fn(),
    batch: vi.fn(),
    issueSignedToken: vi.fn(),
    presignUrl: vi.fn(),
    del: vi.fn(),
    clientToken: vi.fn(),
    logServerError: vi.fn(),
  }));
vi.mock('../_db.js', () => ({ db: () => ({ execute, batch }) }));
vi.mock('../_log.js', () => ({ logServerError }));
vi.mock('@vercel/blob', async () => {
  const actual = await vi.importActual<typeof import('@vercel/blob')>('@vercel/blob');
  return { BlobNotFoundError: actual.BlobNotFoundError, issueSignedToken, presignUrl, del };
});
vi.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: clientToken }));

process.env.OWNER_EMAILS = 'jess@example.com,tarun@example.com';

const { BlobNotFoundError } = await import('@vercel/blob');
const { typeDefs } = await import('../_schema.js');
const { resolvers } = await import('./index.js');
const photos = await import('./photos.js');
const {
  MAX_PHOTOS_PER_ACTIVITY,
  MAX_PHOTO_BYTES,
  UPLOAD_TOKEN_TTL_MS,
  VIEW_TOKEN_TTL_MS,
  VIEW_TOKEN_MIN_LEFT_MS,
  forgetViewToken,
  mapPhotoRow,
  photoActivityId,
  photoIdFrom,
  photoPathname,
} = photos;

const server = new ApolloServer({ typeDefs, resolvers });
beforeAll(() => server.start());

const JESS = { email: 'jess@example.com', role: 'owner' as const };
const EDITOR = { email: 'editor@example.com', role: 'editor' as const };
type Caller = { email: string; role: 'owner' | 'editor' } | null;
type Result = {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: Record<string, unknown> }[];
};

async function run(query: string, variables: Record<string, unknown>, caller: Caller = JESS) {
  const res = await server.executeOperation({ query, variables }, { contextValue: { caller } });
  if (res.body.kind !== 'single') throw new Error('expected single result');
  return res.body.singleResult as Result;
}

const code = (r: Result) => r.errors?.[0]?.extensions?.code;

const LIST = `query($a: ID!){ activityPhotos(activityId: $a){ id activityId url createdAt } }`;
const UPLOAD = `mutation($i: PhotoUploadInput!){ photoUpload(input: $i){ pathname clientToken } }`;
const ADD = `mutation($i: AddActivityPhotoInput!){ addActivityPhoto(input: $i){ photo { id activityId url createdAt } } }`;
const REMOVE = `mutation($i: RemoveActivityPhotoInput!){ removeActivityPhoto(input: $i){ removedId } }`;
const DELETE_ACTIVITY = `mutation($i: DeleteActivityInput!){ deleteActivity(input: $i){ deletedId } }`;

// --- in-memory tables -------------------------------------------------------
type Row = { id: string; activity_id: string; pathname: string; added_by: string; created_at: number };
let table: Map<string, Row>;
let catalog: Set<string>;

function sqlOf(q: unknown) {
  return typeof q === 'string' ? q : (q as { sql: string }).sql;
}
function argsOf(q: unknown) {
  return typeof q === 'string' ? [] : ((q as { args?: unknown[] }).args ?? []);
}
function forActivity(id: unknown) {
  return [...table.values()]
    .filter((r) => r.activity_id === id)
    .sort((x, y) => x.created_at - y.created_at || x.id.localeCompare(y.id));
}

function fakeDb(q: unknown) {
  const sql = sqlOf(q);
  const args = argsOf(q);
  if (sql === 'SELECT 1 FROM a WHERE id = ?') {
    return { rows: catalog.has(args[0] as string) ? [{ 1: 1 }] : [] };
  }
  if (sql.startsWith('SELECT COUNT(*) AS n FROM activity_photos')) {
    return { rows: [{ n: forActivity(args[0]).length }] };
  }
  if (sql.startsWith('INSERT INTO activity_photos')) {
    expect(sql).toMatch(/WHERE EXISTS \(SELECT 1 FROM a WHERE id = \?\)\s+AND \(SELECT COUNT\(\*\) FROM activity_photos WHERE activity_id = \?\) < \?/);
    expect(sql).toMatch(/ON CONFLICT\(id\) DO NOTHING/);
    const [id, activity_id, pathname, added_by, created_at, existsFor, capFor, cap] = args as [
      string, string, string, string, number, string, string, number,
    ];
    if (table.has(id) || !catalog.has(existsFor) || forActivity(capFor).length >= cap) {
      return { rows: [], rowsAffected: 0 };
    }
    table.set(id, { id, activity_id, pathname, added_by, created_at });
    return { rows: [], rowsAffected: 1 };
  }
  if (sql.includes('FROM activity_photos') && sql.includes('WHERE activity_id = ?')) {
    expect(sql).toMatch(/ORDER BY created_at, id/);
    return { rows: forActivity(args[0]) };
  }
  if (sql === 'SELECT pathname FROM activity_photos WHERE id = ?') {
    const row = table.get(args[0] as string);
    return { rows: row ? [{ pathname: row.pathname }] : [] };
  }
  if (sql === 'DELETE FROM activity_photos WHERE id = ?') {
    table.delete(args[0] as string);
    return { rows: [], rowsAffected: 1 };
  }
  throw new Error(`unexpected SQL: ${sql}`);
}

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const NOW = 1_800_000_000_000;

function seed(activityId: string, id: string, createdAt: number) {
  table.set(id, {
    id,
    activity_id: activityId,
    pathname: photoPathname(activityId, id),
    added_by: JESS.email,
    created_at: createdAt,
  });
}

function token(validUntil: number) {
  return { delegationToken: `d${validUntil}`, clientSigningToken: `s${validUntil}`, validUntil };
}

beforeEach(() => {
  table = new Map();
  catalog = new Set(['muir']);
  forgetViewToken();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  execute.mockImplementation((q: unknown) => Promise.resolve(fakeDb(q)));
  batch.mockImplementation((stmts: { sql: string; args: unknown[] }[]) =>
    Promise.resolve(
      stmts.map(({ sql, args }) => {
        if (sql === 'DELETE FROM activity_photos WHERE activity_id = ? RETURNING pathname') {
          const gone = forActivity(args[0]);
          for (const r of gone) table.delete(r.id);
          return { rows: gone.map((r) => ({ pathname: r.pathname })) };
        }
        if (sql === 'DELETE FROM a WHERE id = ?') catalog.delete(args[0] as string);
        return { rows: [] };
      }),
    ),
  );
  issueSignedToken.mockImplementation((o: { validUntil: number }) =>
    Promise.resolve(token(o.validUntil)),
  );
  presignUrl.mockImplementation((t: { delegationToken: string }, o: { pathname: string }) =>
    Promise.resolve({ presignedUrl: `https://blob.test/${o.pathname}?t=${t.delegationToken}` }),
  );
  del.mockResolvedValue(undefined);
  clientToken.mockResolvedValue('client-token');
});

afterEach(() => {
  vi.restoreAllMocks();
  execute.mockReset();
  batch.mockReset();
  issueSignedToken.mockReset();
  presignUrl.mockReset();
  del.mockReset();
  clientToken.mockReset();
  logServerError.mockReset();
});

describe('pathnames', () => {
  it('files each photo under its activity', () => {
    expect(photoPathname('muir', ID1)).toBe(`photos/muir/${ID1}.jpg`);
  });

  it('files photos only under path-safe activity ids', () => {
    for (const ok of ['muir', 'Mt_Diablo-2']) expect(photoActivityId(ok)).toBe(ok);
    for (const bad of ['a/b', 'a b', 'a.b', 'a%2Fb', 'muir?x', 'é']) {
      expect(() => photoActivityId(bad)).toThrow("activity id can't hold photos");
    }
    expect(() => photoActivityId('')).toThrow('missing activityId');
  });

  it('reads the photo id back only from this activity’s upload pathnames', () => {
    expect(photoIdFrom('muir', `photos/muir/${ID1}.jpg`)).toBe(ID1);
    for (const bad of [
      `photos/tam/${ID1}.jpg`,
      `photos/tamx/${ID1}.jpg`,
      `photos/muir/${ID1}.png`,
      `photos/muir/${ID1}.jpg.png`,
      `photos/muir/x${ID1}.jpg`,
      `photos/muir/../tam/${ID1}.jpg`,
      `photos/muir/AAAAAAAA-1111-4111-8111-111111111111.jpg`,
      `photos/muir/not-a-uuid.jpg`,
      `other/muir/${ID1}.jpg`,
      '',
    ]) {
      expect(photoIdFrom('muir', bad)).toBeNull();
    }
  });
});

describe('mapPhotoRow', () => {
  const good = { id: ID1, activity_id: 'muir', pathname: 'p', created_at: 5 };

  it('maps a row, reading the timestamp as a number', () => {
    expect(mapPhotoRow({ ...good, created_at: '5' })).toEqual({
      id: ID1,
      activityId: 'muir',
      pathname: 'p',
      createdAt: 5,
    });
  });

  it.each([
    ['id', { ...good, id: 1 }],
    ['activity_id', { ...good, activity_id: null }],
    ['pathname', { ...good, pathname: 2 }],
    ['created_at', { ...good, created_at: 'soon' }],
  ])('skips a row with a bad %s', (_, row) => {
    expect(mapPhotoRow(row)).toBeNull();
  });
});

describe('who may use photos', () => {
  const calls: [string, string, Record<string, unknown>][] = [
    ['activityPhotos', LIST, { a: 'muir' }],
    ['photoUpload', UPLOAD, { i: { activityId: 'muir' } }],
    ['addActivityPhoto', ADD, { i: { activityId: 'muir', pathname: photoPathname('muir', ID1) } }],
    ['removeActivityPhoto', REMOVE, { i: { id: ID1 } }],
  ];

  it.each(calls)('%s needs a signed-in caller', async (_, query, vars) => {
    expect(code(await run(query, vars, null))).toBe('UNAUTHENTICATED');
  });

  it.each(calls)('%s is for owners only', async (_, query, vars) => {
    expect(code(await run(query, vars, EDITOR))).toBe('FORBIDDEN');
  });

  it('touches nothing for a caller it turns away', async () => {
    seed('muir', ID1, 1);
    for (const [, query, vars] of calls) await run(query, vars, EDITOR);
    expect(table.size).toBe(1);
    expect(del).not.toHaveBeenCalled();
    expect(clientToken).not.toHaveBeenCalled();
    expect(issueSignedToken).not.toHaveBeenCalled();
  });
});

describe('activityPhotos', () => {
  it('lists the activity’s photos oldest first, each with a signed link', async () => {
    seed('muir', ID2, 20);
    seed('muir', ID1, 10);
    seed('tam', '33333333-3333-4333-8333-333333333333', 5);
    const r = await run(LIST, { a: 'muir' });
    expect(r.errors).toBeUndefined();
    expect(r.data?.activityPhotos).toEqual([
      {
        id: ID1,
        activityId: 'muir',
        url: `https://blob.test/photos/muir/${ID1}.jpg?t=d${NOW + VIEW_TOKEN_TTL_MS}`,
        createdAt: new Date(10).toISOString(),
      },
      {
        id: ID2,
        activityId: 'muir',
        url: `https://blob.test/photos/muir/${ID2}.jpg?t=d${NOW + VIEW_TOKEN_TTL_MS}`,
        createdAt: new Date(20).toISOString(),
      },
    ]);
    expect(issueSignedToken).toHaveBeenCalledWith({
      pathname: '*',
      operations: ['get'],
      validUntil: NOW + VIEW_TOKEN_TTL_MS,
    });
    expect(presignUrl).toHaveBeenCalledWith(token(NOW + VIEW_TOKEN_TTL_MS), {
      operation: 'get',
      pathname: `photos/muir/${ID1}.jpg`,
      access: 'private',
    });
  });

  it('skips a malformed row', async () => {
    seed('muir', ID1, 10);
    table.set('bad', { ...table.get(ID1)!, id: 'bad', created_at: Number.NaN });
    const r = await run(LIST, { a: 'muir' });
    expect((r.data?.activityPhotos as unknown[]).length).toBe(1);
  });

  it('asks Blob for nothing when there are no photos', async () => {
    const r = await run(LIST, { a: 'muir' });
    expect(r.data?.activityPhotos).toEqual([]);
    expect(issueSignedToken).not.toHaveBeenCalled();
  });

  it('refuses an empty or unsafe activity id', async () => {
    expect(code(await run(LIST, { a: '' }))).toBe('BAD_USER_INPUT');
    expect(code(await run(LIST, { a: 'a/b' }))).toBe('BAD_USER_INPUT');
  });

  it('reuses one signing token until it nears expiry', async () => {
    seed('muir', ID1, 10);
    await run(LIST, { a: 'muir' });
    vi.spyOn(Date, 'now').mockReturnValue(NOW + VIEW_TOKEN_TTL_MS - VIEW_TOKEN_MIN_LEFT_MS - 1);
    await run(LIST, { a: 'muir' });
    expect(issueSignedToken).toHaveBeenCalledTimes(1);

    const later = NOW + VIEW_TOKEN_TTL_MS - VIEW_TOKEN_MIN_LEFT_MS;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    const r = await run(LIST, { a: 'muir' });
    expect(issueSignedToken).toHaveBeenCalledTimes(2);
    expect(issueSignedToken).toHaveBeenLastCalledWith(
      expect.objectContaining({ validUntil: later + VIEW_TOKEN_TTL_MS }),
    );
    expect((r.data?.activityPhotos as { url: string }[])[0].url).toContain(
      `t=d${later + VIEW_TOKEN_TTL_MS}`,
    );
  });

  it('keeps the limits it was designed around', () => {
    expect(MAX_PHOTOS_PER_ACTIVITY).toBe(20);
    expect(MAX_PHOTO_BYTES).toBe(4 * 1024 * 1024);
    expect(UPLOAD_TOKEN_TTL_MS).toBe(10 * 60 * 1000);
    expect(VIEW_TOKEN_TTL_MS).toBe(60 * 60 * 1000);
    expect(VIEW_TOKEN_MIN_LEFT_MS).toBe(15 * 60 * 1000);
  });
});

describe('photoUpload', () => {
  it('hands out a fresh pathname and a token that can write only a JPEG there', async () => {
    const r = await run(UPLOAD, { i: { activityId: 'muir' } });
    expect(r.errors).toBeUndefined();
    const { pathname, clientToken: t } = r.data?.photoUpload as {
      pathname: string;
      clientToken: string;
    };
    expect(t).toBe('client-token');
    expect(photoIdFrom('muir', pathname)).not.toBeNull();
    expect(clientToken).toHaveBeenCalledWith({
      pathname,
      allowedContentTypes: ['image/jpeg'],
      maximumSizeInBytes: MAX_PHOTO_BYTES,
      validUntil: NOW + UPLOAD_TOKEN_TTL_MS,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    const again = await run(UPLOAD, { i: { activityId: 'muir' } });
    expect((again.data?.photoUpload as { pathname: string }).pathname).not.toBe(pathname);
  });

  it('refuses an activity id that photos can’t be filed under', async () => {
    catalog.add('a b');
    expect(code(await run(UPLOAD, { i: { activityId: 'a b' } }))).toBe('BAD_USER_INPUT');
    expect(clientToken).not.toHaveBeenCalled();
  });

  it('refuses an activity that isn’t in the catalog', async () => {
    const r = await run(UPLOAD, { i: { activityId: 'gone' } });
    expect(code(r)).toBe('NOT_FOUND');
    expect(clientToken).not.toHaveBeenCalled();
  });

  it('refuses once the activity has its fill of photos', async () => {
    for (let n = 0; n < MAX_PHOTOS_PER_ACTIVITY - 1; n++) {
      seed('muir', `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, n);
    }
    expect((await run(UPLOAD, { i: { activityId: 'muir' } })).errors).toBeUndefined();
    seed('muir', ID1, 99);
    const r = await run(UPLOAD, { i: { activityId: 'muir' } });
    expect(code(r)).toBe('CONFLICT');
    expect(r.errors?.[0]?.extensions?.appCode).toBe('photo_limit');
    expect(clientToken).toHaveBeenCalledTimes(1);
  });
});

describe('addActivityPhoto', () => {
  it('records an uploaded photo as the caller’s and returns it signed', async () => {
    const pathname = photoPathname('muir', ID1);
    const r = await run(ADD, { i: { activityId: 'muir', pathname } });
    expect(r.errors).toBeUndefined();
    expect(r.data?.addActivityPhoto).toEqual({
      photo: {
        id: ID1,
        activityId: 'muir',
        url: `https://blob.test/${pathname}?t=d${NOW + VIEW_TOKEN_TTL_MS}`,
        createdAt: new Date(NOW).toISOString(),
      },
    });
    expect(table.get(ID1)).toEqual({
      id: ID1,
      activity_id: 'muir',
      pathname,
      added_by: JESS.email,
      created_at: NOW,
    });
  });

  it('refuses a pathname that isn’t this activity’s upload', async () => {
    const r = await run(ADD, {
      i: { activityId: 'muir', pathname: photoPathname('tam', ID1) },
    });
    expect(code(r)).toBe('BAD_USER_INPUT');
    expect(table.size).toBe(0);
  });

  it('returns the photo again for a retried call', async () => {
    const pathname = photoPathname('muir', ID1);
    seed('muir', ID1, 7);
    const r = await run(ADD, { i: { activityId: 'muir', pathname } });
    expect(r.errors).toBeUndefined();
    expect(del).not.toHaveBeenCalled();
    expect((r.data?.addActivityPhoto as { photo: { createdAt: string } }).photo.createdAt).toBe(
      new Date(7).toISOString(),
    );
    expect(table.size).toBe(1);
  });

  it('refuses an activity deleted since the upload, and drops the blob', async () => {
    const pathname = photoPathname('muir', ID1);
    catalog.delete('muir');
    const r = await run(ADD, { i: { activityId: 'muir', pathname } });
    expect(code(r)).toBe('NOT_FOUND');
    expect(table.size).toBe(0);
    expect(del).toHaveBeenCalledWith([pathname]);
  });

  it('refuses an id photos can’t be filed under', async () => {
    const r = await run(ADD, { i: { activityId: 'a b', pathname: `photos/a b/${ID1}.jpg` } });
    expect(code(r)).toBe('BAD_USER_INPUT');
  });

  it('refuses past the cap, even with a token handed out earlier', async () => {
    for (let n = 0; n < MAX_PHOTOS_PER_ACTIVITY; n++) {
      seed('muir', `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, n);
    }
    const r = await run(ADD, { i: { activityId: 'muir', pathname: photoPathname('muir', ID1) } });
    expect(code(r)).toBe('CONFLICT');
    expect(r.errors?.[0]?.extensions?.appCode).toBe('photo_limit');
    expect(r.errors?.[0]?.message).toBe('an activity can have at most 20 photos');
    expect(table.has(ID1)).toBe(false);
    // Listed nowhere, so it doesn't stay in the store eating the quota.
    expect(del).toHaveBeenCalledWith([photoPathname('muir', ID1)]);
  });
});

describe('removeActivityPhoto', () => {
  it('deletes the blob, then the row', async () => {
    seed('muir', ID1, 1);
    seed('muir', ID2, 2);
    const r = await run(REMOVE, { i: { id: ID1 } });
    expect(r.data?.removeActivityPhoto).toEqual({ removedId: ID1 });
    expect(del).toHaveBeenCalledWith([photoPathname('muir', ID1)]);
    expect([...table.keys()]).toEqual([ID2]);
  });

  it('still removes the row when the blob is already gone', async () => {
    seed('muir', ID1, 1);
    del.mockRejectedValueOnce(new BlobNotFoundError());
    const r = await run(REMOVE, { i: { id: ID1 } });
    expect(r.errors).toBeUndefined();
    expect(table.size).toBe(0);
  });

  it('keeps the row, so the photo can be retried, when Blob fails', async () => {
    seed('muir', ID1, 1);
    del.mockRejectedValueOnce(new Error('blob down'));
    const r = await run(REMOVE, { i: { id: ID1 } });
    expect(r.errors).toBeDefined();
    expect(table.has(ID1)).toBe(true);
  });

  it('says so for a photo it doesn’t have', async () => {
    const r = await run(REMOVE, { i: { id: ID1 } });
    expect(code(r)).toBe('NOT_FOUND');
    expect(del).not.toHaveBeenCalled();
  });

  it('refuses an empty id', async () => {
    expect(code(await run(REMOVE, { i: { id: '' } }))).toBe('BAD_USER_INPUT');
  });
});

describe('deleting an activity', () => {
  it('deletes its photos’ blobs after the rows', async () => {
    seed('muir', ID1, 1);
    seed('muir', ID2, 2);
    seed('tam', '33333333-3333-4333-8333-333333333333', 3);
    const r = await run(DELETE_ACTIVITY, { i: { id: 'muir' } });
    expect(r.errors).toBeUndefined();
    expect(del).toHaveBeenCalledWith([photoPathname('muir', ID1), photoPathname('muir', ID2)]);
    expect(batch.mock.invocationCallOrder[0]).toBeLessThan(del.mock.invocationCallOrder[0]);
    expect([...table.values()].map((p) => p.activity_id)).toEqual(['tam']);
  });

  it('calls Blob not at all for an activity without photos', async () => {
    await run(DELETE_ACTIVITY, { i: { id: 'muir' } });
    expect(del).not.toHaveBeenCalled();
  });

  it('logs, rather than fails, when the blobs can’t be deleted', async () => {
    seed('muir', ID1, 1);
    del.mockRejectedValueOnce(new Error('blob down'));
    const r = await run(DELETE_ACTIVITY, { i: { id: 'muir' } });
    expect(r.errors).toBeUndefined();
    expect(r.data?.deleteActivity).toEqual({ deletedId: 'muir' });
    expect(logServerError).toHaveBeenCalledWith(expect.any(Error), {
      route: '/api/graphql',
      detail: 'deleteActivity: photos of muir left in Blob',
    });
  });
});

describe('pathnamesFrom', () => {
  it('keeps the string pathnames of returned rows', () => {
    expect(photos.pathnamesFrom([{ pathname: 'a' }, { pathname: 3 }, {}, { pathname: 'b' }])).toEqual([
      'a',
      'b',
    ]);
  });
});
