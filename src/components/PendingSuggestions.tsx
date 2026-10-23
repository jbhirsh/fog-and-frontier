import { useEffect, useId, useRef, useState } from 'react';
import { authorLabel, formatReviewDate } from '../lib/activityReviews';
import { gqlErrorInfo } from '../lib/gqlError';
import { sentenceCase } from '../lib/activityLabels';
import { glyphBleed } from '../lib/iconMetrics';
import {
  acceptSuggestion,
  refreshSuggestions,
  rejectSuggestion,
  type PendingSuggestion,
} from '../lib/suggestions';

interface Props {
  suggestions: readonly PendingSuggestion[];
  /** Opens an activity's detail; offered once a suggestion joins the catalog. */
  onOpenActivity?: (id: string) => void;
  /**
   * Asked for by the toolbar's Review button (#259): unfold the queue, scroll
   * it into view and move focus to it, then say so with `onRevealed`.
   */
  reveal?: boolean;
  onRevealed?: () => void;
}

type Outcome = { text: string; openId?: string };

function without(record: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

// The owners' review queue (#73), above the catalog list: each activity a
// signed-in account suggested, with who suggested it, to accept into the
// catalog (credited to them) or reject. Owner-only, like the server's
// pendingSuggestions; renders nothing until something is waiting.
export function PendingSuggestions({ suggestions, onOpenActivity, reveal, onRevealed }: Props) {
  const headingId = useId();
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(true);
  // Handled once: the request is cleared through onRevealed, so a later
  // remount (switching views and back) doesn't scroll here again.
  useEffect(() => {
    if (!reveal) return;
    setOpen(true);
    section.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    heading.current?.focus({ preventScroll: true });
    onRevealed?.();
  }, [reveal, onRevealed]);
  const [busy, setBusy] = useState<string | null>(null);
  // Per suggestion: a look-alike the server found, or why it failed.
  const [duplicateOf, setDuplicateOf] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (suggestions.length === 0 && !outcome) return null;

  function start(id: string) {
    setBusy(id);
    setOutcome(null);
    setDuplicateOf((d) => without(d, id));
    setErrors((d) => without(d, id));
  }

  // The item is gone once its list refetches; keep focus in the section.
  function done(next: Outcome) {
    heading.current?.focus();
    setOutcome(next);
  }

  // Decided elsewhere (another owner, another tab): bring the lists up to
  // date rather than leave a suggestion that can't be decided again.
  async function decidedElsewhere(s: PendingSuggestion) {
    done({ text: `${s.activity.name} was already decided.` });
    await refreshSuggestions().catch(() => {});
  }

  async function accept(s: PendingSuggestion, allowDuplicate = false) {
    start(s.id);
    try {
      const catalogId = await acceptSuggestion(s.id, { allowDuplicate });
      done({ text: `Added ${s.activity.name} to the catalog.`, openId: catalogId });
    } catch (e) {
      const { code, appCode, message } = gqlErrorInfo(e);
      if (code === 'NOT_FOUND') await decidedElsewhere(s);
      else if (appCode === 'duplicate')
        setDuplicateOf((d) => ({ ...d, [s.id]: `This ${message}.` }));
      else setErrors((d) => ({ ...d, [s.id]: e instanceof Error ? message : 'Failed to accept' }));
    } finally {
      setBusy(null);
    }
  }

  async function reject(s: PendingSuggestion) {
    if (!window.confirm(`Reject "${s.activity.name}"? It leaves the queue and isn't added.`)) {
      return;
    }
    start(s.id);
    try {
      await rejectSuggestion(s.id);
      done({ text: `Rejected ${s.activity.name}.` });
    } catch (e) {
      const { code, message } = gqlErrorInfo(e);
      if (code === 'NOT_FOUND') await decidedElsewhere(s);
      else setErrors((d) => ({ ...d, [s.id]: e instanceof Error ? message : 'Failed to reject' }));
    } finally {
      setBusy(null);
    }
  }

  const waiting = suggestions.length;
  const button = 'min-h-11 rounded-full px-md font-body-sm text-body-sm disabled:opacity-50';
  return (
    <section
      ref={section}
      aria-labelledby={headingId}
      // Scrolled to just below the sticky app header (147px tall on a
      // phone, 81px from md up), and from md up below List's sticky toolbar
      // too (up to 110px; Split's doesn't stick, so it gets room to spare).
      className="scroll-mt-40 space-y-sm rounded-xl border border-outline-variant/40 bg-surface-container-low p-sm md:scroll-mt-52"
    >
      <h2
        id={headingId}
        ref={heading}
        tabIndex={-1}
        className="font-body-md text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-primary"
      >
        {waiting > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-11 w-full items-center gap-xs text-left font-semibold"
          >
            {/* Pulled left by the glyph's own side bearing, so the chevron's
                ink lines up with the cards' edge below. */}
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 20, marginLeft: glyphBleed(open ? 'expand_less' : 'expand_more') }}
              aria-hidden="true"
            >
              {open ? 'expand_less' : 'expand_more'}
            </span>
            Waiting for review {/* A circle (20px) that only widens for two digits. */}
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-[5px] text-body-sm leading-none text-on-primary tabular-nums">
              {waiting}
            </span>
          </button>
        ) : (
          <span className="font-semibold">Nothing else waiting for review</span>
        )}
      </h2>
      {/* Always in the tree (visually hidden while empty), so what's said
          into it is announced. */}
      <div
        role="status"
        className="font-body-sm text-body-sm text-on-surface-variant empty:sr-only"
      >
        {outcome && (
          <>
            {outcome.text}{' '}
            {outcome.openId && onOpenActivity && (
              <button
                type="button"
                onClick={() => outcome.openId && onOpenActivity(outcome.openId)}
                className="min-h-11 font-semibold text-primary-container underline"
              >
                Open it
              </button>
            )}
          </>
        )}
      </div>
      {open && waiting > 0 && (
        <ul className="space-y-sm">
          {suggestions.map((s) => {
            const a = s.activity;
            const nameId = `${headingId}-${s.id}`;
            return (
              <li
                key={s.id}
                aria-labelledby={nameId}
                aria-busy={busy === s.id}
                className="space-y-xs rounded-lg border-2 border-dashed border-outline-variant bg-surface-container-lowest p-sm font-body-sm text-body-sm"
              >
                <h3 id={nameId} className="font-body-md text-body-md font-semibold text-on-surface">
                  {a.name}
                </h3>
                <p className="text-on-surface-variant">
                  {a.location.city} · {sentenceCase(a.category)} · {a.duration}
                </p>
                <p className="text-on-surface">{a.shortDescription}</p>
                {a.notes && <p className="text-on-surface-variant">Notes: {a.notes}</p>}
                <p className="text-on-surface-variant">
                  Suggested by {authorLabel(s.suggestedBy)} ·{' '}
                  <time dateTime={s.suggestedAt}>{formatReviewDate(s.suggestedAt)}</time>
                </p>
                {duplicateOf[s.id] && (
                  <div
                    role="alert"
                    className="rounded-lg border border-error bg-error-container/40 px-sm"
                  >
                    {duplicateOf[s.id]}{' '}
                    <button
                      type="button"
                      onClick={() => void accept(s, true)}
                      disabled={busy !== null}
                      className="min-h-11 font-semibold text-on-surface underline disabled:opacity-50"
                    >
                      Accept anyway
                    </button>
                  </div>
                )}
                {errors[s.id] && (
                  <p role="alert" className="text-error">
                    {errors[s.id]}
                  </p>
                )}
                <div className="flex gap-sm pt-xs">
                  <button
                    type="button"
                    onClick={() => void accept(s)}
                    disabled={busy !== null}
                    className={`${button} bg-primary text-on-primary hover:opacity-90`}
                  >
                    Accept <span className="sr-only">{a.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void reject(s)}
                    disabled={busy !== null}
                    className={`${button} text-on-surface-variant hover:bg-surface-variant`}
                  >
                    Reject <span className="sr-only">{a.name}</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
