import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';

import type { Activity } from '../data/types';
import { useDistanceOrigin } from '../lib/distanceOrigin';
import { formatMiles, useDistanceTo } from '../lib/drivingMiles';
import { MAX_PHOTOS_PER_ACTIVITY, useActivityPhotos } from '../lib/userPhotos';
import { useCompleted } from '../lib/userCompleted';
import { deleteUserActivity, useAllActivities } from '../lib/userActivities';
import { useOwner } from '../lib/useOwner';
import { directionsUrl, isApplePlatform } from '../lib/directions';
import { authorLabel } from '../lib/activityReviews';
import { costStat } from '../lib/cost';
import { CATEGORY_ICON } from '../lib/mapPins';
import { glyphBleed } from '../lib/iconMetrics';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useSwipe } from '../lib/swipe';
import { useFocusTrap } from '../lib/focusTrap';
import {
  NEARBY_GROUP_HEADING,
  NEARBY_RADIUS_MILES,
  nearbyByCategory,
} from '../lib/nearbyActivities';
import { ActivityReviews } from './ActivityReviews';
import { AddActivity } from './AddActivity';
import { CdnImage } from './CdnImage';
import { CoverImage } from './CoverImage';
import { InlineError } from './InlineError';

interface Props {
  activity: Activity;
  onClose: () => void;
  showUploads?: boolean;
  /** Opens a nearby activity; without it, the detail swaps in place. */
  onSelectNearby?: (activity: Activity) => void;
  /**
   * Animates the open (#63). Off when the detail replaces another one already
   * on screen, so moving between activities doesn't replay it.
   */
  animateIn?: boolean;
  /**
   * Its place in the browse list it was opened from (#64), with the steps to
   * the previous and next activity; a step is missing at that end of the list.
   */
  sequence?: {
    index: number;
    total: number;
    /** A step; 'swipe' when a swipe made it, so the next one doesn't slide in. */
    onPrev?: (how?: 'swipe') => void;
    onNext?: (how?: 'swipe') => void;
    /** The neighbours, previewed beside the panel while it's swiped. */
    prevActivity?: Activity;
    nextActivity?: Activity;
    /** The step that brought this activity up, to keep focus on its button. */
    cameBy?: 'prev' | 'next';
    /** That step was a swipe: the activity is already in place. */
    swiped?: boolean;
  };
  /**
   * Shows the catalog filtered to one contributor (#9); with it, each name in
   * "Contributed by" is a button. Without it (a trip's detail), plain text.
   */
  onShowContributor?: (email: string) => void;
}

/**
 * Arrow keys in a field, or in a group of controls (a review's star rating),
 * belong there: a step would remount the detail and drop what's half-done.
 */
const OWNS_ARROWS = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  'form',
  '[role="group"]',
  '[role="radiogroup"]',
].join(', ');

function ownsArrows(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OWNS_ARROWS) !== null;
}

// The detail's cover fills its panel: the width of a phone, or at most 768px.
const DETAIL_SIZES = '(min-width: 768px) 768px, 100vw';

const STEP_BUTTON =
  'w-11 h-11 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-default';

// Each needs motion-safe: on its own, so reduced motion opens with a cut.
const SCRIM_IN = 'motion-safe:animate-scrim-in';
const PANEL_IN = 'motion-safe:animate-sheet-in md:motion-safe:animate-dialog-in';
// A step through the list slides the next activity in from the side it came
// from: from the right for next, from the left for previous.
const STEP_IN = {
  next: 'motion-safe:animate-step-in-from-right',
  prev: 'motion-safe:animate-step-in-from-left',
} as const;

export function ActivityDetail({
  activity: initial,
  onClose,
  showUploads,
  onSelectNearby,
  animateIn = true,
  sequence,
  onShowContributor,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [override, setOverride] = useState<Activity | null>(null);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setOverride(null);
  }
  const activity = override ?? initial;
  const setActivity = setOverride;

  const allActivities = useAllActivities();
  const { completed } = useCompleted(activity);
  const { isOwner } = useOwner();
  const {
    photos,
    loading: photosLoading,
    loadError: photosLoadError,
    uploading,
    addPhotos,
    removePhoto,
    saveError,
    clearSaveError,
  } = useActivityPhotos(activity.id, isOwner && (completed || !!showUploads));
  const [editing, setEditing] = useState(false);

  const nearbyGroups = useMemo(
    () => nearbyByCategory(activity, allActivities),
    [allActivities, activity],
  );
  const nearbyIdPrefix = useId();

  function selectNearby(a: Activity) {
    if (onSelectNearby) {
      onSelectNearby(a);
    } else {
      // Swapped in place: the button tapped goes with the old activity's
      // nearby list, so focus moves to the panel rather than out of it.
      setActivity(a);
      scrollRef.current?.focus({ preventScroll: true });
    }
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // When the edit form is layered on top, let it own Escape — don't
      // collapse both modals in one keystroke.
      if (e.key === 'Escape' && !editing) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, editing]);

  // Left and Right step through the list, like its buttons, unless the edit
  // form is up, the key belongs to a field or control, or it's held down
  // (one step per press: a held key would flood the history).
  const onPrev = sequence?.onPrev;
  const onNext = sequence?.onNext;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        editing ||
        e.repeat ||
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        e.shiftKey ||
        ownsArrows(e.target)
      ) {
        return;
      }
      const step = e.key === 'ArrowLeft' ? onPrev : e.key === 'ArrowRight' ? onNext : undefined;
      if (!step) return;
      e.preventDefault();
      step();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onPrev, onNext]);

  // On a phone: swipe down from the top to close, or sideways to step through
  // the list, unless the edit form is up.
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  useSwipe(
    scrollRef,
    scrimRef,
    {
      onClose,
      onPrev: onPrev && (() => onPrev('swipe')),
      onNext: onNext && (() => onNext('swipe')),
      enabled: !editing,
      reduceMotion,
    },
    trackRef,
  );

  // Tab stays inside the detail (#258), except while the edit form is up:
  // that's drawn beside the detail rather than in it, and Tab must reach it.
  // (The form has no trap of its own, so Tab past its end still leaves it.)
  useFocusTrap(scrollRef, !editing);

  // Closing the edit form takes focus with it, if it was in there; hand it
  // back to Edit, or the trap would never see the next Tab.
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    const closed = wasEditing.current && !editing;
    wasEditing.current = editing;
    if (closed && !scrollRef.current?.contains(document.activeElement)) {
      editRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  // A step remounts the detail; keep focus on the control that made it, or
  // its partner once the end of the list has disabled it.
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const cameBy = sequence?.cameBy;
  useEffect(() => {
    if (!cameBy) {
      // Otherwise focus starts on the dialog itself (#258).
      scrollRef.current?.focus({ preventScroll: true });
      return;
    }
    const [mine, other] = cameBy === 'prev' ? [prevRef, nextRef] : [nextRef, prevRef];
    (mine.current?.disabled ? other.current : mine.current)?.focus();
  }, [cameBy]);

  const handleFiles = (files: FileList | null) => {
    if (files && files.length) void addPhotos(files);
  };

  async function handleDelete() {
    if (!isOwner) return;
    const ok = window.confirm(
      `Delete "${activity.name}" for everyone? This removes it from the shared catalog for all viewers. This can't be undone.`,
    );
    if (!ok) return;
    // Close first: under a permalink (#86) the activity leaving the catalog
    // would otherwise flash "not found" while the close is under way.
    onClose();
    await deleteUserActivity(activity.id);
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center p-0 md:p-md overflow-hidden">
      <button
        ref={scrimRef}
        type="button"
        aria-label="Close activity details"
        onClick={onClose}
        className={`absolute inset-0 bg-on-surface/60 backdrop-blur-sm cursor-default ${animateIn ? SCRIM_IN : ''}`}
      />
      {/* The track a sideways swipe moves: the panel, with its neighbours
          waiting beside it. */}
      <div ref={trackRef} className="group/track relative w-full max-w-3xl">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activity.name}
          ref={scrollRef}
          tabIndex={-1}
          className={`relative bg-surface-container-lowest focus:outline-none w-full max-h-[95dvh] overflow-y-auto overscroll-contain md:rounded-xl shadow-2xl ${animateIn ? PANEL_IN : cameBy && !sequence?.swiped ? STEP_IN[cameBy] : ''}`}
        >
          <div className="relative aspect-video bg-surface-variant">
            <CoverImage
              alt={activity.name}
              category={activity.category}
              src={activity.coverImage}
              className="w-full h-full object-cover"
              glyphSize={64}
              sizes={DETAIL_SIZES}
            />
            {/* The sheet's grab handle on a phone: it can be swiped down. */}
            <span
              aria-hidden="true"
              className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-surface-container-lowest/80 shadow-sm"
            />
            {sequence && (
              <nav
                aria-label={`Adventure ${sequence.index + 1} of ${sequence.total} in this list`}
                className="absolute top-sm left-sm flex items-center gap-xs bg-surface-container-lowest/90 backdrop-blur-sm rounded-full p-xs"
              >
                <button
                  ref={prevRef}
                  type="button"
                  onClick={() => sequence.onPrev?.()}
                  disabled={!sequence.onPrev}
                  aria-label="Previous adventure"
                  aria-keyshortcuts="ArrowLeft"
                  className={STEP_BUTTON}
                >
                  <span className="material-symbols-outlined">chevron_left</span>
                </button>
                <span className="font-body-sm text-on-surface-variant tabular-nums px-xs">
                  {sequence.index + 1} of {sequence.total}
                </span>
                <button
                  ref={nextRef}
                  type="button"
                  onClick={() => sequence.onNext?.()}
                  disabled={!sequence.onNext}
                  aria-label="Next adventure"
                  aria-keyshortcuts="ArrowRight"
                  className={STEP_BUTTON}
                >
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              </nav>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-sm right-sm bg-surface-container-lowest/90 backdrop-blur-sm rounded-full w-11 h-11 flex items-center justify-center hover:bg-surface-container-lowest transition-colors"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          {activity.coverCredit && (
            // Commons covers are CC-licensed: credit author + license (#36).
            <p className="px-md md:px-lg pt-xs font-body-sm text-on-surface-variant">
              {activity.coverCredit}
            </p>
          )}
          <div className="p-md md:p-lg space-y-md">
            <TitleRow activity={activity} />

            <Facts activity={activity} onShowContributor={onShowContributor} />

            {(activity.allTrailsUrl ||
              activity.hikeDistanceMiles ||
              activity.hikeElevationFeet) && (
              <div className="bg-surface-container-low rounded-lg p-md space-y-sm">
                <div className="flex items-center justify-between gap-sm">
                  <div className="font-label-caps text-label-caps text-on-surface-variant">
                    TRAIL DETAILS
                  </div>
                  {activity.allTrailsRating != null && (
                    <div className="flex items-center gap-xs text-secondary">
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}
                      >
                        star
                      </span>
                      <span className="font-headline-md text-headline-md">
                        {activity.allTrailsRating.toFixed(1)}
                      </span>
                      <span className="font-body-md text-on-surface-variant">
                        AllTrails
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-md text-on-surface-variant">
                  {activity.hikeDistanceMiles != null && (
                    <Stat
                      icon="straighten"
                      label={`${activity.hikeDistanceMiles} mi`}
                    />
                  )}
                  {activity.hikeElevationFeet != null && (
                    <Stat
                      icon="terrain"
                      label={`${activity.hikeElevationFeet.toLocaleString()} ft gain`}
                    />
                  )}
                  {activity.allTrailsUrl && (
                    <a
                      href={activity.allTrailsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-xs text-primary-container hover:underline font-medium"
                    >
                      View on AllTrails
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 16 }}
                      >
                        open_in_new
                      </span>
                    </a>
                  )}
                </div>
              </div>
            )}

            {(activity.cuisine ||
              activity.priceRange ||
              activity.hours ||
              activity.reservationUrl ||
              activity.menuUrl ||
              (activity.dietary && activity.dietary.length > 0)) && (
              <div className="bg-surface-container-low rounded-lg p-md space-y-sm">
                <div className="font-label-caps text-label-caps text-on-surface-variant">
                  RESTAURANT INFO
                </div>
                <div className="flex flex-wrap gap-md text-on-surface-variant">
                  {activity.cuisine && (
                    <Stat icon="restaurant_menu" label={activity.cuisine} />
                  )}
                  {activity.priceRange && (
                    <Stat icon="payments" label={activity.priceRange} />
                  )}
                  {activity.hours && (
                    <Stat icon="schedule" label={activity.hours} />
                  )}
                </div>
                {activity.dietary && activity.dietary.length > 0 && (
                  <div className="flex flex-wrap gap-xs">
                    {activity.dietary.map((d) => (
                      <span
                        key={d}
                        className="font-body-sm text-on-surface-variant bg-surface-variant rounded-full px-sm py-xs capitalize"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                )}
                {(activity.reservationUrl || activity.menuUrl) && (
                  <div className="flex flex-wrap gap-md">
                    {activity.reservationUrl && (
                      <a
                        href={activity.reservationUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-xs text-primary-container hover:underline font-medium"
                      >
                        Reserve
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 16 }}
                        >
                          open_in_new
                        </span>
                      </a>
                    )}
                    {activity.menuUrl && (
                      <a
                        href={activity.menuUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-xs text-primary-container hover:underline font-medium"
                      >
                        Menu / website
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 16 }}
                        >
                          open_in_new
                        </span>
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {activity.notes && (
              <div className="bg-surface-container-low rounded-lg p-md">
                <div className="font-label-caps text-label-caps text-on-surface-variant mb-xs">
                  NOTES
                </div>
                <p className="font-body-md text-body-md text-on-surface">
                  {activity.notes}
                </p>
              </div>
            )}

            {/* Owner reviews (#184) — what each of us thought after doing it.
                Reviews are about completed activities, so the section only
                appears once this one is marked done. */}
            {completed && (
              // Keyed on the activity: picking a nearby activity swaps `activity`
              // without unmounting this dialog, and an open review draft must not
              // follow along and be saved onto a different activity.
              <ActivityReviews key={activity.id} activityId={activity.id} />
            )}

            {/* Nearby, grouped by category (#65). Hidden entirely when nothing
                is within range: an empty "nothing nearby" panel on most remote
                activities would be noise, not information. */}
            {nearbyGroups.length > 0 && (
              <section className="space-y-sm">
                <h3 className="font-headline-md text-headline-md text-primary">
                  Nearby — do at the same time
                </h3>
                <p className="font-body-sm text-on-surface-variant">
                  Other activities within {NEARBY_RADIUS_MILES} miles of{' '}
                  {activity.location.city}.
                </p>
                {nearbyGroups.map(({ category, items }) => {
                  const headingId = `${nearbyIdPrefix}-${category}`;
                  return (
                    <section
                      key={category}
                      aria-labelledby={headingId}
                      className="space-y-xs"
                    >
                      <h4
                        id={headingId}
                        className="flex items-center gap-xs font-label-caps text-label-caps text-on-surface-variant"
                      >
                        <span
                          aria-hidden="true"
                          className="material-symbols-outlined"
                          style={{ fontSize: 16, marginLeft: glyphBleed(CATEGORY_ICON[category]) }}
                        >
                          {CATEGORY_ICON[category]}
                        </span>
                        {NEARBY_GROUP_HEADING[category]}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
                        {items.map(({ activity: a, miles: m }) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => selectNearby(a)}
                            className="flex gap-sm items-stretch text-left rounded-lg overflow-hidden border border-outline-variant/40 bg-surface-container-low hover:bg-surface-container transition-colors"
                          >
                            <div className="w-24 shrink-0 bg-surface-variant">
                              <CdnImage
                                src={a.coverImage}
                                alt={a.name}
                                sizes="96px"
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="flex-1 min-w-0 py-xs pr-sm">
                              <div className="font-body-md font-bold text-on-surface truncate">
                                {a.name}
                              </div>
                              <div className="font-body-sm text-on-surface-variant truncate">
                                {a.location.city} · {m.toFixed(1)} mi away
                              </div>
                              <div className="font-body-sm text-on-surface-variant truncate">
                                {a.duration}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </section>
            )}

            {/* Owner-only read (#19): the photos are the owners' own, kept in
                private storage, so the whole section is theirs alone. */}
            {isOwner && (completed || showUploads) && (
              <section className="space-y-sm">
                <div className="flex items-center justify-between">
                  <h3 className="font-headline-md text-headline-md text-primary">
                    Your Photos
                  </h3>
                  {photos.length < MAX_PHOTOS_PER_ACTIVITY && (
                    <label
                      className={`bg-secondary text-on-secondary px-md py-sm rounded-full font-medium transition-opacity flex items-center gap-xs ${
                        uploading ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:opacity-90'
                      }`}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        {uploading ? 'hourglass_top' : 'add_a_photo'}
                      </span>
                      {uploading ? 'Uploading…' : 'Add photos'}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        disabled={uploading}
                        className="hidden"
                        onChange={(e) => {
                          handleFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
                <InlineError message={saveError} onDismiss={clearSaveError} />
                {photosLoading ? null : photosLoadError ? (
                  <InlineError message={photosLoadError} />
                ) : photos.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed border-outline-variant p-lg text-center text-on-surface-variant">
                    No photos yet — upload some from this trip.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-sm">
                    {photos.map((photo, i) => (
                      <div
                        key={photo.id}
                        className="relative aspect-square rounded-lg overflow-hidden bg-surface-variant group"
                      >
                        <img
                          src={photo.url}
                          alt={`${activity.name} ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => void removePhoto(photo.id)}
                          aria-label="Remove photo"
                          className="absolute top-xs right-xs bg-on-surface/70 text-on-primary rounded-full w-11 h-11 flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ fontSize: 18 }}
                          >
                            delete
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {isOwner && (
              <div className="pt-md mt-md border-t border-outline-variant/40 flex flex-wrap justify-end gap-sm">
                <button
                  ref={editRef}
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-variant transition-colors"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14 }}
                  >
                    edit
                  </span>
                  EDIT ACTIVITY
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  className="-mr-md inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps text-error hover:bg-error-container transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-container"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14 }}
                  >
                    delete
                  </span>
                  DELETE ACTIVITY
                </button>
              </div>
            )}
          </div>
        </div>
        {sequence?.prevActivity && (
          <Peek
            activity={sequence.prevActivity}
            side="prev"
            place={sequence.index}
            total={sequence.total}
          />
        )}
        {sequence?.nextActivity && (
          <Peek
            activity={sequence.nextActivity}
            side="next"
            place={sequence.index + 2}
            total={sequence.total}
          />
        )}
      </div>
      {editing && (
        <AddActivity
          editActivity={activity}
          onClose={() => setEditing(false)}
          onSaved={(updated) => setActivity(updated)}
        />
      )}
    </div>
  );
}

// "Contributed by Tarun, Jess" (#9), every name spelled out. With `onShow`,
// each name is a button that filters the catalog to that person.
function Contributors({
  emails,
  onShow,
}: {
  emails: readonly string[];
  onShow?: (email: string) => void;
}) {
  return (
    <div className="flex items-center gap-xs">
      <span className="material-symbols-outlined text-icon-md">person</span>
      <span className="font-body-md">
        Contributed by{' '}
        {emails.map((email, i) => (
          <Fragment key={email}>
            {i > 0 && ', '}
            {onShow ? (
              <button
                type="button"
                onClick={() => onShow(email)}
                aria-label={`Show ${authorLabel(email)}'s picks`}
                className="font-medium text-primary-container hover:underline"
              >
                {authorLabel(email)}
              </button>
            ) : (
              authorLabel(email)
            )}
          </Fragment>
        ))}
      </span>
    </div>
  );
}

/**
 * The name, with the completion toggle for owners or its status for everyone
 * else. Shared with the neighbours' previews, so a swipe's preview lines up
 * with what takes over.
 */
function TitleRow({ activity }: { activity: Activity }) {
  const { completed, toggle } = useCompleted(activity);
  const { isOwner } = useOwner();
  return (
    <div className="flex flex-wrap items-start justify-between gap-sm">
      <h2 className="font-display text-headline-lg text-primary">
        {activity.name}
      </h2>
      {isOwner ? (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={completed}
          className={`inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps transition-colors ${
            completed
              ? 'bg-primary-fixed text-primary hover:bg-primary-fixed-dim'
              : 'bg-surface-variant text-on-surface-variant hover:bg-surface-container-high'
          }`}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
            {completed ? 'check_circle' : 'radio_button_unchecked'}
          </span>
          {completed
            ? `COMPLETED${activity.completedDate ? ` · ${activity.completedDate}` : ''}`
            : 'MARK AS COMPLETED'}
        </button>
      ) : (
        // Non-owners can't toggle completion (owner-gated mutation), but
        // the completion *status* is a read worth keeping — render it as a
        // static badge when the activity is completed, nothing otherwise.
        completed && (
          <span className="inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps bg-primary-fixed text-primary">
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              check_circle
            </span>
            {`COMPLETED${activity.completedDate ? ` · ${activity.completedDate}` : ''}`}
          </span>
        )
      )}
    </div>
  );
}

/**
 * The facts under the title and the description: shared by the detail and the
 * previews of its neighbours, so a swipe's preview matches what takes over.
 */
function Facts({
  activity,
  onShowContributor,
}: {
  activity: Activity;
  onShowContributor?: (email: string) => void;
}) {
  const origin = useDistanceOrigin();
  const distance = useDistanceTo()(activity);
  const directionsHref = directionsUrl(activity.location.coords, isApplePlatform());
  return (
    <>
      <div className="flex flex-wrap gap-sm md:gap-md text-on-surface-variant">
        <Stat icon="location_on" label={`${formatMiles(distance, true)} mi from ${origin.label}`} />
        {/* A read: open to every visitor, not owner-gated (#87). */}
        {directionsHref && (
          <a
            href={directionsHref}
            target="_blank"
            rel="noopener noreferrer"
            // 44px to tap, but the -10px margins keep it to the 24px of
            // the facts beside it, so the rows below stay evenly spaced.
            className="inline-flex items-center gap-xs min-h-11 -my-2.5 text-primary-container hover:underline font-medium"
          >
            <span className="material-symbols-outlined text-icon-md">
              directions
            </span>
            Get directions
          </a>
        )}
        <Stat
          icon="schedule"
          label={activity.durationDetail ?? activity.duration}
        />
        {activity.difficulty && (
          <Stat icon="trending_up" label={activity.difficulty} capitalize />
        )}
        {activity.parkType && activity.parkType !== 'none' && (
          <Stat
            icon="forest"
            label={`${activity.parkType} park`}
            capitalize
          />
        )}
        <Stat icon="place" label={activity.location.city} />
        {activity.dogFriendly && <Stat icon="pets" label="Dog friendly" />}
        {activity.costTier && (
          <Stat icon="confirmation_number" label={costStat(activity.costTier)} />
        )}
        {/* Signed-in only: the server sends no contributors otherwise (#9). */}
        {activity.contributors && activity.contributors.length > 0 && (
          <Contributors
            emails={activity.contributors}
            onShow={onShowContributor}
          />
        )}
      </div>

      <p className="font-body-lg text-body-lg text-on-surface-variant">
        {activity.longDescription ?? activity.shortDescription}
      </p>
    </>
  );
}

/**
 * A neighbour in the list, beside the panel while it's swiped sideways: the
 * top of its own detail (cover, list position, title, facts, description),
 * drawn the same way, so the real one takes over in place when the step
 * lands. Hidden until a swipe moves the track; its cover loads anyway, ready
 * for the step.
 */
function Peek({
  activity,
  side,
  place,
  total,
}: {
  activity: Activity;
  side: 'prev' | 'next';
  /** Its 1-based position in the list. */
  place: number;
  total: number;
}) {
  return (
    <div
      aria-hidden="true"
      inert
      data-testid={`peek-${side}`}
      className={`invisible group-data-[swiping=true]/track:visible absolute inset-y-0 w-full overflow-hidden bg-surface-container-lowest md:rounded-xl shadow-2xl ${
        side === 'next' ? 'left-[calc(100%+16px)]' : 'right-[calc(100%+16px)]'
      }`}
    >
      <div className="relative aspect-video bg-surface-variant">
        <CoverImage
          alt=""
          category={activity.category}
          src={activity.coverImage}
          className="w-full h-full object-cover"
          glyphSize={64}
          sizes={DETAIL_SIZES}
        />
        <span className="md:hidden absolute top-2 left-1/2 -translate-x-1/2 h-1 w-10 rounded-full bg-surface-container-lowest/80 shadow-sm" />
        <div className="absolute top-sm left-sm flex items-center gap-xs bg-surface-container-lowest/90 backdrop-blur-sm rounded-full p-xs">
          <span className={`${STEP_BUTTON} ${place === 1 ? 'opacity-35' : ''}`}>
            <span className="material-symbols-outlined">chevron_left</span>
          </span>
          <span className="font-body-sm text-on-surface-variant tabular-nums px-xs">
            {place} of {total}
          </span>
          <span className={`${STEP_BUTTON} ${place === total ? 'opacity-35' : ''}`}>
            <span className="material-symbols-outlined">chevron_right</span>
          </span>
        </div>
        <span className="absolute top-sm right-sm bg-surface-container-lowest/90 backdrop-blur-sm rounded-full w-11 h-11 flex items-center justify-center">
          <span className="material-symbols-outlined">close</span>
        </span>
      </div>
      {activity.coverCredit && (
        <p className="px-md md:px-lg pt-xs font-body-sm text-on-surface-variant">
          {activity.coverCredit}
        </p>
      )}
      <div className="p-md md:p-lg space-y-md">
        <TitleRow activity={activity} />
        <Facts activity={activity} />
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  capitalize,
}: {
  icon: string;
  label: string;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-center gap-xs">
      <span className="material-symbols-outlined text-icon-md">{icon}</span>
      <span className={`font-body-md ${capitalize ? 'capitalize' : ''}`}>
        {label}
      </span>
    </div>
  );
}
