import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomSheet } from './BottomSheet';
import type { SheetSnap } from '../lib/bottomSheetSnap';

// jsdom's window is 768px tall, so the rest heights the drag math uses are
// peek 112, half 399 and full 691.

// A controlled host so the sheet's snap prop follows the changes it requests,
// the way CuratedAdventures owns the snap state.
function Host({
  initial = 'peek',
  onSnapChange,
}: {
  initial?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
}) {
  const [snap, setSnap] = useState<SheetSnap>(initial);
  return (
    <BottomSheet
      snap={snap}
      onSnapChange={(next) => {
        setSnap(next);
        onSnapChange?.(next);
      }}
      label="Activities list"
      header={
        <div>
          <span>23 places</span>
          <button type="button">Hide map</button>
        </div>
      }
    >
      <div>Card body</div>
    </BottomSheet>
  );
}

const sheet = () => screen.getByRole('region', { name: 'Activities list' });
const grabber = () => screen.getByRole('button', { name: /resize list/i });

// Drag from y=700 to `toY` on `target`, releasing (or cancelling) on window.
function drag(
  target: Element,
  toY: number,
  end: 'pointerUp' | 'pointerCancel' = 'pointerUp',
) {
  fireEvent.pointerDown(target, { clientY: 700 });
  fireEvent.pointerMove(window, { clientY: toY });
  fireEvent[end](window, { clientY: toY });
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

describe('BottomSheet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the header and body inside a labelled region', () => {
    render(<Host />);
    expect(sheet()).toBeInTheDocument();
    expect(screen.getByText('23 places')).toBeInTheDocument();
    expect(screen.getByText('Card body')).toBeInTheDocument();
  });

  it('names the grabber with its current position and describes how to use it', () => {
    render(<Host initial="half" />);
    expect(grabber()).toHaveAccessibleName('Resize list, currently half');
    expect(grabber()).toHaveAccessibleDescription(
      'Press to cycle between peek, half and full height. Up and Down arrows step the height.',
    );
  });

  it('sizes itself to the snap position and animates between positions', () => {
    render(<Host initial="half" />);
    expect(sheet().style.height).toBe('52dvh');
    expect(sheet().style.transition).toContain('height 0.3s');
  });

  it('does not animate when the user prefers reduced motion', () => {
    stubReducedMotion(true);
    render(<Host initial="half" />);
    expect(sheet().style.transition).toBe('none');
  });

  it('animates when only other media queries match', () => {
    stubReducedMotion(false);
    render(<Host initial="half" />);
    expect(sheet().style.transition).toContain('height 0.3s');
  });

  it('cycles peek → half → full → peek when the grabber is tapped', async () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);

    await userEvent.click(grabber());
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
    expect(sheet().style.height).toBe('52dvh');
    await userEvent.click(grabber());
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    await userEvent.click(grabber());
    expect(onSnapChange).toHaveBeenLastCalledWith('peek');
    expect(onSnapChange).toHaveBeenCalledTimes(3);
  });

  it('cycles from the keyboard with Enter and Space', async () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    grabber().focus();

    await userEvent.keyboard('{Enter}');
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
    await userEvent.keyboard(' ');
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
  });

  it('steps up and down with the arrow keys, stopping at the ends', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);

    // ArrowDown at peek: already at the bottom, so nothing changes, but the
    // key is still consumed so the page doesn't scroll.
    expect(fireEvent.keyDown(grabber(), { key: 'ArrowDown' })).toBe(false);
    expect(onSnapChange).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(grabber(), { key: 'ArrowUp' })).toBe(false);
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
    fireEvent.keyDown(grabber(), { key: 'ArrowUp' });
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    fireEvent.keyDown(grabber(), { key: 'ArrowUp' });
    expect(onSnapChange).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(grabber(), { key: 'ArrowDown' });
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
    expect(onSnapChange).toHaveBeenCalledTimes(3);
  });

  it('leaves other keys alone', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    expect(fireEvent.keyDown(grabber(), { key: 'Tab' })).toBe(true);
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  it('follows the pointer while dragging, without animating', () => {
    render(<Host />);
    // From peek (112px), 200px up.
    fireEvent.pointerDown(grabber(), { clientY: 700 });
    fireEvent.pointerMove(window, { clientY: 500 });
    expect(sheet().style.height).toBe('312px');
    expect(sheet().style.transition).toBe('none');
  });

  it('starts the drag from the current rest height', () => {
    render(<Host initial="half" />);
    // From half (399px), 50px down.
    fireEvent.pointerDown(grabber(), { clientY: 700 });
    fireEvent.pointerMove(window, { clientY: 750 });
    expect(sheet().style.height).toBe('349px');
  });

  it('snaps to the nearest rest position on release, without also cycling', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);

    // 112 + 200 = 312 is nearest half (399), not peek.
    drag(grabber(), 500);
    // The click the browser fires after a drag must not cycle as well.
    fireEvent.click(grabber());

    expect(onSnapChange).toHaveBeenCalledTimes(1);
    expect(onSnapChange).toHaveBeenCalledWith('half');
    expect(sheet().style.height).toBe('52dvh');
  });

  it('snaps to full after a long drag up', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    drag(grabber(), 100);
    expect(onSnapChange).toHaveBeenCalledWith('full');
  });

  it('treats a pointer that barely moves as a tap', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    drag(grabber(), 696);
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(sheet().style.height).toBe('7rem');

    fireEvent.click(grabber());
    expect(onSnapChange).toHaveBeenCalledWith('half');
  });

  it('still counts a drag that wanders back to where it started', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    fireEvent.pointerDown(grabber(), { clientY: 700 });
    fireEvent.pointerMove(window, { clientY: 400 });
    fireEvent.pointerMove(window, { clientY: 700 });
    fireEvent.pointerUp(window, { clientY: 700 });
    // A drag, so it settles (back at peek) and the trailing click is eaten.
    fireEvent.click(grabber());
    expect(onSnapChange).toHaveBeenCalledTimes(1);
    expect(onSnapChange).toHaveBeenCalledWith('peek');
  });

  it('still cycles on a tap after a drag that fired no click', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    // A touch drag that lifts off the grabber fires no click to consume the
    // suppression; the next tap must still cycle.
    drag(grabber(), 100);
    expect(onSnapChange).toHaveBeenLastCalledWith('full');

    fireEvent.pointerDown(grabber(), { clientY: 400 });
    fireEvent.pointerUp(window, { clientY: 400 });
    fireEvent.click(grabber());
    expect(onSnapChange).toHaveBeenLastCalledWith('peek');
    expect(onSnapChange).toHaveBeenCalledTimes(2);
  });

  it('settles back at the rest position when the pointer is cancelled', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    drag(grabber(), 100, 'pointerCancel');
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(sheet().style.height).toBe('7rem');

    // The gesture is fully over: further moves do nothing, and a new one works.
    fireEvent.pointerMove(window, { clientY: 300 });
    expect(sheet().style.height).toBe('7rem');
    drag(grabber(), 100);
    expect(onSnapChange).toHaveBeenCalledWith('full');
  });

  it('stops tracking the pointer after release', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    render(<Host />);
    drag(grabber(), 500);
    fireEvent.pointerMove(window, { clientY: 100 });
    expect(sheet().style.height).toBe('52dvh');
    // Every listener the gesture added is gone, the cancel one included.
    for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
      expect(remove).toHaveBeenCalledWith(type, expect.any(Function));
    }
    remove.mockRestore();
  });

  it('cycles on the next keyboard press after a drag ate its click', async () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    drag(grabber(), 500);
    fireEvent.click(grabber());
    expect(onSnapChange).toHaveBeenCalledTimes(1);

    // Enter fires a click with no pointerdown before it; it must not be
    // swallowed by the drag that came before.
    grabber().focus();
    await userEvent.keyboard('{Enter}');
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    expect(onSnapChange).toHaveBeenCalledTimes(2);
  });

  it('cycles on Enter after a header drag, whose click lands on the header', async () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    // Dragging from the header leaves the browser's click on the header, so
    // nothing consumes the drag's click suppression on the grabber.
    drag(screen.getByText('23 places'), 500);
    expect(onSnapChange).toHaveBeenCalledTimes(1);

    grabber().focus();
    await userEvent.keyboard('{Enter}');
    expect(onSnapChange).toHaveBeenCalledTimes(2);
  });

  it('keeps its content clear of the home indicator', () => {
    render(<Host />);
    expect(sheet()).toHaveClass('pb-[env(safe-area-inset-bottom)]');
  });

  it('ignores a second pointer while a drag is in progress', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    fireEvent.pointerDown(grabber(), { clientY: 700 });
    fireEvent.pointerDown(grabber(), { clientY: 600 });
    fireEvent.pointerMove(window, { clientY: 100 });
    fireEvent.pointerUp(window, { clientY: 100 });
    expect(onSnapChange).toHaveBeenCalledTimes(1);
    expect(onSnapChange).toHaveBeenCalledWith('full');
  });

  it('captures the pointer when the browser supports it', () => {
    const setPointerCapture = vi.fn();
    render(<Host />);
    const handle = grabber();
    handle.setPointerCapture = setPointerCapture;
    fireEvent.pointerDown(handle, { clientY: 700, pointerId: 7 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('drags from the header too', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    drag(screen.getByText('23 places'), 100);
    expect(onSnapChange).toHaveBeenCalledWith('full');
  });

  it('leaves controls in the header tappable instead of starting a drag', () => {
    const onSnapChange = vi.fn();
    render(<Host onSnapChange={onSnapChange} />);
    drag(screen.getByRole('button', { name: 'Hide map' }), 100);
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(sheet().style.height).toBe('7rem');
  });

  it('drops an in-flight drag when it unmounts', () => {
    const onSnapChange = vi.fn();
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Host onSnapChange={onSnapChange} />);
    fireEvent.pointerDown(grabber(), { clientY: 700 });
    fireEvent.pointerMove(window, { clientY: 100 });
    unmount();
    fireEvent.pointerUp(window, { clientY: 100 });
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function));
    remove.mockRestore();
  });
});
