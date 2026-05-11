import { useEffect, useMemo, useRef, useState } from 'react';

import type { Activity } from '../data/types';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import { useUserPhotos } from '../lib/userPhotos';
import { useCompleted } from '../lib/userCompleted';
import { useAllActivities } from '../lib/userActivities';
import { useOwner } from '../lib/useOwner';

interface Props {
  activity: Activity;
  onClose: () => void;
  showUploads?: boolean;
}

const NEARBY_RADIUS_MILES = 15;
const MAX_NEARBY = 6;

export function ActivityDetail({ activity: initial, onClose, showUploads }: Props) {
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
  const { photos, addPhotos, removePhoto } = useUserPhotos(activity.id);
  const { completed, toggle } = useCompleted(activity);
  const { isOwner } = useOwner();
  const miles = distanceMiles(HOME_LOCATION.coords, activity.location.coords);

  const nearby = useMemo(() => {
    return allActivities
      .filter((a) => a.id !== activity.id)
      .map((a) => ({
        a,
        miles: distanceMiles(activity.location.coords, a.location.coords),
      }))
      .filter((x) => x.miles <= NEARBY_RADIUS_MILES)
      .sort((x, y) => x.miles - y.miles)
      .slice(0, MAX_NEARBY);
  }, [allActivities, activity]);

  function selectNearby(a: Activity) {
    setActivity(a);
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleFiles = (files: FileList | null) => {
    if (files && files.length) void addPhotos(files);
  };

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
        className="relative bg-surface-container-lowest w-full max-w-3xl max-h-[95vh] overflow-y-auto md:rounded-xl shadow-2xl"
      >
        <div className="relative aspect-video bg-surface-variant">
          <img
            alt={activity.name}
            src={activity.coverImage}
            className="w-full h-full object-cover"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-sm right-sm bg-surface-container-lowest/90 backdrop-blur-sm rounded-full w-10 h-10 flex items-center justify-center hover:bg-surface-container-lowest transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="p-md md:p-lg space-y-md">
          <div className="flex flex-wrap items-start justify-between gap-sm">
            <h2 className="font-display text-headline-lg text-primary">
              {activity.name}
            </h2>
            <button
              type="button"
              onClick={toggle}
              disabled={!isOwner}
              title={isOwner ? undefined : 'Sign in to edit'}
              aria-pressed={completed}
              className={`inline-flex items-center gap-xs px-sm py-xs rounded-full font-label-caps text-label-caps transition-colors disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-surface-variant ${
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
          </div>

          <div className="flex flex-wrap gap-md text-on-surface-variant">
            <Stat icon="location_on" label={`${miles.toFixed(1)} mi from ${HOME_LOCATION.label}`} />
            <Stat
              icon="schedule"
              label={activity.durationDetail ?? activity.duration}
            />
            {activity.difficulty && (
              <Stat icon="trending_up" label={activity.difficulty} capitalize />
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

          {nearby.length > 0 && (
            <section className="space-y-sm">
              <h3 className="font-headline-md text-headline-md text-primary">
                Nearby — do at the same time
              </h3>
              <p className="font-body-sm text-on-surface-variant">
                Other activities within {NEARBY_RADIUS_MILES} miles of{' '}
                {activity.location.city}.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
                {nearby.map(({ a, miles: m }) => (
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
          )}

          {(completed || showUploads) && (
            <section className="space-y-sm">
              <div className="flex items-center justify-between">
                <h3 className="font-headline-md text-headline-md text-primary">
                  Your Photos
                </h3>
                <label
                  title={isOwner ? undefined : 'Sign in to edit'}
                  className={`bg-secondary text-on-secondary px-md py-sm rounded-full font-medium transition-opacity flex items-center gap-xs ${
                    isOwner
                      ? 'cursor-pointer hover:opacity-90'
                      : 'opacity-60 cursor-not-allowed'
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    add_a_photo
                  </span>
                  Add photos
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={!isOwner}
                    className="hidden"
                    onChange={(e) => {
                      handleFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {photos.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-outline-variant p-lg text-center text-on-surface-variant">
                  No photos yet — upload some from this trip.
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
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        aria-label="Remove photo"
                        className="absolute top-xs right-xs bg-on-surface/70 text-on-primary rounded-full w-8 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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
        </div>
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
      <span className="material-symbols-outlined text-body-md">{icon}</span>
      <span className={`font-body-md ${capitalize ? 'capitalize' : ''}`}>
        {label}
      </span>
    </div>
  );
}
