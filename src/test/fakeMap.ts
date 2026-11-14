import { useEffect } from 'react';
import { act } from '@testing-library/react';
import * as L from 'leaflet';
import { vi } from 'vitest';

// A stand-in for react-leaflet, for the maps' tests: jsdom lays nothing out,
// so a real Leaflet map has no size to fit or pan in. A test mocks the module
// with it:
//
//   vi.mock('react-leaflet', () => import('../test/fakeReactLeaflet'));
//
// and drives `fake` from here: the map every hook and ref hands out, its zoom,
// size and viewport, and `emit`, which plays the events Leaflet would fire.
// This module holds that state and the hooks; FakeLeaflet.tsx the components,
// which draw a marker's icon HTML (its screen-reader text queryable) with its
// popup and tooltip beside it, always open.

type Handler = (event: { type: string }) => void;

const listeners = new Set<Record<string, Handler | undefined>>();
const mapListeners = new Map<string, Set<() => void>>();

function defaults() {
  return {
    zoom: 8,
    minZoom: 0,
    maxZoom: 18,
    size: { x: 800, y: 600 },
    bounds: { north: 39, south: 36, east: -120, west: -124 },
    containerPoint: { x: 400, y: 300 },
    /** The props MapContainer was last rendered with. */
    containerProps: {} as Record<string, unknown>,
    /** The URL TileLayer was last given. */
    tileUrl: '',
  };
}

// The fake's settings, which its map reads: one object with `fake` below.
const state = defaults();

function makeMap() {
  // In the document, so it can take focus.
  const container = document.createElement('div');
  container.tabIndex = 0;
  document.body.append(container);
  return {
    getZoom: vi.fn(() => state.zoom),
    getMaxZoom: vi.fn(() => state.maxZoom),
    getMinZoom: vi.fn(() => state.minZoom),
    setMinZoom: vi.fn((z: number) => {
      state.minZoom = z;
    }),
    getSize: vi.fn(() => ({ ...state.size })),
    getBounds: vi.fn(() => ({
      getNorth: () => state.bounds.north,
      getSouth: () => state.bounds.south,
      getEast: () => state.bounds.east,
      getWest: () => state.bounds.west,
    })),
    // Real Web Mercator, so pins group as they would on a real map.
    project: vi.fn(([lat, lng]: [number, number], zoom: number) =>
      L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lng), zoom),
    ),
    latLngToContainerPoint: vi.fn<(point: [number, number]) => { x: number; y: number }>(() => ({
      ...state.containerPoint,
    })),
    on: vi.fn((type: string, fn: () => void) => {
      const set = mapListeners.get(type) ?? new Set();
      set.add(fn);
      mapListeners.set(type, set);
    }),
    off: vi.fn((type: string, fn: () => void) => {
      mapListeners.get(type)?.delete(fn);
    }),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    flyTo: vi.fn(),
    flyToBounds: vi.fn(),
    panInside: vi.fn(),
    closePopup: vi.fn(),
    getContainer: vi.fn(() => container),
  };
}

type Fake = ReturnType<typeof defaults> & {
  map: ReturnType<typeof makeMap>;
  reset(): void;
  emit(type: string): void;
};

export const fake: Fake = Object.assign(state, {
  map: makeMap(),
  /** A fresh map and defaults, for each test. */
  reset() {
    listeners.clear();
    mapListeners.clear();
    fake.map.getContainer().remove();
    Object.assign(fake, defaults(), { map: makeMap() });
  },
  /** Fires a map event, as Leaflet would, to hooks and `map.on` listeners alike. */
  emit(type: string) {
    act(() => {
      for (const handlers of [...listeners]) handlers[type]?.({ type });
      for (const fn of [...(mapListeners.get(type) ?? [])]) fn();
    });
  },
});

export function useMap() {
  return fake.map;
}

export function useMapEvents(handlers: Record<string, Handler | undefined>) {
  useEffect(() => {
    listeners.add(handlers);
    return () => {
      listeners.delete(handlers);
    };
  }, [handlers]);
  return fake.map;
}

export interface MarkerProps {
  position: [number, number];
  icon: L.DivIcon;
  zIndexOffset?: number;
  eventHandlers?: Record<string, (() => void) | undefined>;
}

const markerPropsByEl = new WeakMap<Element, MarkerProps>();

/** Notes what the marker drawn as `el` was given (FakeLeaflet's Marker). */
export function registerMarker(el: Element, props: MarkerProps) {
  markerPropsByEl.set(el, props);
}

/** What a drawn marker (its `marker-icon` element, or the box holding it) was given. */
export function markerProps(el: Element): MarkerProps {
  const icon = el.matches('[data-testid="marker-icon"]')
    ? el
    : el.querySelector('[data-testid="marker-icon"]');
  const props = icon && markerPropsByEl.get(icon);
  if (!props) throw new Error('not a marker');
  return props;
}

/** A marker's icon HTML: every icon the maps make is a string of it. */
export function iconHtml(icon: L.DivIcon): string {
  const { html } = icon.options;
  if (typeof html !== 'string') throw new Error('not an HTML icon');
  return html;
}
