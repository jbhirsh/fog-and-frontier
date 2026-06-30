import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomSheet, type SheetSnap } from './BottomSheet';

// A controlled host so the sheet's snap prop tracks the changes it requests —
// mirrors how CuratedAdventures owns the snap state.
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
      header={<div>23 places in this area</div>}
    >
      <div>Card body</div>
    </BottomSheet>
  );
}

const grabber = () => screen.getByRole('button', { name: /resize list/i });

describe('BottomSheet', () => {
  it('renders the header and body inside a labelled region', () => {
    render(<Host />);
    expect(
      screen.getByRole('region', { name: 'Activities list' }),
    ).toBeInTheDocument();
    expect(screen.getByText('23 places in this area')).toBeInTheDocument();
    expect(screen.getByText('Card body')).toBeInTheDocument();
  });

  it('reflects the snap height in its inline style', () => {
    render(<Host initial="half" />);
    expect(screen.getByRole('region', { name: 'Activities list' })).toHaveStyle({
      height: '52dvh',
    });
  });

  it('cycles peek → half → full → peek when the grabber is tapped', async () => {
    const onSnapChange = vi.fn();
    render(<Host initial="peek" onSnapChange={onSnapChange} />);

    await userEvent.click(grabber());
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
    await userEvent.click(grabber());
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    await userEvent.click(grabber());
    expect(onSnapChange).toHaveBeenLastCalledWith('peek');
  });

  it('nudges up/down one step with the arrow keys', async () => {
    const onSnapChange = vi.fn();
    render(<Host initial="peek" onSnapChange={onSnapChange} />);
    const handle = grabber();
    handle.focus();

    await userEvent.keyboard('{ArrowUp}');
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
    await userEvent.keyboard('{ArrowUp}');
    expect(onSnapChange).toHaveBeenLastCalledWith('full');
    // Already full — ArrowUp is a no-op, ArrowDown steps back to half.
    onSnapChange.mockClear();
    await userEvent.keyboard('{ArrowDown}');
    expect(onSnapChange).toHaveBeenLastCalledWith('half');
  });

  it('snaps to the nearest rest position after a drag, not a cycle', () => {
    const onSnapChange = vi.fn();
    render(<Host initial="peek" onSnapChange={onSnapChange} />);
    const handle = grabber();

    // Drag the grabber far up the (jsdom 768px) viewport — nearest target is full.
    fireEvent.pointerDown(handle, { clientY: 700 });
    fireEvent.pointerMove(window, { clientY: 100 });
    fireEvent.pointerUp(window, { clientY: 100 });

    expect(onSnapChange).toHaveBeenCalledTimes(1);
    expect(onSnapChange).toHaveBeenCalledWith('full');
  });

  it('does not also cycle on the click that ends a real drag', () => {
    const onSnapChange = vi.fn();
    render(<Host initial="peek" onSnapChange={onSnapChange} />);
    const handle = grabber();

    fireEvent.pointerDown(handle, { clientY: 700 });
    fireEvent.pointerMove(window, { clientY: 100 });
    fireEvent.pointerUp(window, { clientY: 100 });
    // The synthetic click after a drag must be swallowed (no extra cycle call).
    fireEvent.click(handle);

    expect(onSnapChange).toHaveBeenCalledTimes(1);
    expect(onSnapChange).toHaveBeenCalledWith('full');
  });
});
