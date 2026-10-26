import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { fireEvent, render, screen } from '../test/render';
import userEvent from '@testing-library/user-event';
import { PinCard } from './PinCard';
import { dogFriendlyTidepools, muirWoods } from '../test/fixtures';

function renderCard(activity = muirWoods) {
  const onDetails = vi.fn();
  const onClose = vi.fn();
  render(<PinCard activity={activity} onDetails={onDetails} onClose={onClose} />);
  return { onDetails, onClose };
}

describe('PinCard (#291)', () => {
  it('names the place, what it is, how long and where', () => {
    renderCard();
    expect(screen.getByRole('region', { name: 'Test Muir Woods' })).toHaveClass(
      'fixed',
      'bottom-(--tab-bar)',
    );
    expect(screen.getByRole('heading', { name: 'Test Muir Woods' })).toBeInTheDocument();
    expect(screen.getByText('Hike · Half Day')).toBeInTheDocument();
    expect(screen.getByText(/^Mill Valley, CA · .* mi$/)).toBeInTheDocument();
  });

  it('shows its shorter card name when it has one', () => {
    renderCard({ ...muirWoods, cardName: 'Muir Woods' });
    expect(screen.getByRole('heading', { name: 'Muir Woods' })).toBeInTheDocument();
    // The region keeps the whole name.
    expect(screen.getByRole('region', { name: 'Test Muir Woods' })).toBeInTheDocument();
  });

  it('shows no rating or dog when it has neither', () => {
    renderCard();
    expect(screen.queryByText(/Rated/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Dogs welcome' })).not.toBeInTheDocument();
  });

  it('shows a rating to one place, and the dog where dogs are welcome', () => {
    renderCard({ ...dogFriendlyTidepools, allTrailsRating: 4.66 });
    expect(screen.getByText('Rated').parentElement).toHaveTextContent('Rated 4.7');
    expect(screen.getByRole('img', { name: 'Dogs welcome' })).toBeInTheDocument();
  });

  it('links directions to the place, in a new tab', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /Directions/ });
    expect(link.getAttribute('href')).toContain('37.8917');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers no directions to a place without coordinates', () => {
    renderCard({ ...muirWoods, location: { city: 'Somewhere', coords: { lat: NaN, lng: NaN } } });
    expect(screen.queryByRole('link', { name: /Directions/ })).not.toBeInTheDocument();
  });

  it('opens the detail from See details, and closes from ✕ or Escape', async () => {
    const { onDetails, onClose } = renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'See details' }));
    expect(onDetails).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('leaves an Escape that a field or another dialog has to them', () => {
    const { onClose } = renderCard();
    const field = document.createElement('input');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(field, dialog);
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    const handled = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(onClose).not.toHaveBeenCalled();
    field.remove();
    dialog.remove();
  });

  it('takes focus as it opens, and gives it back to the pin as it goes', () => {
    const pin = document.createElement('button');
    document.body.append(pin);
    pin.focus();
    const { unmount } = render(
      <PinCard activity={muirWoods} onDetails={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByRole('heading', { name: 'Test Muir Woods' })).toHaveFocus();
    unmount();
    expect(pin).toHaveFocus();
    pin.remove();
  });

  it('gives focus back to the pin in StrictMode too, its effect run twice', () => {
    const pin = document.createElement('button');
    document.body.append(pin);
    pin.focus();
    const { unmount } = render(
      <StrictMode>
        <PinCard activity={muirWoods} onDetails={() => {}} onClose={() => {}} />
      </StrictMode>,
    );
    expect(screen.getByRole('heading', { name: 'Test Muir Woods' })).toHaveFocus();
    unmount();
    expect(pin).toHaveFocus();
    pin.remove();
  });

  it('leaves focus where a tap elsewhere moved it', () => {
    const pin = document.createElement('button');
    const map = document.createElement('div');
    map.tabIndex = 0;
    document.body.append(pin, map);
    pin.focus();
    const { unmount } = render(
      <PinCard activity={muirWoods} onDetails={() => {}} onClose={() => {}} />,
    );
    map.focus();
    unmount();
    expect(map).toHaveFocus();
    pin.remove();
    map.remove();
  });

  it('hands focus back to the pin before opening the detail', async () => {
    const pin = document.createElement('button');
    document.body.append(pin);
    pin.focus();
    let focusedAtDetails: Element | null = null;
    render(
      <PinCard
        activity={muirWoods}
        onDetails={() => {
          focusedAtDetails = document.activeElement;
        }}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'See details' }));
    expect(focusedAtDetails).toBe(pin);
    pin.remove();
  });

  it('stops listening for Escape once it goes', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <PinCard activity={muirWoods} onDetails={() => {}} onClose={onClose} />,
    );
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
