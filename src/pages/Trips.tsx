import { Link } from 'react-router-dom';
import { useOwner } from '../lib/useOwner';
import { useTripsList, type TripListItem, type TripStatus } from '../lib/userTrips';
import { glyphBleed } from '../lib/iconMetrics';
import { formatDateRange } from '../lib/dateRange';

export function Trips() {
  const { isOwner, isLoaded, email } = useOwner();
  const { trips, isLoading, error } = useTripsList();

  if (!isLoaded) {
    return (
      <section className="py-xl px-margin text-center text-on-surface-variant">Loading…</section>
    );
  }

  // Trips are visible to any signed-in member (owner or invited editor); the
  // list is member-scoped server-side. Only creating a trip is owner-only.
  if (!email) {
    return (
      <section className="mx-auto max-w-2xl space-y-md py-xl px-margin text-center">
        <h1 className="font-display text-headline-lg text-primary">Trips</h1>
        <p className="font-body-lg text-on-surface-variant">
          Sign in to see trips you&apos;ve been invited to or that you own.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="border-b border-outline-variant/20 bg-surface-container-low py-md px-margin md:py-xl">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-baseline justify-between gap-md">
          <div>
            <h1 className="font-display text-headline-lg text-primary md:text-display">Trips</h1>
            <p className="font-body-md text-on-surface-variant">
              Plan a multi-day outing — shortlist activities, slot them into a per-day itinerary,
              see the map.
            </p>
          </div>
          {isOwner && (
            <Link
              to="/trips/new"
              className="inline-flex items-center gap-xs rounded-full bg-primary px-md py-sm font-body-md text-on-primary transition-opacity hover:opacity-90"
            >
              <span
                className="material-symbols-outlined text-icon-md"
                style={{ marginLeft: glyphBleed('add') }}
              >
                add
              </span>
              New trip
            </Link>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-screen-2xl py-md px-margin md:py-xl">
        {isLoading ? (
          <div className="text-center text-on-surface-variant">Loading…</div>
        ) : error ? (
          <div className="text-center text-on-surface-variant">
            Couldn&apos;t load trips. Try again in a moment.
          </div>
        ) : trips.length === 0 ? (
          <div className="space-y-md py-lg text-center md:py-xl">
            <p className="font-body-lg text-on-surface-variant">
              {isOwner
                ? 'No trips yet — plan one.'
                : "No trips yet. You'll see trips here once you're invited to one."}
            </p>
            {isOwner && (
              <Link
                to="/trips/new"
                className="inline-flex items-center gap-xs rounded-full bg-primary px-md py-sm font-body-md text-on-primary transition-opacity hover:opacity-90"
              >
                <span
                  className="material-symbols-outlined text-icon-md"
                  style={{ marginLeft: glyphBleed('add') }}
                >
                  add
                </span>
                New trip
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
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
      className="group block overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-lowest text-left transition-all duration-300 hover:shadow-lg hover:shadow-primary-container/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
    >
      <div className="relative aspect-video bg-surface-variant">
        {trip.cover_image_url ? (
          <img
            alt=""
            src={trip.cover_image_url}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-outline">
            <span className="material-symbols-outlined" style={{ fontSize: 48 }}>
              landscape
            </span>
          </div>
        )}
        <StatusBadge status={trip.status} markedPastAt={trip.marked_past_at} />
      </div>
      <div className="space-y-sm p-md">
        <h3 className="font-headline-md text-headline-md text-on-surface transition-colors group-hover:text-primary-container">
          {trip.title}
        </h3>
        <p className="font-body-md text-body-md text-on-surface-variant">
          {formatDateRange(trip.start_date, trip.end_date)}
        </p>
        <div className="mt-sm flex flex-wrap items-center gap-md border-t border-outline-variant/20 pt-sm text-sm text-outline">
          <div className="flex items-center gap-xs">
            <span className="material-symbols-outlined text-icon-sm">event</span>
            {trip.scheduled_count} scheduled
          </div>
          <div className="flex items-center gap-xs">
            <span className="material-symbols-outlined text-icon-sm">inbox</span>
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
  status: TripStatus;
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
      <div className="absolute top-sm right-sm rounded-full bg-surface-container-lowest/90 px-sm py-xs font-label-caps text-label-caps text-on-surface-variant backdrop-blur-sm">
        Past{date ? ` · ${date}` : ''}
      </div>
    );
  }
  if (status === 'voting') {
    return (
      <div className="absolute top-sm right-sm rounded-full bg-tertiary-container px-sm py-xs font-label-caps text-label-caps text-on-tertiary-container">
        Voting
      </div>
    );
  }
  return (
    <div className="absolute top-sm right-sm rounded-full bg-primary-fixed px-sm py-xs font-label-caps text-label-caps text-primary">
      Planning
    </div>
  );
}
