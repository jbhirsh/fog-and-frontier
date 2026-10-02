import { db } from '../_db.js';
import { badInput } from '../_gqlError.js';
import { requireOwnerCtx, type GqlContext } from '../_gqlContext.js';

// Owner reviews (#184): one review per owner per activity, each an optional
// 1-5 rating plus an optional free-text note. Reads are public; writes are
// owner-gated AND self-scoped — the author is always the authenticated caller,
// never a value from the input, so one owner can never write or delete the
// other's review.

export const MAX_NOTE_LENGTH = 2000;

type ReviewShape = {
  activityId: string;
  authorEmail: string;
  rating: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

// A review must say *something*. Clearing both fields is a delete, which the
// client calls explicitly — an empty upsert would otherwise leave a blank card.
// The schema's Int / String / ID! input coercion has already rejected a value
// of the wrong type, so these check only what GraphQL can't express.
export function normalizeRating(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  if (raw < 1 || raw > 5) {
    throw badInput('rating must be an integer between 1 and 5');
  }
  return raw;
}

export function normalizeNote(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw badInput(`note must be ${MAX_NOTE_LENGTH} characters or fewer`);
  }
  return trimmed;
}

export function requireActivityId(raw: string): string {
  if (!raw) throw badInput('missing activityId');
  return raw;
}

function asNumberOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// DB row (snake_case) -> GraphQL shape. Timestamps stay epoch-ms numbers; the
// DateTimeISO scalar serializes them to ISO at the boundary.
export function mapReviewRow(row: Record<string, unknown>): ReviewShape | null {
  const activityId = typeof row.activity_id === 'string' ? row.activity_id : null;
  const authorEmail =
    typeof row.author_email === 'string' ? row.author_email : null;
  if (!activityId || !authorEmail) return null;
  const createdAt = asNumberOrNull(row.created_at);
  const updatedAt = asNumberOrNull(row.updated_at);
  if (createdAt === null || updatedAt === null) return null;
  return {
    activityId,
    authorEmail,
    rating: asNumberOrNull(row.rating),
    note: typeof row.note === 'string' ? row.note : null,
    createdAt,
    updatedAt,
  };
}

// Public read of every review. Two owners over a personal catalog is a small
// result set, and one query keeps the client cache trivially consistent (same
// shape as `completed`). Revisit if the catalog grows a lot.
async function activityReviews() {
  const rs = await db().execute(
    `SELECT activity_id, author_email, rating, note, created_at, updated_at
       FROM activity_reviews
      ORDER BY updated_at DESC`,
  );
  const out: ReviewShape[] = [];
  for (const row of rs.rows) {
    const mapped = mapReviewRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function saveActivityReview(
  _parent: unknown,
  {
    input,
  }: {
    input: { activityId: string; rating?: number | null; note?: string | null };
  },
  ctx: GqlContext,
) {
  const caller = requireOwnerCtx(ctx);
  const activityId = requireActivityId(input.activityId);
  const rating = normalizeRating(input.rating);
  const note = normalizeNote(input.note);
  if (rating === null && note === null) {
    throw badInput('a review needs a rating or a note');
  }
  const now = Date.now();
  // created_at is preserved across edits (only updated_at moves), so the card
  // can show when the review was first written as well as last touched.
  await db().execute({
    sql: `INSERT INTO activity_reviews
            (activity_id, author_email, rating, note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(activity_id, author_email) DO UPDATE SET
            rating = excluded.rating,
            note = excluded.note,
            updated_at = excluded.updated_at`,
    args: [activityId, caller.email, rating, note, now, now],
  });
  const rs = await db().execute({
    sql: `SELECT activity_id, author_email, rating, note, created_at, updated_at
            FROM activity_reviews
           WHERE activity_id = ? AND author_email = ?`,
    args: [activityId, caller.email],
  });
  const stored = rs.rows[0] ? mapReviewRow(rs.rows[0]) : null;
  return {
    review: stored ?? {
      activityId,
      authorEmail: caller.email,
      rating,
      note,
      createdAt: now,
      updatedAt: now,
    },
  };
}

async function deleteActivityReview(
  _parent: unknown,
  { input }: { input: { activityId: string } },
  ctx: GqlContext,
) {
  const caller = requireOwnerCtx(ctx);
  const activityId = requireActivityId(input.activityId);
  await db().execute({
    sql: 'DELETE FROM activity_reviews WHERE activity_id = ? AND author_email = ?',
    args: [activityId, caller.email],
  });
  return { activityId, authorEmail: caller.email };
}

export const reviewsQuery = { activityReviews };
export const reviewsMutation = { saveActivityReview, deleteActivityReview };
