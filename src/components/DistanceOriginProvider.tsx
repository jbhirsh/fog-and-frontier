import { useEffect, useState, type ReactNode } from 'react';
import {
  DistanceOriginCtx,
  HOME_ORIGIN,
  localAnswerStore,
  locateVisitor,
} from '../lib/distanceOrigin';

/**
 * Asks for the visitor's location once, on load (#66), and hands every
 * distance below it the result: the visitor's position, or home until then
 * and whenever there's no position to use.
 */
export function DistanceOriginProvider({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState(HOME_ORIGIN);
  useEffect(() => {
    // Geolocation is absent in some browsers (and jsdom); locateVisitor then
    // does nothing. A position landing after unmount is a no-op setState.
    locateVisitor(
      navigator.geolocation,
      localAnswerStore,
      setOrigin,
      navigator.permissions,
    );
  }, []);
  return <DistanceOriginCtx.Provider value={origin}>{children}</DistanceOriginCtx.Provider>;
}
