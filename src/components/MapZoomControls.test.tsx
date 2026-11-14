import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as L from 'leaflet';
import { fake } from '../test/fakeMap';
import { MapZoomControls } from './MapZoomControls';
import { getIcon } from '../test/icons';

vi.mock('react-leaflet', () => import('../test/fakeReactLeaflet'));

beforeEach(() => {
  fake.reset();
});

const zoomIn = () => screen.getByRole('button', { name: 'Zoom in' });
const zoomOut = () => screen.getByRole('button', { name: 'Zoom out' });

describe('MapZoomControls', () => {
  it('zooms the map in and out', () => {
    render(<MapZoomControls />);
    fireEvent.click(zoomIn());
    expect(fake.map.zoomIn).toHaveBeenCalledOnce();
    expect(fake.map.zoomOut).not.toHaveBeenCalled();
    fireEvent.click(zoomOut());
    expect(fake.map.zoomOut).toHaveBeenCalledOnce();
  });

  it('keeps the zoom out from showing grey above and below the world, as the map resizes', () => {
    // 600px tall: the world fills it from zoom 2 (1024px).
    const { unmount } = render(<MapZoomControls />);
    expect(fake.map.setMinZoom).toHaveBeenLastCalledWith(2);
    fake.size = { x: 800, y: 1100 };
    fake.emit('resize');
    expect(fake.map.setMinZoom).toHaveBeenLastCalledWith(3);
    expect(fake.map.setMinZoom).toHaveBeenCalledTimes(2);

    unmount();
    expect(fake.map.off).toHaveBeenCalledWith('resize', fake.map.on.mock.calls[0][1]);
    fake.size = { x: 800, y: 3000 };
    fake.emit('resize');
    expect(fake.map.setMinZoom).toHaveBeenCalledTimes(2);
  });

  it('disables a button at its zoom limit, following the zoom', () => {
    fake.zoom = 5;
    render(<MapZoomControls />);
    // setMinZoom made the least zoom 2.
    expect(zoomIn()).toBeEnabled();
    expect(zoomOut()).toBeEnabled();

    fake.zoom = 18;
    fake.emit('zoomend');
    expect(zoomIn()).toBeDisabled();
    expect(zoomOut()).toBeEnabled();

    fake.zoom = 2;
    fake.emit('zoomend');
    expect(zoomIn()).toBeEnabled();
    expect(zoomOut()).toBeDisabled();

    fake.zoom = 17;
    fake.emit('zoomend');
    expect(zoomIn()).toBeEnabled();
    fake.zoom = 3;
    fake.emit('zoomend');
    expect(zoomOut()).toBeEnabled();
  });

  it('keeps a new map from showing grey too', () => {
    const { rerender } = render(<MapZoomControls />);
    fake.reset();
    fake.size = { x: 800, y: 1100 };
    rerender(<MapZoomControls />);
    expect(fake.map.setMinZoom).toHaveBeenCalledExactlyOnceWith(3);
    expect(fake.map.on).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('draws its glyphs at 20px', () => {
    render(<MapZoomControls />);
    expect(getIcon('add')).toHaveStyle({ fontSize: '20px' });
    expect(getIcon('remove')).toHaveStyle({ fontSize: '20px' });
  });

  it('opens at the zoom the map has', () => {
    fake.zoom = 18;
    render(<MapZoomControls />);
    expect(zoomIn()).toBeDisabled();
  });

  it('keeps its clicks and scrolls from the map underneath', () => {
    const click = vi.spyOn(L.DomEvent, 'disableClickPropagation');
    const scroll = vi.spyOn(L.DomEvent, 'disableScrollPropagation');
    const { rerender, unmount } = render(<MapZoomControls />);
    const box = zoomIn().parentElement;
    rerender(<MapZoomControls topInset={20} />);
    unmount();
    expect(click).toHaveBeenCalledExactlyOnceWith(box);
    expect(scroll).toHaveBeenCalledExactlyOnceWith(box);
    click.mockRestore();
    scroll.mockRestore();
  });

  it('sits top right, lower when told to', () => {
    const { rerender } = render(<MapZoomControls />);
    const box = zoomIn().parentElement;
    expect(box).toHaveStyle({ position: 'absolute', right: '12px', top: '12px', zIndex: '1000' });
    rerender(<MapZoomControls topInset={88} />);
    expect(box).toHaveStyle({ top: '88px' });
  });
});
