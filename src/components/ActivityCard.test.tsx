import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityCard } from './ActivityCard';
import {
  completedHike,
  dogFriendlyTidepools,
  muirWoods,
} from '../test/fixtures';

describe('ActivityCard', () => {
  it('renders core fields', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText('Short redwoods description.')).toBeInTheDocument();
    expect(screen.getByText('Half Day')).toBeInTheDocument();
    expect(screen.getByText('HIKING')).toBeInTheDocument();
  });

  it('does not render difficulty (it lives in the detail view, not the card)', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('moderate')).not.toBeInTheDocument();
  });

  it('shows a distance label computed from home', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.getByText(/\d+\s*mi/)).toBeInTheDocument();
  });

  it('renders the dog-friendly meta only when applicable', () => {
    const { rerender } = render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('Dog OK')).not.toBeInTheDocument();
    rerender(<ActivityCard activity={dogFriendlyTidepools} />);
    expect(screen.getByText('Dog OK')).toBeInTheDocument();
  });

  it('renders the completed badge only when activity.completed is true', () => {
    const { rerender } = render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('COMPLETED')).not.toBeInTheDocument();
    rerender(<ActivityCard activity={completedHike} />);
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<ActivityCard activity={muirWoods} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes data-activity-id on the root for scroll-into-view (#94)', () => {
    const { container } = render(<ActivityCard activity={muirWoods} />);
    expect(
      container.querySelector(`[data-activity-id="${muirWoods.id}"]`),
    ).toBeInTheDocument();
  });

  it('fires onHoverChange on pointer enter/leave (#94)', async () => {
    const onHoverChange = vi.fn();
    render(<ActivityCard activity={muirWoods} onHoverChange={onHoverChange} />);
    const button = screen.getByRole('button');
    await userEvent.hover(button);
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    await userEvent.unhover(button);
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
  });

  it('fires onHoverChange on keyboard focus/blur (#94)', () => {
    const onHoverChange = vi.fn();
    render(<ActivityCard activity={muirWoods} onHoverChange={onHoverChange} />);
    const button = screen.getByRole('button');
    act(() => button.focus());
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    act(() => button.blur());
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps the highlight while focused even as the mouse leaves (#94)', async () => {
    const onHoverChange = vi.fn();
    render(<ActivityCard activity={muirWoods} onHoverChange={onHoverChange} />);
    const button = screen.getByRole('button');
    act(() => button.focus()); // keyboard focus → highlight on
    await userEvent.hover(button);
    await userEvent.unhover(button); // mouse leaves, but focus remains
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
  });

  it('outlines the cover when highlighted by a hovered pin (#94)', () => {
    const { container, rerender } = render(
      <ActivityCard activity={muirWoods} />,
    );
    expect(container.querySelector('.outline-2')).toBeNull();
    rerender(<ActivityCard activity={muirWoods} highlighted />);
    expect(container.querySelector('.outline-2')).not.toBeNull();
  });

  it('shows the AllTrails rating when present', () => {
    render(<ActivityCard activity={{ ...muirWoods, allTrailsRating: 4.7 }} />);
    expect(screen.getByText('4.7')).toBeInTheDocument();
  });

  it('renders an actionSlot overlay', () => {
    render(
      <ActivityCard
        activity={muirWoods}
        actionSlot={<button type="button">Trip</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Trip' })).toBeInTheDocument();
  });

  it('shows both the completed badge and the actionSlot without dropping either', () => {
    render(
      <ActivityCard
        activity={completedHike}
        actionSlot={<button type="button">Trip</button>}
      />,
    );
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trip' })).toBeInTheDocument();
  });

  it('shows user photo count when showUserPhotoCount is set and photos exist', () => {
    localStorage.setItem(
      'fogandfrontier.userPhotos.v1',
      JSON.stringify({
        [completedHike.id]: [
          'data:image/png;base64,x',
          'data:image/png;base64,y',
        ],
      }),
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('fogandfrontier:photos-changed'));
    });
    render(<ActivityCard activity={completedHike} showUserPhotoCount />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
