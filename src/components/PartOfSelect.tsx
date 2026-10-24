import type { Activity } from '../data/types';
import { useAllActivities } from '../lib/userActivities';
import { parkChoices, subItemsOf } from '../lib/parks';

interface Props {
  activity: Activity;
  className: string;
  onChange: (parentId: string | undefined) => void;
}

/**
 * Which park an activity is part of (#269), for owners in the add and edit
 * form. One with hikes and stops of its own can't be part of another, so it
 * says so instead.
 */
export function PartOfSelect({ activity, className, onChange }: Props) {
  const all = useAllActivities();
  if (subItemsOf(activity, all).length > 0) {
    return (
      <p className="font-body-sm text-on-surface-variant">
        It has hikes and stops of its own, so it can’t be part of another.
      </p>
    );
  }
  return (
    <select
      value={activity.parentId ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={className}
    >
      <option value="">— Not part of another —</option>
      {parkChoices(activity, all).map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}
