import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthState } from '../lib/authShim';
import { addActivityToTrip, useTripsList } from '../lib/userTrips';

type Props = {
  activityId: string;
  onAdded?: (message: string) => void;
};

export function AddToTripDropdown({ activityId, onAdded }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to trip"
        title="Add to trip"
        className="inline-flex items-center gap-xs px-sm py-xs bg-surface-container-lowest/95 backdrop-blur-sm border border-outline-variant/40 rounded-full text-on-surface-variant hover:bg-surface-variant font-body-md text-sm shadow-sm"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          {open ? 'close' : 'add_circle'}
        </span>
        Trip
      </button>
      {open && (
        <DropdownMenu
          activityId={activityId}
          onClose={() => setOpen(false)}
          onAdded={onAdded}
        />
      )}
    </div>
  );
}

// Mounted only when the menu opens so we don't fire N trip-list fetches
// per page render.
function DropdownMenu({
  activityId,
  onClose,
  onAdded,
}: {
  activityId: string;
  onClose: () => void;
  onAdded?: (message: string) => void;
}) {
  const navigate = useNavigate();
  const { getToken } = useAuthState();
  const { trips, isLoading, error } = useTripsList();
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const planningTrips = trips.filter((t) => t.status === 'planning');

  function handleNewTrip(e: React.MouseEvent) {
    e.stopPropagation();
    onClose();
    void navigate('/trips/new', {
      state: { initial_activity_ids: [activityId] },
    });
  }

  async function handleAddTo(
    tripId: string,
    tripTitle: string,
    e: React.MouseEvent,
  ) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const token = await getToken();
      const { alreadyOnTrip, tripPast } = await addActivityToTrip(
        tripId,
        activityId,
        token,
      );
      if (tripPast) {
        setErrMsg(`"${tripTitle}" was just marked past — refresh to retry.`);
        return;
      }
      onAdded?.(
        alreadyOnTrip
          ? `Already on "${tripTitle}"`
          : `Added to "${tripTitle}"`,
      );
      onClose();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to add.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute right-0 mt-xs w-72 max-h-80 overflow-y-auto bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-xl z-50">
      <button
        type="button"
        onClick={handleNewTrip}
        className="w-full text-left px-md py-sm hover:bg-surface-variant border-b border-outline-variant/20"
      >
        <span className="block font-body-md text-on-surface">
          New trip from this
        </span>
        <span className="block font-body-md text-sm text-on-surface-variant">
          Create a trip pre-loaded with this activity.
        </span>
      </button>
      {isLoading ? (
        <div className="px-md py-sm font-body-md text-sm text-on-surface-variant">
          Loading trips…
        </div>
      ) : error ? (
        <div className="px-md py-sm font-body-md text-sm text-on-surface-variant">
          Couldn&apos;t load trips.
        </div>
      ) : planningTrips.length === 0 ? (
        <div className="px-md py-sm font-body-md text-sm text-on-surface-variant">
          No planning trips yet.
        </div>
      ) : (
        planningTrips.map((trip) => (
          <button
            key={trip.id}
            type="button"
            disabled={busy}
            onClick={(e) => void handleAddTo(trip.id, trip.title, e)}
            className="w-full text-left px-md py-sm hover:bg-surface-variant font-body-md disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="block text-on-surface">{trip.title}</span>
            <span className="block text-sm text-on-surface-variant">
              {trip.start_date} – {trip.end_date}
            </span>
          </button>
        ))
      )}
      {errMsg && (
        <div className="px-md py-sm font-body-md text-sm text-error border-t border-outline-variant/20">
          {errMsg}
        </div>
      )}
    </div>
  );
}
