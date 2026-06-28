import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { HOME_LOCATION } from "../data/home";
import { ActivityCard } from "../components/ActivityCard";
import { ActivityDetail } from "../components/ActivityDetail";
import { ActivityMap } from "../components/ActivityMap";
import { AddActivity } from "../components/AddActivity";
import { AddToTripDialog } from "../components/AddToTripDialog";
import { AddToTripDropdown } from "../components/AddToTripDropdown";
import { ViewModeToggle } from "../components/ViewModeToggle";
import type { ViewMode } from "../components/ViewModeToggle";
import { isViewMode } from "../lib/viewMode";
import type { Activity, Category, Duration, ParkType } from "../data/types";
import { useAuthState } from "../lib/authShim";
import { useCatalogFilters } from "../lib/useCatalogFilters";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useAllActivities } from "../lib/userActivities";
import { useOwner } from "../lib/useOwner";
import { addActivityToTrip } from "../lib/userTrips";

type TargetTrip = { id: string; title: string };

type LocationState = {
  target_trip_id?: string;
  target_trip_title?: string;
} | null;

const DISTANCE_OPTIONS = [
  { label: "Any distance", value: Infinity },
  { label: "Within 25 mi", value: 25 },
  { label: "Within 50 mi", value: 50 },
  { label: "Within 100 mi", value: 100 },
  { label: "Within 250 mi", value: 250 },
];

const DURATION_OPTIONS: ("Any" | Duration)[] = [
  "Any",
  "1-2 Hours",
  "2-3 Hours",
  "Half Day",
  "Full Day",
  "Weekend",
  "Multi-Day",
];

const CATEGORY_OPTIONS: ("Any" | Category)[] = [
  "Any",
  "hiking",
  "cycling",
  "water",
  "food",
  "culture",
  "scenic",
  "climbing",
  "camping",
  "other",
];

const PARK_TYPE_OPTIONS: ("Any" | ParkType)[] = [
  "Any",
  "national",
  "state",
  "regional",
  "county",
  "city",
  "private",
  "none",
];

const PARK_TYPE_LABELS: Record<"Any" | ParkType, string> = {
  Any: "Any park type",
  national: "National park",
  state: "State park",
  regional: "Regional park",
  county: "County park",
  city: "City park",
  private: "Private land",
  none: "Not in a park",
};

export function CuratedAdventures() {
  const location = useLocation();
  const navigate = useNavigate();
  const { getToken } = useAuthState();
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
    search,
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
  const isLg = useMediaQuery("(min-width: 1024px)");
  const viewParam = searchParams.get("view");
  const view: ViewMode = isViewMode(viewParam)
    ? viewParam
    : isLg
      ? "split"
      : "list";
  function setView(next: ViewMode) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("view", next);
        return params;
      },
      { replace: true },
    );
  }
  // Whether Split mode should mount its map column. Below `lg` the split
  // collapses to list-only (the mobile map sheet is #96), so we skip mounting
  // Leaflet there entirely. Map mode renders its own map unconditionally.
  const splitMapVisible = view === "split" && isLg;

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
      const token = await getToken();
      let added = 0;
      let skipped = 0;
      for (const id of selectedForTrip) {
        const { alreadyOnTrip, tripPast } = await addActivityToTrip(
          targetTrip.id,
          id,
          token,
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
      if (parts.length > 0) setTripAddedToast(parts.join(" · "));
      void navigate(`/trips/${targetTrip.id}`);
    } catch (err) {
      setTripAddedToast(
        err instanceof Error ? err.message : "Failed to add to trip.",
      );
      window.setTimeout(() => setTripAddedToast(null), 3000);
    } finally {
      setSubmittingTarget(false);
    }
  }

  const results = useMemo(() => applyFilters(all), [applyFilters, all]);

  // Narrower grid in Split (the list shares the row with the map) than in the
  // full-width List layout.
  const gridColsClass =
    view === "split"
      ? "grid-cols-1 xl:grid-cols-2"
      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  const listContent =
    results.length === 0 ? (
      <div className="text-center py-xl text-on-surface-variant">
        No activities match those filters.
      </div>
    ) : (
      <div className={`grid gap-gutter ${gridColsClass}`}>
        {results.map((a) => (
          <ActivityCard
            key={a.id}
            activity={a}
            selectionMode={selectionMode}
            selected={selectedForTrip.has(a.id)}
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
    <div className="mb-md">
      <h1 className="font-display text-headline-md text-primary">
        Curated Adventures
      </h1>
      <p className="mt-xs font-body-sm text-body-sm text-on-surface-variant">
        {results.length} place{results.length === 1 ? "" : "s"} · sorted by
        distance from {HOME_LOCATION.label}
      </p>
    </div>
  );

  return (
    <>
      {/* Compact toolbar (search + filters + view toggle) replacing the old
          full-height hero, so the list/map fills the page like the #4 mockup.
          Sticky in List mode — the long grid scrolls beneath it. In Split/Map
          the columns are themselves sticky and fill the viewport, so a sticky
          toolbar would overlap them; there it scrolls away with the page. */}
      <section
        className={`border-b border-outline-variant/20 bg-surface px-margin py-md z-40 backdrop-blur-xl ${
          view === "list" ? "md:sticky md:top-20" : ""
        }`}
      >
        <div className="max-w-screen-2xl mx-auto flex flex-col gap-sm md:gap-md">
          <div className="flex items-center">
            <label className="flex grow max-w-2xl items-center gap-sm rounded-full border border-outline-variant bg-surface-container-lowest pl-gutter pr-sm py-sm shadow-sm transition-all focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/20">
              <span className="material-symbols-outlined text-outline">
                search
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="grow bg-transparent border-none focus:outline-none text-body-md"
                placeholder="Find your next adventure..."
                type="text"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-sm md:gap-md">
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
                onChange={(e) =>
                  setDuration(e.target.value as "Any" | Duration)
                }
                className="bg-transparent focus:outline-none cursor-pointer"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === "Any" ? "Any duration" : d}
                  </option>
                ))}
              </select>
            </FilterPill>
            <FilterPill icon="category">
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as "Any" | Category)
                }
                className="bg-transparent focus:outline-none cursor-pointer capitalize"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c} className="capitalize">
                    {c === "Any" ? "Any category" : c}
                  </option>
                ))}
              </select>
            </FilterPill>
            <FilterPill icon="forest">
              <select
                value={parkType}
                onChange={(e) =>
                  setParkType(e.target.value as "Any" | ParkType)
                }
                className="bg-transparent focus:outline-none cursor-pointer"
              >
                {PARK_TYPE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {PARK_TYPE_LABELS[p]}
                  </option>
                ))}
              </select>
            </FilterPill>
            <div className="flex items-center gap-sm shrink-0">
              <span className="font-body-md text-on-surface-variant">
                Dog Friendly
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={dogOnly}
                onClick={() => setDogOnly((v) => !v)}
                className={`w-12 h-7 rounded-full relative transition-colors ${
                  dogOnly ? "bg-secondary" : "bg-surface-variant"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full absolute top-1.5 transition-transform ${
                    dogOnly
                      ? "bg-on-secondary translate-x-7"
                      : "bg-outline translate-x-1"
                  }`}
                />
              </button>
            </div>
            <div className="w-full md:w-auto md:ml-auto flex justify-center">
              <ViewModeToggle value={view} onChange={setView} />
            </div>
            <div className="flex flex-wrap items-center gap-sm md:gap-md w-full md:w-auto justify-center md:justify-end">
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
                title={isSignedIn ? undefined : "Sign in to plan trips"}
                className="flex items-center gap-xs bg-surface-container-low border border-outline-variant/40 text-on-surface-variant px-sm md:px-md py-xs rounded-full font-body-md hover:bg-surface-variant transition-colors disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <span className="material-symbols-outlined text-body-md">
                  {selectionMode ? "close" : "check_box"}
                </span>
                {selectionMode ? "Cancel select" : "Select for trip"}
              </button>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex items-center gap-xs bg-primary text-on-primary px-sm md:px-md py-xs rounded-full font-body-md hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  <span className="material-symbols-outlined text-body-md">
                    add
                  </span>
                  Add activity
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {view === "map" ? (
        <section className="px-margin py-md w-full max-w-screen-2xl mx-auto">
          {/* Full-bleed map fills the viewport below the nav. */}
          <div className="h-[calc(100vh-80px)] w-full">
            <ActivityMap activities={results} onSelect={setSelected} />
          </div>
        </section>
      ) : view === "split" ? (
        <section className="max-w-screen-2xl mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* List column: its own scroll container on lg, sticky under the
              filter bar so it scrolls independently of the map. */}
          <div
            className={`px-margin py-lg lg:sticky lg:top-20 lg:h-[calc(100vh-80px)] lg:overflow-y-auto ${
              selectionMode && selectedForTrip.size > 0 ? "pb-32" : ""
            }`}
          >
            {listHeader}
            {listContent}
          </div>
          {/* Map column: sticky at top-20, fills the viewport beside the list.
              Mounted only at lg+ (below it the split collapses to list-only;
              the mobile map sheet is #96). */}
          {splitMapVisible && (
            <div className="hidden lg:block lg:sticky lg:top-20 lg:h-[calc(100vh-80px)] p-md">
              <ActivityMap activities={results} onSelect={setSelected} />
            </div>
          )}
        </section>
      ) : (
        <section
          className={`px-margin py-lg max-w-screen-2xl mx-auto ${
            selectionMode && selectedForTrip.size > 0 ? "pb-32" : ""
          }`}
        >
          {listHeader}
          {listContent}
        </section>
      )}

      {selectionMode && (
        <div className="fixed bottom-0 inset-x-0 z-40 px-margin py-md bg-surface/95 backdrop-blur-xl border-t border-outline-variant/30">
          <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-md flex-wrap">
            <div className="font-body-md text-on-surface">
              {targetTrip ? (
                <>
                  Adding to{" "}
                  <span className="font-bold">
                    &quot;{targetTrip.title}&quot;
                  </span>
                  {" · "}
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
                  ? "Adding…"
                  : targetTrip
                    ? `Add to "${targetTrip.title}"`
                    : "Add to trip"}
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
            setTripAddedToast(parts.join(" · "));
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
    <label className="flex items-center gap-xs text-on-surface-variant bg-surface-container-low px-sm py-xs rounded-full border border-outline-variant/30 cursor-pointer hover:bg-surface-variant transition-colors">
      <span className="material-symbols-outlined text-body-md">{icon}</span>
      {children}
    </label>
  );
}
