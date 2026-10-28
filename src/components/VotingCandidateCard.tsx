import type { TripActivity } from '../lib/userTrips';
import { VoteControls } from './VoteControls';
import { TripCardBody } from './TripCardBody';

type VoteTally = { up: number; down: number; net: number };

type Props = {
  activity: TripActivity;
  tally: VoteTally;
  myVote: -1 | 0 | 1;
  votingOpen: boolean;
  canRemove: boolean;
  onVote?: (value: -1 | 0 | 1) => void;
  onRemove?: () => void;
  // Opens the activity detail view. Omitted for orphaned (deleted) snapshots.
  onOpen?: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;
};

export function VotingCandidateCard({
  activity,
  tally,
  myVote,
  votingOpen,
  canRemove,
  onVote,
  onRemove,
  onOpen,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}: Props) {
  const snapshot = activity.snapshot;
  const name = snapshot?.name ?? '(deleted activity)';
  const cover = snapshot?.coverImage ?? null;
  const cityLine = [snapshot?.location?.city, snapshot?.duration].filter(Boolean).join(' · ');
  const orphaned = !snapshot;

  return (
    <div
      draggable={votingOpen && draggable}
      onDragStart={votingOpen && draggable ? onDragStart : undefined}
      onDragOver={votingOpen && draggable ? onDragOver : undefined}
      onDrop={votingOpen && draggable ? onDrop : undefined}
      className={`overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-lowest ${
        votingOpen && draggable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      {/* The controls wrap onto their own row (#228): beside the thumbnail
          they left the name a few pixels wide. */}
      <div className="flex flex-wrap gap-x-md gap-y-sm p-sm">
        {/* Drag handle */}
        {votingOpen && draggable && (
          <div className="flex shrink-0 items-center text-on-surface-variant/50">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              drag_indicator
            </span>
          </div>
        )}

        {/* Cover + main content — a button when openable, so clicking the card
            (but not the vote/remove/drag controls) opens the detail view. */}
        {onOpen && !orphaned ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex min-w-0 flex-1 gap-md rounded-lg text-left hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
          >
            <TripCardBody cover={cover} name={name} cityLine={cityLine} orphaned={orphaned} wrap />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 gap-md">
            <TripCardBody cover={cover} name={name} cityLine={cityLine} orphaned={orphaned} wrap />
          </div>
        )}

        {/* Vote controls + remove: a row of their own. */}
        <div className="flex shrink-0 basis-full items-center justify-end gap-sm">
          <VoteControls
            tally={tally}
            myVote={myVote}
            disabled={!votingOpen}
            disabledTooltip="Voting is closed"
            onVote={votingOpen ? onVote : undefined}
          />
          {canRemove && onRemove && (
            <button
              type="button"
              aria-label="Remove candidate"
              onClick={onRemove}
              className="min-h-11 rounded-full border border-error/40 py-xs pr-sm pl-[10px] font-body-md text-sm text-error transition-colors hover:bg-error-container"
            >
              ✕ Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
