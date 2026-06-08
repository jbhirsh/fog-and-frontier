import type { TripActivity } from '../lib/userTrips';
import { derivedEndTime, formatHHMM } from '../lib/userTrips';

type Props = {
  activity: TripActivity;
  disabled?: boolean;
  pastTooltip?: string;
  // Drag handlers wired by the parent for HTML5 DnD.
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  // Actions
  onEditTime?: () => void;
  onMoveToUnscheduled?: () => void;
  onAssignToDay?: () => void;
  onRemove?: () => void;
  // Opens the activity detail view. Omitted for orphaned (deleted) snapshots.
  onOpen?: () => void;
  // Day-bucket cards show the time range across the top.
  showTimeRange?: boolean;
};

export function TripActivityCard({
  activity,
  disabled,
  pastTooltip,
  onDragStart,
  onDragEnd,
  isDragging,
  onEditTime,
  onMoveToUnscheduled,
  onAssignToDay,
  onRemove,
  onOpen,
  showTimeRange,
}: Props) {
  const snapshot = activity.snapshot;
  const orphaned = !snapshot;
  const name = snapshot?.name ?? '(deleted activity)';
  const cover = snapshot?.coverImage ?? null;
  const cityLine = [snapshot?.location?.city, snapshot?.duration]
    .filter(Boolean)
    .join(' · ');
  const start = activity.start_time;
  const end = derivedEndTime(activity);
  const draggable = !disabled && !!onDragStart;

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      className={`bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden ${
        isDragging ? 'opacity-40' : ''
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {showTimeRange && start && (
        <div className="px-md py-xs bg-primary-fixed text-primary font-body-md text-sm border-b border-outline-variant/20">
          {formatHHMM(start)}
          {end ? ` – ${formatHHMM(end)}` : ''}
        </div>
      )}
      <div className="p-sm space-y-sm">
        {/* Cover + title — a button when openable, so clicking the card (but
            not the action buttons or drag) opens the detail view. */}
        {onOpen && !orphaned ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex gap-md w-full text-left rounded-lg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
          >
            <CardBody cover={cover} name={name} cityLine={cityLine} orphaned={orphaned} />
          </button>
        ) : (
          <div className="flex gap-md">
            <CardBody cover={cover} name={name} cityLine={cityLine} orphaned={orphaned} />
          </div>
        )}
        <div className="flex flex-wrap gap-xs">
          {onAssignToDay && (
            <ActionButton
              onClick={onAssignToDay}
              disabled={disabled}
              tooltip={disabled ? pastTooltip : undefined}
            >
              Assign to day
            </ActionButton>
          )}
          {onEditTime && (
            <ActionButton
              onClick={onEditTime}
              disabled={disabled}
              tooltip={disabled ? pastTooltip : undefined}
            >
              Edit time
            </ActionButton>
          )}
          {onMoveToUnscheduled && (
            <ActionButton
              onClick={onMoveToUnscheduled}
              disabled={disabled}
              tooltip={disabled ? pastTooltip : undefined}
            >
              Unschedule
            </ActionButton>
          )}
          {onRemove && (
            <ActionButton
              onClick={onRemove}
              disabled={disabled}
              tooltip={disabled ? pastTooltip : undefined}
              destructive
            >
              Remove
            </ActionButton>
          )}
        </div>
      </div>
    </div>
  );
}

function CardBody({
  cover,
  name,
  cityLine,
  orphaned,
}: {
  cover: string | null;
  name: string;
  cityLine: string;
  orphaned: boolean;
}) {
  return (
    <>
      <div className="w-20 h-20 shrink-0 rounded-lg overflow-hidden bg-surface-variant flex items-center justify-center">
        {cover ? (
          <img alt="" src={cover} className="w-full h-full object-cover" />
        ) : (
          <span
            className="material-symbols-outlined text-outline"
            style={{ fontSize: 28 }}
          >
            landscape
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0 space-y-xs">
        <div className="font-headline-md text-body-lg text-on-surface line-clamp-1">
          {name}
        </div>
        {cityLine && (
          <div className="font-body-md text-sm text-on-surface-variant line-clamp-1">
            {cityLine}
          </div>
        )}
        {orphaned && (
          <div className="font-body-md text-xs text-error">
            Original activity was deleted.
          </div>
        )}
      </div>
    </>
  );
}

function ActionButton({
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
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={`font-body-md text-sm px-sm py-xs rounded-full border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        destructive
          ? 'border-error/40 text-error hover:bg-error-container'
          : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant'
      }`}
    >
      {children}
    </button>
  );
}
