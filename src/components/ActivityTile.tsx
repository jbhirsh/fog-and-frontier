import type { Activity } from '../data/types';
import { CdnImage } from './CdnImage';

interface Props {
  activity: Activity;
  /** What to say under its name, a line each. */
  lines: string[];
  onSelect: (activity: Activity) => void;
}

/** Another activity, as the detail page lists it (nearby, or in the same park): opens it. */
export function ActivityTile({ activity, lines, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(activity)}
      className="flex items-stretch gap-sm overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container-low text-left transition-colors hover:bg-surface-container"
    >
      <div className="w-24 shrink-0 bg-surface-variant">
        <CdnImage
          src={activity.coverImage}
          alt={activity.name}
          sizes="96px"
          className="size-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1 py-xs pr-sm">
        <div className="truncate font-body-md font-bold text-on-surface">{activity.name}</div>
        {lines.map((line) => (
          <div key={line} className="truncate font-body-sm text-on-surface-variant">
            {line}
          </div>
        ))}
      </div>
    </button>
  );
}
