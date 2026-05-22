import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthState } from '../lib/authShim';
import { useOwner } from '../lib/useOwner';
import { createTrip, type CreateTripInput } from '../lib/userTrips';

type LocationState = {
  initial_activity_ids?: string[];
} | null;

export function NewTrip() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isOwner, isLoaded } = useOwner();
  const { getToken } = useAuthState();
  const initialActivityIds =
    (location.state as LocationState)?.initial_activity_ids ?? [];

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        <h1 className="font-display text-headline-lg text-primary">New trip</h1>
        <p className="font-body-lg text-on-surface-variant">
          Sign in with an owner account to create trips.
        </p>
        <Link to="/trips" className="text-primary underline">
          Back to trips
        </Link>
      </section>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Start and end date are required.');
      return;
    }
    if (endDate < startDate) {
      setError('End date must be on or after start date.');
      return;
    }

    setSubmitting(true);
    try {
      const body: CreateTripInput = {
        title: title.trim(),
        start_date: startDate,
        end_date: endDate,
      };
      const trimmedDescription = description.trim();
      if (trimmedDescription) body.description = trimmedDescription;
      const trimmedCover = coverImageUrl.trim();
      if (trimmedCover) body.cover_image_url = trimmedCover;
      if (initialActivityIds.length > 0) {
        body.initial_activity_ids = initialActivityIds;
      }
      const token = await getToken();
      const trip = await createTrip(body, token);
      void navigate(`/trips/${trip.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create trip.');
      setSubmitting(false);
    }
  }

  return (
    <section className="px-margin py-xl max-w-2xl mx-auto space-y-lg">
      <div className="space-y-xs">
        <Link to="/trips" className="text-body-sm text-on-surface-variant underline">
          ← Trips
        </Link>
        <h1 className="font-display text-headline-lg md:text-display text-primary">
          New trip
        </h1>
        {initialActivityIds.length > 0 && (
          <p className="font-body-md text-on-surface-variant">
            {initialActivityIds.length} activit
            {initialActivityIds.length === 1 ? 'y' : 'ies'} will be added to the
            Unscheduled list once the trip is created.
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="space-y-md"
      >
        <Field label="Title" htmlFor="trip-title" required>
          <input
            id="trip-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm font-body-md focus:outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
            placeholder="Weekend on the coast"
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          <Field label="Start date" htmlFor="trip-start" required>
            <input
              id="trip-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm font-body-md focus:outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
            />
          </Field>
          <Field label="End date" htmlFor="trip-end" required>
            <input
              id="trip-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              min={startDate || undefined}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm font-body-md focus:outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
            />
          </Field>
        </div>

        <Field label="Description" htmlFor="trip-description">
          <textarea
            id="trip-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm font-body-md focus:outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
            placeholder="Optional"
          />
        </Field>

        <Field label="Cover image URL" htmlFor="trip-cover">
          <input
            id="trip-cover"
            type="url"
            value={coverImageUrl}
            onChange={(e) => setCoverImageUrl(e.target.value)}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm font-body-md focus:outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
            placeholder="https://…"
          />
        </Field>

        {error && (
          <div className="bg-error-container text-on-error-container px-md py-sm rounded-lg font-body-md">
            {error}
          </div>
        )}

        <div className="flex items-center gap-md">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating…' : 'Create trip'}
          </button>
          <Link
            to="/trips"
            className="font-body-md text-on-surface-variant hover:text-on-surface"
          >
            Cancel
          </Link>
        </div>
      </form>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block space-y-xs">
      <span className="font-body-md text-on-surface-variant">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
    </label>
  );
}
