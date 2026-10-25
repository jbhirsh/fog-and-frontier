import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, type Location } from 'react-router-dom';
import { useDistanceOrigin } from '../lib/distanceOrigin';
import { useDrivingMiles } from '../lib/drivingMiles';
import { ActivityCard } from '../components/ActivityCard';
import { ActivityMap } from '../components/ActivityMap';
import { AddActivity } from '../components/AddActivity';
import { AddToTripDialog } from '../components/AddToTripDialog';
import { AddToTripDropdown } from '../components/AddToTripDropdown';
import { BottomSheet } from '../components/BottomSheet';
import { ContributorFilter } from '../components/ContributorFilter';
import { FilterPill } from '../components/FilterPill';
import { InlineError } from '../components/InlineError';
import { ParkBar, ParkSection } from '../components/ParkSection';
import { PendingSuggestions } from '../components/PendingSuggestions';
import { ViewModeToggle } from '../components/ViewModeToggle';
import type { ViewMode } from '../components/ViewModeToggle';
import { isViewMode } from '../lib/viewMode';
import type { SheetSnap } from '../lib/bottomSheetSnap';
import type { Activity, Category, Duration, ParkType } from '../data/types';
import {
  CONTRIBUTORS_PARAM,
  contributorOptions,
  parseContributors,
  readCompletedOnly,
  useCatalogFilters,
  withCompletedOnly,
  withContributors,
} from '../lib/useCatalogFilters';
import { filterByBounds, type MapBounds } from '../lib/mapBounds';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useRevealedCount, useWhenVisible } from '../lib/useRevealedCount';
import { useOpenActivity } from '../lib/activityRoute';
import { useUserActivities } from '../lib/userActivities';
import { useOverrides } from '../lib/userCompleted';
import { useOwner } from '../lib/useOwner';
import { usePendingSuggestions } from '../lib/suggestions';
import { addActivityToTrip } from '../lib/userTrips';
import { glyphBleed } from '../lib/iconMetrics';
import { nestUnderParks, parkBarId, type Nested } from '../lib/parks';

/** The park whose hikes and stops are open below its row (#269). */
interface OpenPark {
  id: string;
  held: Activity[];
}
import { rowEnd, useGridColumns } from '../lib/useGridColumns';
import { categoryOptionLabel } from '../lib/activityLabels';

type TargetTrip = { id: string; title: string };

type LocationState = {
  target_trip_id?: string;
  target_trip_title?: string;
} | null;

// "Within N mi of you / of San Jose" (#66): the radius is measured from the
// visitor when they shared their location, else from home.
const DISTANCE_LIMITS = [25, 50, 100, 250];

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

// A list card's root element by activity id (cards carry data-activity-id).
function cardElement(id: string): Element | null {
  const safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  return document.querySelector(`[data-activity-id="${safeId}"]`);
}

export function CuratedAdventures() {
  // Router state is whatever a link put there: unknown until narrowed.
  const location: Location<unknown> = useLocation();
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
  // editors can shortlist activities too. The trip affordances are hidden, not
  // greyed out, from signed-out visitors (#112); the server enforces per-trip
  // membership on the actual add. (Catalog "Add activity" stays owner-only
  // below; other accounts get "Suggest activity", #73.) A signed-out visitor
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
    freeOnly,
    setFreeOnly,
    setCompletedOnly,
    setContributors,
    applyFilters,
  } = useCatalogFilters();
  // Layout mode (#4 / #93). Source of truth is the `?view=` param so the choice
  // is shareable and survives reloads; when absent we default to Split on
  // desktop and List on mobile. `isLg` also gates mounting the map column —
  // below `lg` there's no Split; Map there is a full-screen map with the list
  // in a bottom sheet (#96).
  const [searchParams, setSearchParams] = useSearchParams();
  const isLg = useMediaQuery('(min-width: 1024px)');
  const viewParam = searchParams.get('view');
  const requestedView: ViewMode = isViewMode(viewParam) ? viewParam : isLg ? 'split' : 'list';
  // Split needs the two-column desktop layout; below `lg` there's no room, so
  // a `?view=split` link (or a window narrowed while in Split) falls back to
  // List there instead.
  const view: ViewMode = requestedView === 'split' && !isLg ? 'list' : requestedView;
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
  // collapses to list-only, so we skip mounting Leaflet there entirely. Map
  // mode renders its own map unconditionally.
  const splitMapVisible = view === 'split' && isLg;
  // Mobile Map mode (#96): a full-screen map with the list riding in a
  // draggable bottom sheet, Apple-Maps style. Only below `lg`; at lg+ Split
  // already pairs the list and the map side by side.
  const mobileMap = view === 'map' && !isLg;
  // The sheet starts collapsed so the map is the prominent surface the user
  // just asked for; "Show map" re-collapses it so a previous full-height drag
  // doesn't bury the map next time.
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>('peek');
  function showMobileMap() {
    setSheetSnap('peek');
    setView('map');
  }

  // Free-text search now lives in the global header (#4 mockup) and is shared
  // via the `?q=` param; mirror it into the catalog filter state.
  const query = searchParams.get('q') ?? '';
  useEffect(() => {
    setSearch(query);
  }, [query, setSearch]);

  // "Completed only" (#5) is likewise URL-sourced (`?completed=1`, which the
  // retired /adventures route redirects to); the chip below writes the param
  // and this mirrors it into the shared filter state.
  const completedOnly = readCompletedOnly(searchParams);
  useEffect(() => {
    setCompletedOnly(completedOnly);
  }, [completedOnly, setCompletedOnly]);
  function toggleCompletedOnly() {
    // Read from `prev`, not the render's value, so two quick clicks toggle
    // twice instead of both turning it on.
    setSearchParams((prev) => withCompletedOnly(prev, !readCompletedOnly(prev)), { replace: true });
  }
  // Contributors (#9) are URL-sourced too (`?contributors=`). Only signed-in
  // callers get contributor data, so for anyone else the filter is off rather
  // than matching nothing, and its chip isn't rendered.
  const contributorsRaw = searchParams.get(CONTRIBUTORS_PARAM);
  const selectedContributors = useMemo(
    () => (isSignedIn ? parseContributors(contributorsRaw) : []),
    [isSignedIn, contributorsRaw],
  );
  useEffect(() => {
    setContributors(selectedContributors);
  }, [selectedContributors, setContributors]);
  function changeContributors(next: string[]) {
    setSearchParams((prev) => withContributors(prev, next), { replace: true });
  }
  // Completion overrides, so "Completed only" agrees with the badges.
  const overrides = useOverrides();

  // Opening a card goes to its permalink (#86), drawn over this page.
  const openActivity = useOpenActivity();
  // The owners' review queue (#73); nothing is asked for anyone else.
  const pending = usePendingSuggestions(isOwner);
  // The toolbar's Review button (#259) asks the queue to show itself. Map
  // has no list header to hold the queue, so it first switches to the view
  // that does: Split on a desktop, keeping the map; the list on a phone,
  // dropping the map's area filter as Hide map does.
  const [revealQueue, setRevealQueue] = useState(false);
  const queueRevealed = useCallback(() => setRevealQueue(false), []);
  function showQueue() {
    if (view === 'map') {
      if (!isLg) clearBounds();
      setView(isLg ? 'split' : 'list');
    }
    setRevealQueue(true);
  }
  const [adding, setAdding] = useState(false);
  const [selectionMode, setSelectionMode] = useState(acceptTarget);
  const [selectedForTrip, setSelectedForTrip] = useState<Set<string>>(() => new Set());
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [tripAddedToast, setTripAddedToast] = useState<string | null>(null);
  const [targetTrip, setTargetTrip] = useState<TargetTrip | null>(
    acceptTarget ? initialTarget : null,
  );
  // Selection is a signed-in mode (#112), so restart it whenever sign-in
  // changes. Clerk resolves the session after the first render, so a trip
  // target that arrived with location.state (a reload keeps it) is applied
  // once the user is known; signing out drops any selection, whose
  // "Cancel select" toggle is hidden from signed-out visitors.
  const [prevSignedIn, setPrevSignedIn] = useState(isSignedIn);
  if (prevSignedIn !== isSignedIn) {
    setPrevSignedIn(isSignedIn);
    setSelectionMode(acceptTarget);
    setSelectedForTrip(new Set());
    setTargetTrip(acceptTarget ? initialTarget : null);
  }
  const [submittingTarget, setSubmittingTarget] = useState(false);
  const { activities: all, error: loadError } = useUserActivities();
  const contributorChoices = useMemo(() => contributorOptions(all), [all]);
  const anyFree = useMemo(() => all.some((a) => a.costTier === 'free'), [all]);

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

  // The mobile map's sheet (#96) sits above the selection bar and the trip
  // dialog, and "Show map" steps aside while selecting. A selection can only
  // reach the mobile map by the window narrowing mid-select (Map at lg+, then
  // an iPad turned to portrait), so end it there rather than leave the bar
  // buried with card taps still toggling selection.
  const [prevMobileMap, setPrevMobileMap] = useState(mobileMap);
  if (prevMobileMap !== mobileMap) {
    setPrevMobileMap(mobileMap);
    if (mobileMap) clearSelection();
  }

  async function handleAddToTarget() {
    if (!targetTrip || submittingTarget) return;
    setSubmittingTarget(true);
    try {
      let added = 0;
      let skipped = 0;
      for (const id of selectedForTrip) {
        const { alreadyOnTrip, tripPast } = await addActivityToTrip(targetTrip.id, id);
        if (tripPast) {
          // Trip flipped to past between the navigation and now (e.g. a
          // second tab). Drop the target so the action bar reverts to
          // generic mode and the user can pick a different trip.
          setTripAddedToast(`"${targetTrip.title}" is now past — pick a different trip.`);
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
      setTripAddedToast(err instanceof Error ? err.message : 'Failed to add to trip.');
      window.setTimeout(() => setTripAddedToast(null), 3000);
    } finally {
      setSubmittingTarget(false);
    }
  }

  const origin = useDistanceOrigin();
  const driving = useDrivingMiles();
  const results = useMemo(
    () => applyFilters(all, overrides, origin.coords, driving),
    [applyFilters, all, overrides, origin, driving],
  );

  // Bounds filter (#95): when the user pans/zooms an interactive map, narrow the
  // list to the activities inside the current viewport, on top of the catalog
  // filters. `null` = inactive (never moved, or "Clear bounds"). The map keeps
  // plotting `results` (as parks, #269, below); only the list narrows.
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  // Linked card↔pin state (#94), lifted here since both the list and the map are
  // rendered in this component.
  //   - `hoveredId` drives the highlighted pin (a hovered/focused card).
  //   - `pinHoveredId` is the reverse: a hovered pin outlines its list card.
  // Clicking a card opens detail but never moves the map (the user may have
  // framed it deliberately), so there's nothing else to coordinate.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinHoveredId, setPinHoveredId] = useState<string | null>(null);
  const handleBoundsChange = useCallback((next: MapBounds) => setBounds(next), []);
  // "Clear bounds" also flies the map out to fit every result (#106), so the
  // map and the list agree again; bumping the signal asks the map to re-fit.
  const [fitSignal, setFitSignal] = useState(0);
  const clearBounds = useCallback(() => {
    setBounds(null);
    setFitSignal((n) => n + 1);
  }, []);
  const visibleResults = useMemo(
    () => (bounds ? filterByBounds(results, bounds) : results),
    [bounds, results],
  );
  // A park's hikes and stops (#269) sit under its card, and open below its
  // row. Which park holds what is decided from the filtered catalog, not the
  // map's viewport, so panning can't unfold a park. Not while selecting for a
  // trip: every activity must be pickable.
  const nested = useMemo(
    (): Nested => (selectionMode ? { top: results, subItems: new Map() } : nestUnderParks(results)),
    [results, selectionMode],
  );
  // The viewport (#95) narrows the list: a card stays while it, or one of
  // its park's own, is in view.
  const visibleTop = useMemo(() => {
    if (!bounds) return nested.top;
    const inView = new Set(visibleResults.map((a) => a.id));
    return nested.top.filter(
      (a) => inView.has(a.id) || nested.subItems.get(a.id)?.some((s) => inView.has(s.id)),
    );
  }, [bounds, nested, visibleResults]);
  const topIds = useMemo(() => visibleTop.map((a) => a.id), [visibleTop]);
  // Desktop Map mode shows no list, so there's no card to reveal or scroll to.
  const listShown = !(view === 'map' && isLg);
  // Render the list a page at a time (#102): a screenful to start, more as
  // its end comes into view. Desktop List's three-column grid gets a bigger
  // page; everything else is one or two columns. Prev/next and filtering still
  // see every card.
  const {
    count: revealedCount,
    remaining,
    showMore,
    revealTo,
  } = useRevealedCount(visibleTop.length, view === 'list' && isLg ? 12 : 6);
  const endOfListRef = useWhenVisible<HTMLDivElement>(
    showMore,
    `${revealedCount}/${visibleTop.length}`,
  );
  const [gridRef, columns] = useGridColumns<HTMLDivElement>();
  const [openPark, setOpenPark] = useState<string | null>(null);
  // Open only while its card is on screen with something to hold: a filter,
  // a search, the viewport or Map mode closes it for good, rather than it
  // reopening unasked when they change back.
  const opened = useMemo((): OpenPark | null => {
    const held = nested.subItems.get(openPark ?? '');
    return held && listShown && topIds.slice(0, revealedCount).includes(openPark ?? '')
      ? { id: openPark ?? '', held }
      : null;
  }, [listShown, nested, openPark, revealedCount, topIds]);
  if (openPark !== null && !opened) setOpenPark(null);
  // The map plots the parks rather than everything in them, plus the open
  // park's own pins. Desktop Map mode has no list to open a park from, so
  // there it plots every pin.
  const mapActivities = useMemo(() => {
    if (!listShown) return results;
    return opened ? [...nested.top, ...opened.held] : nested.top;
  }, [listShown, nested, results, opened]);
  // The list as shown, which an activity opened from here steps through
  // (#64): the cards in order, with an open park's own after the last card
  // of its row, where its section sits, `shownCount` cards being rendered.
  // Desktop Map mode has no list: there it's every pin in view.
  const idsShowing = useCallback(
    (park: OpenPark | null, shownCount: number) => {
      if (!park) return topIds;
      const after = rowEnd(topIds.indexOf(park.id), columns, shownCount);
      return [
        ...topIds.slice(0, after + 1),
        ...park.held.map((a) => a.id),
        ...topIds.slice(after + 1),
      ];
    },
    [columns, topIds],
  );
  const visibleIds = useMemo(
    () => (listShown ? idsShowing(opened, revealedCount) : visibleResults.map((a) => a.id)),
    [idsShowing, listShown, revealedCount, opened, visibleResults],
  );
  const openFromList = useCallback(
    (id: string) => openActivity(id, visibleIds),
    [openActivity, visibleIds],
  );
  // Which cards the list holds, for a scroll asked of it to still apply.
  const visibleKey = useMemo(() => topIds.join('|'), [topIds]);

  // A pin's card to scroll to once it's rendered (#94, #102). Each click is a
  // new request for the list as it stood; the ref marks the one served, so a
  // later page load doesn't scroll back to it, and a request for a list
  // that has since changed is dropped.
  const [scrollRequest, setScrollRequest] = useState<{ id: string; list: string } | null>(null);
  const servedScroll = useRef<{ id: string; list: string } | null>(null);
  useEffect(() => {
    if (!scrollRequest || servedScroll.current === scrollRequest) return;
    if (scrollRequest.list !== visibleKey) return;
    const card = cardElement(scrollRequest.id);
    if (!card) return; // Not rendered yet: the reveal re-runs this.
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    servedScroll.current = scrollRequest;
  }, [scrollRequest, revealedCount, visibleKey, opened]);

  // "Show more" moves focus to the first card it added, so keyboard users
  // land on the new cards instead of tabbing past them, and focus isn't lost
  // when the last page removes the button.
  const focusAfterShowMore = useRef<string | null>(null);
  function handleShowMore() {
    focusAfterShowMore.current = topIds[revealedCount] ?? null;
    showMore();
  }
  useEffect(() => {
    const id = focusAfterShowMore.current;
    if (id === null) return;
    focusAfterShowMore.current = null;
    cardElement(id)?.querySelector<HTMLElement>('button, a[href]')?.focus();
  }, [revealedCount]);

  // Pin click (#94): open detail and scroll the matching card into view,
  // first rendering the list down to it (#102). The card exists in Split and
  // in the mobile map's sheet; desktop Map mode has no list.
  // A park's hike opens its park's section, below the park's row (#269).
  function handlePinActivate(activity: Activity) {
    const held = nested.subItems.get(activity.parentId ?? '');
    const park = held?.includes(activity) ? { id: activity.parentId ?? '', held } : null;
    const index = topIds.indexOf(park ? park.id : activity.id);
    if (!listShown || index === -1) {
      openFromList(activity.id);
      return;
    }
    const shownCount = revealTo(index);
    // Stepped through as the list will show it, with its park open.
    openActivity(activity.id, park ? idsShowing(park, shownCount) : visibleIds);
    if (park) setOpenPark(park.id);
    setScrollRequest({ id: activity.id, list: visibleKey });
  }

  // Closing a park's section puts focus back on its bar, rather than losing
  // it with the button that closed it.
  const focusBarAfterClose = useRef<string | null>(null);
  useEffect(() => {
    const id = focusBarAfterClose.current;
    if (id === null || opened) return;
    focusBarAfterClose.current = null;
    document.getElementById(parkBarId(id))?.focus();
  }, [opened]);

  // Narrower grid in Split (the list shares the row with the map) and in the
  // mobile map's sheet (two cards a row only once there's room for them) than
  // in the full-width List layout.
  const gridColsClass =
    view === 'split'
      ? 'grid-cols-1 xl:grid-cols-2'
      : view === 'map'
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
  // An open park's hikes and stops sit smaller, one more to a row. (The
  // mobile map's sheet is never wide enough for Split's third column.)
  const parkGridClass =
    view === 'list'
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
      : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';

  function card(a: Activity) {
    return (
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
            openFromList(a.id);
          }
        }}
        actionSlot={
          // Per-card "Add to trip" shows only while building a trip
          // (#112), keeping the default browse view uncluttered. An
          // active trip target (location.state) always opens selection
          // mode, so selectionMode covers both cases.
          isSignedIn && selectionMode ? (
            <AddToTripDropdown
              activityId={a.id}
              onAdded={(msg) => {
                setTripAddedToast(msg);
                window.setTimeout(() => setTripAddedToast(null), 3000);
              }}
            />
          ) : undefined
        }
      />
    );
  }

  // The cards shown, each park's with its bar, and the open park's section
  // after the last card of its row (#269), so it reads in place.
  const shown = visibleTop.slice(0, revealedCount);
  const openIndex = opened ? shown.findIndex((a) => a.id === opened.id) : -1;
  const section = opened && (
    <ParkSection
      key={`park-${opened.id}`}
      park={shown[openIndex]}
      gridClass={parkGridClass}
      onViewPark={() => openFromList(opened.id)}
      onClose={() => {
        focusBarAfterClose.current = opened.id;
        setOpenPark(null);
      }}
    >
      {opened.held.map(card)}
    </ParkSection>
  );
  const sectionAfter = rowEnd(openIndex, columns, shown.length);
  const gridItems = shown.flatMap((a, i) => {
    const held = nested.subItems.get(a.id);
    const item = held ? (
      <div key={a.id} className="flex flex-col gap-sm">
        {card(a)}
        <ParkBar
          park={a}
          count={held.length}
          open={a.id === opened?.id}
          onToggle={() => {
            // Revealed for good, so a smaller page (List to Split) keeps it.
            revealTo(i);
            setOpenPark((open) => (open === a.id ? null : a.id));
          }}
        />
      </div>
    ) : (
      card(a)
    );
    return i === sectionAfter && section ? [item, section] : [item];
  });

  const listContent =
    visibleResults.length === 0 ? (
      <div className="py-xl text-center text-on-surface-variant">
        {bounds && results.length > 0
          ? 'No activities in this area.'
          : 'No activities match those filters.'}
      </div>
    ) : (
      <>
        <div ref={gridRef} className={`grid gap-gutter ${gridColsClass}`}>
          {gridItems}
        </div>
        {remaining > 0 && (
          // The end of the list: coming into view adds the next page. The
          // button does the same for keyboards and browsers without
          // IntersectionObserver.
          <div ref={endOfListRef} className="flex justify-center pt-lg">
            <button
              type="button"
              onClick={handleShowMore}
              className="inline-flex min-h-11 items-center rounded-full border border-outline-variant/40 px-md font-body-md text-primary hover:bg-surface-variant"
            >
              Show more ({remaining} left)
            </button>
          </div>
        )}
      </>
    );

  // Compact list-head (replaces the old hero's H1) — shown above the grid in
  // List and Split; Map mode gives the whole viewport to the map.
  const listHeader = (
    <div className="mb-md space-y-sm">
      <div>
        <h1 className="font-display text-headline-md text-primary">Curated Adventures</h1>
        <p className="mt-xs font-body-sm text-body-sm text-on-surface-variant">
          {results.length} place{results.length === 1 ? '' : 's'} · sorted by distance from{' '}
          {origin.label}
        </p>
      </div>
      {isOwner && (
        <PendingSuggestions
          suggestions={pending}
          onOpenActivity={openActivity}
          reveal={revealQueue}
          onRevealed={queueRevealed}
        />
      )}
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

  // How many suggestions wait for the owners (#259), in every view: the
  // queue itself only shows above the list. Tapping it goes there.
  const waiting = pending.length;
  const reviewButton = isOwner && waiting > 0 && (
    <button
      type="button"
      onClick={showQueue}
      aria-label={`Review ${waiting} suggestion${waiting === 1 ? '' : 's'}`}
      // Ends in its count's circle, so the right padding matches the space
      // above and below it.
      className="inline-flex h-9 shrink-0 items-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-low pr-base pl-sm text-body-sm whitespace-nowrap text-on-surface-variant transition-colors hover:bg-surface-variant"
    >
      Review
      <span
        aria-hidden="true"
        className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-[5px] leading-none text-on-primary tabular-nums"
      >
        {waiting}
      </span>
    </button>
  );

  // Header of the mobile map's list sheet (#96). It stays visible at `peek`, so
  // it carries the way back to the list and the same count / bounds summary
  // the list header shows. The exit reads "Hide map" rather than "List"
  // because the sheet already is the list.
  const mobileSheetHeader = (
    <div className="flex items-center justify-between gap-sm">
      {/* The way out, and beside it the owners' review count (#259). */}
      <div className="flex shrink-0 items-center gap-xs">
        <button
          type="button"
          // Drop the map-driven viewport filter on the way out: the full-width
          // list shouldn't stay narrowed to a map the user can no longer see.
          onClick={() => {
            clearBounds();
            setView('list');
          }}
          className="inline-flex h-9 items-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-low px-sm text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-variant"
        >
          <span
            className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
            style={{ fontSize: 18, width: 18, height: 18 }}
            aria-hidden="true"
          >
            close
          </span>
          Hide map
        </button>
        {reviewButton}
      </div>
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-sm text-body-sm text-on-surface-variant"
      >
        {bounds ? (
          <>
            <span>
              Showing <b className="text-on-surface">{visibleResults.length}</b> in this area
            </span>
            <button
              type="button"
              aria-label="Clear bounds"
              // Drop the sheet to peek first, so the fit's flight (sized for a
              // peeking sheet) isn't hidden behind it.
              onClick={() => {
                setSheetSnap('peek');
                clearBounds();
              }}
              className="font-semibold text-secondary hover:underline"
            >
              Clear
            </button>
          </>
        ) : (
          <span>
            <b className="text-on-surface">{results.length}</b> place
            {results.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  );

  // Compact toolbar (filters + view toggle). Sticky in List mode (the long grid
  // scrolls beneath it); in Split it sits above the page-scrolled columns; in
  // Map it's the fixed top row of a viewport-height flex column (below).
  // The filter chips, shared by the toolbar and the mobile map's sheet (#96).
  // On mobile they stay on one line that scrolls horizontally, so the toolbar
  // stays short (wrapping there pushed the map far down the page). On desktop
  // they wrap instead: the scrollbar is hidden, so a chip past the edge (e.g.
  // "Completed only" at 1280px) was unreachable in practice.
  // In the toolbar the chips' box dissolves from md up (`contents`), so the
  // chips and the view/trip actions wrap as one row: kept in two columns, the
  // chips wrapped in what was left beside the actions, stranding one on a
  // line of its own. The mobile map's sheet keeps the box.
  const renderFilterChips = (inToolbar: boolean) => (
    <div
      className={`-my-1 flex scrollbar-none items-center gap-sm overflow-x-auto px-0.5 py-1 md:min-w-0 md:flex-1 md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden ${
        inToolbar ? 'md:contents' : ''
      }`}
    >
      <FilterPill
        icon="location_on"
        label={
          maxDistance === Infinity ? 'Any distance' : `Within ${maxDistance} mi of ${origin.name}`
        }
      >
        <select
          value={String(maxDistance)}
          onChange={(e) => setMaxDistance(Number(e.target.value))}
          aria-label="Distance"
          className="cursor-pointer appearance-none bg-transparent text-body-sm focus:outline-none"
        >
          <option value={String(Infinity)}>Any distance</option>
          {DISTANCE_LIMITS.map((miles) => (
            <option key={miles} value={String(miles)}>
              Within {miles} mi of {origin.name}
            </option>
          ))}
        </select>
      </FilterPill>
      <FilterPill icon="schedule" label={duration === 'Any' ? 'Any duration' : duration}>
        <select
          value={duration}
          onChange={(e) => setDuration(e.target.value as 'Any' | Duration)}
          aria-label="Duration"
          className="cursor-pointer appearance-none bg-transparent text-body-sm focus:outline-none"
        >
          {DURATION_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d === 'Any' ? 'Any duration' : d}
            </option>
          ))}
        </select>
      </FilterPill>
      <FilterPill icon="category" label={categoryOptionLabel(category)}>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as 'Any' | Category)}
          aria-label="Category"
          className="cursor-pointer appearance-none bg-transparent text-body-sm focus:outline-none"
        >
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {categoryOptionLabel(c)}
            </option>
          ))}
        </select>
      </FilterPill>
      <FilterPill icon="forest" label={PARK_TYPE_LABELS[parkType]}>
        <select
          value={parkType}
          onChange={(e) => setParkType(e.target.value as 'Any' | ParkType)}
          aria-label="Park type"
          className="cursor-pointer appearance-none bg-transparent text-body-sm focus:outline-none"
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
          style={{ fontSize: 18, width: 18, height: 18, marginLeft: glyphBleed('pets') }}
          aria-hidden="true"
        >
          pets
        </span>
        Dog friendly
      </button>
      {/* A read filter, so it's shown to everyone (#85), once anything is
          known to be free: before that it could only empty the list. Kept
          while it's on, so it can still be cleared if nothing free is left. */}
      {(anyFree || freeOnly) && (
        <button
          type="button"
          role="switch"
          aria-checked={freeOnly}
          aria-label="Free"
          onClick={() => setFreeOnly((v) => !v)}
          className={`inline-flex h-9 shrink-0 items-center gap-xs rounded-full border px-sm text-body-sm font-medium transition-colors ${
            freeOnly
              ? 'border-primary bg-primary text-on-primary'
              : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
          }`}
        >
          <span
            className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
            style={{ fontSize: 18, width: 18, height: 18, marginLeft: glyphBleed('money_off') }}
            aria-hidden="true"
          >
            money_off
          </span>
          Free
        </button>
      )}
      {/* A read filter, so it's shown to everyone (#5). */}
      <button
        type="button"
        role="switch"
        aria-checked={completedOnly}
        aria-label="Completed only"
        onClick={toggleCompletedOnly}
        className={`inline-flex h-9 shrink-0 items-center gap-xs rounded-full border px-sm text-body-sm font-medium transition-colors ${
          completedOnly
            ? 'border-primary bg-primary text-on-primary'
            : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
        }`}
      >
        <span
          className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
          style={{ fontSize: 18, width: 18, height: 18, marginLeft: glyphBleed('check_circle') }}
          aria-hidden="true"
        >
          check_circle
        </span>
        Completed only
      </button>
      {/* Signed-in only (#9): there's no contributor data to filter otherwise. */}
      {isSignedIn && (
        <ContributorFilter
          options={contributorChoices}
          selected={selectedContributors}
          onChange={changeContributors}
        />
      )}
    </div>
  );

  const filterToolbar = (
    <section
      className={`z-40 border-b border-outline-variant/20 bg-surface py-sm px-margin backdrop-blur-xl ${
        view === 'list' ? 'md:sticky md:top-20' : ''
      }`}
    >
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-sm md:flex-row md:flex-wrap md:items-center">
        {renderFilterChips(true)}
        {/* View toggle + trip actions: their own row below the filters on
            mobile, right-aligned inline on desktop. */}
        <div className="flex shrink-0 flex-wrap items-center justify-start gap-sm md:ml-auto md:flex-nowrap md:justify-end">
          {/* Split only exists at lg+, so the segmented control does too;
              below it, a floating "Show map" button (below) opens the
              full-screen map and the sheet's "Hide map" closes it (#96). */}
          {isLg && <ViewModeToggle value={view} onChange={setView} />}
          {reviewButton}
          {isSignedIn && (
            <button
              type="button"
              onClick={() => {
                if (selectionMode) {
                  clearSelection();
                } else {
                  setSelectionMode(true);
                }
              }}
              className="inline-flex h-9 items-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-low px-sm text-body-sm whitespace-nowrap text-on-surface-variant transition-colors hover:bg-surface-variant"
            >
              <span
                className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
                style={{
                  fontSize: 18,
                  width: 18,
                  height: 18,
                  marginLeft: glyphBleed(selectionMode ? 'close' : 'check_box'),
                }}
                aria-hidden="true"
              >
                {selectionMode ? 'close' : 'check_box'}
              </span>
              {selectionMode ? 'Cancel select' : 'Select for trip'}
            </button>
          )}
          {/* Owners add; any other signed-in account suggests one for the
              owners to review (#73). Signed-out visitors see neither. */}
          {(isOwner || isSignedIn) && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex h-9 items-center gap-xs rounded-full bg-primary px-sm text-body-sm whitespace-nowrap text-on-primary transition-opacity hover:opacity-90"
            >
              <span
                className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
                style={{
                  fontSize: 18,
                  width: 18,
                  height: 18,
                  marginLeft: glyphBleed(isOwner ? 'add' : 'lightbulb'),
                }}
                aria-hidden="true"
              >
                {isOwner ? 'add' : 'lightbulb'}
              </span>
              {isOwner ? 'Add activity' : 'Suggest activity'}
            </button>
          )}
        </div>
      </div>
      {/* In the toolbar so List, Split and Map all show it: a failed catalog
          read must not pass for an empty catalog. */}
      {loadError && (
        <div className="mx-auto max-w-screen-2xl pt-sm">
          <InlineError message={loadError} />
        </div>
      )}
    </section>
  );

  // The floating "Show map" button (#96) is the mobile list's way into the
  // map. It steps aside while the selection bar owns the bottom of the screen;
  // the dialogs open above it.
  const showMapButton = !isLg && view === 'list' && !selectionMode;

  return (
    <>
      {mobileMap ? (
        // Mobile (#96): the map is a full-screen backdrop behind the
        // translucent app header, and the list rides over it in a draggable
        // sheet. No filter toolbar competes for the height: the sheet header
        // carries the exit and the count, and its body the filter chips.
        <>
          <div className="fixed inset-0 z-0">
            <ActivityMap
              fullBleed
              activities={mapActivities}
              onSelect={(a) => openFromList(a.id)}
              onActivate={handlePinActivate}
              highlightedId={hoveredId}
              onPinHoverChange={(act) => setPinHoveredId(act?.id ?? null)}
              onBoundsChange={handleBoundsChange}
              fitSignal={fitSignal}
            />
          </div>
          <h1 className="sr-only">Curated Adventures — map</h1>
          <BottomSheet
            snap={sheetSnap}
            onSnapChange={setSheetSnap}
            label="Activities on the map"
            header={mobileSheetHeader}
          >
            {/* The toolbar isn't shown on the mobile map, so the sheet
                carries its filter chips: otherwise active filters would
                narrow the pins with no way to see or change them here. */}
            <div className="pb-sm">{renderFilterChips(false)}</div>
            {/* The toolbar that shows a failed catalog read elsewhere isn't
                here, and a failed read must not pass for an empty catalog. */}
            {loadError && (
              <div className="pb-sm">
                <InlineError message={loadError} />
              </div>
            )}
            {listContent}
          </BottomSheet>
        </>
      ) : view === 'map' ? (
        <div className="flex h-[calc(100dvh-5rem)] flex-col overflow-hidden">
          {filterToolbar}
          {/* Map fills exactly the space below the nav: a flex child in a
              fixed-height, overflow-clipped column, so the page never scrolls
              and the map can't slide under the sticky header. */}
          <section className="min-h-0 flex-1 px-gutter py-md">
            <h1 className="sr-only">Curated Adventures — map</h1>
            <div className="size-full">
              <ActivityMap
                activities={mapActivities}
                onSelect={(a) => openFromList(a.id)}
                onActivate={handlePinActivate}
                highlightedId={hoveredId}
                onPinHoverChange={(act) => setPinHoveredId(act?.id ?? null)}
                onBoundsChange={handleBoundsChange}
                fitSignal={fitSignal}
              />
            </div>
          </section>
        </div>
      ) : view === 'split' ? (
        <>
          {filterToolbar}
          <section className="mx-auto max-w-screen-2xl lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* List column flows in the normal page scroll (Airbnb-style): the
              page's own scrollbar moves the cards while the map stays pinned —
              no separate inner scrollbar. */}
            <div
              className={`py-md px-margin ${selectionMode && selectedForTrip.size > 0 ? 'pb-32' : ''}`}
            >
              {listHeader}
              {listContent}
            </div>
            {/* Map column: sticky at top-20, fills the viewport and stays put as
              the list scrolls past. Mounted only at lg+ (below it the split
              collapses to list-only). */}
            {splitMapVisible && (
              <div className="hidden p-md lg:sticky lg:top-20 lg:block lg:h-[calc(100vh-80px)]">
                <ActivityMap
                  activities={mapActivities}
                  onSelect={(a) => openFromList(a.id)}
                  onActivate={handlePinActivate}
                  highlightedId={hoveredId}
                  onPinHoverChange={(act) => setPinHoveredId(act?.id ?? null)}
                  onBoundsChange={handleBoundsChange}
                  fitSignal={fitSignal}
                />
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          {filterToolbar}
          <section
            className={`mx-auto max-w-screen-2xl py-md px-margin ${
              selectionMode && selectedForTrip.size > 0 ? 'pb-32' : showMapButton ? 'pb-24' : ''
            }`}
          >
            {listHeader}
            {listContent}
          </section>
        </>
      )}

      {showMapButton && (
        <button
          type="button"
          onClick={showMobileMap}
          className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-xs rounded-full bg-primary px-md py-sm text-body-sm font-semibold text-on-primary shadow-lg transition-opacity hover:opacity-90"
        >
          <span
            className="material-symbols-outlined inline-flex shrink-0 items-center justify-center overflow-hidden"
            style={{ fontSize: 20, width: 20, height: 20, marginLeft: glyphBleed('map') }}
            aria-hidden="true"
          >
            map
          </span>
          Show map
        </button>
      )}

      {selectionMode && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-outline-variant/30 bg-surface/95 pt-md px-margin pb-[calc(var(--spacing-md)+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-md">
            <div className="font-body-md text-on-surface">
              {targetTrip ? (
                <>
                  Adding to <span className="font-bold">&quot;{targetTrip.title}&quot;</span>
                  {' · '}
                  {selectedForTrip.size} selected
                </>
              ) : (
                <>{selectedForTrip.size} selected</>
              )}
              {overBulkCap && (
                <span className="ml-sm font-body-md text-sm text-error">
                  Pick at most {MAX_BULK_ADD} at a time.
                </span>
              )}
            </div>
            <div className="ml-auto flex items-center gap-md">
              <button
                type="button"
                onClick={clearSelection}
                className="min-h-11 px-xs font-body-md text-on-surface-variant"
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
                disabled={selectedForTrip.size === 0 || submittingTarget || overBulkCap}
                title={overBulkCap ? `Pick at most ${MAX_BULK_ADD}` : undefined}
                className="inline-flex min-h-11 items-center gap-xs rounded-full bg-primary px-md py-sm font-body-md text-on-primary hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="fixed top-24 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-outline-variant/30 bg-surface-container-lowest px-md py-sm font-body-md shadow-lg"
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

      {adding && (
        <AddActivity
          suggest={!isOwner}
          onClose={() => setAdding(false)}
          onOpenActivity={(id) => {
            setAdding(false);
            openActivity(id);
          }}
        />
      )}
    </>
  );
}
