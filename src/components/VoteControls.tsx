type VoteTally = { up: number; down: number; net: number };

type Props = {
  tally: VoteTally;
  myVote: -1 | 0 | 1;
  disabled?: boolean;
  disabledTooltip?: string;
  onVote?: (value: -1 | 0 | 1) => void;
};

export function VoteControls({
  tally,
  myVote,
  disabled = false,
  disabledTooltip,
  onVote,
}: Props) {
  function handleUp() {
    if (disabled || !onVote) return;
    onVote(myVote === 1 ? 0 : 1);
  }

  function handleDown() {
    if (disabled || !onVote) return;
    onVote(myVote === -1 ? 0 : -1);
  }

  const netLabel =
    tally.net > 0 ? `+${tally.net}` : tally.net < 0 ? `${tally.net}` : '0';

  return (
    <div className="flex items-center gap-sm">
      {/* Upvote */}
      <button
        type="button"
        aria-label="Upvote"
        aria-pressed={myVote === 1}
        disabled={disabled}
        title={disabled ? disabledTooltip : undefined}
        onClick={handleUp}
        className={`flex items-center gap-xs px-sm py-xs rounded-full border font-body-md text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          myVote === 1
            ? 'bg-primary text-on-primary border-primary'
            : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant'
        }`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          thumb_up
        </span>
        <span>{tally.up}</span>
      </button>

      {/* Net score pill */}
      <span
        className={`px-sm py-xs rounded-full font-body-md text-sm font-medium ${
          tally.net > 0
            ? 'bg-tertiary-container text-on-tertiary-container'
            : tally.net < 0
              ? 'bg-error-container text-error'
              : 'bg-surface-variant text-on-surface-variant'
        }`}
        aria-label={`Net score ${netLabel}`}
      >
        {netLabel}
      </span>

      {/* Downvote */}
      <button
        type="button"
        aria-label="Downvote"
        aria-pressed={myVote === -1}
        disabled={disabled}
        title={disabled ? disabledTooltip : undefined}
        onClick={handleDown}
        className={`flex items-center gap-xs px-sm py-xs rounded-full border font-body-md text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
          myVote === -1
            ? 'bg-error text-on-error border-error'
            : 'border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant'
        }`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          thumb_down
        </span>
        <span>{tally.down}</span>
      </button>
    </div>
  );
}
