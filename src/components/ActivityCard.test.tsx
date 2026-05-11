import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityCard } from './ActivityCard';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';

describe('ActivityCard', () => {
  it('renders core fields', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText('Short redwoods description.')).toBeInTheDocument();
    expect(screen.getByText('Half Day')).toBeInTheDocument();
    expect(screen.getByText('moderate')).toBeInTheDocument();
    expect(screen.getByText('HIKING')).toBeInTheDocument();
  });

  it('shows a distance label computed from home', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.getByText(/\d+\s*mi/)).toBeInTheDocument();
  });

  it('renders the dog-friendly badge only when applicable', () => {
    const { rerender } = render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('DOGS OK')).not.toBeInTheDocument();
    rerender(<ActivityCard activity={dogFriendlyTidepools} />);
    expect(screen.getByText('DOGS OK')).toBeInTheDocument();
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

  it('shows the AllTrails rating when present', () => {
    render(
      <ActivityCard
        activity={{ ...muirWoods, allTrailsRating: 4.7 }}
      />,
    );
    expect(screen.getByText('4.7')).toBeInTheDocument();
  });

  it('shows user photo count when showUserPhotoCount is set and photos exist', () => {
    localStorage.setItem(
      'fogandfrontier.userPhotos.v1',
      JSON.stringify({ [completedHike.id]: ['data:image/png;base64,x', 'data:image/png;base64,y'] }),
    );
    act(() => {
      window.dispatchEvent(new CustomEvent('fogandfrontier:photos-changed'));
    });
    render(<ActivityCard activity={completedHike} showUserPhotoCount />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
