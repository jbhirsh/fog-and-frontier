import { useEffect, useState } from 'react';
import { HOME_LOCATION } from '../data/home';
import { useOwner } from '../lib/useOwner';
import { apolloClient } from '../lib/apolloClient';
import { DISCOVER_QUERY } from '../lib/gqlDocs';

type Range = 'today' | 'tomorrow' | 'weekend' | 'week';

type DiscoverEvent = {
  name: string;
  dateText: string;
  startDate?: string;
  endDate?: string;
  location: string;
  blurb: string;
  sourceUrl: string;
};

type DiscoverSource = { uri: string; title: string };

type CacheShape = {
  range: Range;
  at: number;
  events: DiscoverEvent[];
  sources: DiscoverSource[];
};

const CACHE_KEY = 'fogandfrontier.discover.v1';

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isFutureOrToday(e: DiscoverEvent, today: string): boolean {
  const end = e.endDate || e.startDate;
  if (!end) return true;
  return end >= today;
}

const RANGE_VALUES: readonly string[] = ['today', 'tomorrow', 'weekend', 'week'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === 'string';
}

function isDiscoverEvent(v: unknown): v is DiscoverEvent {
  return (
    isRecord(v) &&
    typeof v.name === 'string' &&
    typeof v.dateText === 'string' &&
    isOptionalString(v.startDate) &&
    isOptionalString(v.endDate) &&
    typeof v.location === 'string' &&
    typeof v.blurb === 'string' &&
    typeof v.sourceUrl === 'string'
  );
}

function isDiscoverSource(v: unknown): v is DiscoverSource {
  return isRecord(v) && typeof v.uri === 'string' && typeof v.title === 'string';
}

// The cache is whatever this browser kept, possibly from an older build, and
// it's read during the first render, where a wrong shape would throw into the
// root error boundary on every reload. Check it here; a cache that doesn't fit
// reads as none.
function isCacheShape(v: unknown): v is CacheShape {
  return (
    isRecord(v) &&
    typeof v.range === 'string' &&
    RANGE_VALUES.includes(v.range) &&
    typeof v.at === 'number' &&
    Number.isFinite(v.at) &&
    Array.isArray(v.events) &&
    v.events.every(isDiscoverEvent) &&
    Array.isArray(v.sources) &&
    v.sources.every(isDiscoverSource)
  );
}

function readCache(): CacheShape | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isCacheShape(parsed)) return parsed;
  } catch {
    /* unreadable or not JSON: drop it below */
  }
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* storage unavailable */
  }
  return null;
}

function writeCache(c: CacheShape) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* quota */
  }
}

const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'Next 7 days' },
];

type HydratedCache = {
  range: Range;
  events: DiscoverEvent[];
  sources: DiscoverSource[];
  lastFetched: { range: Range; at: number };
};

function hydrateFromCache(): HydratedCache | null {
  const cached = readCache();
  if (!cached) return null;
  const today = todayISO();
  const fresh = cached.events.filter((e) => isFutureOrToday(e, today));
  if (fresh.length === 0) return null;
  return {
    range: cached.range,
    events: fresh,
    sources: cached.sources,
    lastFetched: { range: cached.range, at: cached.at },
  };
}

export function Explore() {
  const { isOwner } = useOwner();
  const [initial] = useState(hydrateFromCache);
  const [range, setRange] = useState<Range>(initial?.range ?? 'weekend');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<DiscoverEvent[] | null>(initial?.events ?? null);
  const [sources, setSources] = useState<DiscoverSource[]>(initial?.sources ?? []);
  const [lastFetched, setLastFetched] = useState<{ range: Range; at: number } | null>(
    initial?.lastFetched ?? null,
  );

  // One-time cache GC on mount: prune past-dated entries from localStorage so
  // hydrateFromCache (above) and future reads don't have to re-filter them.
  useEffect(() => {
    const cached = readCache();
    if (!cached) return;
    const today = todayISO();
    const fresh = cached.events.filter((e) => isFutureOrToday(e, today));
    if (fresh.length === 0) {
      localStorage.removeItem(CACHE_KEY);
      return;
    }
    if (fresh.length !== cached.events.length) {
      writeCache({ ...cached, events: fresh });
    }
  }, []);

  async function discover() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apolloClient.query({
        query: DISCOVER_QUERY,
        variables: { range },
        fetchPolicy: 'network-only',
      });
      const result = data?.discover;
      // Live-model fields are all nullable; coalesce into the card's shape.
      const evs: DiscoverEvent[] = (result?.events ?? []).map((e) => ({
        name: e.name ?? '',
        dateText: e.dateText ?? '',
        startDate: e.startDate ?? undefined,
        endDate: e.endDate ?? undefined,
        location: e.location ?? '',
        blurb: e.blurb ?? '',
        sourceUrl: e.sourceUrl ?? '',
      }));
      const srcs: DiscoverSource[] = (result?.sources ?? []).map((s) => ({
        uri: s.uri ?? '',
        title: s.title ?? '',
      }));
      const at = Date.now();
      setEvents(evs);
      setSources(srcs);
      setLastFetched({ range, at });
      writeCache({ range, at, events: evs, sources: srcs });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="border-b border-outline-variant/20 bg-surface-container-low py-md px-margin md:py-xl lg:py-24">
        <div className="mx-auto max-w-4xl space-y-md text-center">
          <h1 className="font-display text-headline-lg text-primary md:text-display">Explore</h1>
          <p className="mx-auto max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
            What's happening around {HOME_LOCATION.label} right now? Pick a window and let Gemini
            search for things to do.
          </p>
          <div className="flex flex-wrap justify-center gap-sm pt-sm">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={`rounded-full border px-md py-sm font-body-md transition-colors ${
                  range === r.value
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-variant'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {isOwner && (
            <div className="pt-md">
              <button
                type="button"
                onClick={() => void discover()}
                disabled={loading}
                className="inline-flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-body-lg text-on-primary shadow-md transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="material-symbols-outlined">auto_awesome</span>
                {loading ? 'Searching…' : events ? 'Refresh' : 'Discover events'}
              </button>
            </div>
          )}
          {lastFetched && !loading && (
            <p className="pt-xs font-body-sm text-on-surface-variant">
              Last refreshed {timeAgo(lastFetched.at)} for{' '}
              {RANGES.find((r) => r.value === lastFetched.range)?.label}
            </p>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-screen-2xl py-md px-margin md:py-xl">
        {loading && <LoadingState />}
        {!loading && error && <ErrorState message={error} onRetry={() => void discover()} />}
        {!loading && !error && !events && <EmptyHero isOwner={isOwner} />}
        {!loading && !error && events && events.length === 0 && (
          <div className="py-lg text-center text-on-surface-variant md:py-xl">
            Nothing surfaced for that window. Try a different range.
          </div>
        )}
        {!loading && !error && events && events.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
              {events.map((e, i) => (
                <EventCard key={`${e.name}-${i}`} event={e} />
              ))}
            </div>
            {sources.length > 0 && (
              <div className="mt-xl border-t border-outline-variant/30 pt-md">
                <p className="mb-xs font-body-sm text-on-surface-variant">
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
            <p className="mt-md text-center font-body-sm text-on-surface-variant">
              AI-generated suggestions — verify dates and details with the source before you go.
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
      className="block rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-md transition-shadow hover:shadow-md"
    >
      <div className="font-body-sm font-bold tracking-wide text-secondary uppercase">
        {event.dateText}
      </div>
      <h3 className="mt-xs font-display text-headline-md text-primary">{event.name}</h3>
      <div className="mt-xs flex items-center gap-xs font-body-md text-on-surface-variant">
        <span className="material-symbols-outlined text-icon-md">location_on</span>
        {event.location}
      </div>
      <p className="mt-sm font-body-md text-on-surface">{event.blurb}</p>
      <div className="mt-md flex items-center gap-xs font-body-sm text-primary">
        View source
        <span className="material-symbols-outlined text-icon-sm">open_in_new</span>
      </div>
    </a>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-2xl space-y-md px-md py-lg text-center md:py-xl">
      <div className="mx-auto size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="font-body-lg text-body-lg text-on-surface">
        Searching the web for upcoming events…
      </p>
      <p className="font-body-md text-body-md text-on-surface-variant">
        This can take 10–20 seconds while Gemini cross-references multiple sources.
      </p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-md px-md py-lg text-center md:py-xl">
      <p className="font-body-lg text-error">Something went wrong.</p>
      <p className="mx-auto max-w-144 font-body-md text-on-surface-variant">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-primary px-md py-sm font-body-md text-on-primary"
      >
        Try again
      </button>
    </div>
  );
}

function EmptyHero({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="mx-auto max-w-2xl space-y-sm px-md py-lg text-center text-on-surface-variant md:py-xl">
      <span
        className="material-symbols-outlined block text-outline"
        style={{ fontSize: 64, lineHeight: 1 }}
      >
        explore
      </span>
      <p className="font-body-lg text-body-lg">
        {isOwner ? (
          <>
            Pick a window above and tap <strong>Discover events</strong> to see what's happening.
          </>
        ) : (
          <>No events have been discovered for this window yet — check back soon.</>
        )}
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
