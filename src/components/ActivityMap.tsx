import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import type * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapZoomControls } from './MapZoomControls';
import { MapCredit } from './MapCredit';
import { WORLD_BOUNDS } from '../lib/mapFit';
import { BoundsWatcher, FitToActivities, ViewportWatcher } from './MapViewport';
import { HOME_LOCATION } from '../data/home';
import { useDistanceOrigin } from '../lib/distanceOrigin';
import { formatMiles, useDistanceTo } from '../lib/drivingMiles';
import type { Activity, Category } from '../data/types';
import { isEffectivelyCompleted, useOverrides } from '../lib/userCompleted';
import { createMoveGate, fitPaddingFor, isInsidePadding, type MapBounds } from '../lib/mapBounds';
import { drawPins, type DrawnPins } from '../lib/pinGroups';
import { useMediaQuery } from '../lib/useMediaQuery';
import {
  CARTO_TILE_URL,
  CATEGORY_ICON,
  MINOR_PIN_MILES,
  glyphPin,
  groupPin,
  hasNearPinInView,
  homePin,
  isMinorPin,
  minorPin,
  pinZIndex,
} from '../lib/mapPins';

const COLORS = {
  completed: '#16a34a',
  pending: '#0ea5e9',
  home: '#dc2626',
};

// Status carries meaning via color: home (red), completed (green), pending
// (blue). The glyph reinforces it — a house for home, a check for completed,
// and the activity's category icon for pending (so you see what's still to do).
const completedIcon = glyphPin(COLORS.completed, { icon: 'check' });

const pendingIcons: Partial<Record<Category, L.DivIcon>> = {};
function pendingIcon(category: Category): L.DivIcon {
  return (pendingIcons[category] ??= glyphPin(COLORS.pending, {
    icon: CATEGORY_ICON[category],
  }));
}

// Far-away activities are minor dots in their status color (#109): one shared
// icon per status.
const minorCompletedIcon = minorPin(COLORS.completed);
const minorPendingIcon = minorPin(COLORS.pending);

// Pick the icon for an activity pin. The common (un-highlighted) cases reuse the
// memoized icons above; the highlighted variant is rare (one at a time) so a
// fresh `glyphPin` per render is fine and avoids polluting the shared cache
// (#94).
function activityIcon(
  a: Activity,
  completed: boolean,
  highlighted: boolean,
  minor: boolean,
): L.DivIcon {
  if (minor) return completed ? minorCompletedIcon : minorPendingIcon;
  if (!highlighted) {
    return completed ? completedIcon : pendingIcon(a.category);
  }
  const color = completed ? COLORS.completed : COLORS.pending;
  const glyph = completed ? { icon: 'check' as const } : { icon: CATEGORY_ICON[a.category] };
  return glyphPin(color, glyph, { highlighted });
}

interface Props {
  /** Activities to plot — already filtered by the caller. */
  activities: Activity[];
  /** Open the detail modal for an activity (from a pin popup's "View details"). */
  onSelect: (activity: Activity) => void;
  /**
   * Primary click handler for a pin (#94): a single click on the marker fires
   * this (the split view opens detail + scrolls the matching card into view).
   * The popup's "View details" calls it too when provided. Omit to fall back to
   * {@link onSelect}.
   */
  onActivate?: (activity: Activity) => void;
  /**
   * Id of the activity whose pin should render highlighted (a hovered/focused
   * card, #94). Larger disc + raised above neighbours; does not open a popup.
   */
  highlightedId?: string | null;
  /**
   * Notified when a pin gains/loses hover (#94): the split view outlines the
   * matching card. `null` when the pointer leaves the pin.
   */
  onPinHoverChange?: (activity: Activity | null) => void;
  /**
   * Called ~400 ms after the map settles from a pan/zoom, with the current
   * viewport as normalized {@link MapBounds}. The split view uses this to
   * refilter the list to what's visible (#95). Must be referentially stable
   * (e.g. `useCallback`) so the debounce isn't recreated each render. Omit to
   * disable bounds reporting.
   */
  onBoundsChange?: (bounds: MapBounds) => void;
  /**
   * Drop the rounded corners, border and shadow so the map sits edge to edge
   * as a full-screen backdrop (the mobile map, #96), and lift the zoom
   * controls, legend and attribution clear of the app header and the list
   * sheet. Default `false` keeps the framed look of Split and desktop Map.
   */
  fullBleed?: boolean;
  /**
   * Bump to fly the map out to fit every plotted activity (#106): "Clear
   * bounds" does, so the map and the list agree again. Only a change is a
   * request; the value the map mounts with isn't.
   */
  fitSignal?: number;
  /**
   * A tap on the map itself, not a pin (#291): the mobile map closes the
   * card of the pin it showed.
   */
  onMapTap?: () => void;
  /**
   * The pin whose card shows over the foot of the map (#291): the map pans,
   * if it must, to keep it clear of the card.
   */
  keepInViewId?: string | null;
}

// The zoom the map opens at (below), the deepest it goes (CARTO's tiles end
// at 18), and the room a group's flight leaves at its sides, as the fit does.
const OPEN_ZOOM = 8;
const MAX_ZOOM = 18;
const SIDE_PADDING = 48;
// How far a carded pin stays above the map's foot: clear of the card (about
// 150px) and the sheet it covers.
const CARD_CLEARANCE = 240;

// Where an activity's pin sits, as Leaflet takes a point.
function pointOf(a: Activity): [number, number] {
  return [a.location.coords.lat, a.location.coords.lng];
}

// Group and home icons, by what they show: every card hover and every settle
// renders them again, and a new icon rewrites its marker, so each is made once.
const madeIcons = new Map<string, L.DivIcon>();
function icon(key: string, make: () => L.DivIcon): L.DivIcon {
  let made = madeIcons.get(key);
  if (!made) {
    made = make();
    madeIcons.set(key, made);
  }
  return made;
}

// Home alone, as it is most of the time.
const plainHomeIcon = homePin(COLORS.home, 0);

function plural(n: number): string {
  return `${n} ${n === 1 ? 'place' : 'places'}`;
}

/**
 * Reports the map's zoom as it settles, taps on the map itself, and a
 * popup's pan to fit itself in. Renders nothing; lives inside MapContainer
 * for its events.
 */
function MapEvents({
  onZoom,
  onTap,
  onAutoPan,
}: {
  onZoom: (zoom: number) => void;
  onTap?: () => void;
  onAutoPan: () => void;
}) {
  const map = useMap();
  useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
    click: () => onTap?.(),
    autopanstart: onAutoPan,
  });
  return null;
}

/**
 * A group the deepest zoom can't part (places at one spot): a tap lists
 * them instead, each opening as its pin would.
 */
function PlacesHere({ places, onPick }: { places: Activity[]; onPick: (a: Activity) => void }) {
  return (
    <div className="min-w-[200px]">
      <div className="text-body-md font-bold">{plural(places.length)} here</div>
      <ul className="mt-xs space-y-xs">
        {places.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onPick(a)}
              className="min-h-9 cursor-pointer text-left font-semibold text-primary underline"
            >
              {a.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The shared interactive map surface: CARTO basemap, frosted zoom controls, a
 * home marker, and one glyph pin per activity (green = completed, blue = to-do,
 * colored by category). Fills its parent — the parent sets the height (full
 * page in Map mode, the sticky right column in Split mode). See #4 / #93.
 *
 * Pins that would overlap at the zoom draw as one group with their count
 * (#291), which a tap flies in to; home holds those beside it. The linked
 * card↔pin hover behaviour is #94.
 */
export function ActivityMap({
  activities,
  onSelect,
  onActivate,
  highlightedId,
  onPinHoverChange,
  onBoundsChange,
  fullBleed = false,
  fitSignal = 0,
  onMapTap,
  keepInViewId = null,
}: Props) {
  const overrides = useOverrides();
  const origin = useDistanceOrigin();
  const distanceTo = useDistanceTo();
  // Shared by the fit and the bounds watcher, so the fit's own flight isn't
  // reported back as a pan that re-applies the bounds filter (#106).
  const [moveGate] = useState(createMoveGate);
  // The pin under the pointer: a far-away dot grows into a full pin while
  // hovered (#109), as it does while its card is.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // The current viewport: far pins only shrink beside a near one in view.
  const [view, setView] = useState<MapBounds | null>(null);
  // The map and its zoom, to group the pins that would overlap at it (#291).
  const [map, setMap] = useState<L.Map | null>(null);
  const [zoom, setZoom] = useState(OPEN_ZOOM);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  // Keep fitted pins clear of the header and the zoom controls above and of
  // the legend below. Full bleed, the legend sits above the peeking sheet and
  // the attribution (bottom 112px, about 36px tall).
  const padding = fullBleed ? { top: 100, bottom: 160 } : { top: 48, bottom: 56 };

  const plotted = useMemo(
    () =>
      activities.map((a) => ({
        a,
        completed: isEffectivelyCompleted(a, overrides),
        distance: distanceTo(a),
      })),
    [activities, overrides, distanceTo],
  );
  const byId = useMemo(() => new Map(plotted.map((p) => [p.a.id, p])), [plotted]);
  const nearInView = useMemo(
    () =>
      hasNearPinInView(
        plotted.map(({ a, distance }) => ({
          lat: a.location.coords.lat,
          lng: a.location.coords.lng,
          miles: distance.miles,
        })),
        view,
      ),
    [plotted, view],
  );
  // What draws at this zoom: the places that would overlap grouped, home
  // among them (src/lib/pinGroups.ts). A pan moves every pin alike, so only
  // the zoom, the places and which are far dots decide it.
  const { lat: homeLat, lng: homeLng } = origin.coords;
  const drawn = useMemo<DrawnPins[]>(() => {
    if (!map) return [];
    return drawPins(
      plotted.map(({ a, distance }) => ({
        id: a.id,
        lat: a.location.coords.lat,
        lng: a.location.coords.lng,
        minor: isMinorPin(distance.miles, false, nearInView),
      })),
      { lat: homeLat, lng: homeLng },
      (lat, lng, z) => map.project([lat, lng], z),
      zoom,
      MAX_ZOOM,
    );
  }, [map, zoom, plotted, nearInView, homeLat, homeLng]);

  // A hovered pin pulled into a group by a zoom unmounts with no mouseout:
  // let go of it, here and in the list, so its card isn't left outlined.
  const drawnAlone = useMemo(
    () => new Set(drawn.flatMap((d) => (!d.home && d.ids.length === 1 ? d.ids : []))),
    [drawn],
  );
  const [hoverDropped, setHoverDropped] = useState(0);
  if (hoveredId !== null && map !== null && !drawnAlone.has(hoveredId)) {
    setHoveredId(null);
    setHoverDropped((n) => n + 1);
  }
  const letGoOfHover = useEffectEvent(() => onPinHoverChange?.(null));
  useEffect(() => {
    if (hoverDropped > 0) letGoOfHover();
  }, [hoverDropped]);

  // A carded pin is kept clear of the card over the map's foot. The pan is
  // the map's, not the user's, so the area filter (#95) doesn't take it as
  // one; the gate is armed only for a pan that happens, since one that
  // doesn't fires no moveend to disarm it.
  const keepInView = useEffectEvent((id: string) => {
    const entry = byId.get(id);
    const size = map?.getSize();
    const room =
      size &&
      fitPaddingFor(size, {
        top: padding.top,
        bottom: CARD_CLEARANCE,
        side: SIDE_PADDING,
      });
    if (!map || !entry || !size || !room) return;
    if (isInsidePadding(map.latLngToContainerPoint(pointOf(entry.a)), size, room)) return;
    moveGate.arm();
    map.panInside(pointOf(entry.a), {
      paddingTopLeft: [room.side, room.top],
      paddingBottomRight: [room.side, room.bottom],
      animate: !reduceMotion,
    });
  });
  useEffect(() => {
    if (keepInViewId) keepInView(keepInViewId);
  }, [keepInViewId]);

  // A group's tap flies in to its pins, far enough that they part. It's the
  // user's own move, so a fit still in flight hands over to it (#106), and a
  // map too small for the padding has it scaled down rather than failing.
  function openGroup(points: [number, number][]) {
    const room = map && fitPaddingFor(map.getSize(), { ...padding, side: SIDE_PADDING });
    if (!map || !room) return;
    moveGate.disarm();
    // The marker that had focus goes once the group parts: keep it on the map.
    if (document.activeElement?.closest('.leaflet-marker-icon')) {
      map.getContainer().focus({ preventScroll: true });
    }
    map.flyToBounds(points, {
      paddingTopLeft: [room.side, room.top],
      paddingBottomRight: [room.side, room.bottom],
      maxZoom: MAX_ZOOM,
      animate: !reduceMotion,
    });
  }

  // A place picked from a group that can't part opens as its pin would.
  function pick(a: Activity) {
    // The list's button goes with the popup: keep focus on the map, for the
    // card to hand it back to.
    map?.getContainer().focus({ preventScroll: true });
    map?.closePopup();
    (onActivate ?? onSelect)(a);
  }

  function placesOf(d: DrawnPins): Activity[] {
    return d.ids.flatMap((id) => byId.get(id)?.a ?? []);
  }

  function renderHome(d: DrawnPins) {
    const places = placesOf(d);
    if (places.length === 0) {
      // Where distances are measured from (#66): the visitor, or home.
      return (
        <Marker key="home" position={[d.lat, d.lng]} icon={plainHomeIcon}>
          <Popup>
            {origin.source === 'device' ? (
              <div className="font-bold">You are here</div>
            ) : (
              <>
                <div className="font-bold">{origin.label}</div>
                <div className="text-on-surface-variant">Home base</div>
              </>
            )}
          </Popup>
        </Marker>
      );
    }
    // Holding the places beside it, it carries their count and opens like a
    // group.
    const highlighted = !!highlightedId && d.ids.includes(highlightedId);
    const name = `${origin.name}, and ${plural(places.length)} beside it, ${d.splits ? 'zoom in' : 'list them'}`;
    return (
      <Marker
        key="home"
        position={[d.lat, d.lng]}
        icon={icon(`home:${places.length}:${highlighted}:${name}`, () =>
          homePin(COLORS.home, places.length, name, { highlighted }),
        )}
        zIndexOffset={500}
        eventHandlers={
          d.splits ? { click: () => openGroup([[d.lat, d.lng], ...places.map(pointOf)]) } : {}
        }
      >
        {!d.splits && (
          <Popup>
            <PlacesHere places={places} onPick={pick} />
          </Popup>
        )}
      </Marker>
    );
  }

  function renderGroup(d: DrawnPins) {
    const places = placesOf(d);
    const highlighted = !!highlightedId && d.ids.includes(highlightedId);
    const label = `${plural(places.length)}, ${d.splits ? 'zoom in' : 'list them'}`;
    return (
      <Marker
        key={`group:${d.ids.join(',')}`}
        position={[d.lat, d.lng]}
        icon={icon(`group:${places.length}:${highlighted}:${d.minor}:${label}`, () =>
          groupPin(places.length, label, { highlighted, minor: d.minor }),
        )}
        zIndexOffset={d.minor ? -500 : 500}
        eventHandlers={d.splits ? { click: () => openGroup(places.map(pointOf)) } : {}}
      >
        <Tooltip direction="top" offset={[0, -10]}>
          {plural(places.length)}
        </Tooltip>
        {!d.splits && (
          <Popup>
            <PlacesHere places={places} onPick={pick} />
          </Popup>
        )}
      </Marker>
    );
  }

  function renderPin(id: string) {
    const entry = byId.get(id);
    if (!entry) return null;
    const { a, completed, distance } = entry;
    const highlighted = a.id === highlightedId;
    const raised = highlighted || a.id === hoveredId;
    const minor = isMinorPin(distance.miles, raised, nearInView);
    return (
      <Marker
        key={a.id}
        position={pointOf(a)}
        icon={activityIcon(a, completed, highlighted, minor)}
        zIndexOffset={pinZIndex(raised, minor)}
        eventHandlers={{
          ...(onActivate ? { click: () => onActivate(a) } : {}),
          // Pin hover → outline the matching card in the list (#94).
          mouseover: () => {
            setHoveredId(a.id);
            onPinHoverChange?.(a);
          },
          mouseout: () => {
            setHoveredId((id) => (id === a.id ? null : id));
            onPinHoverChange?.(null);
          },
        }}
      >
        {/* Brief hover tooltip — the activity title (#94). */}
        <Tooltip direction="top" offset={[0, -6]}>
          {a.name}
        </Tooltip>
        {/* When the parent wires `onActivate` (the split view), a pin
            click opens detail + scrolls the card directly — rendering a
            Popup too would double-open it and its autoPan would move the
            map (firing an unwanted bounds refilter). Keep the Popup only
            as the standalone fallback when there's no `onActivate`. */}
        {!onActivate && (
          <Popup>
            <div className="min-w-[200px] space-y-xs">
              <div className="text-body-md font-bold">{a.name}</div>
              <div className="text-body-sm text-on-surface-variant">
                {a.location.city} · {formatMiles(distance)} mi from {origin.name} · {a.duration}
              </div>
              <button
                type="button"
                onClick={() => onSelect(a)}
                className="inline-flex min-h-11 cursor-pointer items-center font-bold text-primary underline"
              >
                View details →
              </button>
            </div>
          </Popup>
        )}
      </Marker>
    );
  }

  // `isolate` traps Leaflet's pane z-indices (markers at 600, controls at
  // 1000) inside the map's own stacking context, so a page-level overlay like
  // the mobile list sheet (#96) paints above the map instead of having pins
  // punch through it.
  return (
    <div
      className={`relative isolate size-full overflow-hidden ${
        fullBleed ? '' : 'rounded-xl border border-outline-variant/30 shadow-sm'
      }`}
    >
      <MapContainer
        ref={setMap}
        center={[HOME_LOCATION.coords.lat, HOME_LOCATION.coords.lng]}
        zoom={OPEN_ZOOM}
        maxZoom={MAX_ZOOM}
        // Pins are drawn on one copy of the world: panning onto the next
        // copy jumps back to that one, so they never pan out of reach.
        worldCopyJump
        // No grey past the poles (MapZoomControls keeps the zoom from it).
        maxBounds={WORLD_BOUNDS}
        maxBoundsViscosity={1}
        scrollWheelZoom
        zoomControl={false}
        // The tiles' credit is MapCredit's ⓘ, below.
        attributionControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url={CARTO_TILE_URL} />
        {/* In full bleed the map runs under the app header: clear its slim
            mobile form (about 60px) and its 80px md+ row. */}
        <MapZoomControls topInset={fullBleed ? 88 : 12} />
        <ViewportWatcher onChange={setView} />
        {/* A list popup's pan to fit itself in is the map's, not the user's. */}
        <MapEvents onZoom={setZoom} onTap={onMapTap} onAutoPan={() => moveGate.arm()} />
        {onBoundsChange && <BoundsWatcher onBoundsChange={onBoundsChange} gate={moveGate} />}
        <FitToActivities
          signal={fitSignal}
          activities={activities}
          padding={padding}
          gate={moveGate}
        />
        {drawn.map((d) => {
          if (d.home) return renderHome(d);
          if (d.ids.length > 1) return renderGroup(d);
          return renderPin(d.ids[0]);
        })}
      </MapContainer>
      {/* In full bleed the list sheet covers the bottom 4.5rem even at peek:
          the credit and the legend sit above it. */}
      <MapCredit bottom={fullBleed ? 'calc(4.5rem + 8px)' : 8} />
      <MapLegend bottomInset={fullBleed ? 80 : 12} />
    </div>
  );
}

// Frosted color key, ported from the old standalone Map page so status stays
// discoverable (color carries meaning). Positioned with inline styles + a high
// z-index for the same reason MapZoomControls does: Leaflet's unlayered CSS
// would otherwise beat Tailwind v4's layered utilities. Sits bottom-left, clear
// of the credit's ⓘ bottom-right and the top-right zoom controls.
function MapLegend({ bottomInset }: { bottomInset: number }) {
  return (
    <div
      style={{ position: 'absolute', left: 12, bottom: bottomInset, zIndex: 1000 }}
      // A phone goes without (#291): a completed pin carries its check, and
      // home its house.
      className="hidden items-center gap-md rounded-lg border border-white/50 bg-white/70 px-sm py-xs text-body-sm text-on-surface shadow-md backdrop-blur-sm md:flex"
    >
      <LegendDot color={COLORS.home} label="Home" />
      <LegendDot color={COLORS.completed} label="Completed" />
      <LegendDot color={COLORS.pending} label="To do" />
      {/* Far-away pins are small dots (#109). */}
      <LegendDot color={COLORS.pending} label={`${MINOR_PIN_MILES}+ mi`} small />
    </div>
  );
}

function LegendDot({
  color,
  label,
  small = false,
}: {
  color: string;
  label: string;
  small?: boolean;
}) {
  return (
    <span className="flex items-center gap-xs">
      <span
        aria-hidden="true"
        style={{ background: color }}
        className={`inline-block rounded-full ${small ? 'size-1.5' : 'size-3'}`}
      />
      {label}
    </span>
  );
}
