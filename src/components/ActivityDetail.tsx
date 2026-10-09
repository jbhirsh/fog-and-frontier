import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { Activity } from '../data/types';
import { useDistanceOrigin } from '../lib/distanceOrigin';
import { formatMiles, useDistanceTo } from '../lib/drivingMiles';
import { useUserPhotos } from '../lib/userPhotos';
import { useCompleted } from '../lib/userCompleted';
import { deleteUserActivity, useAllActivities } from '../lib/userActivities';
import { useOwner } from '../lib/useOwner';
import { directionsUrl, isApplePlatform } from '../lib/directions';
import { CATEGORY_ICON } from '../lib/mapPins';
import {
  NEARBY_GROUP_HEADING,
  NEARBY_RADIUS_MILES,
  nearbyByCategory,
} from '../lib/nearbyActivities';
import { ActivityReviews } from './ActivityReviews';
import { AddActivity } from './AddActivity';
import { CoverImage } from './CoverImage';
import { InlineError } from './InlineError';

interface Props {
  activity: Activity;
  onClose: () => void;
  showUploads?: boolean;
  /** Opens a nearby activity; without it, the detail swaps in place. */
  onSelectNearby?: (activity: Activity) => void;
}

export function ActivityDetail({
  activity: initial,
  onClose,
  showUploads,
  onSelectNearby,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [override, setOverride] = useState<Activity | null>(null);
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setOverride(null);
  }
  const activity = override ?? initial;
  const setActivity = setOverride;

  const allActivities = useAllActivities();
  const { photos, addPhotos, removePhoto, saveError, clearSaveError } =
    useUserPhotos(activity.id);
  const { completed, toggle } = useCompleted(activity);
  const { isOwner } = useOwner();
  const origin = useDistanceOrigin();
  const distance = useDistanceTo()(activity);
  const directionsHref = directionsUrl(
    activity.location.coords,
    isApplePlatform(),
  );
  const [editing, setEditing] = useState(false);

  const nearbyGroups = useMemo(
    () => nearbyByCategory(activity, allActivities),
    [allActivities, activity],
  );
  const nearbyIdPrefix = useId();

  function selectNearby(a: Activity) {
    if (onSelectNearby) onSelectNearby(a);
    else setActivity(a);
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
    <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center p-0 md:p-md">
      <button
        type="button"
        aria-label="Close activity details"
        onClick={onClose}
        className="absolute inset-0 bg-on-surface/60 backdrop-blur-sm cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={activity.name}
        ref={scrollRef}
        className="relative bg-surface-container-lowest w-full max-w-3xl max-h-[95dvh] overflow-y-auto md:rounded-xl shadow-2xl"
      >
        <div className="relative aspect-video bg-surface-variant">
          <CoverImage
            alt={activity.name}
            category={activity.category}
            src={activity.coverImage}
            className="w-full h-full object-cover"
            glyphSize={64}
          />
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

          <div className="flex flex-wrap gap-sm md:gap-md text-on-surface-variant">
            <Stat icon="location_on" label={`${formatMiles(distance, true)} mi from ${origin.label}`} />
            {/* A read: open to every visitor, not owner-gated (#87). */}
            {directionsHref && (
              <a
                href={directionsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-xs min-h-11 text-primary-container hover:underline font-medium"
              >
                <span className="material-symbols-outlined text-body-md">
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
          </div>

          <p className="font-body-lg text-body-lg text-on-surface-variant">
            {activity.longDescription ?? activity.shortDescription}
          </p>

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
                        style={{ fontSize: 16 }}
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
                            <img
                              src={a.coverImage}
                              alt={a.name}
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

          {(completed || showUploads) && (
            <section className="space-y-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-headline-md text-headline-md text-primary">
                  Your Photos
                </h3>
                {isOwner && (
                  <label className="bg-secondary text-on-secondary px-md py-sm rounded-full font-medium transition-opacity flex items-center gap-xs cursor-pointer hover:opacity-90">
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                      add_a_photo
                    </span>
                    Add photos
                    <input
                      type="file"
                      accept="image/*"
                      multiple
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
              {photos.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-outline-variant p-lg text-center text-on-surface-variant">
                  {/* Only owners can upload, so only they get the nudge (#206). */}
                  {isOwner
                    ? 'No photos yet — upload some from this trip.'
                    : 'No photos yet.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-sm">
                  {photos.map((src, i) => (
                    <div
                      key={i}
                      className="relative aspect-square rounded-lg overflow-hidden bg-surface-variant group"
                    >
                      <img
                        src={src}
                        alt={`${activity.name} ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      {/* Owner-gated write: hidden from non-owners (#67, #206). */}
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
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
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {isOwner && (
            <div className="pt-md mt-md border-t border-outline-variant/40 flex flex-wrap justify-end gap-sm">
              <button
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
                className="inline-flex items-center gap-xs px-md py-sm min-h-11 rounded-full font-label-caps text-label-caps text-error hover:bg-error-container transition-colors"
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
      <span className="material-symbols-outlined text-body-md">{icon}</span>
      <span className={`font-body-md ${capitalize ? 'capitalize' : ''}`}>
        {label}
      </span>
    </div>
  );
}
