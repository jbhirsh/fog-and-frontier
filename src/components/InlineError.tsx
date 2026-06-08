// Small inline error banner — the shared version of the error-message pattern
// from AddToTripDialog (#51 c15). Used for vote 409s, invite-claim failures,
// and other recoverable trip-action errors. Renders nothing when message is
// null so callers can render it unconditionally.
export function InlineError({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-sm bg-error-container text-on-error-container px-md py-sm rounded-lg font-body-md"
    >
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0 text-on-error-container/80 hover:text-on-error-container"
        >
          <span className="material-symbols-outlined text-body-md">close</span>
        </button>
      )}
    </div>
  );
}
