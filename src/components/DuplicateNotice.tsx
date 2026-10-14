import { useId } from 'react';
import type { DuplicateMatch } from '../lib/duplicates';

interface Props {
  matches: readonly DuplicateMatch[];
  /** Opens a saved activity's detail; without it the notice only names it. */
  onOpenActivity?: (id: string) => void;
  onSaveAnyway: () => void;
  saving: boolean;
}

// The Add review step's duplicate warning (#17). A high-confidence match
// (same name within 500 m) holds the save: open the saved one, or say this is
// different and save anyway. A possible one is a heads-up that doesn't stop
// the save. Nothing renders without a match.
export function DuplicateNotice({ matches, onOpenActivity, onSaveAnyway, saving }: Props) {
  // The buttons' labels lean on the sentence; point them at it.
  const sentenceId = useId();
  const high = matches.find((m) => m.confidence === 'high');
  const near = matches[0];
  if (!near) return null;
  const open = (m: DuplicateMatch) =>
    onOpenActivity && (
      <button
        type="button"
        onClick={() => onOpenActivity(m.id)}
        aria-describedby={sentenceId}
        className="font-semibold text-primary-container underline"
      >
        {high ? 'Open existing' : 'View'}
      </button>
    );
  if (high) {
    return (
      <div role="alert" className="rounded-lg border border-error bg-error-container/40 p-sm space-y-sm">
        <p id={sentenceId} className="font-body-md text-on-surface">
          This looks like a duplicate of <b>{high.name}</b> in {high.city}.
        </p>
        <div className="flex flex-wrap items-center gap-md">
          {open(high)}
          <button
            type="button"
            onClick={onSaveAnyway}
            disabled={saving}
            aria-describedby={sentenceId}
            className="font-semibold text-on-surface underline disabled:opacity-50"
          >
            Save anyway
          </button>
        </div>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-sm rounded-lg bg-surface-container-low p-sm font-body-sm">
      <span id={sentenceId}>
        You may already have <b>{near.name}</b> in {near.city} saved.
      </span>
      {open(near)}
    </div>
  );
}
