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

        {/* Cover + main content — a button when openable, so clicking the card
            (but not the vote/remove/drag controls) opens the detail view. */}
        {onOpen && !orphaned ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex gap-md flex-1 min-w-0 text-left rounded-lg hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container"
          >
            <CardBody
              cover={cover}
              name={name}
              cityLine={cityLine}
              orphaned={orphaned}
            />
          </button>
        ) : (
          <div className="flex gap-md flex-1 min-w-0">
            <CardBody
              cover={cover}
              name={name}
              cityLine={cityLine}
              orphaned={orphaned}
            />
          </div>
        )}

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
