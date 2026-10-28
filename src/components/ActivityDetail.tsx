import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { Activity } from '../data/types';
import { MAX_PHOTOS_PER_ACTIVITY, useActivityPhotos } from '../lib/userPhotos';
import { useCompleted } from '../lib/userCompleted';
import { deleteUserActivity, useAllActivities } from '../lib/userActivities';
import { useOwner } from '../lib/useOwner';
import { usePersonLabel } from '../lib/people';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useSwipe } from '../lib/swipe';
import { useFocusTrap } from '../lib/focusTrap';
import { nearbyByCategory } from '../lib/nearbyActivities';
import { ActivityReviews } from './ActivityReviews';
import { AddActivity } from './AddActivity';
import { AddToTripDialog } from './AddToTripDialog';
import { ClampedText, PhoneActions, PhoneCover, PhoneHeading, ParkPlaces } from './PlacePhone';
import { NearbyList } from './NearbyList';
import { InlineError } from './InlineError';
import { sourceLabel } from '../lib/sharedPlaces';
import { parkOf, subItemsOf } from '../lib/parks';
import { activityPath } from '../lib/activityRoute';

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

// A button over the phone's photo (#293): back, share.
const OVER_PHOTO =
  'flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-container-lowest/95 text-on-surface shadow-[0_1px_4px_rgba(0,0,0,0.2)]';

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
  // What a phone's page last did for its place: added it to a trip, or
  // copied its link.
  const [note, setNote] = useState<string | null>(null);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setOverride(null);
    setNote(null);
  }
  const activity = override ?? initial;
  const setActivity = setOverride;

  const { completed } = useCompleted(activity);
  const { isOwner, email } = useOwner();
  const [addingToTrip, setAddingToTrip] = useState(false);
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

  function selectNearby(a: Activity) {
    setNote(null);
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
      // collapse both modals in one keystroke. The trip picker is closed
      // by it instead.
      if (e.key !== 'Escape') return;
      if (addingToTrip) setAddingToTrip(false);
      else if (!editing) onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, editing, addingToTrip]);

  // Left and Right step through the list, like its buttons, unless the edit
  // form is up, the key belongs to a field or control, or it's held down
  // (one step per press: a held key would flood the history).
  const onPrev = sequence?.onPrev;
  const onNext = sequence?.onNext;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        editing ||
        addingToTrip ||
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
  }, [editing, addingToTrip, onPrev, onNext]);

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
      enabled: !editing && !addingToTrip,
      reduceMotion,
    },
    trackRef,
  );

  // Tab stays inside the detail (#258), except while the edit form is up:
  // that's drawn beside the detail rather than in it, and Tab must reach it.
  // (The form has no trap of its own, so Tab past its end still leaves it.)
  useFocusTrap(scrollRef, !editing && !addingToTrip);

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

  // The phone's Share: the system's sheet where there is one, else the
  // link copied.
  async function share() {
    const url = new URL(activityPath(activity.id), window.location.origin).href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: activity.name, url });
        return;
      } catch (error) {
        // Dismissed: nothing to say. Anything else (refused, say) falls
        // back to the link, as where there's no sheet.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote('Link copied');
    } catch {
      setNote(`Copy this link: ${url}`);
    }
  }

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

  // The page's taps, which its neighbours' previews take too (inert there),
  // so a preview draws exactly what the page will once it lands.
  const bodyHandlers: BodyHandlers = {
    onTrip: email ? () => setAddingToTrip(true) : undefined,
    onSelect: selectNearby,
    onShowContributor,
  };

  const photosSection = (
    <>
      {/* Owner-only read (#19): the photos are the owners' own, kept in
                private storage, so the whole section is theirs alone. */}
      {isOwner && (completed || showUploads) && (
        <section className="space-y-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-headline-md text-headline-md text-primary">Your Photos</h3>
            {photos.length < MAX_PHOTOS_PER_ACTIVITY && (
              <label
                className={`flex items-center gap-xs rounded-full bg-secondary px-md py-sm font-medium text-on-secondary transition-opacity ${
                  uploading ? 'cursor-wait opacity-60' : 'cursor-pointer hover:opacity-90'
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
            <div className="grid grid-cols-2 gap-sm md:grid-cols-3">
              {photos.map((photo, i) => (
                <div
                  key={photo.id}
                  className="group relative aspect-square overflow-hidden rounded-lg bg-surface-variant"
                >
                  <img
                    src={photo.url}
                    alt={`${activity.name} ${i + 1}`}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => void removePhoto(photo.id)}
                    aria-label="Remove photo"
                    className="absolute top-xs right-xs flex size-11 items-center justify-center rounded-full bg-on-surface/70 text-on-primary opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      delete
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );

  const ownerControls = (
    <>
      {isOwner && (
        <div className="mt-md flex flex-wrap justify-end gap-sm border-t border-outline-variant/40 pt-md">
          <button
            ref={editRef}
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center gap-xs rounded-full px-md py-sm font-label-caps text-label-caps text-on-surface-variant transition-colors hover:bg-surface-variant"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              edit
            </span>
            EDIT ACTIVITY
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            className="-mr-md inline-flex min-h-11 items-center gap-xs rounded-full px-md py-sm font-label-caps text-label-caps text-error transition-colors hover:bg-error-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-inset"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
              delete
            </span>
            DELETE ACTIVITY
          </button>
        </div>
      )}
    </>
  );

  // Its place in the list, and the steps either side (#64).
  const stepper = (where: string) =>
    sequence && (
      <nav
        aria-label={`Adventure ${sequence.index + 1} of ${sequence.total} in this list`}
        className={`${where} flex items-center gap-xs rounded-full bg-surface-container-lowest/90 p-xs backdrop-blur-sm`}
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
        <span className="px-xs font-body-sm text-on-surface-variant tabular-nums">
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
    );

  return (
    <div className="fixed inset-0 z-1000 flex items-end justify-center overflow-hidden p-0 md:items-center md:p-md">
      <button
        ref={scrimRef}
        type="button"
        aria-label="Close activity details"
        onClick={onClose}
        className={`absolute inset-0 cursor-default bg-on-surface/60 backdrop-blur-sm ${animateIn ? SCRIM_IN : ''}`}
      />
      {/* The track a sideways swipe moves: the panel, with its neighbours
          waiting beside it. */}
      <div ref={trackRef} className="group/track relative w-full max-w-144">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={activity.name}
          ref={scrollRef}
          tabIndex={-1}
          className={`relative max-h-[95dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-surface-container-lowest shadow-2xl focus:outline-none md:rounded-xl ${animateIn ? PANEL_IN : cameBy && !sequence?.swiped ? STEP_IN[cameBy] : ''}`}
        >
          <>
            <PhoneCover activity={activity}>
              <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-xs p-sm">
                <button type="button" onClick={onClose} aria-label="Back" className={OVER_PHOTO}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    arrow_back
                  </span>
                </button>
                {stepper('')}
                <button
                  type="button"
                  onClick={() => void share()}
                  aria-label="Share"
                  className={OVER_PHOTO}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    ios_share
                  </span>
                </button>
              </div>
            </PhoneCover>
            <PlaceBody
              activity={activity}
              {...bodyHandlers}
              note={
                note && (
                  <p role="status" className="text-body-sm text-on-surface-variant">
                    {note}
                  </p>
                )
              }
              extras={
                <>
                  {photosSection}
                  {ownerControls}
                </>
              }
            />
          </>
        </div>
        {sequence?.prevActivity && (
          <Peek
            activity={sequence.prevActivity}
            side="prev"
            place={sequence.index}
            total={sequence.total}
            handlers={bodyHandlers}
          />
        )}
        {sequence?.nextActivity && (
          <Peek
            activity={sequence.nextActivity}
            side="next"
            place={sequence.index + 2}
            total={sequence.total}
            handlers={bodyHandlers}
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
      {/* Over the detail, inside its layer (#112): a signed-in account's. */}
      {addingToTrip && (
        <AddToTripDialog
          activityIds={[activity.id]}
          onClose={() => setAddingToTrip(false)}
          onAdded={(trip, added) =>
            setNote(added > 0 ? `Added to ${trip.title}` : `Already on ${trip.title}`)
          }
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
  const authorLabel = usePersonLabel();
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

type BodyHandlers = {
  /** Add it to a trip; omitted for a signed-out visitor. */
  onTrip?: () => void;
  /** A park, hike or nearby place tapped. */
  onSelect: (activity: Activity) => void;
  onShowContributor?: (email: string) => void;
};

/**
 * The page under a place's photo: its name and facts, actions, description
 * and the rest, down to Nearby. The detail draws it for its activity, with
 * the page's own `note` (after the actions) and `extras` (the owners'
 * photos and controls, after Nearby); a preview beside it draws it for a
 * neighbour.
 */
function PlaceBody({
  activity,
  onTrip,
  onSelect,
  onShowContributor,
  note,
  extras,
}: BodyHandlers & { activity: Activity; note?: ReactNode; extras?: ReactNode }) {
  const allActivities = useAllActivities();
  const { completed } = useCompleted(activity);
  // Its park, the park's other hikes and stops, or its own (#269). They
  // aren't offered again under Nearby.
  const park = useMemo(() => parkOf(activity, allActivities), [allActivities, activity]);
  const subItems = useMemo(() => subItemsOf(activity, allActivities), [allActivities, activity]);
  const siblings = useMemo(
    () => (park ? subItemsOf(park, allActivities).filter((a) => a.id !== activity.id) : []),
    [allActivities, activity, park],
  );
  const nearbyGroups = useMemo(() => {
    const listed = new Set([park, ...subItems, ...siblings].map((a) => a?.id));
    return nearbyByCategory(
      activity,
      allActivities.filter((a) => !listed.has(a.id)),
    );
  }, [allActivities, activity, park, siblings, subItems]);

  // The parts both layouts show, the phone's in its own order.
  const restaurantInfo = (
    <>
      {(activity.cuisine ||
        activity.priceRange ||
        activity.hours ||
        activity.reservationUrl ||
        activity.menuUrl ||
        (activity.dietary && activity.dietary.length > 0)) && (
        <div className="space-y-sm rounded-lg bg-surface-container-low p-md">
          <div className="font-label-caps text-label-caps text-on-surface-variant">
            RESTAURANT INFO
          </div>
          <div className="flex flex-wrap gap-md text-on-surface-variant">
            {activity.cuisine && <Stat icon="restaurant_menu" label={activity.cuisine} />}
            {activity.priceRange && <Stat icon="payments" label={activity.priceRange} />}
            {activity.hours && <Stat icon="schedule" label={activity.hours} />}
          </div>
          {activity.dietary && activity.dietary.length > 0 && (
            <div className="flex flex-wrap gap-xs">
              {activity.dietary.map((d) => (
                <span
                  key={d}
                  className="rounded-full bg-surface-variant px-sm py-xs font-body-sm text-on-surface-variant capitalize"
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
                  className="inline-flex items-center gap-xs font-medium text-primary-container hover:underline"
                >
                  Reserve
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    open_in_new
                  </span>
                </a>
              )}
              {activity.menuUrl && (
                <a
                  href={activity.menuUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-xs font-medium text-primary-container hover:underline"
                >
                  Menu / website
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    open_in_new
                  </span>
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );

  const notesBlock = (
    <>
      {activity.notes && (
        <div className="rounded-lg bg-surface-container-low p-md">
          <div className="mb-xs font-label-caps text-label-caps text-on-surface-variant">NOTES</div>
          <p className="font-body-md text-body-md text-on-surface">{activity.notes}</p>
        </div>
      )}
    </>
  );

  const sourceLink = (
    <>
      {/* Where it was found (#6): the reel it was added from. A read,
                open to every visitor. */}
      {activity.sourceUrl && (
        <a
          href={activity.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-xs font-medium text-primary-container hover:underline"
        >
          {sourceLabel(activity.sourceUrl)}
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            open_in_new
          </span>
        </a>
      )}
    </>
  );

  const reviewsBlock = (
    <>
      {/* Owner reviews (#184) — what each of us thought after doing it.
                Reviews are about completed activities, so the section only
                appears once this one is marked done. */}
      {completed && (
        // Keyed on the activity: picking a nearby activity swaps `activity`
        // without unmounting this dialog, and an open review draft must not
        // follow along and be saved onto a different activity.
        <ActivityReviews key={activity.id} activityId={activity.id} />
      )}
    </>
  );

  return (
    // The page rises over the photo's foot.
    <div className="relative -mt-5 space-y-md rounded-t-[22px] bg-surface-container-lowest px-md pt-md pb-[calc(var(--spacing-md)+env(safe-area-inset-bottom))]">
      <PhoneHeading activity={activity} park={park} onOpenPark={onSelect} />
      <PhoneActions activity={activity} onTrip={onTrip} />
      {note}
      <ClampedText
        // Shut again for the next place, which may swap in here.
        key={activity.id}
        text={activity.longDescription ?? activity.shortDescription}
      />
      {(activity.allTrailsUrl ||
        activity.hikeDistanceMiles != null ||
        activity.hikeElevationFeet != null) && <TrailRow activity={activity} />}
      {restaurantInfo}
      {notesBlock}
      {sourceLink}
      {activity.contributors && activity.contributors.length > 0 && (
        <div className="text-on-surface-variant">
          <Contributors emails={activity.contributors} onShow={onShowContributor} />
        </div>
      )}
      {reviewsBlock}
      {subItems.length > 0 && (
        <ParkPlaces heading="Hikes & stops here" activities={subItems} onSelect={onSelect} />
      )}
      {park && siblings.length > 0 && (
        <ParkPlaces heading={`Also in ${park.name}`} activities={siblings} onSelect={onSelect} />
      )}
      {nearbyGroups.length > 0 && (
        <NearbyList groups={nearbyGroups} city={activity.location.city} onSelect={onSelect} />
      )}
      {extras}
      {activity.coverCredit && (
        // Commons covers are CC-licensed: credit author + license (#36).
        <p className="text-[12px] text-on-surface-variant">{activity.coverCredit}</p>
      )}
    </div>
  );
}

/**
 * A neighbour in the list, beside the panel while it's swiped sideways: its
 * own page (photo, list position and body), drawn by the same PlaceBody, so
 * the real one takes over in place when the step lands, with nothing left to
 * fill in. Hidden until a swipe moves the track; its cover loads anyway, ready
 * for the step.
 */
function Peek({
  activity,
  side,
  place,
  total,
  handlers,
}: {
  activity: Activity;
  side: 'prev' | 'next';
  /** Its 1-based position in the list. */
  place: number;
  total: number;
  handlers: BodyHandlers;
}) {
  const steps = (where: string) => (
    <div
      className={`${where} flex items-center gap-xs rounded-full bg-surface-container-lowest/90 p-xs backdrop-blur-sm`}
    >
      <span className={`${STEP_BUTTON} ${place === 1 ? 'opacity-35' : ''}`}>
        <span className="material-symbols-outlined">chevron_left</span>
      </span>
      <span className="px-xs font-body-sm text-on-surface-variant tabular-nums">
        {place} of {total}
      </span>
      <span className={`${STEP_BUTTON} ${place === total ? 'opacity-35' : ''}`}>
        <span className="material-symbols-outlined">chevron_right</span>
      </span>
    </div>
  );
  return (
    <div
      aria-hidden="true"
      inert
      data-testid={`peek-${side}`}
      className={`invisible absolute inset-y-0 w-full overflow-hidden bg-surface-container-lowest shadow-2xl group-data-[swiping=true]/track:visible md:rounded-xl ${
        side === 'next' ? 'left-[calc(100%+16px)]' : 'right-[calc(100%+16px)]'
      }`}
    >
      <>
        <PhoneCover activity={activity}>
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-xs p-sm">
            <span className={OVER_PHOTO}>
              <span className="material-symbols-outlined">arrow_back</span>
            </span>
            {steps('')}
            <span className={OVER_PHOTO}>
              <span className="material-symbols-outlined">ios_share</span>
            </span>
          </div>
        </PhoneCover>
        <PlaceBody activity={activity} {...handlers} />
      </>
    </div>
  );
}

/** A phone's row for the trail (#6): its numbers, and its AllTrails page when it has one. */
function TrailRow({ activity }: { activity: Activity }) {
  const stats = [
    activity.hikeDistanceMiles != null && `${activity.hikeDistanceMiles} mi`,
    activity.hikeElevationFeet != null && `${activity.hikeElevationFeet.toLocaleString()} ft`,
  ]
    .filter(Boolean)
    .join(', ');
  const row =
    'flex min-h-12 items-center justify-between gap-sm border-y border-outline-variant/40 text-[15px] text-on-surface';
  const words = (
    <span>
      {activity.allTrailsUrl ? 'On AllTrails' : 'Trail'}
      {stats && <span className="text-on-surface-variant"> · {stats}</span>}
    </span>
  );
  if (!activity.allTrailsUrl) return <p className={row}>{words}</p>;
  return (
    <a href={activity.allTrailsUrl} target="_blank" rel="noopener noreferrer" className={row}>
      {words}
      <span
        className="material-symbols-outlined size-4.5 shrink-0 overflow-hidden text-[18px] text-on-surface-variant"
        aria-hidden="true"
      >
        open_in_new
      </span>
    </a>
  );
}

function Stat({ icon, label, capitalize }: { icon: string; label: string; capitalize?: boolean }) {
  return (
    <div className="flex items-center gap-xs">
      <span className="material-symbols-outlined text-icon-md">{icon}</span>
      <span className={`font-body-md ${capitalize ? 'capitalize' : ''}`}>{label}</span>
    </div>
  );
}
