// useVisibilityInterval — like setInterval but paused while the document is
// hidden. When the document becomes visible again (visibilitychange) or the
// window regains focus, the callback fires immediately and the interval
// restarts from zero. The latest callback ref is captured so changing the
// callback identity does NOT reset the interval timer.
//
// Usage:
//   useVisibilityInterval(refreshVotes, 30_000, status === 'voting');

import { useEffect, useRef } from 'react';

export function useVisibilityInterval(
  callback: () => void,
  ms: number,
  enabled: boolean,
): void {
  // Always hold the latest callback without re-triggering the effect.
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    function startInterval() {
      stopInterval();
      intervalId = setInterval(() => {
        if (!document.hidden) {
          callbackRef.current();
        }
      }, ms);
    }

    function stopInterval() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function handleVisibility() {
      if (document.hidden) {
        stopInterval();
      } else {
        callbackRef.current();
        startInterval();
      }
    }

    function handleFocus() {
      if (!document.hidden) {
        callbackRef.current();
        startInterval();
      }
    }

    // Kick off immediately (if currently visible).
    if (!document.hidden) {
      startInterval();
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [ms, enabled]);
}
