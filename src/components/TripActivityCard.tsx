import type { TripActivity } from '../lib/userTrips';
import { TripCardBody } from './TripCardBody';

type Props = {
  activity: TripActivity;
  disabled?: boolean;
  pastTooltip?: string;
  // Actions
  onAssignToDay?: () => void;
  onRemove?: () => void;
  // Opens the activity detail view. Omitted for orphaned (deleted) snapshots.
  onOpen?: () => void;
};

export function TripActivityCard({
  activity,
  disabled,
  pastTooltip,
  onAssignToDay,
  onRemove,
  onOpen,
}: Props) {
  const snapshot = activity.snapshot;
  const orphaned = !snapshot;
  const name = snapshot?.name ?? '(deleted activity)';
  const cover = snapshot?.coverImage ?? null;
  const cityLine = [snapshot?.location?.city, snapshot?.duration].filter(Boolean).join(' · ');

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest">
      <div className="space-y-sm p-sm">
        {/* Cover + title — a button when openable, so clicking the card (but
            not the action buttons) opens the detail view. */}
        {onOpen && !orphaned ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex w-full gap-md rounded-lg text-left hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
          >
            <TripCardBody cover={cover} name={name} cityLine={cityLine} orphaned={orphaned} wrap />
          </button>
        ) : (
          <div className="flex gap-md">
            <TripCardBody cover={cover} name={name} cityLine={cityLine} orphaned={orphaned} wrap />
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
      className={`inline-flex min-h-11 items-center rounded-full border px-sm py-xs font-body-md text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        destructive
          ? 'border-error/40 text-error hover:bg-error-container'
          : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant'
      }`}
    >
      {children}
    </button>
  );
}
