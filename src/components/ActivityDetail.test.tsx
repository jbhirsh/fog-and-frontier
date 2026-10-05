import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../test/render';
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

  it('shows the category glyph when the hero cover fails to load (#120)', () => {
    render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
    fireEvent.error(screen.getByRole('img', { name: 'Test Muir Woods' }));
    const hero = screen.getByRole('img', { name: 'Test Muir Woods' });
    expect(hero.tagName).toBe('DIV');
    expect(hero).toHaveTextContent('directions_walk');
  });

  it('credits a Commons cover under the hero (#36)', () => {
    const credit = 'Photo: Jo, CC BY-SA 4.0, via Wikimedia Commons';
    render(
      <ActivityDetail activity={{ ...muirWoods, coverCredit: credit }} onClose={() => {}} />,
    );
    expect(screen.getByText(credit)).toBeInTheDocument();
  });

  it('shows no credit line for a cover without one', () => {
    render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
    expect(screen.queryByText(/via Wikimedia Commons/)).not.toBeInTheDocument();
  });

  it('shows the COMPLETED badge with date and notes for completed activities', () => {
    render(<ActivityDetail activity={completedHike} onClose={() => {}} />);
    expect(screen.getByText(/COMPLETED/)).toBeInTheDocument();
    expect(screen.getByText(/2025-11-02/)).toBeInTheDocument();
    expect(screen.getByText('Beautiful sunset.')).toBeInTheDocument();
  });

  describe('owner reviews (issue #184)', () => {
    const jessReview = {
      activityId: completedHike.id,
      authorEmail: 'owner@example.com',
      rating: 4,
      note: 'The ridge was worth it.',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };

    it('shows the reviews section on a completed activity', async () => {
      render(<ActivityDetail activity={completedHike} onClose={() => {}} />, {
        reviews: [jessReview],
      });
      expect(
        await screen.findByRole('heading', { name: 'Reviews' }),
      ).toBeInTheDocument();
      expect(screen.getByText('The ridge was worth it.')).toBeInTheDocument();
    });

    it('drops an open review draft when a nearby activity is selected', async () => {
      const user = userEvent.setup();
      // jsdom doesn't implement Element.scrollTo, which selectNearby calls to
      // return the dialog to the top.
      Object.defineProperty(Element.prototype, 'scrollTo', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      });
      const nearbyCompleted = {
        ...muirWoods,
        id: 'test-nearby-completed',
        name: 'Nearby Completed Loop',
        completed: true,
      };
      render(<ActivityDetail activity={completedHike} onClose={() => {}} />, {
        activities: [completedHike, nearbyCompleted],
        reviews: [jessReview],
      });
      await user.click(
        await screen.findByRole('button', { name: /edit review/i }),
      );
      expect(screen.getByRole('textbox')).toHaveValue('The ridge was worth it.');

      await user.click(
        screen.getByRole('button', { name: /Nearby Completed Loop/ }),
      );
      // The draft belonged to the previous activity — it must not carry over
      // and get saved onto this one.
      await waitFor(() =>
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByText('The ridge was worth it.'),
      ).not.toBeInTheDocument();
    });

    it('does not show reviews on an activity we have not done yet', () => {
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      expect(
        screen.queryByRole('heading', { name: 'Reviews' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('nearby, grouped by category (issue #65)', () => {
    // Offsets due north of muirWoods; 0.01° of latitude is ~0.69 mi.
    const near = (
      id: string,
      name: string,
      category: Activity['category'],
      hundredths: number,
    ): Activity => ({
      ...muirWoods,
      id,
      name,
      category,
      location: {
        city: 'Mill Valley, CA',
        coords: {
          lat: muirWoods.location.coords.lat + hundredths / 100,
          lng: muirWoods.location.coords.lng,
        },
      },
    });

    const lunch = near('n-lunch', 'Trailside Tacos', 'food', 6);
    const hikes = [1, 2, 3, 4].map((n) =>
      near(`n-hike-${n}`, `Ridge Hike ${n}`, 'hiking', n),
    );
    const vista = near('n-vista', 'Overlook Vista', 'scenic', 5);
    const faraway = near('n-far', 'Faraway Diner', 'food', 40);

    function stubScrollTo() {
      // jsdom doesn't implement Element.scrollTo, which selectNearby calls.
      Object.defineProperty(Element.prototype, 'scrollTo', {
        value: vi.fn(),
        writable: true,
        configurable: true,
      });
    }

    it('renders one labelled group per category, food first for a hike', () => {
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />, {
        activities: [muirWoods, ...hikes, vista, lunch, faraway],
      });
      expect(screen.getAllByRole('region')).toHaveLength(3);
      // Each heading leads with its category's map-pin glyph (CATEGORY_ICON).
      expect(
        screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent),
      ).toEqual([
        'restaurantNearby food',
        'directions_walkNearby hikes',
        'landscapeNearby scenic spots',
      ]);

      const food = screen.getByRole('region', { name: 'Nearby food' });
      expect(
        within(food).getByRole('button', { name: /Trailside Tacos/ }),
      ).toBeInTheDocument();
      // Out of range, so absent even though it's food.
      expect(screen.queryByText('Faraway Diner')).not.toBeInTheDocument();

      // Per-category cap: the three nearest hikes, nearest first; the fourth
      // is dropped without crowding out food or the vista.
      const hikeGroup = screen.getByRole('region', { name: 'Nearby hikes' });
      expect(
        within(hikeGroup)
          .getAllByRole('button')
          .map((b) => within(b).getByRole('img').getAttribute('alt')),
      ).toEqual(['Ridge Hike 1', 'Ridge Hike 2', 'Ridge Hike 3']);
      expect(
        within(
          screen.getByRole('region', { name: 'Nearby scenic spots' }),
        ).getByRole('button', { name: /Overlook Vista/ }),
      ).toBeInTheDocument();

      // The open activity never lists itself.
      expect(
        screen.queryByRole('button', { name: /Test Muir Woods/ }),
      ).not.toBeInTheDocument();
    });

    it('swaps the detail to a nearby activity on tap and regroups around it', async () => {
      const user = userEvent.setup();
      stubScrollTo();
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />, {
        activities: [muirWoods, lunch, vista],
      });
      await user.click(screen.getByRole('button', { name: /Trailside Tacos/ }));

      expect(
        screen.getByRole('dialog', { name: 'Trailside Tacos' }),
      ).toBeInTheDocument();
      // Now centred on the restaurant: it drops out of its own list, the hike
      // it was reached from appears, and food no longer leads (the open
      // activity is food), so groups go by nearest member.
      expect(
        screen.queryByRole('region', { name: 'Nearby food' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent),
      ).toEqual(['landscapeNearby scenic spots', 'directions_walkNearby hikes']);
      expect(
        within(
          screen.getByRole('region', { name: 'Nearby hikes' }),
        ).getByRole('button', { name: /Test Muir Woods/ }),
      ).toBeInTheDocument();
    });

    it('hides the section when nothing is within range', () => {
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />, {
        activities: [muirWoods, faraway],
      });
      expect(
        screen.queryByRole('heading', { name: /Nearby — do at the same time/ }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });
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

  describe('non-owner presentation (issue #67)', () => {
    it('hides the Mark-as-completed toggle for non-owners', () => {
      ownerState.isOwner = false;
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      expect(
        screen.queryByRole('button', { name: /mark as completed/i }),
      ).not.toBeInTheDocument();
    });

    it('keeps the completed status as a read-only badge for non-owners', () => {
      ownerState.isOwner = false;
      render(<ActivityDetail activity={completedHike} onClose={() => {}} />);
      // Status is preserved (a read), but it is not an interactive control.
      expect(screen.getByText(/COMPLETED/)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /completed/i }),
      ).not.toBeInTheDocument();
    });

    it('hides the photo-upload control for non-owners in upload mode', () => {
      ownerState.isOwner = false;
      render(
        <ActivityDetail
          activity={completedHike}
          onClose={() => {}}
          showUploads
        />,
      );
      // The Your Photos section (a read) still renders, but Add photos is gone.
      expect(screen.queryByText('Add photos')).not.toBeInTheDocument();
      expect(screen.getByText(/No photos yet/)).toBeInTheDocument();
    });
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

  it('says so when a photo cannot be saved (storage full)', async () => {
    const user = userEvent.setup();
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
    const { container } = render(
      <ActivityDetail activity={completedHike} onClose={() => {}} showUploads />,
    );
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, new File(['x'], 'pic.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save that photo",
    );
    expect(screen.getByText(/No photos yet/)).toBeInTheDocument();
    setItem.mockRestore();

    await user.click(screen.getByLabelText('Dismiss error'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  describe('get directions (issue #87)', () => {
    function stubUserAgent(ua: string) {
      const spy = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
      onTestFinished(() => spy.mockRestore());
    }

    it('links to Google Maps directions in a new tab on non-Apple devices', () => {
      stubUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
      );
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      const link = screen.getByRole('link', { name: /Get directions/ });
      expect(link).toHaveAttribute(
        'href',
        'https://www.google.com/maps/dir/?api=1&destination=37.8917%2C-122.5719',
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('links to Apple Maps on Apple devices', () => {
      stubUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1',
      );
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      expect(
        screen.getByRole('link', { name: /Get directions/ }),
      ).toHaveAttribute(
        'href',
        'https://maps.apple.com/?daddr=37.8917%2C-122.5719',
      );
    });

    it('is shown to non-owners too (a read, not owner-gated)', () => {
      ownerState.isOwner = false;
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      expect(
        screen.getByRole('link', { name: /Get directions/ }),
      ).toBeInTheDocument();
    });

    it('is absent when the activity has no usable coordinates', () => {
      render(
        <ActivityDetail
          activity={{
            ...muirWoods,
            location: {
              ...muirWoods.location,
              coords: { lat: Number.NaN, lng: Number.NaN },
            },
          }}
          onClose={() => {}}
        />,
      );
      expect(
        screen.queryByRole('link', { name: /Get directions/ }),
      ).not.toBeInTheDocument();
    });
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
          expect(deleteSpy).toHaveBeenCalledWith(activity.id);
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

    it('does not render the Delete button for non-owners', () => {
      ownerState.isOwner = false;
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      expect(
        screen.queryByRole('button', { name: /delete activity/i }),
      ).not.toBeInTheDocument();
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

    it('does not render the Edit button for non-owners', () => {
      ownerState.isOwner = false;
      render(<ActivityDetail activity={muirWoods} onClose={() => {}} />);
      expect(
        screen.queryByRole('button', { name: /edit activity/i }),
      ).not.toBeInTheDocument();
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
