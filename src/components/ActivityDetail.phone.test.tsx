import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, render, screen, within } from '../test/render';
import type { Activity } from '../data/types';
import { muirWoods } from '../test/fixtures';
import { ActivityDetail } from './ActivityDetail';

// A place's page on a phone (#293). jsdom matches no media query, so the
// rest of the detail's tests see the desktop dialog; here the phone's query
// matches.

const ownerState = vi.hoisted(() => ({ isOwner: false, email: null as string | null }));
vi.mock('../lib/useOwner', () => ({
  useOwner: () => ({ isOwner: ownerState.isOwner, isLoaded: true, email: ownerState.email }),
}));

const completedState = vi.hoisted(() => ({ completed: false, toggle: vi.fn() }));
vi.mock('../lib/userCompleted', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/userCompleted')>('../lib/userCompleted');
  return { ...actual, useCompleted: () => completedState };
});

// The trip picker reads the trips list and navigates; a stand-in hands back
// its props.
const tripDialog = vi.hoisted(() => ({
  props: null as null | {
    activityIds: string[];
    onClose: () => void;
    onAdded?: (trip: { id: string; title: string }, added: number, skipped: number) => void;
  },
}));
vi.mock('./AddToTripDialog', () => ({
  AddToTripDialog: (props: NonNullable<typeof tripDialog.props>) => {
    tripDialog.props = props;
    return <div role="dialog" aria-label="Add to trip" />;
  },
}));

const PHONE_QUERY = '(max-width: 767.98px)';

// The trail's row, when it isn't a link.
const trailRow = (_: string, el: Element | null) =>
  el?.tagName === 'P' && (el.textContent ?? '').startsWith('Trail ·');

const PARK: Activity = {
  ...muirWoods,
  id: 'test-park',
  name: 'Test Redwoods Park',
  category: 'scenic',
};
const HIKE: Activity = {
  ...muirWoods,
  id: 'test-hike',
  name: 'Test Canopy Trail',
  parentId: PARK.id,
  dogFriendly: true,
  dogRulesUrl: 'https://www.parks.example/dogs',
  allTrailsRating: 4.6,
  allTrailsUrl: 'https://www.alltrails.com/trail/us/california/test',
  hikeDistanceMiles: 2.6,
  hikeElevationFeet: 1590,
  costTier: 'free',
};
const TACOS: Activity = {
  ...muirWoods,
  id: 'test-tacos',
  name: 'Trailside Tacos',
  category: 'food',
  location: { city: 'Mill Valley, CA', coords: { lat: 37.9, lng: -122.57 } },
};
const BAKERY: Activity = {
  ...muirWoods,
  id: 'test-bakery',
  name: 'Ridge Bakery',
  cardName: 'Ridge Bakery (short)',
  category: 'food',
  location: { city: 'Mill Valley, CA', coords: { lat: 37.95, lng: -122.6 } },
};
const ALL = [PARK, HIKE, TACOS, BAKERY];

function show(activity: Activity, props: Partial<Parameters<typeof ActivityDetail>[0]> = {}) {
  const onClose = vi.fn();
  const onSelectNearby = vi.fn();
  render(
    <ActivityDetail
      activity={activity}
      onClose={onClose}
      onSelectNearby={onSelectNearby}
      {...props}
    />,
    { activities: ALL },
  );
  return { onClose, onSelectNearby };
}

beforeEach(() => {
  ownerState.isOwner = false;
  ownerState.email = null;
  completedState.completed = false;
  completedState.toggle = vi.fn();
  tripDialog.props = null;
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === PHONE_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a place’s page on a phone (#293)', () => {
  it('opens on its photo with Back and Share over it, and its name whole', async () => {
    const { onClose } = show(HIKE);
    expect(screen.getByRole('heading', { name: 'Test Canopy Trail', level: 2 })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('links the dog to the place’s dog rules, beside its name (#296)', () => {
    show(HIKE);
    const dog = screen.getByRole('link', {
      name: "Dogs welcome: Test Canopy Trail's dog rules (opens in a new tab)",
    });
    expect(dog).toHaveAttribute('href', 'https://www.parks.example/dogs');
    expect(dog).toHaveAttribute('target', '_blank');
    expect(dog).toHaveAttribute('rel', 'noopener noreferrer');
    expect(dog).toHaveClass('size-11');
    // Beside the name, in its row, never a line of its own.
    expect(dog.parentElement).toContainElement(screen.getByRole('heading', { level: 2 }));
  });

  it('shows the dog alone without a rules page, and nothing for a place without dogs', () => {
    show({ ...HIKE, dogRulesUrl: undefined });
    expect(screen.getByRole('img', { name: 'Dogs welcome' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Dogs welcome/ })).not.toBeInTheDocument();
  });

  it('shows no dog where dogs aren’t welcome', () => {
    show({ ...HIKE, dogFriendly: false });
    expect(screen.queryByRole('img', { name: 'Dogs welcome' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Dogs welcome/ })).not.toBeInTheDocument();
  });

  it('puts the park and town under the name, the park opening it', async () => {
    const { onSelectNearby } = show(HIKE);
    const park = screen.getByRole('button', { name: 'Test Redwoods Park' });
    expect(park.parentElement).toHaveTextContent('Test Redwoods Park · Mill Valley, CA');
    await userEvent.click(park);
    expect(onSelectNearby).toHaveBeenCalledWith(expect.objectContaining({ id: PARK.id }));
  });

  it('says the town alone for a place in no park', () => {
    show({ ...HIKE, parentId: undefined });
    // Its own line, no park before it (the park may still be nearby).
    expect(screen.getByText('Mill Valley, CA').tagName).toBe('P');
  });

  it('lays the facts on one line: kind, duration, distance, rating and cost', () => {
    show(HIKE);
    const facts = screen.getByText('Hike').closest('p')!;
    expect(facts).toHaveTextContent(/^Hike·Half Day·≈?[\d.]+ mi away·starRated 4\.6·Free$/);
    expect(within(facts).getByText('Free')).toHaveClass('font-medium');
  });

  it('shows a cost that isn’t free as its tier, and leaves out what it doesn’t know', () => {
    show({ ...HIKE, costTier: '$$', allTrailsRating: undefined });
    const facts = screen.getByText('Hike').closest('p')!;
    expect(facts).toHaveTextContent(/·\$\$$/);
    expect(facts).not.toHaveTextContent('Rated');
  });

  describe('its three buttons', () => {
    it('offers a signed-out visitor directions alone', () => {
      show(HIKE);
      expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute('target', '_blank');
      expect(screen.queryByRole('button', { name: /Trip/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Done/ })).not.toBeInTheDocument();
    });

    it('offers a signed-in account a trip, and shows it done once it is', () => {
      ownerState.email = 'friend@example.com';
      completedState.completed = true;
      show(HIKE);
      expect(screen.getByRole('button', { name: 'Trip' })).toBeInTheDocument();
      // A badge, not a toggle: only owners mark places done.
      expect(screen.queryByRole('button', { name: /Done/ })).not.toBeInTheDocument();
      expect(screen.getByText('Done').tagName).toBe('SPAN');
    });

    it('lets an owner mark it done', async () => {
      ownerState.isOwner = true;
      ownerState.email = 'owner@example.com';
      show(HIKE);
      const done = screen.getByRole('button', { name: 'Done' });
      expect(done).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(done);
      expect(completedState.toggle).toHaveBeenCalledOnce();
    });

    it('marks an owner’s done place pressed', () => {
      ownerState.isOwner = true;
      completedState.completed = true;
      show(HIKE);
      expect(screen.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('adds it to a trip over the page, and says where it went', async () => {
    ownerState.email = 'friend@example.com';
    const { onClose } = show(HIKE);
    await userEvent.click(screen.getByRole('button', { name: 'Trip' }));
    expect(screen.getByRole('dialog', { name: 'Add to trip' })).toBeInTheDocument();
    expect(tripDialog.props?.activityIds).toEqual(['test-hike']);
    // Escape puts the picker away, not the page under it.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Add to trip' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Trip' }));
    act(() => tripDialog.props?.onAdded?.({ id: 't1', title: 'Spring Getaway' }, 1, 0));
    expect(screen.getByRole('status')).toHaveTextContent('Added to Spring Getaway');
    act(() => tripDialog.props?.onAdded?.({ id: 't1', title: 'Spring Getaway' }, 0, 1));
    expect(screen.getByRole('status')).toHaveTextContent('Already on Spring Getaway');
    act(() => tripDialog.props?.onClose());
    expect(screen.queryByRole('dialog', { name: 'Add to trip' })).not.toBeInTheDocument();
  });

  describe('Share', () => {
    it('opens the system’s share sheet with the place’s link', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, share });
      show(HIKE);
      await userEvent.click(screen.getByRole('button', { name: 'Share' }));
      expect(share).toHaveBeenCalledWith({
        title: 'Test Canopy Trail',
        url: `${window.location.origin}/activity/test-hike`,
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('says nothing when the sheet is dismissed', async () => {
      const share = vi.fn().mockRejectedValue(new DOMException('', 'AbortError'));
      vi.stubGlobal('navigator', { ...navigator, share });
      show(HIKE);
      await userEvent.click(screen.getByRole('button', { name: 'Share' }));
      expect(share).toHaveBeenCalledOnce();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('copies the link when the sheet fails for another reason', async () => {
      const share = vi.fn().mockRejectedValue(new DOMException('', 'NotAllowedError'));
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText } });
      show(HIKE);
      await userEvent.click(screen.getByRole('button', { name: 'Share' }));
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/activity/test-hike`);
      expect(screen.getByRole('status')).toHaveTextContent('Link copied');
    });

    it('copies the link when sharing throws something other than a DOMException', async () => {
      const share = vi.fn().mockRejectedValue(new Error('AbortError'));
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, share, clipboard: { writeText } });
      show(HIKE);
      await userEvent.click(screen.getByRole('button', { name: 'Share' }));
      expect(writeText).toHaveBeenCalledOnce();
    });

    it('copies the link where there’s no share sheet', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
      show(HIKE);
      await userEvent.click(screen.getByRole('button', { name: 'Share' }));
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/activity/test-hike`);
      expect(screen.getByRole('status')).toHaveTextContent('Link copied');
    });

    it('shows the link to copy when it can’t be copied', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } });
      show(HIKE);
      await userEvent.click(screen.getByRole('button', { name: 'Share' }));
      expect(screen.getByRole('status')).toHaveTextContent(
        `Copy this link: ${window.location.origin}/activity/test-hike`,
      );
    });
  });

  it('shows three lines of the description, and More when there’s more', async () => {
    const heights = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.tagName === 'P' && !this.className.includes('overflow-hidden') ? 0 : 200;
      });
    show(HIKE);
    const text = screen.getByText('A longer description of the redwoods loop.');
    expect(text).toHaveClass('max-h-[4.65em]', 'overflow-hidden');
    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(text).not.toHaveClass('overflow-hidden');
    const less = screen.getByRole('button', { name: 'Less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    heights.mockRestore();
  });

  it('offers no More for a description that fits', () => {
    show(HIKE);
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('describes it from its short description when it has no long one', () => {
    show({ ...HIKE, longDescription: undefined });
    expect(screen.getByText('Short redwoods description.')).toBeInTheDocument();
  });

  it('gives the trail a row: its numbers, and its AllTrails page', () => {
    show(HIKE);
    const row = screen.getByRole('link', { name: /On AllTrails/ });
    expect(row).toHaveTextContent('On AllTrails · 2.6 mi, 1,590 ft');
    expect(row).toHaveAttribute('href', HIKE.allTrailsUrl);
    expect(row).toHaveAttribute('target', '_blank');
  });

  it('gives a trail with no AllTrails page its numbers alone', () => {
    show({ ...HIKE, allTrailsUrl: undefined, hikeElevationFeet: undefined });
    expect(screen.queryByRole('link', { name: /AllTrails/ })).not.toBeInTheDocument();
    expect(screen.getByText(trailRow)).toHaveTextContent(/^Trail · 2\.6 mi$/);
  });

  it('has no trail row for a place that isn’t a trail', () => {
    show(TACOS);
    expect(screen.queryByRole('link', { name: /AllTrails/ })).not.toBeInTheDocument();
    expect(screen.queryByText(trailRow)).not.toBeInTheDocument();
  });

  it('lists what’s nearby by kind, nearest first, each saying where and how far', async () => {
    const { onSelectNearby } = show(HIKE);
    const nearby = screen.getByRole('region', { name: 'Nearby' });
    expect(within(nearby).getByRole('heading', { name: 'Nearby' })).toBeInTheDocument();
    expect(within(nearby).getByText(`Within 15 miles of ${HIKE.location.city}`)).toBeVisible();
    const food = within(nearby).getByRole('region', { name: /Nearby food/ });
    const rows = within(food).getAllByRole('button');
    expect(rows.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Trailside Tacos.*Mill Valley, CA · \d+\.\d mi · /),
      expect.stringMatching(/^Ridge Bakery \(short\)/),
    ]);
    await userEvent.click(rows[0]);
    expect(onSelectNearby).toHaveBeenCalledWith(expect.objectContaining({ id: TACOS.id }));
  });

  it('lists a park’s own, and a hike’s neighbours in its park, the same way', () => {
    show(PARK);
    const row = screen.getByRole('region', { name: 'Hikes & stops here' });
    expect(within(row).getByRole('button', { name: 'Test Canopy Trail' })).toBeInTheDocument();
    // Snapped as it scrolls, a place stops at the page's margin, not the edge.
    expect(within(row).getByRole('list')).toHaveClass('snap-x', 'scroll-px-md', 'px-md');
  });

  it('credits the cover at the foot of the page', () => {
    show({ ...HIKE, coverCredit: 'Photo: Someone, CC BY 4.0' });
    expect(screen.getByText('Photo: Someone, CC BY 4.0')).toHaveClass('text-[12px]');
  });

  it('draws its neighbours in the list as phone pages too, for a swipe', () => {
    show(HIKE, {
      sequence: {
        index: 1,
        total: 3,
        onPrev: () => {},
        onNext: () => {},
        prevActivity: TACOS,
        nextActivity: { ...HIKE, id: 'test-second', name: 'Test Second Trail' },
      },
    });
    const prev = screen.getByTestId('peek-prev');
    expect(within(prev).getByText('Trailside Tacos')).toBeInTheDocument();
    expect(within(prev).getByText('arrow_back')).toBeInTheDocument();
    expect(within(prev).getByText('1 of 3')).toBeInTheDocument();
    // A neighbour in a park names it, as plain text: it can't be tapped.
    const next = screen.getByTestId('peek-next');
    expect(within(next).getByText(/Test Redwoods Park/).tagName).toBe('P');
    // The steps stay on the page itself, between Back and Share.
    expect(screen.getByRole('navigation', { name: 'Adventure 2 of 3 in this list' })).toBeVisible();
  });
});
