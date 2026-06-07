import type { TripActivity } from '../lib/userTrips';
import { VoteControls } from './VoteControls';

type VoteTally = { up: number; down: number; net: number };

type Props = {
  activity: TripActivity;
  tally: VoteTally;
  myVote: -1 | 0 | 1;
  votingOpen: boolean;
  canRemove: boolean;
  onVote?: (value: -1 | 0 | 1) => void;
  onRemove?: () => void;
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
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
}: Props) {
  const snapshot = activity.snapshot;
  const name = snapshot?.name ?? '(deleted activity)';
  const cover = snapshot?.coverImage ?? null;
  const cityLine = [snapshot?.location?.city, snapshot?.duration]
    .filter(Boolean)
    .join(' · ');
  const orphaned = !snapshot;

  return (
    <div
      draggable={votingOpen && draggable}
      onDragStart={votingOpen && draggable ? onDragStart : undefined}
      onDragOver={votingOpen && draggable ? onDragOver : undefined}
      onDrop={votingOpen && draggable ? onDrop : undefined}
      className={`bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden ${
        votingOpen && draggable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      <div className="flex gap-md p-sm">
        {/* Drag handle */}
        {votingOpen && draggable && (
          <div className="flex items-center shrink-0 text-on-surface-variant/50">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
              drag_indicator
            </span>
          </div>
        )}

        {/* Cover image */}
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

        {/* Main content */}
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

        {/* Right side: vote controls + remove */}
        <div className="flex flex-col items-end gap-xs shrink-0">
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
              className="font-body-md text-sm px-sm py-xs rounded-full border border-error/40 text-error hover:bg-error-container transition-colors"
            >
              ✕ Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
