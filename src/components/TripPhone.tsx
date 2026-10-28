import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { kindLabel } from '../lib/activityLabels';
import { authorLabel } from '../lib/activityReviews';
import { formatDateRange } from '../lib/dateRange';
import {
  dayName,
  dayOrder,
  moveWithinDay,
  placesCount,
  shortDayLabel,
  timeOfDay,
} from '../lib/tripDays';
import { dayCount, type Trip, type TripActivity } from '../lib/userTrips';
import { CoverImage } from './CoverImage';
import { ModalShell } from './ModalShell';

// A trip's page on a phone (#294): a short header, Plan / Ideas / Map as
// one control, and the plan a day at a time, each place a compact row.
// TripDetail keeps the trip's state and its dialogs, and hands this the
// parts it shares with the desktop page (the menu, the members, the ideas,
// the map) as they are.

export type TripTab = 'plan' | 'ideas' | 'map';

interface Props {
  trip: Trip;
  isPast: boolean;
  isVoting: boolean;
  /** The ••• menu, Edit trip among its items. */
  menu: ReactNode;
  /** The members, with the creator's controls, shown from the avatars. */
  members: ReactNode;
  onInvite: () => void;
  /** The candidates while voting, else the places on no day yet. */
  ideas: ReactNode;
  ideasCount: number;
  map: ReactNode;
  onOpen: (a: TripActivity) => void;
  /** Puts a place on a day, at the time that follows what's there. */
  onSchedule: (a: TripActivity, dayIndex: number) => void;
  /** New start times for places on a day, from moving one a step. */
  onMove: (times: { id: string; start_time: string }[]) => void;
  /** The day and time picker. */
  onEditTime: (a: TripActivity) => void;
  onUnschedule: (a: TripActivity) => void;
  onRemove: (a: TripActivity) => void;
  /** The catalog, picking places for this trip. */
  onBrowse: () => void;
  /** A change is saving: the handles wait for it, so a move isn't lost. */
  busy: boolean;
  /** What went wrong last, shown under the header where it's seen. */
  notice?: ReactNode;
}

const SEGMENT = 'h-9.5 rounded-[11px] text-body-sm whitespace-nowrap transition-colors';
const SEGMENT_ON = 'bg-surface-container-lowest font-semibold text-primary shadow-sm';
const SEGMENT_OFF = 'font-medium text-on-surface hover:bg-surface-container';

export function TripPhone(props: Props) {
  const { trip, isPast, isVoting, menu, members, onInvite, ideas, ideasCount, map, notice } = props;
  // Voting opens on the ideas being voted on; a plan on its days.
  const [tab, setTab] = useState<TripTab>(isVoting ? 'ideas' : 'plan');
  const [prevVoting, setPrevVoting] = useState(isVoting);
  if (prevVoting !== isVoting) {
    setPrevVoting(isVoting);
    setTab(isVoting ? 'ideas' : 'plan');
  }
  const [membersOpen, setMembersOpen] = useState(false);
  // A past trip says when it ended, when someone marked it so.
  const status = isPast
    ? trip.marked_past_at
      ? `Past · ended ${new Date(trip.marked_past_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })}`
      : 'Past'
    : isVoting
      ? 'Voting'
      : 'Planning';
  // This header stands in for the brand's bar, which Layout hides while
  // the page is marked.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.ownHeader = '';
    return () => {
      delete root.dataset.ownHeader;
    };
  }, []);

  return (
    <>
      {/* White across a phone, a bar at the top of the screen; on a wider
          screen, in the page's column, it would be a white box ending
          above the days, so it takes the page's own colour there. */}
      <header className="space-y-sm bg-surface-container-lowest pt-xs px-margin pb-sm md:bg-transparent md:px-gutter">
        <div className="flex items-center justify-between">
          <Link
            to="/trips"
            className="-ml-1.5 inline-flex min-h-11 items-center gap-0.5 text-[15px] font-medium text-primary"
          >
            <span
              className="material-symbols-outlined size-5 overflow-hidden text-[20px]"
              aria-hidden="true"
            >
              chevron_left
            </span>
            Trips
          </Link>
          {menu}
        </div>
        <div className="space-y-xs">
          <h1 className="font-display text-[26px] leading-tight font-bold text-primary">
            {trip.title}
          </h1>
          <p className="text-body-sm text-on-surface-variant">
            {formatDateRange(trip.start_date, trip.end_date)} · {status}
          </p>
          {trip.description && (
            <p className="pt-xs text-body-md whitespace-pre-line text-on-surface">
              {trip.description}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-sm">
          <Avatars trip={trip} onOpen={() => setMembersOpen(true)} />
          <button
            type="button"
            onClick={onInvite}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-lowest px-sm text-body-sm font-medium text-primary hover:bg-surface-container-low"
          >
            <span
              className="material-symbols-outlined size-4 overflow-hidden text-[16px]"
              aria-hidden="true"
            >
              person_add
            </span>
            Invite
          </button>
        </div>
        <div
          role="group"
          aria-label="Show"
          className="grid grid-cols-3 gap-0.5 rounded-[14px] bg-surface-container-low p-[3px]"
        >
          {(
            [
              ['plan', 'Plan'],
              ['ideas', `Ideas · ${ideasCount}`],
              ['map', 'Map'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
              className={`${SEGMENT} ${tab === value ? SEGMENT_ON : SEGMENT_OFF}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      {notice}

      {tab === 'plan' &&
        (isVoting ? (
          <p className="mx-gutter my-md rounded-xl bg-primary-fixed/50 px-md py-sm text-body-sm text-on-surface">
            Voting is open: the plan comes once the trip creator finalizes voting. Vote on the
            ideas.
          </p>
        ) : (
          <Days {...props} />
        ))}
      {tab === 'ideas' && <div className="[&>section]:py-sm">{ideas}</div>}
      {tab === 'map' && <div className="py-sm px-margin md:px-gutter">{map}</div>}

      {membersOpen && (
        <ModalShell title="Members" onCancel={() => setMembersOpen(false)}>
          {members}
        </ModalShell>
      )}
    </>
  );
}

/** The members as overlapping initials, opening the list of them. */
function Avatars({ trip, onOpen }: { trip: Trip; onOpen: () => void }) {
  const names = trip.members.map((m) => m.display_name ?? authorLabel(m.email));
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Members: ${names.join(', ')}`}
      className="flex min-h-11 items-center"
    >
      {shown.map((name, i) => (
        <span
          key={name + i}
          aria-hidden="true"
          className={`inline-flex size-8 items-center justify-center rounded-full border-2 border-surface-container-lowest text-[13px] font-semibold ${
            i === 0 ? '' : '-ml-2'
          } ${i % 2 === 0 ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-secondary-fixed text-on-secondary-fixed'}`}
        >
          {name.charAt(0).toUpperCase()}
        </span>
      ))}
      {more > 0 && (
        <span
          aria-hidden="true"
          className="-ml-2 inline-flex size-8 items-center justify-center rounded-full border-2 border-surface-container-lowest bg-surface-container text-[12px] font-semibold text-on-surface-variant"
        >
          +{more}
        </span>
      )}
    </button>
  );
}

/** The days as buttons, and the one chosen as rows. */
function Days({
  trip,
  isPast,
  onOpen,
  onSchedule,
  onMove,
  onEditTime,
  onUnschedule,
  onRemove,
  onBrowse,
  busy,
}: Props) {
  const total = dayCount(trip);
  const [chosen, setChosen] = useState(0);
  const day = Math.min(chosen, total - 1);
  const onDay = (i: number) => dayOrder(trip.activities.filter((a) => a.day_index === i));
  const places = onDay(day);
  const unscheduled = trip.activities.filter((a) => a.day_index === null);
  // By id, looked up in the day as it is now: the trip reloads under an
  // open sheet (votes, other members), and its places come back as new
  // objects. Gone from the day, the sheet goes with it.
  const [actingId, setActingId] = useState<string | null>(null);
  const actingIndex = places.findIndex((p) => p.id === actingId);
  const acting = actingIndex >= 0 ? places[actingIndex] : null;
  const [adding, setAdding] = useState(false);

  return (
    <section aria-label="Plan" className="pt-xs pb-md">
      <div
        role="group"
        aria-label="Day"
        className="flex scrollbar-none gap-base overflow-x-auto px-margin pb-xs md:px-gutter"
      >
        {Array.from({ length: total }, (_, i) => {
          const on = i === day;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => setChosen(i)}
              className={`flex h-13.5 min-w-[calc((100%-2*var(--spacing-base))/3)] flex-1 flex-col items-center justify-center gap-px rounded-[14px] px-sm text-[15px] font-semibold ${
                on ? 'bg-primary text-on-primary' : 'bg-surface-container-low text-on-surface'
              }`}
            >
              {/* Spaced for a screen reader; a flex column drops it. */}
              {shortDayLabel(trip, i)}{' '}
              <span
                className={`text-[12px] font-normal ${on ? 'text-on-primary/80' : 'text-on-surface-variant'}`}
              >
                {placesCount(onDay(i).length)}
              </span>
            </button>
          );
        })}
      </div>
      <ol className="pt-xs px-margin md:px-gutter">
        {places.map((a) => (
          <PlaceRow
            key={a.id}
            activity={a}
            onOpen={() => onOpen(a)}
            onActions={isPast ? undefined : () => setActingId(a.id)}
            busy={busy}
          />
        ))}
        {!isPast && (
          <li className="pt-sm">
            <button
              type="button"
              onClick={() => (unscheduled.length > 0 ? setAdding(true) : onBrowse())}
              className="flex h-12 w-full items-center justify-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-outline-variant text-[15px] font-medium text-primary hover:bg-surface-container-low"
            >
              <span
                className="material-symbols-outlined size-4.5 overflow-hidden text-[18px]"
                aria-hidden="true"
              >
                add
              </span>
              Add a place to {dayName(trip, day)}
            </button>
          </li>
        )}
      </ol>

      {acting && (
        <PlaceActions
          activity={acting}
          canEarlier={actingIndex > 0}
          canLater={actingIndex < places.length - 1}
          onClose={() => setActingId(null)}
          onMove={(by) => onMove(moveWithinDay(places, actingIndex, by))}
          onEditTime={() => onEditTime(acting)}
          onUnschedule={() => onUnschedule(acting)}
          onRemove={() => onRemove(acting)}
        />
      )}
      {adding && (
        <ModalShell
          title={`Add a place to ${dayName(trip, day)}`}
          onCancel={() => setAdding(false)}
        >
          <ul className="-my-xs">
            {unscheduled.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    onSchedule(a, day);
                  }}
                  className="flex min-h-12 w-full items-center border-b border-outline-variant/40 text-left text-body-md text-on-surface hover:bg-surface-container-low"
                >
                  {a.snapshot?.name ?? '(activity)'}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              onBrowse();
            }}
            className="min-h-11 text-body-md font-semibold text-primary underline underline-offset-4"
          >
            Find another in the catalog
          </button>
        </ModalShell>
      )}
    </section>
  );
}

/** A place on the day: its photo, when, name, and kind · duration; a handle to move it. */
function PlaceRow({
  activity,
  onOpen,
  onActions,
  busy,
}: {
  activity: TripActivity;
  onOpen: () => void;
  /** Omitted on a past trip, which can't change. */
  onActions?: () => void;
  busy?: boolean;
}) {
  const snapshot = activity.snapshot;
  const name = snapshot?.name ?? '(deleted activity)';
  const when = timeOfDay(activity.start_time);
  return (
    <li className="flex items-center gap-sm border-b border-outline-variant/40 py-2.5">
      <button
        type="button"
        onClick={onOpen}
        disabled={!snapshot}
        className="flex min-w-0 flex-1 items-center gap-sm text-left"
      >
        <span className="size-14 shrink-0 overflow-hidden rounded-[10px] bg-surface-variant">
          {snapshot && (
            <CoverImage
              src={snapshot.coverImage}
              alt=""
              category={snapshot.category}
              sizes="56px"
              glyphSize={24}
              className="size-full object-cover"
            />
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          {when && (
            <span className="text-[12px] font-semibold tracking-[0.02em] text-secondary uppercase">
              {when}
            </span>
          )}{' '}
          <span className="text-[15px] leading-snug font-semibold text-on-surface">{name}</span>{' '}
          {snapshot && (
            <span className="text-[13px] text-on-surface-variant">
              {kindLabel(snapshot.category)} · {snapshot.duration}
            </span>
          )}
        </span>
      </button>
      {onActions && (
        <button
          type="button"
          onClick={onActions}
          disabled={busy}
          aria-haspopup="dialog"
          aria-label={`Move or change ${name}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-outline hover:bg-surface-container-low disabled:opacity-40"
        >
          <span
            className="material-symbols-outlined size-5 overflow-hidden text-[20px]"
            aria-hidden="true"
          >
            drag_indicator
          </span>
        </button>
      )}
    </li>
  );
}

/** What can be done to a place on the day, from its handle: by touch or by keyboard. */
function PlaceActions({
  activity,
  canEarlier,
  canLater,
  onClose,
  onMove,
  onEditTime,
  onUnschedule,
  onRemove,
}: {
  activity: TripActivity;
  canEarlier: boolean;
  canLater: boolean;
  onClose: () => void;
  onMove: (by: -1 | 1) => void;
  onEditTime: () => void;
  onUnschedule: () => void;
  onRemove: () => void;
}) {
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const item =
    'flex min-h-12 w-full items-center gap-sm border-b border-outline-variant/40 text-left text-body-md disabled:cursor-not-allowed disabled:opacity-50';
  const icon = (name: string) => (
    <span
      className="material-symbols-outlined size-5 overflow-hidden text-[20px] text-on-surface-variant"
      aria-hidden="true"
    >
      {name}
    </span>
  );
  return (
    <ModalShell title={activity.snapshot?.name ?? '(activity)'} onCancel={onClose}>
      <div className="-my-xs">
        <button
          type="button"
          disabled={!canEarlier}
          onClick={act(() => onMove(-1))}
          className={`${item} text-on-surface`}
        >
          {icon('arrow_upward')}
          Earlier in the day
        </button>
        <button
          type="button"
          disabled={!canLater}
          onClick={act(() => onMove(1))}
          className={`${item} text-on-surface`}
        >
          {icon('arrow_downward')}
          Later in the day
        </button>
        <button type="button" onClick={act(onEditTime)} className={`${item} text-on-surface`}>
          {icon('schedule')}
          Change day or time…
        </button>
        <button type="button" onClick={act(onUnschedule)} className={`${item} text-on-surface`}>
          {icon('event_busy')}
          Take off the plan
        </button>
        <button type="button" onClick={act(onRemove)} className={`${item} text-error`}>
          {icon('delete')}
          Remove from trip
        </button>
      </div>
    </ModalShell>
  );
}
