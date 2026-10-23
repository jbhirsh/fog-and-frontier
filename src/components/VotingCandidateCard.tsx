import type { TripActivity } from '../lib/userTrips';
import { VoteControls } from './VoteControls';
import { CdnImage } from './CdnImage';

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
      {/* Below md the controls wrap onto their own row (#228): beside the
          thumbnail they left the name a few pixels wide on a phone. */}
      <div className="flex flex-wrap gap-x-md gap-y-sm p-sm md:flex-nowrap">
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
            <CardBody cover={cover} name={name} cityLine={cityLine} orphaned={orphaned} />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 gap-md">
            <CardBody cover={cover} name={name} cityLine={cityLine} orphaned={orphaned} />
          </div>
        )}

        {/* Vote controls + remove: a row of their own on a phone, the right
            side of the card from md up. */}
        <div className="flex shrink-0 basis-full items-center justify-end gap-sm md:basis-auto md:flex-col md:items-end md:justify-start md:gap-xs">
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
              className="min-h-11 rounded-full border border-error/40 py-xs pr-sm pl-[10px] font-body-md text-sm text-error transition-colors hover:bg-error-container md:min-h-auto"
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
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-variant">
        {cover ? (
          <CdnImage alt="" src={cover} sizes="80px" className="size-full object-cover" />
        ) : (
          <span className="material-symbols-outlined text-outline" style={{ fontSize: 28 }}>
            landscape
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-xs">
        {/* The full name on a phone, wrapping as it needs; one line from md. */}
        <div className="font-headline-md text-body-lg wrap-break-word text-on-surface md:line-clamp-1 md:break-normal">
          {name}
        </div>
        {cityLine && (
          <div className="font-body-md text-sm wrap-break-word text-on-surface-variant md:line-clamp-1 md:break-normal">
            {cityLine}
          </div>
        )}
        {orphaned && (
          <div className="font-body-md text-xs text-error">Original activity was deleted.</div>
        )}
      </div>
    </>
  );
}
