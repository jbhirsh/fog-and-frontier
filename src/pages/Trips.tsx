import { Link } from 'react-router-dom';
import { useOwner } from '../lib/useOwner';
import {
  useTripsList,
  type TripListItem,
} from '../lib/userTrips';

export function Trips() {
  const { isOwner, isLoaded } = useOwner();
  const { trips, isLoading, error } = useTripsList();

  if (!isLoaded) {
    return (
      <section className="px-margin py-xl text-center text-on-surface-variant">
        Loading…
      </section>
    );
  }

  if (!isOwner) {
    return (
      <section className="px-margin py-xl max-w-2xl mx-auto text-center space-y-md">
        <h1 className="font-display text-headline-lg text-primary">Trips</h1>
        <p className="font-body-lg text-on-surface-variant">
          Trips are owner-only for now. Sign in with the owner account to plan an outing.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="px-margin py-lg md:py-xl bg-surface-container-low border-b border-outline-variant/20">
        <div className="max-w-screen-2xl mx-auto flex items-baseline justify-between flex-wrap gap-md">
          <div>
            <h1 className="font-display text-headline-lg md:text-display text-primary">
              Trips
            </h1>
            <p className="font-body-md text-on-surface-variant">
              Plan a multi-day outing — shortlist activities, slot them into a per-day itinerary, see the map.
            </p>
          </div>
          <Link
            to="/trips/new"
            className="inline-flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-body-md">add</span>
            New trip
          </Link>
        </div>
      </section>

      <section className="px-margin py-xl max-w-screen-2xl mx-auto">
        {isLoading ? (
          <div className="text-center text-on-surface-variant">Loading…</div>
        ) : error ? (
          <div className="text-center text-on-surface-variant">
            Couldn&apos;t load trips. Try again in a moment.
          </div>
        ) : trips.length === 0 ? (
          <div className="text-center py-xl space-y-md">
            <p className="font-body-lg text-on-surface-variant">
              No trips yet — plan one.
            </p>
            <Link
              to="/trips/new"
              className="inline-flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined text-body-md">add</span>
              New trip
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function TripCard({ trip }: { trip: TripListItem }) {
  return (
    <Link
      to={`/trips/${trip.id}`}
      className="text-left group bg-surface-container-lowest rounded-xl border border-outline-variant/20 overflow-hidden hover:shadow-lg hover:shadow-primary-container/5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container block"
    >
      <div className="relative aspect-video bg-surface-variant">
        {trip.cover_image_url ? (
          <img
            alt=""
            src={trip.cover_image_url}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-outline">
            <span className="material-symbols-outlined" style={{ fontSize: 48 }}>
              landscape
            </span>
          </div>
        )}
        <StatusBadge status={trip.status} markedPastAt={trip.marked_past_at} />
      </div>
      <div className="p-md space-y-sm">
        <h3 className="font-headline-md text-headline-md text-on-surface group-hover:text-primary-container transition-colors">
          {trip.title}
        </h3>
        <p className="font-body-md text-body-md text-on-surface-variant">
          {formatDateRange(trip.start_date, trip.end_date)}
        </p>
        <div className="flex items-center gap-md text-outline pt-sm border-t border-outline-variant/20 mt-sm flex-wrap text-sm">
          <div className="flex items-center gap-xs">
            <span className="material-symbols-outlined text-body-md">event</span>
            {trip.scheduled_count} scheduled
          </div>
          <div className="flex items-center gap-xs">
            <span className="material-symbols-outlined text-body-md">inbox</span>
            {trip.unscheduled_count} unscheduled
          </div>
        </div>
      </div>
    </Link>
  );
}

function StatusBadge({
  status,
  markedPastAt,
}: {
  status: 'planning' | 'past';
  markedPastAt: number | null;
}) {
  if (status === 'past') {
    const date = markedPastAt
      ? new Date(markedPastAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })
      : null;
    return (
      <div className="absolute top-sm right-sm bg-surface-container-lowest/90 backdrop-blur-sm text-on-surface-variant px-sm py-xs rounded-full font-label-caps text-label-caps">
        Past{date ? ` · ${date}` : ''}
      </div>
    );
  }
  return (
    <div className="absolute top-sm right-sm bg-primary-fixed text-primary px-sm py-xs rounded-full font-label-caps text-label-caps">
      Planning
    </div>
  );
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${start} – ${end}`;
  }
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const startFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  const endFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${startFmt.format(startDate)} – ${endFmt.format(endDate)}`;
}
