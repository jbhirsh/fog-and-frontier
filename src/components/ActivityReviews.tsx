import { useState } from 'react';

import {
  MAX_NOTE_LENGTH,
  MAX_RATING,
  authorLabel,
  deleteActivityReview,
  findOwnReview,
  formatReviewDate,
  saveActivityReview,
  useActivityReviews,
  validateDraft,
  type ActivityReview,
} from '../lib/activityReviews';
import { useOwner } from '../lib/useOwner';
import { InlineError } from './InlineError';

// Owner reviews (#184): Jess and Tarun each leave their own rating + note on an
// activity we've done. Reading is public — a signed-out visitor sees both
// reviews as static content. Writing is owner-gated and self-scoped, and per
// the role-gated UI convention (#67) the write affordances are not rendered at
// all for non-owners. The server (requireOwnerCtx + author-from-token) is the
// real gate; this is presentation.

const STARS = [1, 2, 3, 4, 5] as const;

export function ActivityReviews({ activityId }: { activityId: string }) {
  const { isOwner, email } = useOwner();
  const { reviews, loading } = useActivityReviews(activityId);
  const [editing, setEditing] = useState(false);

  const own = findOwnReview(reviews, isOwner ? email : null);
  const others = own ? reviews.filter((r) => r !== own) : reviews;

  // Hold the section back until the first read lands. Otherwise an owner who
  // already has a review is briefly told there are none and offered "write a
  // review" — and a review saved from that state would be overwritten by the
  // read that was already in flight.
  if (loading) return null;
  // Nothing to read and nothing this viewer may write — render no empty shell.
  if (!isOwner && reviews.length === 0) return null;

  return (
    <section className="space-y-sm" aria-labelledby={`reviews-${activityId}`}>
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h3
          id={`reviews-${activityId}`}
          className="font-headline-md text-headline-md text-primary"
        >
          Reviews
        </h3>
        {isOwner && !own && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps bg-secondary text-on-secondary hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              rate_review
            </span>
            WRITE A REVIEW
          </button>
        )}
      </div>

      {editing ? (
        <ReviewEditor
          activityId={activityId}
          existing={own}
          onDone={() => setEditing(false)}
        />
      ) : (
        own && (
          <ReviewCard review={own} isOwn onEdit={() => setEditing(true)} />
        )
      )}

      {others.map((review) => (
        <ReviewCard key={review.authorEmail} review={review} />
      ))}

      {reviews.length === 0 && !editing && (
        <p className="font-body-md text-on-surface-variant">
          No reviews yet — say what you thought of it.
        </p>
      )}
    </section>
  );
}

function ReviewCard({
  review,
  isOwn,
  onEdit,
}: {
  review: ActivityReview;
  isOwn?: boolean;
  onEdit?: () => void;
}) {
  return (
    <article className="bg-surface-container-low rounded-lg p-md space-y-xs">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="flex items-center gap-sm">
          <span className="font-body-md font-bold text-on-surface">
            {authorLabel(review.authorEmail)}
            {isOwn && (
              <span className="font-body-sm text-on-surface-variant"> (you)</span>
            )}
          </span>
          {review.rating != null && <StarDisplay rating={review.rating} />}
        </div>
        {/* Owner-gated edit affordance — only ever rendered on your own card. */}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-xs px-sm py-xs min-h-11 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-variant transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              edit
            </span>
            EDIT REVIEW
          </button>
        )}
      </div>
      {review.note && (
        <p className="font-body-md text-body-md text-on-surface whitespace-pre-line">
          {review.note}
        </p>
      )}
      <div className="font-body-sm text-on-surface-variant">
        {formatReviewDate(review.updatedAt)}
      </div>
    </article>
  );
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <span
      className="flex items-center text-secondary"
      aria-label={`${rating} out of ${MAX_RATING} stars`}
    >
      {STARS.map((star) => (
        <span
          key={star}
          aria-hidden="true"
          className="material-symbols-outlined"
          style={{
            fontSize: 18,
            fontVariationSettings: star <= rating ? "'FILL' 1" : "'FILL' 0",
          }}
        >
          star
        </span>
      ))}
    </span>
  );
}

function StarPicker({
  rating,
  onChange,
}: {
  rating: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div role="group" aria-label="Rating" className="flex items-center">
      {STARS.map((star) => {
        const filled = rating != null && star <= rating;
        return (
          <button
            key={star}
            type="button"
            aria-label={`${star} ${star === 1 ? 'star' : 'stars'}`}
            aria-pressed={filled}
            // Clicking the active star clears the rating (a note-only review).
            onClick={() => onChange(rating === star ? null : star)}
            className="w-11 h-11 flex items-center justify-center text-secondary hover:bg-surface-variant rounded-full transition-colors"
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 24,
                fontVariationSettings: filled ? "'FILL' 1" : "'FILL' 0",
              }}
            >
              star
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ReviewEditor({
  activityId,
  existing,
  onDone,
}: {
  activityId: string;
  existing: ActivityReview | null;
  onDone: () => void;
}) {
  const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    const invalid = validateDraft(rating, note);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await saveActivityReview({ activityId, rating, note });
      onDone();
    } catch {
      setError("Couldn't save your review. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteActivityReview(activityId);
      onDone();
    } catch {
      setError("Couldn't delete your review. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface-container-low rounded-lg p-md space-y-sm">
      <InlineError message={error} onDismiss={() => setError(null)} />
      <StarPicker rating={rating} onChange={setRating} />
      <label className="block space-y-xs">
        <span className="font-label-caps text-label-caps text-on-surface-variant">
          YOUR NOTES
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={4}
          placeholder="What was it like? Anything to remember for next time?"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-sm font-body-md text-on-surface"
        />
      </label>
      <div className="flex flex-wrap justify-end gap-sm">
        {existing && (
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={busy}
            className="inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps text-error hover:bg-error-container transition-colors disabled:opacity-50"
          >
            DELETE REVIEW
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          disabled={busy}
          className="inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-variant transition-colors disabled:opacity-50"
        >
          CANCEL
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy}
          className="inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps bg-secondary text-on-secondary hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          SAVE REVIEW
        </button>
      </div>
    </div>
  );
}
