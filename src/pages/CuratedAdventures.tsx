import { useMemo, useState } from 'react';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import { ActivityCard } from '../components/ActivityCard';
import { ActivityDetail } from '../components/ActivityDetail';
import { AddActivity } from '../components/AddActivity';
import type { Activity, Category, Duration } from '../data/types';
import { useAllActivities } from '../lib/userActivities';
import { useOwner } from '../lib/useOwner';

const DISTANCE_OPTIONS = [
  { label: 'Any distance', value: Infinity },
  { label: 'Within 25 mi', value: 25 },
  { label: 'Within 50 mi', value: 50 },
  { label: 'Within 100 mi', value: 100 },
  { label: 'Within 250 mi', value: 250 },
];

const DURATION_OPTIONS: ('Any' | Duration)[] = [
  'Any',
  '1-2 Hours',
  '2-3 Hours',
  'Half Day',
  'Full Day',
  'Weekend',
  'Multi-Day',
];

const CATEGORY_OPTIONS: ('Any' | Category)[] = [
  'Any',
  'hiking',
  'cycling',
  'water',
  'food',
  'culture',
  'scenic',
  'climbing',
  'camping',
  'other',
];

export function CuratedAdventures() {
  const [search, setSearch] = useState('');
  const [maxDistance, setMaxDistance] = useState<number>(Infinity);
  const [duration, setDuration] = useState<'Any' | Duration>('Any');
  const [category, setCategory] = useState<'Any' | Category>('Any');
  const [dogOnly, setDogOnly] = useState(false);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [adding, setAdding] = useState(false);
  const all = useAllActivities();
  const { isOwner } = useOwner();

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .map((a) => ({
        a,
        miles: distanceMiles(HOME_LOCATION.coords, a.location.coords),
      }))
      .filter(({ a, miles }) => {
        if (miles > maxDistance) return false;
        if (duration !== 'Any' && a.duration !== duration) return false;
        if (category !== 'Any' && a.category !== category) return false;
        if (dogOnly && !a.dogFriendly) return false;
        if (q) {
          const hay = `${a.name} ${a.shortDescription} ${a.location.city} ${a.category}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((x, y) => x.miles - y.miles)
      .map(({ a }) => a);
  }, [search, maxDistance, duration, category, dogOnly, all]);

  return (
    <>
      <section className="relative px-margin py-xl lg:py-24 bg-surface-container-low border-b border-outline-variant/20">
        <div className="max-w-4xl mx-auto text-center space-y-lg">
          <h1 className="font-display text-display text-primary">
            Curated Adventures
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
            A hand-picked list of trips from {HOME_LOCATION.label} — misty
            redwoods, hidden coves, and everything in between.
          </p>
          <div className="relative max-w-3xl mx-auto">
            <div className="flex items-center bg-surface-container-lowest rounded-full border border-outline-variant focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/20 transition-all shadow-sm pl-gutter pr-sm py-sm">
              <span className="material-symbols-outlined text-outline">
                search
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-grow bg-transparent border-none focus:outline-none text-body-lg px-sm"
                placeholder="Find your next adventure..."
                type="text"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Sticky only on md+; on mobile the header wraps to two rows so a
          second sticky bar would eat too much vertical space. */}
      <section className="border-b border-outline-variant/20 bg-surface px-margin py-md md:sticky md:top-20 z-40 backdrop-blur-xl">
        <div className="max-w-screen-2xl mx-auto flex flex-wrap items-center gap-md">
          <FilterPill icon="location_on">
            <select
              value={String(maxDistance)}
              onChange={(e) => setMaxDistance(Number(e.target.value))}
              className="bg-transparent focus:outline-none cursor-pointer"
            >
              {DISTANCE_OPTIONS.map((o) => (
                <option key={o.label} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </FilterPill>
          <FilterPill icon="schedule">
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value as 'Any' | Duration)}
              className="bg-transparent focus:outline-none cursor-pointer"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d === 'Any' ? 'Any duration' : d}
                </option>
              ))}
            </select>
          </FilterPill>
          <FilterPill icon="category">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as 'Any' | Category)}
              className="bg-transparent focus:outline-none cursor-pointer capitalize"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c === 'Any' ? 'Any category' : c}
                </option>
              ))}
            </select>
          </FilterPill>
          <div className="flex items-center gap-md w-full md:w-auto md:ml-auto justify-between md:justify-start">
            <div className="flex items-center gap-sm">
              <span className="font-body-md text-on-surface-variant">
                Dog Friendly
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={dogOnly}
                onClick={() => setDogOnly((v) => !v)}
                className={`w-12 h-7 rounded-full relative transition-colors ${
                  dogOnly ? 'bg-secondary' : 'bg-surface-variant'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full absolute top-1.5 transition-transform ${
                    dogOnly
                      ? 'bg-on-secondary translate-x-7'
                      : 'bg-outline translate-x-1'
                  }`}
                />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAdding(true)}
              disabled={!isOwner}
              title={isOwner ? undefined : 'Sign in to edit'}
              className="flex items-center gap-xs bg-primary text-on-primary px-md py-xs rounded-full font-body-md hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-body-md">add</span>
              Add activity
            </button>
          </div>
        </div>
      </section>

      <section className="px-margin py-xl max-w-screen-2xl mx-auto">
        {results.length === 0 ? (
          <div className="text-center py-xl text-on-surface-variant">
            No activities match those filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {results.map((a) => (
              <ActivityCard
                key={a.id}
                activity={a}
                onClick={() => setSelected(a)}
              />
            ))}
          </div>
        )}
      </section>

      {selected && (
        <ActivityDetail
          activity={selected}
          onClose={() => setSelected(null)}
          showUploads={!!selected.completed}
        />
      )}

      {adding && <AddActivity onClose={() => setAdding(false)} />}
    </>
  );
}

function FilterPill({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-xs text-on-surface-variant bg-surface-container-low px-sm py-xs rounded-full border border-outline-variant/30 cursor-pointer hover:bg-surface-variant transition-colors">
      <span className="material-symbols-outlined text-body-md">{icon}</span>
      {children}
    </label>
  );
}
