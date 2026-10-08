import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import type { Activity } from '../data/types';
import { createMoveGate, type MapBounds, type MoveGate } from '../lib/mapBounds';
import { muirWoods } from '../test/fixtures';

// A stand-in Leaflet map: react-leaflet's hooks hand it to the components, and
// `emit` plays the viewport events Leaflet would fire.
const fake = vi.hoisted(() => {
  type Handler = (event: { type: string }) => void;
  const state = {
    handlers: {} as Record<string, Handler>,
    map: {
      getBounds: vi.fn(),
      getSize: vi.fn(),
      flyToBounds: vi.fn(),
      flyTo: vi.fn(),
    },
    emit(type: string) {
      state.handlers[type]?.({ type });
    },
  };
  return state;
});

vi.mock('react-leaflet', () => ({
  useMap: () => fake.map,
  useMapEvents: (handlers: Record<string, (e: { type: string }) => void>) => {
    fake.handlers = handlers;
    return fake.map;
  },
}));

import { BoundsWatcher, FitToActivities, type FitPadding } from './MapViewport';

// A viewport one world copy west of the Bay Area: the reported bounds come
// back normalized.
const LEAFLET_BOUNDS = {
  getNorth: () => 38,
  getSouth: () => 37,
  getEast: () => -482,
  getWest: () => -483,
};
const REPORTED: MapBounds = { north: 38, south: 37, east: -122, west: -123 };

const PADDING: FitPadding = { top: 100, bottom: 168 };

const at = (id: string, lat: number, lng: number): Activity => ({
  ...muirWoods,
  id,
  location: { ...muirWoods.location, coords: { lat, lng } },
});

function stubReducedMotion() {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.handlers = {};
  fake.map.getBounds.mockReset().mockReturnValue(LEAFLET_BOUNDS);
  // Roomy enough that the fit keeps its full padding.
  fake.map.getSize.mockReset().mockReturnValue({ x: 600, y: 800 });
  fake.map.flyToBounds.mockReset();
  fake.map.flyTo.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BoundsWatcher', () => {
  function renderWatcher(gate: MoveGate = createMoveGate()) {
    const onBoundsChange = vi.fn<(b: MapBounds) => void>();
    const utils = render(
      <BoundsWatcher onBoundsChange={onBoundsChange} gate={gate} />,
    );
    return { onBoundsChange, gate, ...utils };
  }

  it('reports the normalized viewport 400 ms after the map settles', () => {
    const { onBoundsChange } = renderWatcher();
    fake.emit('moveend');
    vi.advanceTimersByTime(399);
    expect(onBoundsChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onBoundsChange).toHaveBeenCalledExactlyOnceWith(REPORTED);
  });

  it('reports a zoom too, once for a burst of events', () => {
    const { onBoundsChange } = renderWatcher();
    fake.emit('zoomend');
    vi.advanceTimersByTime(200);
    fake.emit('moveend');
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).toHaveBeenCalledOnce();
  });

  it('drops a pending report when it unmounts', () => {
    const { onBoundsChange, unmount } = renderWatcher();
    fake.emit('moveend');
    unmount();
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).not.toHaveBeenCalled();
  });

  it("reports to the latest callback, dropping the old one's pending report", () => {
    const { onBoundsChange, gate, rerender } = renderWatcher();
    fake.emit('moveend');
    const next = vi.fn<(b: MapBounds) => void>();
    rerender(<BoundsWatcher onBoundsChange={next} gate={gate} />);
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).not.toHaveBeenCalled();

    fake.emit('moveend');
    vi.advanceTimersByTime(400);
    expect(next).toHaveBeenCalledExactlyOnceWith(REPORTED);
    expect(onBoundsChange).not.toHaveBeenCalled();
  });

  it('ignores a programmatic move through its moveend, then reports again', () => {
    const { onBoundsChange, gate } = renderWatcher();
    gate.arm();
    fake.emit('zoomend');
    fake.emit('moveend');
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).not.toHaveBeenCalled();

    // The user's next pan is reported as usual.
    fake.emit('moveend');
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).toHaveBeenCalledExactlyOnceWith(REPORTED);
  });

  it('drops a user pan still waiting when a programmatic move lands', () => {
    const { onBoundsChange, gate } = renderWatcher();
    fake.emit('moveend');
    vi.advanceTimersByTime(200);
    gate.arm();
    fake.emit('moveend');
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).not.toHaveBeenCalled();
  });
});

describe('BoundsWatcher with a fit under way', () => {
  function renderWatcher() {
    const gate = createMoveGate();
    const onBoundsChange = vi.fn<(b: MapBounds) => void>();
    render(<BoundsWatcher onBoundsChange={onBoundsChange} gate={gate} />);
    return { onBoundsChange, gate };
  }

  it('drops a user pan whose report comes due mid-flight', () => {
    const { onBoundsChange, gate } = renderWatcher();
    fake.emit('moveend');
    vi.advanceTimersByTime(200);
    gate.arm();
    // The pan's debounce fires while the flight is still going.
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).not.toHaveBeenCalled();
    fake.emit('moveend');
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).not.toHaveBeenCalled();
  });

  it("reports a drag that cut a flight short, which never got the flight's moveend", () => {
    const { onBoundsChange, gate } = renderWatcher();
    gate.arm();
    fake.emit('dragstart');
    fake.emit('moveend');
    vi.advanceTimersByTime(400);
    expect(onBoundsChange).toHaveBeenCalledExactlyOnceWith(REPORTED);
  });
});

describe('FitToActivities', () => {
  const activities = [at('a', 37.5, -122.5), at('b', 36.6, -121.9)];

  function renderFit(signal: number, list: readonly Activity[] = activities) {
    const gate = createMoveGate();
    const ui = (s: number, l: readonly Activity[]) => (
      <FitToActivities signal={s} activities={l} padding={PADDING} gate={gate} />
    );
    const utils = render(ui(signal, list));
    return {
      gate,
      rerender: (s: number, l: readonly Activity[] = list) =>
        utils.rerender(ui(s, l)),
    };
  }

  it('does not fly for the signal it mounts with', () => {
    const { gate } = renderFit(3);
    expect(fake.map.flyToBounds).not.toHaveBeenCalled();
    expect(fake.map.flyTo).not.toHaveBeenCalled();
    expect(gate.swallow('moveend')).toBe(false);
  });

  it('flies to fit the activities when the signal changes, and arms the gate', () => {
    const { gate, rerender } = renderFit(0);
    rerender(1);
    expect(fake.map.flyToBounds).toHaveBeenCalledExactlyOnceWith(
      [
        [36.6, -122.5],
        [37.5, -121.9],
      ],
      {
        paddingTopLeft: [48, 100],
        paddingBottomRight: [48, 168],
        maxZoom: 12,
        animate: true,
      },
    );
    expect(fake.map.flyTo).not.toHaveBeenCalled();
    expect(gate.swallow('moveend')).toBe(true);
  });

  it('flies again when the signal goes back to an earlier value', () => {
    const { rerender } = renderFit(0);
    rerender(1);
    rerender(0);
    expect(fake.map.flyToBounds).toHaveBeenCalledTimes(2);
  });

  it('shrinks the padding to fit a short map', () => {
    // 268px of padding in a 300px map: scaled to leave 150px for the pins.
    fake.map.getSize.mockReturnValue({ x: 800, y: 300 });
    const { rerender } = renderFit(0);
    rerender(1);
    const scale = 150 / 268;
    expect(fake.map.flyToBounds).toHaveBeenCalledWith(expect.anything(), {
      paddingTopLeft: [48, 100 * scale],
      paddingBottomRight: [48, 168 * scale],
      maxZoom: 12,
      animate: true,
    });
  });

  it('does not fly, or arm the gate, for a map with no size', () => {
    fake.map.getSize.mockReturnValue({ x: 0, y: 0 });
    const { gate, rerender } = renderFit(0);
    rerender(1);
    expect(fake.map.flyToBounds).not.toHaveBeenCalled();
    expect(fake.map.flyTo).not.toHaveBeenCalled();
    expect(gate.isArmed()).toBe(false);
  });

  it('flies only once per signal', () => {
    const { rerender } = renderFit(0);
    rerender(1);
    // New results alone are not a request to re-fit.
    rerender(1, [at('c', 40, -120)]);
    expect(fake.map.flyToBounds).toHaveBeenCalledOnce();
    rerender(2);
    expect(fake.map.flyToBounds).toHaveBeenCalledTimes(2);
  });

  it('fits the activities current when the signal arrives', () => {
    const { rerender } = renderFit(0);
    rerender(1, [at('c', 40, -120)]);
    expect(fake.map.flyToBounds).toHaveBeenCalledWith(
      [
        [40, -120],
        [40, -120],
      ],
      expect.anything(),
    );
  });

  it('flies home when there is nothing to fit', () => {
    const { gate, rerender } = renderFit(0, []);
    rerender(1);
    expect(fake.map.flyTo).toHaveBeenCalledExactlyOnceWith(
      [37.3382, -121.8863],
      8,
      { animate: true },
    );
    expect(fake.map.flyToBounds).not.toHaveBeenCalled();
    expect(gate.swallow('moveend')).toBe(true);
  });

  it('jumps instead of flying when the user prefers reduced motion', () => {
    stubReducedMotion();
    const { rerender } = renderFit(0);
    rerender(1);
    expect(fake.map.flyToBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ animate: false }),
    );
    rerender(2, []);
    expect(fake.map.flyTo).toHaveBeenCalledWith(expect.anything(), 8, {
      animate: false,
    });
  });
});

// The two together, as ActivityMap mounts them: clearing the bounds re-fits
// the map, and that flight must not re-apply a bounds filter (#106).
describe('a re-fit with the bounds watcher', () => {
  it('does not report the re-fit as a pan', () => {
    const gate = createMoveGate();
    const onBoundsChange = vi.fn<(b: MapBounds) => void>();
    const ui = (signal: number) => (
      <>
        <BoundsWatcher onBoundsChange={onBoundsChange} gate={gate} />
        <FitToActivities
          signal={signal}
          activities={[muirWoods]}
          padding={PADDING}
          gate={gate}
        />
      </>
    );
    const { rerender } = render(ui(0));

    rerender(ui(1));
    expect(fake.map.flyToBounds).toHaveBeenCalledOnce();
    // Leaflet ends the flight with a zoomend and a moveend.
    act(() => {
      fake.emit('zoomend');
      fake.emit('moveend');
      vi.advanceTimersByTime(1000);
    });
    expect(onBoundsChange).not.toHaveBeenCalled();

    act(() => {
      fake.emit('moveend');
      vi.advanceTimersByTime(400);
    });
    expect(onBoundsChange).toHaveBeenCalledExactlyOnceWith(REPORTED);
  });
});
