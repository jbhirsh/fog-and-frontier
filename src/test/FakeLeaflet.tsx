import { useEffect, useImperativeHandle, type ReactNode, type Ref } from 'react';
import { fake, iconHtml, registerMarker, type MarkerProps } from './fakeMap';

// react-leaflet's components, faked for the maps' tests: fakeMap.ts says how.

export function MapContainer({
  children,
  ref,
  ...props
}: {
  children?: ReactNode;
  ref?: Ref<unknown>;
  [prop: string]: unknown;
}) {
  useEffect(() => {
    fake.containerProps = props;
  });
  useImperativeHandle(ref, () => fake.map, []);
  return <div data-testid="map">{children}</div>;
}

export function TileLayer({ url }: { url: string }) {
  useEffect(() => {
    fake.tileUrl = url;
  });
  return null;
}

export function Marker(props: MarkerProps & { children?: ReactNode }) {
  const { icon, eventHandlers = {}, children } = props;
  return (
    <div data-testid="marker">
      <div
        data-testid="marker-icon"
        // As Leaflet does it: its class, focusable, its events bound on the
        // element itself.
        className={`leaflet-marker-icon ${icon.options.className ?? ''}`}
        ref={(el) => {
          if (!el) return;
          registerMarker(el, props);
          el.tabIndex = 0;
          el.onclick = () => eventHandlers.click?.();
          el.onmouseover = () => eventHandlers.mouseover?.();
          el.onmouseout = () => eventHandlers.mouseout?.();
        }}
        dangerouslySetInnerHTML={{ __html: iconHtml(icon) }}
      />
      {children}
    </div>
  );
}

export function Popup({ children }: { children?: ReactNode }) {
  return <div data-testid="popup">{children}</div>;
}

export function Tooltip({
  children,
  direction,
  offset,
}: {
  children?: ReactNode;
  direction?: string;
  offset?: [number, number];
}) {
  return (
    <div data-testid="tooltip" data-direction={direction} data-offset={offset?.join()}>
      {children}
    </div>
  );
}
