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

export function PromoteToPlanningModal({
  candidates,
  onCancel,
  onConfirm,
}: Props) {
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
    const keptIds = candidates
      .filter((c) => checked.has(c.activity.id))
      .map((c) => c.activity.id);
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
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />

      {/* Dialog panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-2xl bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-xl p-lg space-y-md"
      >
        <h2 className="font-headline-md text-headline-md text-on-surface">
          {title}
        </h2>

        <p className="font-body-md text-sm text-on-surface-variant">
          Select the activities to carry into the planning phase. Any unchecked
          candidates will be permanently removed from the trip.
        </p>

        {/* Candidate checklist */}
        <ul className="space-y-sm max-h-96 overflow-y-auto">
          {candidates.map(({ activity, tally }) => {
            const name = activity.snapshot?.name ?? '(deleted activity)';
            const netLabel =
              tally.net > 0
                ? `+${tally.net}`
                : tally.net < 0
                  ? `${tally.net}`
                  : '0';
            const isChecked = checked.has(activity.id);

            return (
              <li key={activity.id}>
                <label className="flex items-center gap-md cursor-pointer rounded-lg px-sm py-xs hover:bg-surface-variant transition-colors">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(activity.id)}
                    className="w-4 h-4 accent-primary shrink-0"
                  />
                  <span className="flex-1 min-w-0 font-body-md text-sm text-on-surface line-clamp-1">
                    {name}
                  </span>
                  <span
                    className={`font-body-md text-xs px-sm py-xs rounded-full shrink-0 ${
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
            className="px-md py-sm rounded-full font-body-md border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-md py-sm rounded-full font-body-md bg-primary text-on-primary hover:opacity-90 transition-opacity"
          >
            Move to planning
          </button>
        </div>
      </div>
    </div>
  );
}
