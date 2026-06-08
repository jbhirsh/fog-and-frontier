import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthState } from '../lib/authShim';
import {
  addActivityToTrip,
  useTripsList,
  type TripListItem,
} from '../lib/userTrips';

type Props = {
  activityIds: string[];
  onClose: () => void;
  // Called after a successful add to an existing trip so the caller can
  // clear its selection and surface a confirmation.
  onAdded?: (trip: TripListItem, added: number, skipped: number) => void;
};

export function AddToTripDialog({ activityIds, onClose, onAdded }: Props) {
  const navigate = useNavigate();
  const { getToken } = useAuthState();
  const { trips, isLoading } = useTripsList();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Any non-past trip can take candidates — both voting and planning trips
  // (#51 c12). The list is already member-scoped server-side.
  const activeTrips = trips.filter((t) => t.status !== 'past');

  function handleCreateNew() {
    onClose();
    void navigate('/trips/new', {
      state: { initial_activity_ids: activityIds },
    });
  }

  async function handleAddToExisting(trip: TripListItem) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      let added = 0;
      let skipped = 0;
      for (const activityId of activityIds) {
        const { alreadyOnTrip, tripPast } = await addActivityToTrip(
          trip.id,
          activityId,
          token,
        );
        if (tripPast) {
          setError(
            `"${trip.title}" was just marked past — refresh and pick a different trip.`,
          );
          return;
        }
        if (alreadyOnTrip) skipped++;
        else added++;
      }
      onAdded?.(trip, added, skipped);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-margin">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to trip"
        className="relative w-full max-w-2xl bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-xl p-lg space-y-md max-h-[80vh] overflow-y-auto"
      >
        <h2 className="font-headline-md text-headline-md text-on-surface">
          Add {activityIds.length} activit{activityIds.length === 1 ? 'y' : 'ies'} to a trip
        </h2>

        <button
          type="button"
          onClick={handleCreateNew}
          disabled={busy}
          className="w-full text-left bg-primary-fixed text-primary px-md py-md rounded-lg hover:bg-primary-container/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <span className="font-headline-md text-body-lg block">
            New trip from selection
          </span>
          <span className="font-body-md text-sm">
            Create a trip and pre-load these activities in Unscheduled.
          </span>
        </button>

        <div className="space-y-xs">
          <h3 className="font-headline-md text-body-md text-on-surface">
            Or add to an existing trip
          </h3>
          {isLoading ? (
            <p className="font-body-md text-sm text-on-surface-variant">
              Loading trips…
            </p>
          ) : activeTrips.length === 0 ? (
            <p className="font-body-md text-sm text-on-surface-variant">
              No active trips yet.
            </p>
          ) : (
            <ul className="space-y-xs">
              {activeTrips.map((trip) => (
                <li key={trip.id}>
                  <button
                    type="button"
                    onClick={() => void handleAddToExisting(trip)}
                    disabled={busy}
                    className="w-full text-left bg-surface-container-low border border-outline-variant/30 px-md py-sm rounded-lg hover:bg-surface-variant transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span className="block font-body-md text-on-surface">
                      {trip.title}
                    </span>
                    <span className="block font-body-md text-sm text-on-surface-variant">
                      {trip.start_date} – {trip.end_date}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="bg-error-container text-on-error-container px-md py-sm rounded-lg font-body-md">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="font-body-md text-on-surface-variant"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
