import { useState } from 'react';
import type { TripActivity } from '../lib/userTrips';

type VoteTally = { up: number; down: number; net: number };

type Candidate = {
  activity: TripActivity;
  tally: VoteTally;
};

type Props = {
  candidates: Candidate[];
  onCancel: () => void;
  onConfirm: (keptActivityIds: string[]) => void;
};

export function PromoteToPlanningModal({ candidates, onCancel, onConfirm }: Props) {
  // Initialize: pre-check candidates with net > 0
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => c.tally.net > 0).map((c) => c.activity.id)),
  );

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleConfirm() {
    // Preserve candidates order, return only checked ids
    const keptIds = candidates.filter((c) => checked.has(c.activity.id)).map((c) => c.activity.id);
    onConfirm(keptIds);
  }

  const title = 'Finalize voting — choose what makes the trip';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-margin">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />

      {/* Dialog panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-2xl space-y-md rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-lg shadow-xl"
      >
        <h2 className="font-headline-md text-headline-md text-on-surface">{title}</h2>

        <p className="font-body-md text-sm text-on-surface-variant">
          Select the activities to carry into the planning phase. Any unchecked candidates will be
          permanently removed from the trip.
        </p>

        {/* Candidate checklist */}
        <ul className="max-h-96 space-y-sm overflow-y-auto">
          {candidates.map(({ activity, tally }) => {
            const name = activity.snapshot?.name ?? '(deleted activity)';
            const netLabel = tally.net > 0 ? `+${tally.net}` : `${tally.net}`;
            const isChecked = checked.has(activity.id);

            return (
              <li key={activity.id}>
                <label className="flex cursor-pointer items-center gap-md rounded-lg px-sm py-xs transition-colors hover:bg-surface-variant">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(activity.id)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="line-clamp-1 min-w-0 flex-1 font-body-md text-sm text-on-surface">
                    {name}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-sm py-xs font-body-md text-xs ${
                      tally.net > 0
                        ? 'bg-tertiary-container text-on-tertiary-container'
                        : tally.net < 0
                          ? 'bg-error-container text-error'
                          : 'bg-surface-variant text-on-surface-variant'
                    }`}
                  >
                    {`net ${netLabel} · ${tally.up} up / ${tally.down} down`}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {/* Footer */}
        <div className="flex justify-end gap-sm pt-xs">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-outline-variant/40 px-md py-sm font-body-md text-on-surface-variant transition-colors hover:bg-surface-variant"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-full bg-primary px-md py-sm font-body-md text-on-primary transition-opacity hover:opacity-90"
          >
            Move to planning
          </button>
        </div>
      </div>
    </div>
  );
}
