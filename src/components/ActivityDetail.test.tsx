import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Activity } from '../data/types';
import { ActivityDetail } from './ActivityDetail';
import { completedHike, muirWoods } from '../test/fixtures';
import { activities as STATIC_ACTIVITIES } from '../data/activities';

const BUILT_IN_ID = 'mt-diablo-summit';
function builtInActivity() {
  const a = STATIC_ACTIVITIES.find((x) => x.id === BUILT_IN_ID);
  if (!a) throw new Error(`built-in fixture ${BUILT_IN_ID} missing from seed`);
  return a;
}

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

// AddActivity pulls in react-leaflet, which doesn't render under jsdom. Stub
// it with a marker that exposes the props the edit flow cares about so we
// can assert pre-population and exercise Save/Cancel without booting Leaflet.
const addActivityProps = vi.hoisted(() => ({
  current: null as null | {
    onClose: () => void;
    editActivity?: Activity;
    onSaved?: (a: Activity) => void;
  },
}));

vi.mock('./AddActivity', () => ({
  AddActivity: (props: {
    onClose: () => void;
    editActivity?: Activity;
    onSaved?: (a: Activity) => void;
  }) => {
    addActivityProps.current = props;
    return (
      <div
        data-testid="add-activity-modal"
        data-edit-id={props.editActivity?.id ?? ''}
        data-edit-name={props.editActivity?.name ?? ''}
      >
        <button type="button" onClick={props.onClose}>
          stub-cancel
        </button>
        <button
          type="button"
          onClick={() => {
            if (!props.editActivity) return;
            const updated: Activity = {
              ...props.editActivity,
              name: 'Updated name',
              shortDescription: 'Updated short.',
            };
            props.onSaved?.(updated);
            props.onClose();
          }}
        >
          stub-save
        </button>
      </div>
    );
  },
}));

beforeEach(() => {
  ownerState.isOwner = true;
  deleteSpy.mockClear();
  addActivityProps.current = null;
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
      const builtIn = builtInActivity();
      render(<ActivityDetail activity={builtIn} onClose={() => {}} />);
      expect(
        screen.getByRole('button', { name: /delete activity/i }),
      ).toBeInTheDocument();
    });

    it.each([
      ['user-added', muirWoods],
      ['built-in seed', builtInActivity()],
    ])(
      'confirms, calls deleteUserActivity, and closes when an owner confirms (%s)',
      async (_label, activity) => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const onClose = vi.fn();
        render(<ActivityDetail activity={activity} onClose={onClose} />);

        await userEvent.click(
          screen.getByRole('button', { name: /delete activity/i }),
        );

        expect(confirmSpy).toHaveBeenCalledWith(
          expect.stringContaining(activity.name),
        );
        expect(confirmSpy).toHaveBeenCalledWith(
          expect.stringContaining('for everyone'),
        );
        await waitFor(() => {
          expect(deleteSpy).toHaveBeenCalledWith(activity.id, null);
        });
        expect(onClose).toHaveBeenCalledTimes(1);

        confirmSpy.mockRestore();
      },
    );

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

  describe('edit', () => {
    it.each([
      ['user-added', muirWoods],
      ['built-in seed', builtInActivity()],
    ])('shows an Edit button on %s activities', (_label, activity) => {
      render(<ActivityDetail activity={activity} onClose={() => {}} />);
      expect(
        screen.getByRole('button', { name: /edit activity/i }),
      ).toBeInTheDocument();
    });

    it('renders the Edit button disabled with a tooltip for non-owners', () => {
      ownerState.isOwner = false;
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      const btn = screen.getByRole('button', { name: /edit activity/i });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Sign in as owner to edit');
    });

    it('opens the edit form pre-populated with the activity when an owner clicks Edit', async () => {
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);

      await userEvent.click(
        screen.getByRole('button', { name: /edit activity/i }),
      );

      const modal = await screen.findByTestId('add-activity-modal');
      expect(modal).toHaveAttribute('data-edit-id', muirWoods.id);
      expect(modal).toHaveAttribute('data-edit-name', muirWoods.name);
      expect(addActivityProps.current?.editActivity).toEqual(muirWoods);
    });

    it('updates the displayed activity after Save and closes only the edit form', async () => {
      const onClose = vi.fn();
      render(<ActivityDetail activity={muirWoods} onClose={onClose} />);

      await userEvent.click(
        screen.getByRole('button', { name: /edit activity/i }),
      );
      await userEvent.click(
        await screen.findByRole('button', { name: 'stub-save' }),
      );

      await waitFor(() => {
        expect(
          screen.queryByTestId('add-activity-modal'),
        ).not.toBeInTheDocument();
      });
      // Detail modal stays open showing the updated name; outer onClose
      // is not called.
      expect(
        screen.getByRole('heading', { name: 'Updated name' }),
      ).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('cancel discards changes and returns to the unchanged detail view', async () => {
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);

      await userEvent.click(
        screen.getByRole('button', { name: /edit activity/i }),
      );
      await userEvent.click(
        await screen.findByRole('button', { name: 'stub-cancel' }),
      );

      await waitFor(() => {
        expect(
          screen.queryByTestId('add-activity-modal'),
        ).not.toBeInTheDocument();
      });
      expect(
        screen.getByRole('heading', { name: muirWoods.name }),
      ).toBeInTheDocument();
    });
  });
});
