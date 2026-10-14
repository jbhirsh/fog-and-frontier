import { randomUUID } from 'node:crypto';
import { db } from '../_db.js';
import { slugify } from '../_duplicates.js';
import { badInput, forbidden, notFound } from '../_gqlError.js';
import { mapCatalogActivity, parseCatalogActivity } from '../_gqlMap.js';
import { keepSavableLinks } from '../_links.js';
import { logServerError } from '../_log.js';
import { requireOwnerCtx, requireUserCtx, type GqlContext } from '../_gqlContext.js';
import { upsertUserStatement } from '../_trips.js';
import {
  MAX_ACTIVITY_JSON,
  buildStoredActivity,
  checkActivityInput,
  freeCatalogId,
  refuseDuplicate,
  type ActivityInput,
} from './catalog.js';
import { forgetCatalog } from './driving.js';

// Suggestions (#73): any signed-in account can suggest an activity; the
// owners accept it (it joins the catalog, crediting whoever suggested it) or
// reject it. Pending ones live in their own table, so the public catalog
// read can never show one. A rejected one is kept, marked, rather than
// deleted.

/** How many of an account's suggestions can wait for review at once. */
export const MAX_PENDING_PER_ACCOUNT = 10;
/** How many pending suggestions the owners' list shows, newest first. */
export const PENDING_LIST_LIMIT = 200;

// The table's TEXT columns; anything else reads as empty.
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function suggestActivity(
  _parent: unknown,
  { input }: { input: { activity: ActivityInput; allowDuplicate?: boolean | null } },
  ctx: GqlContext,
) {
  const caller = requireUserCtx(ctx);
  checkActivityInput(input.activity);
  if (!input.allowDuplicate) await refuseDuplicate(input.activity);
  const id = randomUUID();
  // Credit is set on accept, and the catalog id chosen then too. Whether the
  // owners have done it is theirs to say, so completion is dropped. Only
  // real web pages are kept as links.
  const draft = keepSavableLinks({
    ...input.activity,
    completed: undefined,
    completedDate: undefined,
    contributors: undefined,
  });
  const json = JSON.stringify(buildStoredActivity(id, draft, undefined));
  if (json.length > MAX_ACTIVITY_JSON) throw badInput('activity too large');
  // Only while the account has room in the queue, checked in the insert
  // itself so two at once can't both slip under the cap.
  const rs = await db().execute({
    sql: `INSERT INTO suggestions (id, j, t, suggested_by, status)
          SELECT ?, ?, ?, ?, 'pending'
          WHERE (SELECT COUNT(*) FROM suggestions
                 WHERE suggested_by = ? AND status = 'pending') < ?`,
    args: [id, json, Date.now(), caller.email, caller.email, MAX_PENDING_PER_ACCOUNT],
  });
  if (rs.rowsAffected === 0) {
    throw forbidden(
      `You have ${MAX_PENDING_PER_ACCOUNT} suggestions waiting for review. Try again once the owners have looked at them.`,
      'suggestion_limit',
    );
  }
  return { suggestion: { id } };
}

// A stored suggestion as a catalog activity, or null if it isn't one.
function readDraft(j: unknown, id: string) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text(j));
  } catch {
    // Unreadable: parsed stays null, which isn't an activity.
  }
  const result = parseCatalogActivity(parsed, id);
  return result.ok ? result.activity : null;
}

async function pendingSuggestions(_parent: unknown, _args: unknown, ctx: GqlContext) {
  requireOwnerCtx(ctx);
  const rs = await db().execute({
    sql: `SELECT id, j, t, suggested_by FROM suggestions
          WHERE status = 'pending' ORDER BY t DESC LIMIT ?`,
    args: [PENDING_LIST_LIMIT],
  });
  const out = [];
  for (const row of rs.rows) {
    const id = text(row.id);
    const activity = readDraft(row.j, id);
    if (!activity) {
      logServerError(new Error('skipped invalid suggestion'), {
        route: '/api/graphql',
        detail: `pendingSuggestions: ${id}`,
      });
      continue;
    }
    out.push({
      id,
      suggestedBy: text(row.suggested_by),
      suggestedAt: Number(row.t),
      activity,
    });
  }
  return out;
}

async function pendingRow(id: string) {
  const rs = await db().execute({
    sql: "SELECT j, suggested_by FROM suggestions WHERE id = ? AND status = 'pending'",
    args: [id],
  });
  const row = rs.rows[0];
  if (!row) throw notFound('no such pending suggestion');
  return row;
}

async function acceptSuggestion(
  _parent: unknown,
  { id, allowDuplicate }: { id: string; allowDuplicate?: boolean | null },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const row = await pendingRow(id);
  const activity = readDraft(row.j, id);
  if (!activity) throw badInput('this suggestion is not a complete activity');
  const draft = JSON.parse(text(row.j)) as ActivityInput;
  // The catalog may have gained a look-alike since it was suggested, or
  // someone else suggested the same place.
  if (!allowDuplicate) await refuseDuplicate(draft);
  const suggester = text(row.suggested_by);
  const activityId = await freeCatalogId(slugify(text(activity.name)));
  const stored = { ...draft, id: activityId, contributors: [suggester] };
  const json = JSON.stringify(stored);
  if (json.length > MAX_ACTIVITY_JSON) throw badInput('activity too large');
  // The activity, its credit, and the suggestion's new state land together,
  // and only while it's still pending, so accepting twice at once adds it
  // once. A users row makes the suggester someone the owners can credit.
  const results = await db().batch(
    [
      {
        sql: `INSERT INTO a (id, j, t)
              SELECT ?, ?, ? WHERE EXISTS
                (SELECT 1 FROM suggestions WHERE id = ? AND status = 'pending')`,
        args: [activityId, json, Date.now(), id],
      },
      upsertUserStatement(suggester),
      {
        sql: "UPDATE suggestions SET status = 'accepted' WHERE id = ? AND status = 'pending'",
        args: [id],
      },
    ],
    'write',
  );
  // Decided by someone else between the read and the write: nothing added.
  if (results[2]?.rowsAffected !== 1) throw notFound('no such pending suggestion');
  forgetCatalog(); // road miles (#66) pick up the new pin
  return { activity: mapCatalogActivity(stored, activityId) };
}

async function rejectSuggestion(
  _parent: unknown,
  { id }: { id: string },
  ctx: GqlContext,
) {
  requireOwnerCtx(ctx);
  const rs = await db().execute({
    sql: "UPDATE suggestions SET status = 'rejected' WHERE id = ? AND status = 'pending'",
    args: [id],
  });
  if (rs.rowsAffected === 0) throw notFound('no such pending suggestion');
  return { id };
}

export const suggestionsQuery = { pendingSuggestions };
export const suggestionsMutation = { suggestActivity, acceptSuggestion, rejectSuggestion };
