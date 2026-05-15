import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityDetail } from './ActivityDetail';
import { completedHike, muirWoods } from '../test/fixtures';
import { activities as STATIC_ACTIVITIES } from '../data/activities';

const ownerState = vi.hoisted(() => ({ isOwner: true }));

vi.mock('../lib/useOwner', () => ({
  useOwner: () => ({
    isOwner: ownerState.isOwner,
    isLoaded: true,
    email: 'owner@example.com',
  }),
}));

const deleteSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../lib/userActivities', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/userActivities')>(
      '../lib/userActivities',
    );
  return { ...actual, deleteUserActivity: deleteSpy };
});

beforeEach(() => {
  ownerState.isOwner = true;
  deleteSpy.mockClear();
});

describe('ActivityDetail', () => {
  it('renders the activity name, description, and stats', () => {
    render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
    expect(
      screen.getByRole('heading', { name: 'Test Muir Woods' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('A longer description of the redwoods loop.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Half Day').length).toBeGreaterThan(0);
  });

  it('falls back to the short description when no long one is provided', () => {
    const a = { ...muirWoods, longDescription: undefined };
    render(<ActivityDetail activity={a} onClose={() => {}} />);
    expect(screen.getByText('Short redwoods description.')).toBeInTheDocument();
  });

  it('shows the COMPLETED badge with date and notes for completed activities', () => {
    render(<ActivityDetail activity={completedHike} onClose={() => {}} />);
    expect(screen.getByText(/COMPLETED/)).toBeInTheDocument();
    expect(screen.getByText(/2025-11-02/)).toBeInTheDocument();
    expect(screen.getByText('Beautiful sunset.')).toBeInTheDocument();
  });

  it('does not show photo upload when showUploads is false', () => {
    render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
    expect(screen.queryByText('Add photos')).not.toBeInTheDocument();
  });

  it('shows an empty state in upload mode when no photos exist', () => {
    render(
      <ActivityDetail activity={completedHike} onClose={() => {}} showUploads />,
    );
    expect(screen.getByText('Add photos')).toBeInTheDocument();
    expect(screen.getByText(/No photos yet/)).toBeInTheDocument();
  });

  it('uploads, displays, and removes a photo', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ActivityDetail activity={completedHike} onClose={() => {}} showUploads />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    await user.upload(input, file);

    const img = await screen.findByAltText(/Test Completed Hike 1/);
    expect(img).toBeInTheDocument();

    const removeBtn = screen.getByLabelText('Remove photo');
    await user.click(removeBtn);

    await waitFor(() => {
      expect(
        screen.queryByAltText(/Test Completed Hike 1/),
      ).not.toBeInTheDocument();
    });
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(<ActivityDetail activity={muirWoods} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<ActivityDetail activity={muirWoods} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows AllTrails rating, distance, elevation, and link when present', () => {
    render(
      <ActivityDetail
        activity={{
          ...muirWoods,
          allTrailsUrl: 'https://www.alltrails.com/trail/test',
          allTrailsRating: 4.6,
          hikeDistanceMiles: 3.2,
          hikeElevationFeet: 600,
          durationDetail: '3.2 mi loop, ~2h',
        }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('TRAIL DETAILS')).toBeInTheDocument();
    expect(screen.getByText('4.6')).toBeInTheDocument();
    expect(screen.getByText('3.2 mi')).toBeInTheDocument();
    expect(screen.getByText('600 ft gain')).toBeInTheDocument();
    expect(screen.getByText(/3\.2 mi loop/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /View on AllTrails/ });
    expect(link).toHaveAttribute(
      'href',
      'https://www.alltrails.com/trail/test',
    );
  });

  it('omits the trail-details panel when no hike fields are present', () => {
    render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
    expect(screen.queryByText('TRAIL DETAILS')).not.toBeInTheDocument();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<ActivityDetail activity={muirWoods} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close activity details'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('delete', () => {
    it('shows a Delete button on user-added activities', () => {
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      expect(
        screen.getByRole('button', { name: /delete activity/i }),
      ).toBeInTheDocument();
    });

    it('shows a Delete button on built-in activities too', () => {
      const builtIn = STATIC_ACTIVITIES[0];
      render(<ActivityDetail activity={builtIn} onClose={() => {}} />);
      expect(
        screen.getByRole('button', { name: /delete activity/i }),
      ).toBeInTheDocument();
    });

    it('confirms, calls deleteUserActivity, and closes when an owner confirms', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const onClose = vi.fn();
      render(<ActivityDetail activity={muirWoods} onClose={onClose} />);

      await userEvent.click(
        screen.getByRole('button', { name: /delete activity/i }),
      );

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining(muirWoods.name),
      );
      await waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith(muirWoods.id, null);
      });
      expect(onClose).toHaveBeenCalledTimes(1);

      confirmSpy.mockRestore();
    });

    it('does nothing when the owner cancels the confirm dialog', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const onClose = vi.fn();
      render(<ActivityDetail activity={muirWoods} onClose={onClose} />);

      await userEvent.click(
        screen.getByRole('button', { name: /delete activity/i }),
      );

      expect(deleteSpy).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it('renders the Delete button disabled with a tooltip for non-owners', () => {
      ownerState.isOwner = false;
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      const btn = screen.getByRole('button', { name: /delete activity/i });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Sign in as owner to delete');
    });
  });
});
