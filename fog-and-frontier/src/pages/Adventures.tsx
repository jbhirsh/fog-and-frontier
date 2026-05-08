import { useMemo, useState } from 'react';
import { ActivityCard } from '../components/ActivityCard';
import { ActivityDetail } from '../components/ActivityDetail';
import type { Activity } from '../data/types';
import { HOME_LOCATION } from '../data/home';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';
import { useAllActivities } from '../lib/userActivities';

export function Adventures() {
  const [selected, setSelected] = useState<Activity | null>(null);
  const overrides = useOverrides();
  const all = useAllActivities();

  const completed = useMemo(
    () =>
      all
        .filter((a) => isEffectivelyCompleted(a, overrides))
        .sort((a, b) =>
          (b.completedDate ?? '').localeCompare(a.completedDate ?? ''),
        ),
    [overrides, all],
  );

  return (
    <>
      <section className="px-margin py-xl lg:py-24 bg-surface-container-low border-b border-outline-variant/20">
        <div className="max-w-4xl mx-auto text-center space-y-md">
          <h1 className="font-display text-display text-primary">
            Our Adventures
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl mx-auto">
            {completed.length} trip{completed.length === 1 ? '' : 's'} from{' '}
            {HOME_LOCATION.label}. Click any card to add your own photos.
          </p>
        </div>
      </section>

      <section className="px-margin py-xl max-w-screen-2xl mx-auto">
        {completed.length === 0 ? (
          <div className="text-center py-xl text-on-surface-variant">
            <p className="font-body-lg">No completed adventures yet.</p>
            <p className="font-body-md mt-sm">
              Mark an activity as <code className="bg-surface-variant px-xs py-xs rounded">completed: true</code>{' '}
              in <code className="bg-surface-variant px-xs py-xs rounded">src/data/activities.ts</code>{' '}
              to see it here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter">
            {completed.map((a) => (
              <ActivityCard
                key={a.id}
                activity={a}
                showUserPhotoCount
                onClick={() => setSelected(a)}
              />
            ))}
          </div>
        )}
      </section>

      {selected && (
        <ActivityDetail
          activity={selected}
          onClose={() => setSelected(null)}
          showUploads
        />
      )}
    </>
  );
}
