import { useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import type { LeafletEvent } from 'leaflet';
import { HOME_LOCATION } from '../data/home';
import type { Activity } from '../data/types';
import {
  activitiesBounds,
  debounce,
  fitPaddingFor,
  toMapBounds,
  type MapBounds,
  type MoveGate,
} from '../lib/mapBounds';
import { useMediaQuery } from '../lib/useMediaQuery';

// The two halves of the map's viewport wiring. Both render inside
// MapContainer so `useMap()` has the map in context, render nothing, and
// share a MoveGate: FitToActivities arms it before a programmatic flight, and
// BoundsWatcher ignores that flight's events instead of reporting them as a
// user pan.

/**
 * Reports the viewport to the parent ~400 ms after the map settles from a
 * pan/zoom (#95), skipping the moves the gate marks as programmatic (#106).
 */
export function BoundsWatcher({
  onBoundsChange,
  gate,
}: {
  onBoundsChange: (bounds: MapBounds) => void;
  gate: MoveGate;
}) {
  const map = useMap();
  const debounced = useMemo(
    () =>
      debounce(() => {
        // A user pan from just before a fit would land mid-flight and put the
        // filter straight back; the flight supersedes it.
        if (!gate.isArmed()) onBoundsChange(toMapBounds(map.getBounds()));
      }, 400),
    [map, onBoundsChange, gate],
  );
  function handleMove(event: LeafletEvent) {
    // Also drop a user pan still waiting on the debounce: the flight
    // supersedes it.
    if (gate.swallow(event.type)) debounced.cancel();
    else debounced();
  }
  useMapEvents({
    moveend: handleMove,
    zoomend: handleMove,
    // A drag stops a flight short of its own moveend; the drag's is the user's.
    dragstart: () => gate.disarm(),
  });
  useEffect(() => () => debounced.cancel(), [debounced]);
  return null;
}

/** Room around the fitted pins, in pixels, clear of the map's own overlays. */
export type FitPadding = { top: number; bottom: number };

// Side padding for a fit, and the closest a fit may zoom in, so a single pin
// (or a tight cluster) still shows its surroundings.
const FIT_SIDE_PX = 48;
const FIT_MAX_ZOOM = 12;
// The view the map opens on (see ActivityMap), used when there's nothing to fit.
const HOME_ZOOM = 8;

/**
 * Flies the map out to fit `activities` each time `signal` changes (#106): the
 * "Clear bounds" button bumps it so the map and the list agree again. Falls
 * back to the home view when no activity has coordinates. The signal the map
 * mounts with is not a request, so a map remounted later doesn't fly.
 */
export function FitToActivities({
  signal,
  activities,
  padding,
  gate,
}: {
  signal: number;
  activities: readonly Activity[];
  padding: FitPadding;
  gate: MoveGate;
}) {
  const map = useMap();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Reads the latest activities and padding without making them reasons to
  // fly: only a new signal is.
  const fit = useEffectEvent(() => {
    const room = fitPaddingFor(map.getSize(), { ...padding, side: FIT_SIDE_PX });
    // A map with no size (not laid out) has nothing to fit into.
    if (!room) return;
    gate.arm();
    const animate = !reduceMotion;
    const corners = activitiesBounds(activities);
    if (corners) {
      map.flyToBounds(corners, {
        paddingTopLeft: [room.side, room.top],
        paddingBottomRight: [room.side, room.bottom],
        maxZoom: FIT_MAX_ZOOM,
        animate,
      });
    } else {
      const { lat, lng } = HOME_LOCATION.coords;
      map.flyTo([lat, lng], HOME_ZOOM, { animate });
    }
  });
  const handled = useRef(signal);
  useEffect(() => {
    if (signal === handled.current) return;
    handled.current = signal;
    fit();
  }, [signal]);
  return null;
}
