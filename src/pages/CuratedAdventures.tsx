import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { HOME_LOCATION } from '../data/home';
import { ActivityCard } from '../components/ActivityCard';
import { ActivityDetail } from '../components/ActivityDetail';
import { ActivityMap } from '../components/ActivityMap';
import { AddActivity } from '../components/AddActivity';
import { AddToTripDialog } from '../components/AddToTripDialog';
import { AddToTripDropdown } from '../components/AddToTripDropdown';
import { ViewModeToggle } from '../components/ViewModeToggle';
import type { ViewMode } from '../components/ViewModeToggle';
import { isViewMode } from '../lib/viewMode';
import type { Activity, Category, Duration, ParkType } from '../data/types';
import { useCatalogFilters } from '../lib/useCatalogFilters';
import { filterByBounds, type MapBounds } from '../lib/mapBounds';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useAllActivities } from '../lib/userActivities';
import { useOwner } from '../lib/useOwner';
import { addActivityToTrip } from '../lib/userTrips';

type TargetTrip = { id: string; title: string };

type LocationState = {
  target_trip_id?: string;
  target_trip_title?: string;
} | null;

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

const PARK_TYPE_OPTIONS: ('Any' | ParkType)[] = [
  'Any',
  'national',
  'state',
  'regional',
  'county',
  'city',
  'private',
  'none',
];

const PARK_TYPE_LABELS: Record<'Any' | ParkType, string> = {
  Any: 'Any park type',
  national: 'National park',
  state: 'State park',
  regional: 'Regional park',
  county: 'County park',
  city: 'City park',
  private: 'Private land',
  none: 'Not in a park',
};

export function CuratedAdventures() {
  const location = useLocation();
  const navigate = useNavigate();
  const incomingState = location.state as LocationState;
  const initialTarget: TargetTrip | null =
    incomingState?.target_trip_id && incomingState.target_trip_title
      ? {
          id: incomingState.target_trip_id,
          title: incomingState.target_trip_title,
        }
      : null;

  const { isOwner, email } = useOwner();
  // Adding to a trip is a member power, not an owner-only one (#51): invited
  // editors can shortlist activities too. Gate the trip-selection affordances
  // on being signed in; the server enforces per-trip membership on the actual
  // add. (Catalog "Add activity" stays owner-only below.) A signed-out visitor
  // arriving via location.state falls back to vanilla Curated.
  const isSignedIn = !!email;
  const acceptTarget = isSignedIn && initialTarget !== null;

  const {
    setSearch,
    maxDistance,
    setMaxDistance,
    duration,
    setDuration,
    category,
    setCategory,
    parkType,
    setParkType,
    dogOnly,
    setDogOnly,
    applyFilters,
  } = useCatalogFilters();
  // Layout mode (#4 / #93). Source of truth is the `?view=` param so the choice
  // is shareable and survives reloads; when absent we default to Split on
  // desktop and List on mobile. `isLg` also gates mounting the map column —
  // below `lg` the split collapses to list-only (the mobile map sheet is #96).
  const [searchParams, setSearchParams] = useSearchParams();
  const isLg = useMediaQuery('(min-width: 1024px)');
  const viewParam = searchParams.get('view');
  const requestedView: ViewMode = isViewMode(viewParam)
    ? viewParam
    : isLg
      ? 'split'
      : 'list';
  // Split needs the two-column desktop layout; below `lg` there's no room (the
  // mobile map experience is #96), so a `?view=split` link or a stray toggle
  // falls back to List there instead of showing Split selected over a
  // list-only page.
  const view: ViewMode =
    requestedView === 'split' && !isLg ? 'list' : requestedView;
  function setView(next: ViewMode) {
    // Split is desktop-only; below `lg`, store List so the URL never carries a
    // `?view=split` that would silently activate if the window is widened.
    const target: ViewMode = next === 'split' && !isLg ? 'list' : next;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('view', target);
        return params;
      },
      { replace: true },
    );
  }
  // Whether Split mode should mount its map column. Below `lg` the split
  // collapses to list-only (the mobile map sheet is #96), so we skip mounting
  // Leaflet there entirely. Map mode renders its own map unconditionally.
  const splitMapVisible = view === 'split' && isLg;

  // Split is a desktop-only layout, so the segmented control only offers it at
  // lg+; on smaller screens it's List · Map (the mobile map UX is #96).
  const toggleModes: ViewMode[] = isLg
    ? ['list', 'split', 'map']
    : ['list', 'map'];

  // Free-text search now lives in the global header (#4 mockup) and is shared
  // via the `?q=` param; mirror it into the catalog filter state.
  const query = searchParams.get('q') ?? '';
  useEffect(() => {
    setSearch(query);
  }, [query, setSearch]);

  const [selected, setSelected] = useState<Activity | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectionMode, setSelectionMode] = useState(acceptTarget);
  const [selectedForTrip, setSelectedForTrip] = useState<Set<string>>(
    () => new Set(),
  );
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [tripAddedToast, setTripAddedToast] = useState<string | null>(null);
  const [targetTrip, setTargetTrip] = useState<TargetTrip | null>(
    acceptTarget ? initialTarget : null,
  );
  const [submittingTarget, setSubmittingTarget] = useState(false);
  const all = useAllActivities();

  const MAX_BULK_ADD = 50;
  const overBulkCap = selectedForTrip.size > MAX_BULK_ADD;

  function toggleSelected(id: string) {
    setSelectedForTrip((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectionMode(false);
    setSelectedForTrip(new Set());
    setTargetTrip(null);
  }

  async function handleAddToTarget() {
    if (!targetTrip || submittingTarget) return;
    setSubmittingTarget(true);
    try {
      let added = 0;
      let skipped = 0;
      for (const id of selectedForTrip) {
        const { alreadyOnTrip, tripPast } = await addActivityToTrip(
          targetTrip.id,
          id,
        );
        if (tripPast) {
          // Trip flipped to past between the navigation and now (e.g. a
          // second tab). Drop the target so the action bar reverts to
          // generic mode and the user can pick a different trip.
          setTripAddedToast(
            `"${targetTrip.title}" is now past — pick a different trip.`,
          );
          window.setTimeout(() => setTripAddedToast(null), 3500);
          setTargetTrip(null);
          return;
        }
        if (alreadyOnTrip) skipped++;
        else added++;
      }
      const parts: string[] = [];
      if (added > 0) parts.push(`Added ${added} to "${targetTrip.title}"`);
      if (skipped > 0) parts.push(`${skipped} already on trip`);
      if (parts.length > 0) setTripAddedToast(parts.join(' · '));
      void navigate(`/trips/${targetTrip.id}`);
    } catch (err) {
      setTripAddedToast(
        err instanceof Error ? err.message : 'Failed to add to trip.',
      );
      window.setTimeout(() => setTripAddedToast(null), 3000);
    } finally {
      setSubmittingTarget(false);
    }
  }

  const results = useMemo(() => applyFilters(all), [applyFilters, all]);

  // Bounds filter (#95): when the user pans/zooms an interactive map, narrow the
  // list to the activities inside the current viewport, on top of the catalog
  // filters. `null` = inactive (never moved, or "Clear bounds"). The map keeps
  // plotting every `results` pin; only the list narrows.
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  // Linked card↔pin state (#94), lifted here since both the list and the map are
  // rendered in this component.
  //   - `hoveredId` drives the highlighted pin (a hovered/focused card).
  //   - `pinHoveredId` is the reverse: a hovered pin outlines its list card.
  // Clicking a card opens detail but never moves the map (the user may have
  // framed it deliberately), so there's nothing else to coordinate.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinHoveredId, setPinHoveredId] = useState<string | null>(null);
  const handleBoundsChange = useCallback(
    (next: MapBounds) => setBounds(next),
    [],
  );
  const clearBounds = useCallback(() => setBounds(null), []);
  const visibleResults = useMemo(
    () => (bounds ? filterByBounds(results, bounds) : results),
    [bounds, results],
  );

  // Pin click (#94): open detail and scroll the matching card into view. The
  // card only exists in list/split layouts; in map mode the querySelector simply
  // returns null.
  function handlePinActivate(activity: Activity) {
    setSelected(activity);
    if (typeof document === 'undefined') return;
    const safeId =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(activity.id)
        : activity.id;
    document
      .querySelector(`[data-activity-id="${safeId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Narrower grid in Split (the list shares the row with the map) than in the
  // full-width List layout.
  const gridColsClass =
    view === 'split'
      ? 'grid-cols-1 xl:grid-cols-2'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

  const listContent =
    visibleResults.length === 0 ? (
      <div className="text-center py-xl text-on-surface-variant">
        {bounds && results.length > 0
          ? 'No activities in this area.'
          : 'No activities match those filters.'}
      </div>
    ) : (
      <div className={`grid gap-gutter ${gridColsClass}`}>
        {visibleResults.map((a) => (
          <ActivityCard
            key={a.id}
            activity={a}
            selectionMode={selectionMode}
            selected={selectedForTrip.has(a.id)}
            highlighted={a.id === pinHoveredId}
            onHoverChange={(hovering) => setHoveredId(hovering ? a.id : null)}
            onClick={() => {
              if (selectionMode) {
                toggleSelected(a.id);
              } else {
                setSelected(a);
              }
            }}
            actionSlot={
              selectionMode ? undefined : (
                <AddToTripDropdown
                  activityId={a.id}
                  disabled={!isSignedIn}
                  disabledTooltip="Sign in to add to trips"
                  onAdded={(msg) => {
                    setTripAddedToast(msg);
                    window.setTimeout(() => setTripAddedToast(null), 3000);
                  }}
                />
              )
            }
          />
        ))}
      </div>
    );

  // Compact list-head (replaces the old hero's H1) — shown above the grid in
  // List and Split; Map mode gives the whole viewport to the map.
  const listHeader = (
    <div className="mb-md space-y-sm">
      <div>
        <h1 className="font-display text-headline-md text-primary">
          Curated Adventures
        </h1>
        <p className="mt-xs font-body-sm text-body-sm text-on-surface-variant">
          {results.length} place{results.length === 1 ? '' : 's'} · sorted by
          distance from {HOME_LOCATION.label}
        </p>
      </div>
      {/* Bounds indicator (#95): why the list narrowed, with a way to undo. */}
      {bounds && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-sm rounded-lg border border-secondary/30 bg-secondary/5 px-sm py-xs text-body-sm text-on-surface"
        >
          <span
            className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden text-secondary"
            style={{ fontSize: 18, width: 18, height: 18 }}
            aria-hidden="true"
          >
            my_location
          </span>
          <span>
            Showing <b>{visibleResults.length}</b> in this area
          </span>
          <button
            type="button"
            onClick={clearBounds}
            className="ml-auto inline-flex items-center gap-xs font-semibold text-secondary hover:underline"
          >
            <span
              className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
              style={{ fontSize: 18, width: 18, height: 18 }}
              aria-hidden="true"
            >
              close
            </span>
            Clear bounds
          </button>
        </div>
      )}
    </div>
  );

  // Compact toolbar (filters + view toggle). Sticky in List mode (the long grid
  // scrolls beneath it); in Split it sits above the page-scrolled columns; in
  // Map it's the fixed top row of a viewport-height flex column (below).
  const filterToolbar = (
    <section
      className={`border-b border-outline-variant/20 bg-surface px-gutter py-sm z-40 backdrop-blur-xl ${
        view === 'list' ? 'md:sticky md:top-20' : ''
      }`}
    >
      <div className="max-w-screen-2xl mx-auto flex flex-col gap-sm md:flex-row md:items-center">
        {/* Filter chips on a single line that scrolls horizontally instead of
            wrapping, so the toolbar stays short — especially on mobile, where
            wrapping previously pushed the map far down the page. */}
        <div className="flex items-center gap-sm overflow-x-auto px-0.5 py-1 -my-1 md:min-w-0 md:flex-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterPill icon="location_on">
            <select
              value={String(maxDistance)}
              onChange={(e) => setMaxDistance(Number(e.target.value))}
              className="appearance-none bg-transparent focus:outline-none cursor-pointer text-body-sm"
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
              className="appearance-none bg-transparent focus:outline-none cursor-pointer text-body-sm"
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
              className="appearance-none bg-transparent focus:outline-none cursor-pointer capitalize text-body-sm"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c} className="capitalize">
                  {c === 'Any' ? 'Any category' : c}
                </option>
              ))}
            </select>
          </FilterPill>
          <FilterPill icon="forest">
            <select
              value={parkType}
              onChange={(e) => setParkType(e.target.value as 'Any' | ParkType)}
              className="appearance-none bg-transparent focus:outline-none cursor-pointer text-body-sm"
            >
              {PARK_TYPE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PARK_TYPE_LABELS[p]}
                </option>
              ))}
            </select>
          </FilterPill>
          <button
            type="button"
            role="switch"
            aria-checked={dogOnly}
            aria-label="Dog friendly"
            onClick={() => setDogOnly((v) => !v)}
            className={`inline-flex h-9 shrink-0 items-center gap-xs rounded-full border px-sm text-body-sm font-medium transition-colors ${
              dogOnly
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
            }`}
          >
            <span
              className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
              style={{ fontSize: 18, width: 18, height: 18 }}
              aria-hidden="true"
            >
              pets
            </span>
            Dog friendly
          </button>
        </div>
        {/* View toggle + trip actions: their own row below the filters on
            mobile, right-aligned inline on desktop. */}
        <div className="flex flex-wrap md:flex-nowrap shrink-0 items-center justify-center gap-sm md:ml-auto md:justify-end">
          <ViewModeToggle value={view} onChange={setView} modes={toggleModes} />
          <button
            type="button"
            onClick={() => {
              if (selectionMode) {
                clearSelection();
              } else {
                setSelectionMode(true);
              }
            }}
            disabled={!isSignedIn && !selectionMode}
            title={isSignedIn ? undefined : 'Sign in to plan trips'}
            className="inline-flex h-9 items-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-low px-sm text-body-sm text-on-surface-variant hover:bg-surface-variant transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <span
              className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
              style={{ fontSize: 18, width: 18, height: 18 }}
              aria-hidden="true"
            >
              {selectionMode ? 'close' : 'check_box'}
            </span>
            {selectionMode ? 'Cancel select' : 'Select for trip'}
          </button>
          {isOwner && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-9 items-center gap-xs rounded-full bg-primary px-sm text-body-sm text-on-primary hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              <span
                className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
                style={{ fontSize: 18, width: 18, height: 18 }}
                aria-hidden="true"
              >
                add
              </span>
              Add activity
            </button>
          )}
        </div>
      </div>
    </section>
  );

  return (
    <>
      {view === 'map' ? (
        <div className="flex h-[calc(100dvh-5rem)] flex-col overflow-hidden">
          {filterToolbar}
          {/* Map fills exactly the space below the nav: a flex child in a
              fixed-height, overflow-clipped column, so the page never scrolls
              and the map can't slide under the sticky header. */}
          <section className="min-h-0 flex-1 px-gutter py-md">
            <h1 className="sr-only">Curated Adventures — map</h1>
            <div className="h-full w-full">
              <ActivityMap
                activities={results}
                onSelect={setSelected}
                onActivate={handlePinActivate}
                highlightedId={hoveredId}
                onPinHoverChange={(act) => setPinHoveredId(act?.id ?? null)}
                onBoundsChange={handleBoundsChange}
              />
            </div>
          </section>
        </div>
      ) : view === 'split' ? (
        <>
          {filterToolbar}
          <section className="max-w-screen-2xl mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* List column flows in the normal page scroll (Airbnb-style): the
              page's own scrollbar moves the cards while the map stays pinned —
              no separate inner scrollbar. */}
            <div
              className={`px-gutter py-md ${
                selectionMode && selectedForTrip.size > 0 ? 'pb-32' : ''
              }`}
            >
              {listHeader}
              {listContent}
            </div>
            {/* Map column: sticky at top-20, fills the viewport and stays put as
              the list scrolls past. Mounted only at lg+ (below it the split
              collapses to list-only; the mobile map sheet is #96). */}
            {splitMapVisible && (
              <div className="hidden lg:block lg:sticky lg:top-20 lg:h-[calc(100vh-80px)] p-md">
                <ActivityMap
                  activities={results}
                  onSelect={setSelected}
                  onActivate={handlePinActivate}
                  highlightedId={hoveredId}
                  onPinHoverChange={(act) => setPinHoveredId(act?.id ?? null)}
                  onBoundsChange={handleBoundsChange}
                />
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          {filterToolbar}
          <section
            className={`px-gutter py-md max-w-screen-2xl mx-auto ${
              selectionMode && selectedForTrip.size > 0 ? 'pb-32' : ''
            }`}
          >
            {listHeader}
            {listContent}
          </section>
        </>
      )}

      {selectionMode && (
        <div className="fixed bottom-0 inset-x-0 z-40 px-gutter py-md bg-surface/95 backdrop-blur-xl border-t border-outline-variant/30">
          <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-md flex-wrap">
            <div className="font-body-md text-on-surface">
              {targetTrip ? (
                <>
                  Adding to{' '}
                  <span className="font-bold">
                    &quot;{targetTrip.title}&quot;
                  </span>
                  {' · '}
                  {selectedForTrip.size} selected
                </>
              ) : (
                <>{selectedForTrip.size} selected</>
              )}
              {overBulkCap && (
                <span className="ml-sm text-error font-body-md text-sm">
                  Pick at most {MAX_BULK_ADD} at a time.
                </span>
              )}
            </div>
            <div className="flex items-center gap-md">
              <button
                type="button"
                onClick={clearSelection}
                className="font-body-md text-on-surface-variant"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (targetTrip) {
                    void handleAddToTarget();
                  } else {
                    setTripDialogOpen(true);
                  }
                }}
                disabled={
                  selectedForTrip.size === 0 || submittingTarget || overBulkCap
                }
                title={overBulkCap ? `Pick at most ${MAX_BULK_ADD}` : undefined}
                className="inline-flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submittingTarget
                  ? 'Adding…'
                  : targetTrip
                    ? `Add to "${targetTrip.title}"`
                    : 'Add to trip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {tripAddedToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-surface-container-lowest border border-outline-variant/30 px-md py-sm rounded-lg shadow-lg font-body-md"
        >
          {tripAddedToast}
        </div>
      )}

      {tripDialogOpen && (
        <AddToTripDialog
          activityIds={Array.from(selectedForTrip)}
          onClose={() => setTripDialogOpen(false)}
          onAdded={(trip, added, skipped) => {
            const parts: string[] = [];
            if (added > 0) parts.push(`Added ${added} to "${trip.title}"`);
            if (skipped > 0) parts.push(`${skipped} already on trip`);
            setTripAddedToast(parts.join(' · '));
            window.setTimeout(() => setTripAddedToast(null), 3000);
            clearSelection();
          }}
        />
      )}

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
    <label className="inline-flex h-9 shrink-0 items-center gap-xs rounded-full border border-outline-variant bg-surface-container-lowest px-sm text-body-sm font-medium text-on-surface hover:bg-surface-container-low transition-colors cursor-pointer focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/40">
      {/* Fixed-size icon box: clips the Material Symbols ligature so a missing
          icon font (the visual tests stub it) can't blow out the chip width. */}
      <span
        className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden text-on-surface-variant"
        style={{ fontSize: 18, width: 18, height: 18 }}
        aria-hidden="true"
      >
        {icon}
      </span>
      {children}
      {/* Custom caret — the native select arrow is removed via appearance-none
          so the chip reads cleanly; this keeps the dropdown affordance. */}
      <span
        className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden text-on-surface-variant"
        style={{ fontSize: 18, width: 18, height: 18 }}
        aria-hidden="true"
      >
        expand_more
      </span>
    </label>
  );
}
