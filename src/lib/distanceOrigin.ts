import { createContext, useContext } from 'react';
import { HOME_LOCATION } from '../data/home';

// Where distances are measured from (#66). The browser asks for the visitor's
// location on their first visit; with it, distances, distance sorting, the
// distance filter and the map's home pin follow the visitor ("from you").
// Without it (declined, failed, unsupported) they fall back to the fixed home
// point ("from San Jose"). The position is never stored; only a coarse
// (~1 km) version leaves the browser, to fetch road miles (drivingMiles.ts).

export interface DistanceOrigin {
  source: 'device' | 'home';
  coords: { lat: number; lng: number };
  /** Short form, for "27 mi from you" / "27 mi from San Jose". */
  name: string;
  /** Long form, for "sorted by distance from San Jose, CA". */
  label: string;
}

export const HOME_ORIGIN: DistanceOrigin = {
  source: 'home',
  coords: HOME_LOCATION.coords,
  name: HOME_LOCATION.shortLabel,
  label: HOME_LOCATION.label,
};

export function deviceOrigin(coords: { latitude: number; longitude: number }): DistanceOrigin {
  return {
    source: 'device',
    coords: { lat: coords.latitude, lng: coords.longitude },
    name: 'you',
    label: 'you',
  };
}

// Whether the visitor answered the prompt, so a "no" isn't asked again on
// every visit. Only the answer is stored, never the position.
export const LOCATION_STORAGE_KEY = 'fogandfrontier.location.v1';
type Answer = 'granted' | 'denied';

export interface AnswerStore {
  get(): Answer | null;
  set(answer: Answer): void;
}

/** The answer, kept in localStorage; reads and writes fail soft. */
export const localAnswerStore: AnswerStore = {
  get() {
    try {
      const v = localStorage.getItem(LOCATION_STORAGE_KEY);
      return v === 'granted' || v === 'denied' ? v : null;
    } catch {
      return null;
    }
  },
  set(answer) {
    try {
      localStorage.setItem(LOCATION_STORAGE_KEY, answer);
    } catch {
      // Storage blocked: the visitor is asked again next visit.
    }
  },
};

// A coarse, recent fix is plenty for "miles from you".
export const POSITION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 10 * 60 * 1000,
  timeout: 10_000,
};

// GeolocationPositionError.PERMISSION_DENIED; a dismissed prompt reports it too.
const PERMISSION_DENIED = 1;

/**
 * Asks for the visitor's position unless they declined before, reporting a
 * device origin on success. Declining is remembered; a timeout or an
 * unavailable position isn't, so the next visit tries again. Without
 * geolocation support nothing happens and distances stay "from home".
 *
 * After a "no", the app doesn't ask again, but the visitor can still allow
 * location in the browser's site settings. The Permissions API reports that
 * without prompting, so a stored "no" is set aside once the browser says
 * "granted".
 */
export function locateVisitor(
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined,
  store: AnswerStore,
  onOrigin: (origin: DistanceOrigin) => void,
  permissions?: Pick<Permissions, 'query'>,
): void {
  if (!geolocation) return;
  if (store.get() === 'denied') {
    permissions
      ?.query({ name: 'geolocation' })
      .then((status) => {
        if (status.state === 'granted') locate(geolocation, store, onOrigin);
      })
      .catch(() => {
        // No answer from the Permissions API: keep the stored "no".
      });
    return;
  }
  locate(geolocation, store, onOrigin);
}

function locate(
  geolocation: Pick<Geolocation, 'getCurrentPosition'>,
  store: AnswerStore,
  onOrigin: (origin: DistanceOrigin) => void,
): void {
  geolocation.getCurrentPosition(
    (position) => {
      store.set('granted');
      onOrigin(deviceOrigin(position.coords));
    },
    (error) => {
      if (error.code === PERMISSION_DENIED) store.set('denied');
    },
    POSITION_OPTIONS,
  );
}

export const DistanceOriginCtx = createContext<DistanceOrigin>(HOME_ORIGIN);

/** The origin distances are measured from: the visitor, or home. */
export function useDistanceOrigin(): DistanceOrigin {
  return useContext(DistanceOriginCtx);
}
