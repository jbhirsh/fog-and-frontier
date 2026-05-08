import { useState } from 'react';
import { HOME_LOCATION } from '../data/home';

type Range = 'today' | 'tomorrow' | 'weekend' | 'week';

type DiscoverEvent = {
  name: string;
  dateText: string;
  location: string;
  blurb: string;
  sourceUrl: string;
};

type DiscoverSource = { uri: string; title: string };

const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'Next 7 days' },
];

export function Explore() {
  const [range, setRange] = useState<Range>('weekend');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<DiscoverEvent[] | null>(null);
  const [sources, setSources] = useState<DiscoverSource[]>([]);
  const [lastFetched, setLastFetched] = useState<{ range: Range; at: number } | null>(null);

  async function discover() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ range }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        events: DiscoverEvent[];
        sources: DiscoverSource[];
      };
      setEvents(Array.isArray(data.events) ? data.events : []);
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setLastFetched({ range, at: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="px-margin py-xl lg:py-24 bg-surface-container-low border-b border-outline-variant/20">
        <div className="max-w-4xl mx-auto text-center space-y-md">
          <h1 className="font-display text-display text-primary">Explore</h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
            What's happening around {HOME_LOCATION.label} right now? Pick a
            window and let Gemini search for things to do.
          </p>
          <div className="flex flex-wrap justify-center gap-sm pt-sm">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={`px-md py-xs rounded-full font-body-md transition-colors border ${
                  range === r.value
                    ? 'bg-primary text-on-primary border-primary'
                    : 'bg-surface-container-lowest text-on-surface border-outline-variant hover:bg-surface-variant'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="pt-md">
            <button
              type="button"
              onClick={discover}
              disabled={loading}
              className="inline-flex items-center gap-xs bg-primary text-on-primary px-lg py-sm rounded-full font-body-lg shadow-md hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              <span className="material-symbols-outlined">auto_awesome</span>
              {loading ? 'Searching…' : events ? 'Refresh' : 'Discover events'}
            </button>
          </div>
          {lastFetched && !loading && (
            <p className="font-body-sm text-on-surface-variant pt-xs">
              Last refreshed {timeAgo(lastFetched.at)} for{' '}
              {RANGES.find((r) => r.value === lastFetched.range)?.label}
            </p>
          )}
        </div>
      </section>

      <section className="px-margin py-xl max-w-screen-2xl mx-auto">
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} onRetry={discover} />}
        {!loading && !error && !events && <EmptyHero />}
        {!loading && !error && events && events.length === 0 && (
          <div className="text-center py-xl text-on-surface-variant">
            Nothing surfaced for that window. Try a different range.
          </div>
        )}
        {!loading && !error && events && events.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
              {events.map((e, i) => (
                <EventCard key={`${e.name}-${i}`} event={e} />
              ))}
            </div>
            {sources.length > 0 && (
              <div className="mt-xl pt-md border-t border-outline-variant/30">
                <p className="font-body-sm text-on-surface-variant mb-xs">
                  Sources Gemini searched
                </p>
                <ul className="flex flex-wrap gap-xs">
                  {sources.slice(0, 12).map((s) => (
                    <li key={s.uri}>
                      <a
                        href={s.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="text-body-sm text-primary underline hover:opacity-80"
                      >
                        {s.title || s.uri}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-md font-body-sm text-on-surface-variant text-center">
              AI-generated suggestions — verify dates and details with the
              source before you go.
            </p>
          </>
        )}
      </section>
    </>
  );
}

function EventCard({ event }: { event: DiscoverEvent }) {
  return (
    <a
      href={event.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="block rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-md hover:shadow-md transition-shadow"
    >
      <div className="font-body-sm text-secondary uppercase tracking-wide font-bold">
        {event.dateText}
      </div>
      <h3 className="font-display text-headline-md text-primary mt-xs">
        {event.name}
      </h3>
      <div className="font-body-md text-on-surface-variant mt-xs flex items-center gap-xs">
        <span className="material-symbols-outlined text-body-md">
          location_on
        </span>
        {event.location}
      </div>
      <p className="font-body-md text-on-surface mt-sm">{event.blurb}</p>
      <div className="mt-md font-body-sm text-primary flex items-center gap-xs">
        View source
        <span className="material-symbols-outlined text-body-md">
          open_in_new
        </span>
      </div>
    </a>
  );
}

function LoadingState() {
  return (
    <div className="text-center py-xl space-y-md">
      <div className="w-12 h-12 mx-auto rounded-full border-4 border-primary border-t-transparent animate-spin" />
      <p className="font-body-lg text-on-surface">
        Searching the web for upcoming events…
      </p>
      <p className="font-body-md text-on-surface-variant max-w-md mx-auto">
        This can take 10–20 seconds while Gemini cross-references multiple
        sources.
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="text-center py-xl space-y-md">
      <p className="font-body-lg text-error">Something went wrong.</p>
      <p className="font-body-md text-on-surface-variant max-w-xl mx-auto">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md"
      >
        Try again
      </button>
    </div>
  );
}

function EmptyHero() {
  return (
    <div className="text-center py-xl space-y-sm text-on-surface-variant max-w-xl mx-auto">
      <span className="material-symbols-outlined text-display text-outline">
        explore
      </span>
      <p className="font-body-lg">
        Pick a window above and tap <strong>Discover events</strong> to see
        what's happening.
      </p>
      <p className="font-body-sm">
        Each search costs an API call, so results stick around until you
        refresh.
      </p>
    </div>
  );
}

function timeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
