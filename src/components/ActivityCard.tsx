import type { ReactNode } from 'react';
import type { Activity } from '../data/types';
import { HOME_LOCATION, distanceMiles } from '../data/home';
import { useUserPhotos } from '../lib/userPhotos';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';

const categoryLabels: Record<Activity['category'], { label: string; icon: string }> = {
  hiking: { label: 'HIKING', icon: 'directions_walk' },
  cycling: { label: 'CYCLING', icon: 'pedal_bike' },
  water: { label: 'WATER', icon: 'water' },
  food: { label: 'FOOD', icon: 'restaurant' },
  culture: { label: 'CULTURE', icon: 'museum' },
  scenic: { label: 'SCENIC', icon: 'landscape' },
  climbing: { label: 'CLIMBING', icon: 'terrain' },
  camping: { label: 'CAMPING', icon: 'forest' },
  other: { label: 'OTHER', icon: 'explore' },
};

const difficultyIcon: Record<NonNullable<Activity['difficulty']>, string> = {
  easy: 'trending_up',
  moderate: 'directions_walk',
  advanced: 'signal_cellular_alt',
};

interface Props {
  activity: Activity;
  onClick?: () => void;
  showUserPhotoCount?: boolean;
  selected?: boolean;
  selectionMode?: boolean;
  /**
   * Optional overlay affordance (e.g. an add-to-trip control) rendered in the
   * top-right corner. It sits as a sibling of the card button — never nested
   * inside it — so it stays a valid interactive control and any popover it
   * opens can overflow the card. The card stacks the COMPLETED badge above it
   * so the two never collide.
   */
  actionSlot?: ReactNode;
}

export function ActivityCard({
  activity,
  onClick,
  showUserPhotoCount,
  selected,
  selectionMode,
  actionSlot,
}: Props) {
  const cat = categoryLabels[activity.category];
  const miles = distanceMiles(HOME_LOCATION.coords, activity.location.coords);
  const { photos } = useUserPhotos(activity.id);
  const overrides = useOverrides();
  const completed = isEffectivelyCompleted(activity, overrides);
  const cover =
    showUserPhotoCount && photos.length > 0 ? photos[0] : activity.coverImage;

  const distanceLabel =
    miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selectionMode ? !!selected : undefined}
        className={`w-full text-left group bg-surface-container-lowest rounded-xl border overflow-hidden hover:shadow-lg hover:shadow-primary-container/5 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container ${
          selected
            ? 'border-primary ring-2 ring-primary'
            : 'border-outline-variant/20'
        }`}
      >
        <div className="relative aspect-video bg-surface-variant">
          <img
            alt={activity.name}
            className="w-full h-full object-cover"
            src={cover}
            loading="lazy"
          />
          {selectionMode && (
            <div
              className={`absolute bottom-sm left-sm w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                selected
                  ? 'bg-primary border-primary text-on-primary'
                  : 'bg-surface-container-lowest/90 border-outline-variant/60 text-on-surface-variant'
              }`}
              aria-hidden="true"
            >
              {selected && (
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20 }}
                >
                  check
                </span>
              )}
            </div>
          )}
          {activity.dogFriendly && (
            <div className="absolute top-sm left-sm bg-secondary-fixed text-secondary px-sm py-xs rounded-full flex items-center gap-xs">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                pets
              </span>
              <span className="font-label-caps text-label-caps">DOGS OK</span>
            </div>
          )}
          {showUserPhotoCount && photos.length > 0 && (
            <div className="absolute bottom-sm right-sm bg-surface-container-lowest/90 backdrop-blur-sm text-primary px-sm py-xs rounded-full flex items-center gap-xs">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                photo_library
              </span>
              <span className="font-label-caps text-label-caps">
                {photos.length}
              </span>
            </div>
          )}
        </div>
        <div className="p-md space-y-sm">
          <div className="flex justify-between items-start gap-sm">
            <h3 className="font-headline-md text-headline-md text-on-surface group-hover:text-primary-container transition-colors">
              {activity.name}
            </h3>
            <span className="shrink-0 flex items-center gap-xs font-label-caps text-label-caps text-on-surface-variant bg-surface-variant px-sm py-xs rounded-full">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                {cat.icon}
              </span>
              {cat.label}
            </span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant line-clamp-2">
            {activity.shortDescription}
          </p>
          <div className="flex items-center gap-md text-outline pt-sm border-t border-outline-variant/20 mt-sm flex-wrap">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-body-md">
                schedule
              </span>
              <span className="font-body-md text-sm">{activity.duration}</span>
            </div>
            {activity.difficulty && (
              <div className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-body-md">
                  {difficultyIcon[activity.difficulty]}
                </span>
                <span className="font-body-md text-sm capitalize">
                  {activity.difficulty}
                </span>
              </div>
            )}
            {activity.allTrailsRating != null && (
              <div className="flex items-center gap-xs">
                <span
                  className="material-symbols-outlined text-body-md text-secondary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  star
                </span>
                <span className="font-body-md text-sm">
                  {activity.allTrailsRating.toFixed(1)}
                </span>
              </div>
            )}
            <div className="flex items-center gap-xs ml-auto">
              <span className="material-symbols-outlined text-body-md">
                location_on
              </span>
              <span className="font-body-md text-sm">{distanceLabel}</span>
            </div>
          </div>
        </div>
      </button>
      {/*
        Top-right overlay stack. The COMPLETED badge and the optional action
        affordance (e.g. add-to-trip) share this corner but stack vertically,
        so they never overlap. Rendered as a sibling of the card button — not
        nested inside it — so the action stays interactive and its popover can
        overflow the card. Other badges keep their own corners: dog-friendly
        (top-left), photo-count (bottom-right), selection check (bottom-left).
      */}
      {(completed || actionSlot) && (
        <div className="absolute top-sm right-sm z-10 flex flex-col items-end gap-xs">
          {completed && (
            <div className="bg-primary-fixed text-primary px-sm py-xs rounded-full flex items-center gap-xs">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                check_circle
              </span>
              <span className="font-label-caps text-label-caps">COMPLETED</span>
            </div>
          )}
          {actionSlot}
        </div>
      )}
    </div>
  );
}
