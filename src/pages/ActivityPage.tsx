import { useEffect, useRef, useState } from 'react';
import { NavigationType, useLocation, useNavigationType, useParams } from 'react-router-dom';
import { ActivityDetail } from '../components/ActivityDetail';
import {
  listPosition,
  type ListPosition,
  readActivityState,
  useCloseActivity,
  useOpenActivity,
  useShowContributor,
} from '../lib/activityRoute';
import { useUserActivities } from '../lib/userActivities';
import type { Activity } from '../data/types';

/**
 * An activity's permalink (#86): the detail for /activity/:id, drawn over the
 * page it was opened from (or the catalog, for a link opened fresh). The
 * catalog is already loaded on the way here, so the id is looked up in it;
 * until the first load lands nothing shows, and an id it doesn't have gets a
 * "not found" dialog rather than a silent bounce home. If the catalog failed
 * to load, it says that instead: the link may be fine.
 */
export function ActivityPage() {
  const { id } = useParams();
  const { activities, loading, error } = useUserActivities();
  const open = useOpenActivity();
  const close = useCloseActivity();
  const showContributor = useShowContributor();
  // The page stays mounted while Back, Forward or a nearby pick moves between
  // activities, so only the one it opened with animates in (#63), and only
  // until it moves on: coming back to it doesn't replay the open.
  const [openedWith, setOpenedWith] = useState(id);
  if (openedWith !== undefined && id !== openedWith) setOpenedWith(undefined);

  // Stepping through the list it was opened from (#64): each step opens the
  // neighbour one deeper, so Back retraces them and close leaves them all.
  // An id no longer in the catalog (deleted since the list was shown) is
  // stepped over rather than onto a dead end.
  const location = useLocation();
  const [stepped, setStepped] = useState<{ to: string; by: 'prev' | 'next'; swiped: boolean }>();
  const list = readActivityState(location.state)?.list?.filter((listed) =>
    activities.some((a) => a.id === listed),
  );
  const position = listPosition(list, id ?? '');
  const step = (to: string, by: 'prev' | 'next', swiped: boolean) => {
    setStepped({ to, by, swiped });
    open(to);
  };
  // Focus and the slide-in follow a step only onto the entry it pushed, not a
  // later Back or Forward onto it (or onto an entry before it).
  const navigation = useNavigationType();
  const arrived = navigation === NavigationType.Push && stepped?.to === id ? stepped : undefined;

  const activity = activities.find((a) => a.id === id);
  if (activity) {
    return (
      // Keyed so nothing (an open edit form, the scroll) carries over when
      // Back or Forward moves between activities.
      <ActivityDetail
        key={activity.id}
        activity={activity}
        onClose={close}
        onSelectNearby={(a) => open(a.id)}
        showUploads={!!activity.completed}
        animateIn={activity.id === openedWith}
        sequence={
          position
            ? sequenceOf(position, activities, step, arrived?.by, arrived?.swiped)
            : undefined
        }
        onShowContributor={showContributor}
      />
    );
  }
  if (loading) return null;
  const animate = id === openedWith;
  return error ? (
    <Missing
      title="Couldn't load this activity"
      message={error}
      onClose={close}
      animate={animate}
    />
  ) : (
    <Missing
      title="Activity not found"
      message="This link may be out of date, or the activity was removed from the catalog."
      onClose={close}
      animate={animate}
    />
  );
}

function sequenceOf(
  { index, total, prev, next }: ListPosition,
  activities: readonly Activity[],
  step: (to: string, by: 'prev' | 'next', swiped: boolean) => void,
  cameBy: 'prev' | 'next' | undefined,
  swiped: boolean | undefined,
) {
  return {
    index,
    total,
    onPrev: prev ? (how?: 'swipe') => step(prev, 'prev', how === 'swipe') : undefined,
    onNext: next ? (how?: 'swipe') => step(next, 'next', how === 'swipe') : undefined,
    // The neighbours, for the previews that ride beside a swipe.
    prevActivity: activities.find((a) => a.id === prev),
    nextActivity: activities.find((a) => a.id === next),
    cameBy,
    swiped: swiped === true,
  };
}

function Missing({
  title,
  message,
  onClose,
  animate,
}: {
  title: string;
  message: string;
  onClose: () => void;
  /** Off when it replaces a detail already on screen, like the detail's own. */
  animate: boolean;
}) {
  const action = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Like the detail: the page behind stays put, and focus starts in here.
  useEffect(() => {
    action.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center px-margin">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-on-surface/60 backdrop-blur-sm cursor-default ${animate ? 'motion-safe:animate-scrim-in' : ''}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-missing-title"
        className={`relative w-full max-w-2xl bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-xl p-lg text-center ${animate ? 'motion-safe:animate-dialog-in' : ''}`}
      >
        <span className="material-symbols-outlined text-on-surface-variant text-5xl">
          wrong_location
        </span>
        <h2
          id="activity-missing-title"
          className="font-headline-md text-headline-md text-on-surface mt-sm"
        >
          {title}
        </h2>
        <p className="font-body-md text-on-surface-variant mt-xs">{message}</p>
        <button
          ref={action}
          type="button"
          onClick={onClose}
          className="mt-md bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
        >
          Browse adventures
        </button>
      </div>
    </div>
  );
}
