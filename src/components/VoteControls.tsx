type VoteTally = { up: number; down: number; net: number };

type Props = {
  tally: VoteTally;
  myVote: -1 | 0 | 1;
  disabled?: boolean;
  disabledTooltip?: string;
  onVote?: (value: -1 | 0 | 1) => void;
};

// YouTube-style segmented control: [👍 up | 👎 down] in one pill, each thumb
// showing its own count. No separate aggregate/net pill — the per-thumb counts
// are the whole story. The active vote is filled + colored; click it again to
// clear to neutral.
export function VoteControls({ tally, myVote, disabled = false, disabledTooltip, onVote }: Props) {
  function handleUp() {
    if (disabled || !onVote) return;
    onVote(myVote === 1 ? 0 : 1);
  }

  function handleDown() {
    if (disabled || !onVote) return;
    onVote(myVote === -1 ? 0 : -1);
  }

  return (
    <div className="inline-flex items-center overflow-hidden rounded-full border border-outline-variant/40">
      <ThumbButton
        label="Upvote"
        icon="thumb_up"
        count={tally.up}
        active={myVote === 1}
        activeClass="text-primary"
        disabled={disabled}
        disabledTooltip={disabledTooltip}
        onClick={handleUp}
      />
      <span className="w-px self-stretch bg-outline-variant/40" aria-hidden="true" />
      <ThumbButton
        label="Downvote"
        icon="thumb_down"
        count={tally.down}
        active={myVote === -1}
        activeClass="text-error"
        disabled={disabled}
        disabledTooltip={disabledTooltip}
        onClick={handleDown}
      />
    </div>
  );
}

function ThumbButton({
  label,
  icon,
  count,
  active,
  activeClass,
  disabled,
  disabledTooltip,
  onClick,
}: {
  label: string;
  icon: 'thumb_up' | 'thumb_down';
  count: number;
  active: boolean;
  activeClass: string;
  disabled: boolean;
  disabledTooltip?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      title={disabled ? disabledTooltip : undefined}
      onClick={onClick}
      // 44px tall on touch screens (#228); compact from md, as before.
      className={`flex min-h-11 min-w-11 items-center gap-xs px-sm py-xs font-body-md text-sm transition-colors disabled:cursor-not-allowed md:min-h-auto md:min-w-auto ${
        active ? `${activeClass} font-medium` : 'text-on-surface-variant'
      } ${disabled ? '' : 'hover:bg-surface-variant'}`}
    >
      {/* The thumb glyphs sit low in their box; a 1px lift centres them on
          the count's digits. */}
      <span
        className="material-symbols-outlined relative -top-px"
        style={{
          fontSize: 18,
          fontVariationSettings: active ? "'FILL' 1" : undefined,
        }}
      >
        {icon}
      </span>
      <span>{count}</span>
    </button>
  );
}
