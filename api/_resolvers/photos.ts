import { randomUUID } from 'node:crypto';
import {
  BlobNotFoundError,
  del,
  issueSignedToken,
  presignUrl,
  type IssuedSignedToken,
} from '@vercel/blob';
import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';
import { db } from '../_db.js';
import { badInput, conflict, notFound } from '../_gqlError.js';
import { requireOwnerCtx, type GqlContext } from '../_gqlContext.js';
import { requireActivityId } from './reviews.js';

// Owner photos (#19). The bytes live in a private Vercel Blob store and never
// pass through this function: an upload gets a client token that can write one
// pathname, and a read gets signed links that expire within the hour. This
// table lists each activity's photos and holds the per-activity cap. Owners
// only, both ways: the photos are theirs, not part of the public catalog.

/** A guard against the Hobby plan's monthly limits, which pause Blob when hit. */
export const MAX_PHOTOS_PER_ACTIVITY = 20;
/** The client sends ~1600 px JPEGs, well under this. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const UPLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
export const VIEW_TOKEN_TTL_MS = 60 * 60 * 1000;
/** A cached view token is reused until it has this little time left. */
export const VIEW_TOKEN_MIN_LEFT_MS = 15 * 60 * 1000;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Catalog ids are slugs. A photo's link is its pathname pasted into a URL, so
// an id that would need escaping (a space, a slash) is refused rather than
// stored in a form its link wouldn't match.
const PATH_SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** The activity id, if photos can be filed under it. */
export function photoActivityId(raw: string): string {
  const id = requireActivityId(raw);
  if (!PATH_SAFE_ID.test(id)) throw badInput("activity id can't hold photos");
  return id;
}

function folder(activityId: string): string {
  return `photos/${activityId}/`;
}

/** Where a new photo of this activity goes. */
export function photoPathname(activityId: string, photoId: string): string {
  return `${folder(activityId)}${photoId}.jpg`;
}

/**
 * The photo id in a pathname this activity's upload could have written, or
 * null. Only pathnames of that exact shape are recorded, so a row can never
 * point at another activity's photo or anything else in the store.
 */
export function photoIdFrom(activityId: string, pathname: string): string | null {
  const prefix = folder(activityId);
  if (!pathname.startsWith(prefix)) return null;
  const match = new RegExp(`^(${UUID})\\.jpg$`).exec(pathname.slice(prefix.length));
  return match ? match[1] : null;
}

type PhotoRow = { id: string; activityId: string; pathname: string; createdAt: number };

export function mapPhotoRow(row: Record<string, unknown>): PhotoRow | null {
  const { id, activity_id, pathname } = row;
  const createdAt = Number(row.created_at);
  if (typeof id !== 'string' || typeof activity_id !== 'string') return null;
  if (typeof pathname !== 'string' || !Number.isFinite(createdAt)) return null;
  return { id, activityId: activity_id, pathname, createdAt };
}

// One signing token serves every read for its lifetime, so a warm instance
// asks the Blob API for one about once an hour, however many photos it shows.
// Signing each link with it is local.
let viewToken: IssuedSignedToken | null = null;

export function forgetViewToken(): void {
  viewToken = null;
}

async function viewSigner(now: number): Promise<IssuedSignedToken> {
  if (viewToken && viewToken.validUntil - now > VIEW_TOKEN_MIN_LEFT_MS) {
    return viewToken;
  }
  viewToken = await issueSignedToken({
    pathname: '*',
    operations: ['get'],
    validUntil: now + VIEW_TOKEN_TTL_MS,
  });
  return viewToken;
}

async function withUrls(rows: PhotoRow[]) {
  if (rows.length === 0) return [];
  const signer = await viewSigner(Date.now());
  return Promise.all(
    rows.map(async ({ id, activityId, pathname, createdAt }) => {
      const { presignedUrl } = await presignUrl(signer, {
        operation: 'get',
        pathname,
        access: 'private',
      });
      return { id, activityId, url: presignedUrl, createdAt };
    }),
  );
}

async function photosOf(activityId: string): Promise<PhotoRow[]> {
  const rs = await db().execute({
    sql: `SELECT id, activity_id, pathname, created_at
            FROM activity_photos
           WHERE activity_id = ?
           ORDER BY created_at, id`,
    args: [activityId],
  });
  const out: PhotoRow[] = [];
  for (const row of rs.rows) {
    const mapped = mapPhotoRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function countOf(activityId: string): Promise<number> {
  const rs = await db().execute({
    sql: 'SELECT COUNT(*) AS n FROM activity_photos WHERE activity_id = ?',
    args: [activityId],
  });
  return Number(rs.rows[0]?.n ?? 0);
}

function photoLimit() {
  return conflict(
    `an activity can have at most ${MAX_PHOTOS_PER_ACTIVITY} photos`,
    'photo_limit',
  );
}

async function activityPhotos(
  _parent: unknown,
  { activityId }: { activityId: string },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  return withUrls(await photosOf(photoActivityId(activityId)));
}

// Step one of an upload: a fresh pathname and a token that can write only
// that, only a JPEG, only for a few minutes. The cap is checked here so a full
// activity doesn't spend an upload, and again when the photo is recorded.
async function photoUpload(
  _parent: unknown,
  { input }: { input: { activityId: string } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const activityId = photoActivityId(input.activityId);
  const exists = await db().execute({
    sql: 'SELECT 1 FROM a WHERE id = ?',
    args: [activityId],
  });
  if (exists.rows.length === 0) throw notFound('activity not found');
  if ((await countOf(activityId)) >= MAX_PHOTOS_PER_ACTIVITY) throw photoLimit();
  const pathname = photoPathname(activityId, randomUUID());
  const clientToken = await generateClientTokenFromReadWriteToken({
    pathname,
    allowedContentTypes: ['image/jpeg'],
    maximumSizeInBytes: MAX_PHOTO_BYTES,
    validUntil: Date.now() + UPLOAD_TOKEN_TTL_MS,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return { pathname, clientToken };
}

// Step two, once the browser has uploaded: record the photo. One statement
// inserts only while the activity exists and is under the cap, so two uploads
// finishing together can't both squeeze past it, and an upload finishing
// after its activity was deleted can't leave a row a recreated activity would
// inherit.
async function addActivityPhoto(
  _parent: unknown,
  { input }: { input: { activityId: string; pathname: string } },
  ctx: GqlContext,
) {
  const caller = requireOwnerCtx(ctx);
  const activityId = photoActivityId(input.activityId);
  const id = photoIdFrom(activityId, input.pathname);
  if (!id) throw badInput("pathname isn't one of this activity's uploads");
  const now = Date.now();
  const rs = await db().execute({
    sql: `INSERT INTO activity_photos (id, activity_id, pathname, added_by, created_at)
          SELECT ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM a WHERE id = ?)
             AND (SELECT COUNT(*) FROM activity_photos WHERE activity_id = ?) < ?
          ON CONFLICT(id) DO NOTHING`,
    args: [
      id,
      activityId,
      input.pathname,
      caller.email,
      now,
      activityId,
      activityId,
      MAX_PHOTOS_PER_ACTIVITY,
    ],
  });
  if (rs.rowsAffected === 0) {
    // Already recorded (a retried call: fine, return it), or refused. A
    // refused upload's blob is listed nowhere, so it goes now rather than
    // sitting in the store, uncounted, for good.
    const existing = (await photosOf(activityId)).find((p) => p.id === id);
    if (existing) {
      const [photo] = await withUrls([existing]);
      return { photo };
    }
    await deleteBlobs([input.pathname]);
    const stillThere = await db().execute({
      sql: 'SELECT 1 FROM a WHERE id = ?',
      args: [activityId],
    });
    if (stillThere.rows.length === 0) throw notFound('activity not found');
    throw photoLimit();
  }
  const [photo] = await withUrls([
    { id, activityId, pathname: input.pathname, createdAt: now },
  ]);
  return { photo };
}

/** Deletes blobs, treating one that's already gone as deleted. */
export async function deleteBlobs(pathnames: string[]): Promise<void> {
  if (pathnames.length === 0) return;
  try {
    await del(pathnames);
  } catch (err) {
    if (!(err instanceof BlobNotFoundError)) throw err;
  }
}

async function removeActivityPhoto(
  _parent: unknown,
  { input }: { input: { id: string } },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  if (!input.id) throw badInput('missing id');
  const rs = await db().execute({
    sql: 'SELECT pathname FROM activity_photos WHERE id = ?',
    args: [input.id],
  });
  const pathname = rs.rows[0]?.pathname;
  if (typeof pathname !== 'string') throw notFound('photo not found');
  // Blob first: if that fails the row stays, so the photo still shows and the
  // owner can try again, rather than an unlisted blob eating the quota.
  await deleteBlobs([pathname]);
  await db().execute({
    sql: 'DELETE FROM activity_photos WHERE id = ?',
    args: [input.id],
  });
  return { removedId: input.id };
}

/**
 * Deletes an activity's photo rows, as a statement for the activity's delete
 * batch, returning the pathnames whose blobs then need deleting.
 */
export function deletePhotosOf(activityId: string) {
  return {
    sql: 'DELETE FROM activity_photos WHERE activity_id = ? RETURNING pathname',
    args: [activityId],
  };
}

export function pathnamesFrom(rows: readonly Record<string, unknown>[]): string[] {
  return rows.flatMap((r) => (typeof r.pathname === 'string' ? [r.pathname] : []));
}

export const photosQuery = { activityPhotos };
export const photosMutation = { photoUpload, addActivityPhoto, removeActivityPhoto };
