import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TripActivityCard } from '../components/TripActivityCard';
import { TripMap } from '../components/TripMap';
import { useAuthState } from '../lib/authShim';
import { useOwner } from '../lib/useOwner';
import {
  assignSlot,
  dayCount,
  dayLabel,
  defaultStartTimeForDay,
  deleteTrip,
  formatHHMM,
  markTripPast,
  patchTrip,
  removeTripActivity,
  useTrip,
  type PatchTripInput,
  type Trip,
  type TripActivity,
} from '../lib/userTrips';

const DRAG_MIME = 'application/x-fnf-trip-activity-id';
const PAST_TOOLTIP = 'This trip is past';

export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isOwner, isLoaded: ownerLoaded } = useOwner();
  const { getToken } = useAuthState();
  const { trip, isLoading, error, reload } = useTrip(id);

  const [editingHeader, setEditingHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slotDialog, setSlotDialog] = useState<SlotDialogState | null>(null);
  const [markPastOpen, setMarkPastOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isPast = trip?.status === 'past';

  const buckets = useMemo(() => bucketByDay(trip), [trip]);

  const runWithToken = useCallback(
    async (fn: (token: string | null) => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        const token = await getToken();
        await fn(token);
        reload();
      } catch (err) {
        console.error(err);
      } finally {
        setBusy(false);
      }
    },
    [busy, getToken, reload],
  );

  function handleDropOnDay(dayIndex: number) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      if (isPast || !trip) return;
      const taId = e.dataTransfer.getData(DRAG_MIME);
      if (!taId) return;
      e.preventDefault();
      const activity = trip.activities.find((a) => a.id === taId);
      if (!activity) return;
      const onDay = trip.activities.filter(
        (a) => a.day_index === dayIndex && a.id !== taId && a.start_time,
      );
      const start_time = defaultStartTimeForDay(onDay);
      void runWithToken((token) =>
        assignSlot(taId, { day_index: dayIndex, start_time }, token),
      );
    };
  }

  function handleDropOnUnscheduled(e: React.DragEvent<HTMLDivElement>) {
    if (isPast) return;
    const taId = e.dataTransfer.getData(DRAG_MIME);
    if (!taId) return;
    e.preventDefault();
    void runWithToken((token) =>
      assignSlot(taId, { day_index: null, start_time: null }, token),
    );
  }

  function handleAssignOrEdit(activity: TripActivity) {
    if (!trip) return;
    setSlotDialog({
      taId: activity.id,
      activityName: activity.snapshot?.name ?? '(activity)',
      dayIndex: activity.day_index ?? 0,
      startTime: activity.start_time ?? defaultStartTimeForDay(
        trip.activities.filter(
          (a) => a.day_index === 0 && a.id !== activity.id && a.start_time,
        ),
      ),
    });
  }

  function handleSubmitSlot(dayIndex: number, startTime: string) {
    if (!slotDialog) return;
    const taId = slotDialog.taId;
    setSlotDialog(null);
    void runWithToken((token) =>
      assignSlot(taId, { day_index: dayIndex, start_time: startTime }, token),
    );
  }

  function handleMoveToUnscheduled(activity: TripActivity) {
    void runWithToken((token) =>
      assignSlot(
        activity.id,
        { day_index: null, start_time: null },
        token,
      ),
    );
  }

  function handleRemove(activity: TripActivity) {
    void runWithToken((token) => removeTripActivity(activity.id, token));
  }

  async function handleSaveHeader(input: HeaderEditInput) {
    if (!trip) return;
    // On past trips, title and dates are disabled in the form; only send
    // the still-editable fields so the server doesn't 409 on the disabled
    // ones (the patch handler rejects any title/start_date/end_date in the
    // body when status === 'past', even if the value hasn't changed).
    const body: PatchTripInput = {
      description: input.description || null,
      cover_image_url: input.cover_image_url || null,
    };
    if (trip.status !== 'past') {
      body.title = input.title;
      body.start_date = input.start_date;
      body.end_date = input.end_date;
    }
    await runWithToken((token) => patchTrip(trip.id, body, token));
    setEditingHeader(false);
  }

  function handleConfirmDelete() {
    if (!trip) return;
    setConfirmingDelete(false);
    void (async () => {
      try {
        const token = await getToken();
        await deleteTrip(trip.id, token);
        void navigate('/trips');
      } catch (err) {
        console.error(err);
      }
    })();
  }

  function handleSubmitMarkPast(ids: string[]) {
    if (!trip) return;
    setMarkPastOpen(false);
    void runWithToken((token) => markTripPast(trip.id, ids, token));
  }

  if (!ownerLoaded || isLoading) {
    return (
      <section className="px-margin py-xl text-center text-on-surface-variant">
        Loading…
      </section>
    );
  }

  if (!isOwner) {
    return (
      <section className="px-margin py-xl max-w-2xl mx-auto text-center space-y-md">
        <h1 className="font-display text-headline-lg text-primary">Trip</h1>
        <p className="font-body-lg text-on-surface-variant">
          Sign in with an owner account to view trips.
        </p>
        <Link to="/trips" className="text-primary underline">
          Back to trips
        </Link>
      </section>
    );
  }

  if (error || !trip) {
    return (
      <section className="px-margin py-xl max-w-2xl mx-auto text-center space-y-md">
        <p className="font-body-lg text-on-surface-variant">
          {error === 'not-found'
            ? "We couldn't find that trip."
            : "Couldn't load this trip."}
        </p>
        <Link to="/trips" className="text-primary underline">
          Back to trips
        </Link>
      </section>
    );
  }

  return (
    <>
      <TripHeader
        trip={trip}
        isPast={isPast}
        editing={editingHeader}
        onEdit={() => setEditingHeader(true)}
        onCancelEdit={() => setEditingHeader(false)}
        onSave={(input) => void handleSaveHeader(input)}
        onMarkPast={() => setMarkPastOpen(true)}
        onDelete={() => setConfirmingDelete(true)}
      />

      <section className="px-margin py-lg max-w-screen-2xl mx-auto space-y-lg">
        <TripMap trip={trip} />

        <div className="flex items-center justify-between gap-md flex-wrap">
          <h2 className="font-headline-md text-headline-md text-on-surface">
            Itinerary
          </h2>
          <button
            type="button"
            onClick={() => {
              if (isPast) return;
              void navigate('/', {
                state: {
                  target_trip_id: trip.id,
                  target_trip_title: trip.title,
                },
              });
            }}
            disabled={isPast}
            title={isPast ? PAST_TOOLTIP : undefined}
            className="inline-flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-body-md">add</span>
            Add activity
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
          <div className="lg:col-span-2 space-y-md">
            {buckets.map((bucket) => (
              <DaySection
                key={bucket.dayIndex}
                trip={trip}
                bucket={bucket}
                isPast={isPast}
                onDropOnDay={handleDropOnDay(bucket.dayIndex)}
                onEditTime={(a) => handleAssignOrEdit(a)}
                onMoveToUnscheduled={(a) => handleMoveToUnscheduled(a)}
                onRemove={(a) => handleRemove(a)}
              />
            ))}
          </div>
          <UnscheduledPanel
            trip={trip}
            isPast={isPast}
            onDrop={handleDropOnUnscheduled}
            onAssign={(a) => handleAssignOrEdit(a)}
            onRemove={(a) => handleRemove(a)}
            onAddFromCurated={() => {
              if (isPast) return;
              void navigate('/', {
                state: {
                  target_trip_id: trip.id,
                  target_trip_title: trip.title,
                },
              });
            }}
          />
        </div>
      </section>

      {slotDialog && trip && (
        <SlotDialog
          state={slotDialog}
          dayCount={dayCount(trip)}
          dayLabelFor={(i) => dayLabel(trip, i)}
          onCancel={() => setSlotDialog(null)}
          onSubmit={handleSubmitSlot}
        />
      )}

      {markPastOpen && trip && (
        <MarkPastModal
          trip={trip}
          onCancel={() => setMarkPastOpen(false)}
          onSubmit={handleSubmitMarkPast}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this trip?"
          message="The trip and its itinerary will be removed permanently. Completed activities stay completed."
          confirmLabel="Delete trip"
          destructive
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </>
  );
}

type DayBucket = { dayIndex: number; activities: TripActivity[] };

function bucketByDay(trip: Trip | null): DayBucket[] {
  if (!trip) return [];
  const total = dayCount(trip);
  const out: DayBucket[] = [];
  for (let i = 0; i < total; i++) {
    out.push({
      dayIndex: i,
      activities: trip.activities
        .filter((a) => a.day_index === i)
        .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')),
    });
  }
  return out;
}

type HeaderEditInput = {
  title: string;
  start_date: string;
  end_date: string;
  description: string;
  cover_image_url: string;
};

function TripHeader({
  trip,
  isPast,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onMarkPast,
  onDelete,
}: {
  trip: Trip;
  isPast: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (input: HeaderEditInput) => void;
  onMarkPast: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<HeaderEditInput>({
    title: trip.title,
    start_date: trip.start_date,
    end_date: trip.end_date,
    description: trip.description ?? '',
    cover_image_url: trip.cover_image_url ?? '',
  });
  const [menuOpen, setMenuOpen] = useState(false);

  if (editing) {
    return (
      <section className="px-margin py-lg bg-surface-container-low border-b border-outline-variant/20">
        <form
          className="max-w-3xl mx-auto space-y-md"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
          }}
        >
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            required
            disabled={isPast}
            title={isPast ? 'This trip is past' : undefined}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm font-display text-headline-md disabled:opacity-60"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <input
              type="date"
              value={draft.start_date}
              onChange={(e) =>
                setDraft({ ...draft, start_date: e.target.value })
              }
              disabled={isPast}
              title={isPast ? 'This trip is past' : undefined}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm disabled:opacity-60"
            />
            <input
              type="date"
              value={draft.end_date}
              onChange={(e) =>
                setDraft({ ...draft, end_date: e.target.value })
              }
              min={draft.start_date || undefined}
              disabled={isPast}
              title={isPast ? 'This trip is past' : undefined}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm disabled:opacity-60"
            />
          </div>
          <textarea
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            rows={2}
            placeholder="Description (optional)"
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm"
          />
          <input
            type="url"
            value={draft.cover_image_url}
            onChange={(e) =>
              setDraft({ ...draft, cover_image_url: e.target.value })
            }
            placeholder="Cover image URL (optional)"
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm"
          />
          <div className="flex items-center gap-md">
            <button
              type="submit"
              className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="font-body-md text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const editTooltip = isPast ? 'This trip is past' : undefined;

  return (
    <section className="px-margin py-lg bg-surface-container-low border-b border-outline-variant/20">
      <div className="max-w-screen-2xl mx-auto flex flex-wrap items-start justify-between gap-md">
        <div className="space-y-xs">
          <Link
            to="/trips"
            className="text-body-sm text-on-surface-variant underline"
          >
            ← Trips
          </Link>
          <h1 className="font-display text-headline-lg md:text-display text-primary">
            {trip.title}
          </h1>
          <p className="font-body-md text-on-surface-variant">{dateRange}</p>
          {trip.description && (
            <p className="font-body-md text-on-surface max-w-2xl">
              {trip.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-sm">
          {isPast ? (
            <span className="font-label-caps text-label-caps text-on-surface-variant bg-surface-variant px-sm py-xs rounded-full">
              {trip.marked_past_at
                ? `Past · ended ${new Date(trip.marked_past_at).toLocaleDateString(
                    'en-US',
                    { month: 'short', day: 'numeric' },
                  )}`
                : 'Past'}
            </span>
          ) : (
            <span className="font-label-caps text-label-caps text-primary bg-primary-fixed px-sm py-xs rounded-full">
              Planning
            </span>
          )}
          <button
            type="button"
            onClick={onEdit}
            title={isPast ? 'Past trip — only cover and description are editable' : editTooltip}
            className="font-body-md text-sm px-sm py-xs rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant"
          >
            Edit
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant"
            >
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-xs w-56 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-lg z-10 overflow-hidden"
              >
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onMarkPast();
                  }}
                  disabled={isPast}
                  tooltip={isPast ? 'Already past' : undefined}
                >
                  Mark as past…
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  destructive
                >
                  Delete trip…
                </MenuItem>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MenuItem({
  onClick,
  disabled,
  tooltip,
  destructive,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={`w-full text-left font-body-md px-md py-sm hover:bg-surface-variant disabled:opacity-60 disabled:cursor-not-allowed ${
        destructive ? 'text-error' : 'text-on-surface'
      }`}
    >
      {children}
    </button>
  );
}

function DaySection({
  trip,
  bucket,
  isPast,
  onDropOnDay,
  onEditTime,
  onMoveToUnscheduled,
  onRemove,
}: {
  trip: Trip;
  bucket: DayBucket;
  isPast: boolean;
  onDropOnDay: (e: React.DragEvent<HTMLDivElement>) => void;
  onEditTime: (a: TripActivity) => void;
  onMoveToUnscheduled: (a: TripActivity) => void;
  onRemove: (a: TripActivity) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (isPast) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        onDropOnDay(e);
      }}
      className={`rounded-xl border-2 transition-colors p-md space-y-sm ${
        dragOver
          ? 'border-primary bg-primary-fixed/40'
          : 'border-outline-variant/30 bg-surface-container-low'
      }`}
    >
      <h3 className="font-headline-md text-body-lg text-on-surface">
        {dayLabel(trip, bucket.dayIndex)}
      </h3>
      {bucket.activities.length === 0 ? (
        <p className="font-body-md text-sm text-on-surface-variant">
          Drag an activity from Unscheduled, or use the card menu.
        </p>
      ) : (
        bucket.activities.map((a) => (
          <TripActivityCard
            key={a.id}
            activity={a}
            disabled={isPast}
            pastTooltip={PAST_TOOLTIP}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, a.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onEditTime={() => onEditTime(a)}
            onMoveToUnscheduled={() => onMoveToUnscheduled(a)}
            onRemove={() => onRemove(a)}
            showTimeRange
          />
        ))
      )}
    </div>
  );
}

function UnscheduledPanel({
  trip,
  isPast,
  onDrop,
  onAssign,
  onRemove,
  onAddFromCurated,
}: {
  trip: Trip;
  isPast: boolean;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onAssign: (a: TripActivity) => void;
  onRemove: (a: TripActivity) => void;
  onAddFromCurated: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const items = trip.activities.filter((a) => a.day_index === null);

  return (
    <div
      onDragOver={(e) => {
        if (isPast) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        onDrop(e);
      }}
      className={`rounded-xl border-2 transition-colors p-md space-y-sm h-fit ${
        dragOver
          ? 'border-primary bg-primary-fixed/40'
          : 'border-outline-variant/30 bg-surface-container-low'
      }`}
    >
      <div className="flex items-center justify-between gap-sm">
        <h2 className="font-headline-md text-headline-md text-on-surface">
          Unscheduled
        </h2>
        <button
          type="button"
          onClick={onAddFromCurated}
          disabled={isPast}
          title={isPast ? PAST_TOOLTIP : undefined}
          className="font-body-md text-sm px-sm py-xs rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant disabled:opacity-60 disabled:cursor-not-allowed"
        >
          + Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="font-body-md text-sm text-on-surface-variant">
          Use{' '}
          <button
            type="button"
            onClick={onAddFromCurated}
            disabled={isPast}
            className="text-primary underline disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Add activity
          </button>{' '}
          to multi-select from the curated catalog into this trip.
        </p>
      ) : (
        items.map((a) => (
          <TripActivityCard
            key={a.id}
            activity={a}
            disabled={isPast}
            pastTooltip={PAST_TOOLTIP}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, a.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onAssignToDay={() => onAssign(a)}
            onRemove={() => onRemove(a)}
          />
        ))
      )}
    </div>
  );
}

type SlotDialogState = {
  taId: string;
  activityName: string;
  dayIndex: number;
  startTime: string;
};

function SlotDialog({
  state,
  dayCount,
  dayLabelFor,
  onCancel,
  onSubmit,
}: {
  state: SlotDialogState;
  dayCount: number;
  dayLabelFor: (dayIndex: number) => string;
  onCancel: () => void;
  onSubmit: (dayIndex: number, startTime: string) => void;
}) {
  const [dayIndex, setDayIndex] = useState(state.dayIndex);
  const [startTime, setStartTime] = useState(state.startTime);

  return (
    <ModalShell onCancel={onCancel} title={`Schedule ${state.activityName}`}>
      <div className="space-y-md">
        <label className="block space-y-xs">
          <span className="font-body-md text-on-surface-variant">Day</span>
          <select
            value={dayIndex}
            onChange={(e) => setDayIndex(Number(e.target.value))}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm"
          >
            {Array.from({ length: dayCount }, (_, i) => (
              <option key={i} value={i}>
                {dayLabelFor(i)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-xs">
          <span className="font-body-md text-on-surface-variant">Start time</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm"
          />
        </label>
        <div className="flex items-center justify-end gap-md">
          <button
            type="button"
            onClick={onCancel}
            className="font-body-md text-on-surface-variant"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(dayIndex, startTime)}
            className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function MarkPastModal({
  trip,
  onCancel,
  onSubmit,
}: {
  trip: Trip;
  onCancel: () => void;
  onSubmit: (ids: string[]) => void;
}) {
  const scheduled = useMemo(
    () =>
      trip.activities
        .filter(
          (a) =>
            a.day_index !== null &&
            a.activity_id !== null &&
            a.start_time !== null,
        )
        .sort((a, b) => {
          if (a.day_index !== b.day_index)
            return (a.day_index ?? 0) - (b.day_index ?? 0);
          return (a.start_time ?? '').localeCompare(b.start_time ?? '');
        }),
    [trip],
  );

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(scheduled.map((a) => [a.activity_id ?? '', true])),
  );

  function toggle(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function submit() {
    const ids = scheduled
      .map((a) => a.activity_id ?? '')
      .filter((id) => id && checked[id]);
    onSubmit(ids);
  }

  return (
    <ModalShell
      onCancel={onCancel}
      title="Which scheduled activities did we actually do?"
    >
      {scheduled.length === 0 ? (
        <p className="font-body-md text-on-surface-variant">
          Nothing was scheduled, so there&apos;s nothing to mark completed.
          Marking past anyway is fine.
        </p>
      ) : (
        <div className="space-y-xs max-h-96 overflow-y-auto">
          {scheduled.map((a) => {
            const aid = a.activity_id ?? '';
            const inputId = `mp-${a.id}`;
            return (
              <div
                key={a.id}
                className="flex items-start gap-sm py-sm border-b border-outline-variant/20 last:border-b-0"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={!!checked[aid]}
                  onChange={() => toggle(aid)}
                  className="mt-1 accent-primary"
                />
                <label
                  htmlFor={inputId}
                  className="flex-1 space-y-xs cursor-pointer"
                >
                  <span className="block font-body-md text-on-surface">
                    {a.snapshot?.name ?? '(activity)'}
                  </span>
                  <span className="block font-body-md text-sm text-on-surface-variant">
                    {dayLabel(trip, a.day_index ?? 0)} ·{' '}
                    {formatHHMM(a.start_time)}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-end gap-md pt-md">
        <button
          type="button"
          onClick={onCancel}
          className="font-body-md text-on-surface-variant"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
        >
          Mark trip past
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell onCancel={onCancel} title={title}>
      <p className="font-body-md text-on-surface-variant">{message}</p>
      <div className="flex items-center justify-end gap-md pt-md">
        <button
          type="button"
          onClick={onCancel}
          className="font-body-md text-on-surface-variant"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`px-md py-sm rounded-full font-body-md hover:opacity-90 ${
            destructive
              ? 'bg-error text-on-error'
              : 'bg-primary text-on-primary'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-margin">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-2xl bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-xl p-lg space-y-md"
      >
        <h2 className="font-headline-md text-headline-md text-on-surface">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${start} – ${end}`;
  }
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const startFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  const endFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${startFmt.format(startDate)} – ${endFmt.format(endDate)}`;
}
