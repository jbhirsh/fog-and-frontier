import type { Activity } from '../data/types';
import { categoryOptionLabel } from '../lib/activityLabels';
import { CdnImage } from './CdnImage';
import { ActivityTile } from './ActivityTile';

interface PartOfProps {
  park: Activity;
  onSelect: (activity: Activity) => void;
}

/** "Part of <park>" under a hike's title (#269): opens the park. */
export function PartOfPark({ park, onSelect }: PartOfProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(park)}
      className="inline-flex min-h-10 max-w-full items-center gap-sm rounded-full bg-primary-fixed py-xs pr-sm pl-xs text-body-sm font-semibold text-on-primary-fixed-variant hover:bg-primary-fixed-dim"
    >
      <span className="size-7 shrink-0 overflow-hidden rounded-full bg-surface-variant">
        <CdnImage src={park.coverImage} alt="" sizes="28px" className="size-full object-cover" />
      </span>
      <span className="truncate">Part of {park.name}</span>
      <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
        chevron_right
      </span>
    </button>
  );
}

interface ListProps {
  heading: string;
  activities: Activity[];
  onSelect: (activity: Activity) => void;
}

/** A park's hikes and stops on its detail page, or a hike's siblings on its own (#269). */
export function ParkActivities({ heading, activities, onSelect }: ListProps) {
  return (
    <section className="space-y-sm">
      <h3 className="font-headline-md text-headline-md text-primary">{heading}</h3>
      <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
        {activities.map((a) => (
          <ActivityTile
            key={a.id}
            activity={a}
            lines={[categoryOptionLabel(a.category), a.duration]}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
