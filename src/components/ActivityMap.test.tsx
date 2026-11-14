import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { Activity } from '../data/types';
import { DistanceOriginCtx, deviceOrigin, HOME_ORIGIN } from '../lib/distanceOrigin';
import { DrivingMilesCtx, NO_DRIVING_MILES, type DrivingMiles } from '../lib/drivingMiles';
import { CARTO_TILE_URL } from '../lib/mapPins';
import { WORLD_BOUNDS } from '../lib/mapFit';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';
import { fake, iconHtml, markerProps } from '../test/fakeMap';
import { render, type CompletedSeed } from '../test/render';
import { ActivityMap } from './ActivityMap';
import { stubReducedMotion } from '../test/reducedMotion';

vi.mock('react-leaflet', () => import('../test/fakeReactLeaflet'));

beforeEach(() => {
  fake.reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const HOME: [number, number] = [37.3382, -121.8863];

function place(id: string, name: string, lat: number, lng: number): Activity {
  return { ...muirWoods, id, name, location: { city: 'Somewhere, OR', coords: { lat, lng } } };
}

// Two near places apart at the opening zoom: Muir Woods (a hike, to do) and
// the tide pools (scenic, to do), ~50 and ~35 miles from home.
const muir = muirWoods;
const tide = dogFriendlyTidepools;
// Far from home (#109): Portland, past 100 miles.
const far = place('far', 'Far Falls', 45.5, -122.7);
const farTwin = place('far-twin', 'Far Twin', 45.5, -122.7);

type Props = ComponentProps<typeof ActivityMap>;

function renderMap(
  over: Partial<Props> = {},
  {
    completed = [],
    origin = HOME_ORIGIN,
    driving = NO_DRIVING_MILES,
  }: { completed?: CompletedSeed[]; origin?: typeof HOME_ORIGIN; driving?: DrivingMiles } = {},
) {
  const onSelect = vi.fn<(a: Activity) => void>();
  const ui = (p: Partial<Props>) => (
    <DistanceOriginCtx.Provider value={origin}>
      <DrivingMilesCtx.Provider value={driving}>
        <ActivityMap activities={[muir, tide]} onSelect={onSelect} {...over} {...p} />
      </DrivingMilesCtx.Provider>
    </DistanceOriginCtx.Provider>
  );
  const utils = render(ui({}), { completed });
  return { onSelect, ...utils, rerender: (p: Partial<Props>) => utils.rerender(ui(p)) };
}

const markers = () => screen.queryAllByTestId('marker');
const iconOf = (m: HTMLElement) => within(m).getByTestId('marker-icon');
const htmlOf = (m: HTMLElement) => iconHtml(markerProps(m).icon);
const sizeOf = (m: HTMLElement) => markerProps(m).icon.options.iconSize;

/** The marker drawn for a place, found by its tooltip. */
function pinOf(name: string): HTMLElement {
  const tip = screen
    .getAllByTestId('tooltip')
    .find((t) => t.textContent === name && t.closest('[data-testid="marker"]'));
  const marker = tip?.closest<HTMLElement>('[data-testid="marker"]');
  if (!marker) throw new Error(`no pin for ${name}`);
  return marker;
}

/** The marker whose icon reads `label` to a screen reader. */
function markerNamed(label: string): HTMLElement {
  const marker = screen
    .getByText(label, { selector: '.sr-only' })
    .closest('[data-testid="marker"]');
  if (!(marker instanceof HTMLElement)) throw new Error(`no marker ${label}`);
  return marker;
}

/** Home alone: the marker at home's point with no count. */
function homeMarker(): HTMLElement {
  const home = markers().find((m) => markerProps(m).position.join() === HOME.join());
  if (!home) throw new Error('no home');
  return home;
}

// The 400 ms the bounds watcher waits for the map to settle.
function settle() {
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

describe('ActivityMap: the map', () => {
  it('is a world map of CARTO tiles opening on home, with its zoom, credit and legend', () => {
    renderMap();
    expect(fake.containerProps).toMatchObject({
      center: HOME,
      zoom: 8,
      maxZoom: 18,
      worldCopyJump: true,
      maxBounds: WORLD_BOUNDS,
      maxBoundsViscosity: 1,
      scrollWheelZoom: true,
      zoomControl: false,
      attributionControl: false,
      style: { height: '100%', width: '100%' },
    });
    expect(fake.tileUrl).toBe(CARTO_TILE_URL);
    expect(screen.getByRole('button', { name: 'Zoom in' }).parentElement).toHaveStyle({
      top: '12px',
    });
    expect(screen.getByRole('button', { name: 'Map credits' })).toBeInTheDocument();
    for (const label of ['Home', 'Completed', 'To do', '100+ mi']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('frames itself, or runs edge to edge in full bleed with its controls clear of the header and sheet', () => {
    const { container, rerender } = renderMap();
    const frame = container.firstElementChild;
    expect(frame).toHaveClass('rounded-xl');
    const legend = screen.getByText('Home').parentElement;
    expect(legend).toHaveStyle({ bottom: '12px', left: '12px' });
    expect(screen.getByText('100+ mi').firstElementChild).toHaveClass('size-1.5');
    expect(screen.getByText('100+ mi').firstElementChild).not.toHaveClass('size-3');
    expect(screen.getByText('Home').firstElementChild).toHaveClass('size-3');
    const dot = (label: string) => screen.getByText(label).firstElementChild;
    expect(dot('Home')).toHaveAttribute('style', 'background: rgb(220, 38, 38);');
    expect(dot('Completed')).toHaveAttribute('style', 'background: rgb(22, 163, 74);');
    expect(dot('To do')).toHaveAttribute('style', 'background: rgb(14, 165, 233);');
    expect(dot('100+ mi')).toHaveAttribute('style', 'background: rgb(14, 165, 233);');

    rerender({ fullBleed: true });
    expect(frame).not.toHaveClass('rounded-xl');
    expect(legend).toHaveStyle({ bottom: '80px' });
    expect(screen.getByRole('button', { name: 'Zoom in' }).parentElement).toHaveStyle({
      top: '88px',
    });
  });

  it('tells the page of a tap on the map itself', () => {
    const onMapTap = vi.fn();
    renderMap({ onMapTap });
    fake.emit('click');
    expect(onMapTap).toHaveBeenCalledOnce();
  });

  it('leaves the map as it was on a tap with no listener', () => {
    const { onSelect } = renderMap();
    const before = markers().map((m) => m.outerHTML);
    fake.emit('click');
    expect(markers().map((m) => m.outerHTML)).toEqual(before);
    expect(onSelect).not.toHaveBeenCalled();
    expect(fake.map.flyToBounds).not.toHaveBeenCalled();
    expect(fake.map.closePopup).not.toHaveBeenCalled();
  });
});

describe('ActivityMap: pins', () => {
  it('draws home and a pin per place, to do in blue with its category, completed in green with a check', () => {
    renderMap({}, { completed: [{ id: tide.id, completed: true }] });
    expect(markers()).toHaveLength(3);
    const home = homeMarker();
    expect(htmlOf(home)).toContain('#dc2626');
    expect(htmlOf(home)).toContain('data-icon="home"');

    const muirPin = pinOf(muir.name);
    expect(markerProps(muirPin).position).toEqual([37.8917, -122.5719]);
    expect(htmlOf(muirPin)).toContain('#0ea5e9');
    expect(htmlOf(muirPin)).toContain('directions_walk');
    expect(sizeOf(muirPin)).toEqual([30, 30]);
    expect(markerProps(muirPin).zIndexOffset).toBe(0);

    const tidePin = pinOf(tide.name);
    expect(htmlOf(tidePin)).toContain('#16a34a');
    expect(htmlOf(tidePin)).toContain('data-icon="check"');
  });

  it('shares one icon among pins alike, render after render', () => {
    const twin = place('twin', 'Twin', 36.6, -121.9);
    const { rerender } = renderMap({ activities: [muir, tide, twin] });
    expect(markerProps(pinOf(muir.name)).icon).toBe(markerProps(pinOf('Twin')).icon);
    const before = markers().map((m) => markerProps(m).icon);
    rerender({ highlightedId: 'nothing' });
    expect(markers().map((m) => markerProps(m).icon)).toEqual(before);
    markers().forEach((m, i) => expect(markerProps(m).icon).toBe(before[i]));
  });

  it('pops up a pin’s place, its distance and a way to its details, without onActivate', () => {
    const { onSelect } = renderMap();
    const pin = pinOf(muir.name);
    const popup = within(pin).getByTestId('popup');
    expect(popup).toHaveTextContent(
      `${muir.name}Mill Valley, CA · ≈54 mi from San Jose · Half Day`,
    );
    // The pin itself has no click of its own: Leaflet opens the popup.
    fireEvent.click(iconOf(pin));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(within(popup).getByRole('button', { name: 'View details →' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(muir);
  });

  it('measures from the visitor, by road where known', () => {
    renderMap(
      {},
      {
        origin: deviceOrigin({ latitude: 37.8, longitude: -122.27 }),
        driving: new Map([[muir.id, 21]]),
      },
    );
    expect(within(pinOf(muir.name)).getByTestId('popup')).toHaveTextContent('21 mi from you');
    // Home is where the visitor is.
    const here = screen.getByText('You are here').closest<HTMLElement>('[data-testid="marker"]');
    expect(here && markerProps(here).position).toEqual([37.8, -122.27]);
  });

  it('pops up home as the home base', () => {
    renderMap();
    expect(within(homeMarker()).getByTestId('popup')).toHaveTextContent(/^San Jose, CAHome base$/);
    expect(markerProps(homeMarker()).zIndexOffset).toBeUndefined();
  });

  it('names a pin in a tooltip above it', () => {
    renderMap();
    const tip = within(pinOf(muir.name)).getByTestId('tooltip');
    expect(tip).toHaveAttribute('data-direction', 'top');
    expect(tip).toHaveAttribute('data-offset', '0,-6');
  });

  it('redraws for new places', () => {
    const { rerender } = renderMap();
    rerender({ activities: [muir] });
    expect(markers()).toHaveLength(2);
    expect(screen.queryByText(tide.name)).not.toBeInTheDocument();
    const monterey = place('monterey', 'Monterey', 36.6, -121.9);
    rerender({ activities: [muir, monterey] });
    expect(markers()).toHaveLength(3);
    expect(pinOf('Monterey')).toBeInTheDocument();
  });

  it('opens a pin straight away with onActivate, and has no popup', () => {
    const onActivate = vi.fn();
    const { onSelect } = renderMap({ onActivate });
    const pin = pinOf(muir.name);
    expect(within(pin).queryByTestId('popup')).not.toBeInTheDocument();
    fireEvent.click(iconOf(pin));
    expect(onActivate).toHaveBeenCalledExactlyOnceWith(muir);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('raises and enlarges the highlighted pin', () => {
    const { rerender } = renderMap({ highlightedId: muir.id });
    const pin = pinOf(muir.name);
    expect(sizeOf(pin)).toEqual([40, 40]);
    expect(markerProps(pin).zIndexOffset).toBe(1000);
    expect(htmlOf(pin)).toContain('directions_walk');
    expect(htmlOf(pin)).toContain('#0ea5e9');
    expect(sizeOf(pinOf(tide.name))).toEqual([30, 30]);
    expect(markerProps(pinOf(tide.name)).zIndexOffset).toBe(0);

    rerender({ highlightedId: tide.id });
    expect(sizeOf(pinOf(muir.name))).toEqual([30, 30]);
    expect(sizeOf(pinOf(tide.name))).toEqual([40, 40]);
  });

  it('highlights a completed pin in green with its check', () => {
    renderMap({ highlightedId: tide.id }, { completed: [{ id: tide.id, completed: true }] });
    const pin = pinOf(tide.name);
    expect(sizeOf(pin)).toEqual([40, 40]);
    expect(htmlOf(pin)).toContain('#16a34a');
    expect(htmlOf(pin)).toContain('data-icon="check"');
  });

  it('tells the page which pin is hovered, and lets go when the pointer leaves', () => {
    const onPinHoverChange = vi.fn();
    renderMap({ onPinHoverChange });
    const pin = iconOf(pinOf(muir.name));
    fireEvent.mouseOver(pin);
    expect(onPinHoverChange).toHaveBeenLastCalledWith(muir);
    expect(markerProps(pinOf(muir.name)).zIndexOffset).toBe(1000);
    fireEvent.mouseOut(pin);
    expect(onPinHoverChange).toHaveBeenLastCalledWith(null);
    expect(markerProps(pinOf(muir.name)).zIndexOffset).toBe(0);
    expect(onPinHoverChange).toHaveBeenCalledTimes(2);
  });

  it('keeps a pin raised when the pointer leaves another', () => {
    renderMap();
    fireEvent.mouseOver(iconOf(pinOf(muir.name)));
    fireEvent.mouseOut(iconOf(pinOf(tide.name)));
    expect(markerProps(pinOf(muir.name)).zIndexOffset).toBe(1000);
  });

  it('hovers without a listener', () => {
    renderMap();
    fireEvent.mouseOver(iconOf(pinOf(muir.name)));
    fireEvent.mouseOut(iconOf(pinOf(muir.name)));
    expect(markerProps(pinOf(muir.name)).zIndexOffset).toBe(0);
  });
});

describe('ActivityMap: far places (#109)', () => {
  it('draws a far place as a small dot beside a near one, under the full pins', () => {
    renderMap({ activities: [muir, far] }, { completed: [{ id: muir.id, completed: true }] });
    const dot = pinOf(far.name);
    expect(sizeOf(dot)).toEqual([24, 24]);
    expect(htmlOf(dot)).toContain('#0ea5e9');
    expect(htmlOf(dot)).not.toContain('data-icon');
    expect(markerProps(dot).zIndexOffset).toBe(-1000);
  });

  it('draws a completed far place as a green dot', () => {
    renderMap({ activities: [muir, far] }, { completed: [{ id: far.id, completed: true }] });
    const dot = pinOf(far.name);
    expect(sizeOf(dot)).toEqual([24, 24]);
    expect(htmlOf(dot)).toContain('#16a34a');
  });

  it('grows a far dot into a full pin while hovered or highlighted', () => {
    const { rerender } = renderMap({ activities: [muir, far] });
    fireEvent.mouseOver(iconOf(pinOf(far.name)));
    expect(sizeOf(pinOf(far.name))).toEqual([30, 30]);
    expect(markerProps(pinOf(far.name)).zIndexOffset).toBe(1000);
    fireEvent.mouseOut(iconOf(pinOf(far.name)));
    expect(sizeOf(pinOf(far.name))).toEqual([24, 24]);

    rerender({ activities: [muir, far], highlightedId: far.id });
    expect(sizeOf(pinOf(far.name))).toEqual([40, 40]);
  });

  it('keeps a far place whole with no near place in view', () => {
    renderMap({ activities: [muir, far] });
    expect(sizeOf(pinOf(far.name))).toEqual([24, 24]);
    // Panned to Oregon: only the far place is in view.
    fake.bounds = { north: 47, south: 44, east: -120, west: -125 };
    fake.emit('moveend');
    expect(sizeOf(pinOf(far.name))).toEqual([30, 30]);
    expect(markerProps(pinOf(far.name)).zIndexOffset).toBe(0);
  });

  it('keeps every place whole on a map of only far places', () => {
    renderMap({ activities: [far] });
    expect(sizeOf(pinOf(far.name))).toEqual([30, 30]);
  });
});

describe('ActivityMap: groups (#291)', () => {
  // Muir Woods and the completed hike, ~3 miles apart: one group at the
  // opening zoom, parted by zooming in.
  const close = [muir, completedHike, tide];

  it('draws places that would overlap as one group with their count, which a tap flies in to', () => {
    renderMap({ activities: close });
    expect(markers()).toHaveLength(3);
    const group = markerNamed('2 places, zoom in');
    expect(markerProps(group).zIndexOffset).toBe(500);
    // Drawn at its seed: a tie goes to the lower id.
    expect(markerProps(group).position).toEqual([37.9295, -122.5807]);
    const tip = within(group).getByTestId('tooltip');
    expect(tip).toHaveTextContent(/^2 places$/);
    expect(tip).toHaveAttribute('data-direction', 'top');
    expect(tip).toHaveAttribute('data-offset', '0,-10');
    expect(within(group).queryByTestId('popup')).not.toBeInTheDocument();
    expect(htmlOf(group)).toContain('#001e37');
    expect(htmlOf(group)).not.toContain('#0ea5e9');

    fireEvent.click(iconOf(group));
    expect(fake.map.flyToBounds).toHaveBeenCalledExactlyOnceWith(
      expect.arrayContaining([
        [37.8917, -122.5719],
        [37.9295, -122.5807],
      ]),
      { paddingTopLeft: [48, 48], paddingBottomRight: [48, 56], maxZoom: 18, animate: true },
    );
    expect(fake.map.flyToBounds.mock.calls[0][0]).toHaveLength(2);
  });

  it('parts the group as the map zooms in', () => {
    renderMap({ activities: close });
    fake.zoom = 13;
    fake.emit('zoomend');
    expect(markers()).toHaveLength(4);
    expect(pinOf(completedHike.name)).toBeInTheDocument();
  });

  it('flies in with the padding full bleed keeps clear, without motion when asked', () => {
    stubReducedMotion();
    renderMap({ activities: close, fullBleed: true });
    fireEvent.click(iconOf(markerNamed('2 places, zoom in')));
    expect(fake.map.flyToBounds).toHaveBeenCalledWith(expect.anything(), {
      paddingTopLeft: [48, 100],
      paddingBottomRight: [48, 160],
      maxZoom: 18,
      animate: false,
    });
  });

  it('scales the padding for a small map, and doesn’t fly in a map with no size', () => {
    fake.size = { x: 100, y: 52 };
    renderMap({ activities: close });
    fireEvent.click(iconOf(markerNamed('2 places, zoom in')));
    expect(fake.map.flyToBounds).toHaveBeenCalledWith(expect.anything(), {
      paddingTopLeft: [25, 12],
      paddingBottomRight: [25, 14],
      maxZoom: 18,
      animate: true,
    });

    fake.map.flyToBounds.mockClear();
    fake.size = { x: 0, y: 0 };
    fireEvent.click(iconOf(markerNamed('2 places, zoom in')));
    expect(fake.map.flyToBounds).not.toHaveBeenCalled();
  });

  it('keeps focus on the map when the focused group parts', () => {
    renderMap({ activities: close });
    const group = iconOf(markerNamed('2 places, zoom in'));
    group.focus();
    const focus = vi.spyOn(fake.map.getContainer(), 'focus');
    fireEvent.click(group);
    expect(fake.map.getContainer()).toHaveFocus();
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it('leaves focus be when it’s elsewhere', () => {
    renderMap({ activities: close });
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    zoomIn.focus();
    fireEvent.click(iconOf(markerNamed('2 places, zoom in')));
    expect(zoomIn).toHaveFocus();
  });

  it('outlines the group holding the highlighted place', () => {
    renderMap({ activities: close, highlightedId: completedHike.id });
    expect(htmlOf(markerNamed('2 places, zoom in'))).toContain('3px solid #0ea5e9');
  });

  it('outlines no group for a place outside it', () => {
    renderMap({ activities: close, highlightedId: tide.id });
    expect(htmlOf(markerNamed('2 places, zoom in'))).not.toContain('#0ea5e9');
  });

  it('caches a group’s icon across renders', () => {
    const { rerender } = renderMap({ activities: close });
    const icon = markerProps(markerNamed('2 places, zoom in')).icon;
    rerender({ activities: close, onMapTap: () => {} });
    expect(markerProps(markerNamed('2 places, zoom in')).icon).toBe(icon);
  });

  it('lists places at one spot, each opening as its pin would', () => {
    const onActivate = vi.fn();
    const twin = { ...muir, id: 'muir-twin', name: 'Muir Twin' };
    renderMap({ activities: [muir, twin, tide], onActivate });
    const group = markerNamed('2 places, list them');
    expect(markerProps(group).eventHandlers).toEqual({});
    const popup = within(group).getByTestId('popup');
    expect(within(popup).getByText('2 places here')).toBeInTheDocument();
    const items = within(popup).getAllByRole('button');
    // The seed first: a tie goes to the lower id.
    expect(items.map((b) => b.textContent)).toEqual(['Muir Twin', muir.name]);

    const focus = vi.spyOn(fake.map.getContainer(), 'focus');
    fireEvent.click(items[0]);
    expect(onActivate).toHaveBeenCalledExactlyOnceWith(twin);
    expect(fake.map.closePopup).toHaveBeenCalledOnce();
    expect(fake.map.getContainer()).toHaveFocus();
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it('opens a listed place with onSelect when there is no onActivate', () => {
    const twin = { ...muir, id: 'muir-twin', name: 'Muir Twin' };
    const { onSelect } = renderMap({ activities: [muir, twin] });
    fireEvent.click(screen.getByRole('button', { name: muir.name }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(muir);
  });

  it('draws a group of only far places small and under the rest', () => {
    renderMap({ activities: [muir, far, farTwin] });
    const group = markerNamed('2 places, list them');
    expect(markerProps(group).zIndexOffset).toBe(-500);
    expect(sizeOf(group)).toEqual([24, 24]);
    expect(htmlOf(group)).toContain('#64748b');
  });

  it('lets go of a hovered pin a zoom pulls into a group', () => {
    const onPinHoverChange = vi.fn();
    renderMap({ activities: close, onPinHoverChange });
    fake.zoom = 13;
    fake.emit('zoomend');
    fireEvent.mouseOver(iconOf(pinOf(muir.name)));
    expect(onPinHoverChange).toHaveBeenLastCalledWith(muir);

    fake.zoom = 8;
    fake.emit('zoomend');
    expect(onPinHoverChange).toHaveBeenLastCalledWith(null);
    expect(onPinHoverChange).toHaveBeenCalledTimes(2);
    // Parted again, it isn't raised: the hover was let go of.
    fake.zoom = 13;
    fake.emit('zoomend');
    expect(markerProps(pinOf(muir.name)).zIndexOffset).toBe(0);
  });

  it('lets go of a hovered pin without a listener', () => {
    renderMap({ activities: close });
    fake.zoom = 13;
    fake.emit('zoomend');
    fireEvent.mouseOver(iconOf(pinOf(muir.name)));
    fake.zoom = 8;
    fake.emit('zoomend');
    expect(markerNamed('2 places, zoom in')).toBeInTheDocument();
  });
});

describe('ActivityMap: home holding the places beside it', () => {
  const nextDoor = place('next-door', 'Next Door', 37.35, -121.9);
  const atHome = place('at-home', 'At Home', ...HOME);
  const alsoHome = place('also-home', 'Also Home', ...HOME);

  it('carries their count, and a tap flies in to home and them', () => {
    renderMap({ activities: [nextDoor, muir] });
    expect(markers()).toHaveLength(2);
    const home = markerNamed('San Jose, and 1 place beside it, zoom in');
    expect(markerProps(home).position).toEqual(HOME);
    expect(markerProps(home).zIndexOffset).toBe(500);
    expect(within(home).queryByTestId('popup')).not.toBeInTheDocument();
    expect(htmlOf(home)).toContain('data-icon="home"');
    expect(htmlOf(home)).toContain('#001e37');
    fireEvent.click(iconOf(home));
    expect(fake.map.flyToBounds).toHaveBeenCalledExactlyOnceWith(
      [HOME, [37.35, -121.9]],
      expect.objectContaining({ maxZoom: 18 }),
    );
  });

  it('turns its badge blue for a highlighted place beside it', () => {
    renderMap({ activities: [nextDoor, muir], highlightedId: nextDoor.id });
    expect(htmlOf(markerNamed('San Jose, and 1 place beside it, zoom in'))).not.toContain(
      '#001e37',
    );
  });

  it('keeps its badge navy for a highlighted place elsewhere', () => {
    renderMap({ activities: [nextDoor, muir], highlightedId: muir.id });
    expect(htmlOf(markerNamed('San Jose, and 1 place beside it, zoom in'))).toContain('#001e37');
  });

  it('caches its icon across renders', () => {
    const { rerender } = renderMap({ activities: [nextDoor] });
    const icon = markerProps(markerNamed('San Jose, and 1 place beside it, zoom in')).icon;
    rerender({ activities: [nextDoor], onMapTap: () => {} });
    expect(markerProps(markerNamed('San Jose, and 1 place beside it, zoom in')).icon).toBe(icon);
  });

  it('lists the places at home itself', () => {
    const onActivate = vi.fn();
    renderMap({ activities: [atHome, alsoHome], onActivate });
    const home = markerNamed('San Jose, and 2 places beside it, list them');
    expect(markerProps(home).eventHandlers).toEqual({});
    const popup = within(home).getByTestId('popup');
    expect(popup).toHaveTextContent('2 places here');
    fireEvent.click(within(popup).getByRole('button', { name: 'At Home' }));
    expect(onActivate).toHaveBeenCalledExactlyOnceWith(atHome);
  });
});

describe('ActivityMap: the viewport', () => {
  it('reports where the map settles, but not its own fit', () => {
    vi.useFakeTimers();
    const onBoundsChange = vi.fn();
    const { rerender } = renderMap({ onBoundsChange });
    fake.emit('moveend');
    settle();
    expect(onBoundsChange).toHaveBeenCalledExactlyOnceWith({
      north: 39,
      south: 36,
      east: -120,
      west: -124,
    });

    // "Clear bounds" flies out to fit every place: not a pan.
    rerender({ onBoundsChange, fitSignal: 1 });
    expect(fake.map.flyToBounds).toHaveBeenCalledWith(expect.anything(), {
      paddingTopLeft: [48, 48],
      paddingBottomRight: [48, 56],
      maxZoom: 12,
      animate: true,
    });
    fake.emit('moveend');
    settle();
    expect(onBoundsChange).toHaveBeenCalledOnce();
  });

  it('fits full bleed clear of the header and the sheet', () => {
    const { rerender } = renderMap({ fullBleed: true });
    rerender({ fullBleed: true, fitSignal: 1 });
    expect(fake.map.flyToBounds).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ paddingTopLeft: [48, 100], paddingBottomRight: [48, 160] }),
    );
  });

  it('hands a fit in flight over to a tap on a group', () => {
    vi.useFakeTimers();
    const onBoundsChange = vi.fn();
    const activities = [muir, completedHike];
    const { rerender } = renderMap({ activities, onBoundsChange });
    rerender({ activities, onBoundsChange, fitSignal: 1 });
    fireEvent.click(iconOf(markerNamed('2 places, zoom in')));
    fake.emit('moveend');
    settle();
    expect(onBoundsChange).toHaveBeenCalledOnce();
  });

  it('takes a popup’s pan to fit itself in as the map’s own', () => {
    vi.useFakeTimers();
    const onBoundsChange = vi.fn();
    renderMap({ onBoundsChange });
    fake.emit('autopanstart');
    fake.emit('moveend');
    settle();
    expect(onBoundsChange).not.toHaveBeenCalled();
  });

  it('reports nothing without a listener', () => {
    vi.useFakeTimers();
    renderMap();
    fake.emit('moveend');
    const read = fake.map.getBounds.mock.calls.length;
    settle();
    // No report once the map settles: nothing reads the bounds to send one.
    expect(fake.map.getBounds).toHaveBeenCalledTimes(read);
  });
});

describe('ActivityMap: keeping a carded pin in view (#291)', () => {
  it('pans a pin under the card clear of it, as the map’s own move', () => {
    vi.useFakeTimers();
    const onBoundsChange = vi.fn();
    // Below the card's clearance: 600 - 240.
    fake.containerPoint = { x: 400, y: 361 };
    const { rerender } = renderMap({ onBoundsChange });
    // The pin's card shows once the map is up.
    rerender({ onBoundsChange, keepInViewId: muir.id });
    expect(fake.map.latLngToContainerPoint).toHaveBeenCalledWith([37.8917, -122.5719]);
    expect(fake.map.panInside).toHaveBeenCalledExactlyOnceWith([37.8917, -122.5719], {
      paddingTopLeft: [48, 48],
      paddingBottomRight: [48, 240],
      animate: true,
    });
    fake.emit('moveend');
    settle();
    expect(onBoundsChange).not.toHaveBeenCalled();
  });

  it('pans full bleed clear of the header, without motion when asked', () => {
    stubReducedMotion();
    fake.containerPoint = { x: 400, y: 50 };
    const { rerender } = renderMap({ fullBleed: true });
    rerender({ fullBleed: true, keepInViewId: tide.id });
    // 340px of padding in a 600px map: scaled to leave 300px.
    const scale = 300 / 340;
    expect(fake.map.panInside).toHaveBeenCalledExactlyOnceWith([37.5235, -122.5172], {
      paddingTopLeft: [48, 100 * scale],
      paddingBottomRight: [48, 240 * scale],
      animate: false,
    });
  });

  it('leaves a pin already clear of the card where it is, and the area filter armed for the user', () => {
    vi.useFakeTimers();
    const onBoundsChange = vi.fn();
    fake.containerPoint = { x: 400, y: 360 };
    const { rerender } = renderMap({ onBoundsChange });
    rerender({ onBoundsChange, keepInViewId: muir.id });
    expect(fake.map.latLngToContainerPoint).toHaveBeenCalledOnce();
    expect(fake.map.panInside).not.toHaveBeenCalled();
    fake.emit('moveend');
    settle();
    expect(onBoundsChange).toHaveBeenCalledOnce();

    // A pin the map doesn't hold, or none, moves nothing.
    fake.containerPoint = { x: 0, y: 0 };
    rerender({ onBoundsChange, keepInViewId: 'gone' });
    rerender({ onBoundsChange, keepInViewId: null });
    expect(fake.map.panInside).not.toHaveBeenCalled();
  });

  it('pans again for the next carded pin', () => {
    fake.containerPoint = { x: 0, y: 0 };
    const { rerender } = renderMap();
    rerender({ keepInViewId: muir.id });
    rerender({ keepInViewId: tide.id });
    expect(fake.map.panInside).toHaveBeenCalledTimes(2);
    expect(fake.map.panInside).toHaveBeenLastCalledWith([37.5235, -122.5172], expect.anything());
  });

  it('waits for the map before keeping a pin in view', () => {
    fake.containerPoint = { x: 0, y: 0 };
    renderMap({ keepInViewId: muir.id });
    expect(fake.map.panInside).not.toHaveBeenCalled();
  });

  it('doesn’t pan a map with no size', () => {
    fake.size = { x: 0, y: 0 };
    fake.containerPoint = { x: -1, y: -1 };
    const { rerender } = renderMap();
    rerender({ keepInViewId: muir.id });
    expect(fake.map.panInside).not.toHaveBeenCalled();
  });
});
