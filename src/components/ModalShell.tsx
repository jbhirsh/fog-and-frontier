import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap, useReturnFocus } from '../lib/focusTrap';

/**
 * A centred dialog over a dimmed page, closed from its backdrop or Escape:
 * the trip page's confirmations, its slot picker, and on a phone its lists
 * (#294). It takes focus as it opens, keeps Tab inside, and gives focus
 * back to what had it as it closes. As a `card` (sign-in and the account
 * menu) it's narrow, edge to edge, with a close button: what it holds lays
 * itself out, its own heading included, and `title` only names it.
 */
export function ModalShell({
  title,
  onCancel,
  children,
  layout = 'page',
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
  layout?: 'page' | 'card';
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog);
  useReturnFocus();
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center py-md px-margin">
      <button
        type="button"
        aria-label="Close dialog"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          layout === 'card'
            ? 'relative max-h-[calc(100dvh-2*var(--spacing-md))] w-full max-w-100 overflow-y-auto overscroll-contain rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-xl focus:outline-none'
            : 'relative max-h-[calc(100dvh-2*var(--spacing-md))] w-full max-w-2xl space-y-md overflow-y-auto overscroll-contain rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-md shadow-xl focus:outline-none md:p-lg'
        }
      >
        {layout === 'card' ? (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="absolute top-sm right-sm inline-flex size-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-icon-md" aria-hidden="true">
              close
            </span>
          </button>
        ) : (
          <h2 className="font-headline-md text-headline-md text-on-surface">{title}</h2>
        )}
        {children}
      </div>
    </div>
  );
}
