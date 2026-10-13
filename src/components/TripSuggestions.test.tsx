import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Activity } from '../data/types';
import {
  TRIP_SUGGESTION_RADIUS_MILES,
  TRIP_SUGGESTIONS_PAGE,
  type TripSuggestion,
} from '../lib/tripSuggestions';
import { TripSuggestions } from './TripSuggestions';

function suggestion(n: number): TripSuggestion {
  const activity: Activity = {
    id: `a${n}`,
    name: `Spot ${n}`,
    shortDescription: '',
    category: 'food',
    region: 'south-bay',
    location: { city: `Town ${n}`, coords: { lat: 37, lng: -122 } },
    duration: 'Half Day',
    coverImage: '',
  };
  return { activity, miles: n + 0.25, nearName: 'Castle Rock' };
}

const many = (count: number) => Array.from({ length: count }, (_, i) => suggestion(i + 1));

function renderIt(overrides: Partial<Parameters<typeof TripSuggestions>[0]> = {}) {
  const props = {
    suggestions: many(2),
    busy: false,
    onAdd: vi.fn<(a: Activity) => Promise<boolean>>().mockResolvedValue(true),
    onOpen: vi.fn(),
    ...overrides,
  };
  render(<TripSuggestions {...props} />);
  return props;
}

const section = () => screen.getByRole('region', { name: 'Suggested for this trip' });
const items = () => within(section()).queryAllByRole('listitem');

describe('TripSuggestions', () => {
  it('says so when nothing is near the candidates', () => {
    renderIt({ suggestions: [] });
    expect(section()).toHaveTextContent(
      `Nothing else in the catalog is within ${TRIP_SUGGESTION_RADIUS_MILES} miles of this trip's candidates.`,
    );
    expect(items()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('shows each suggestion with its town and distance from the nearest candidate', () => {
    renderIt();
    expect(section()).toHaveTextContent(
      `Within ${TRIP_SUGGESTION_RADIUS_MILES} miles of the candidates, starting with what the trip doesn't have yet.`,
    );
    const [first] = items();
    expect(first).toHaveTextContent('Spot 1');
    expect(first).toHaveTextContent('Town 1');
    expect(first).toHaveTextContent('1.3 mi from Castle Rock');
  });

  it('opens a suggestion from its card', async () => {
    const { onOpen, onAdd } = renderIt();
    await userEvent.click(screen.getByRole('button', { name: /^Spot 2/ }));
    expect(onOpen).toHaveBeenCalledWith(suggestion(2).activity);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('adds a suggestion as a candidate in one tap, then says so', async () => {
    const { onAdd, onOpen } = renderIt();
    expect(screen.getByRole('status')).toHaveTextContent('');
    await userEvent.click(screen.getByRole('button', { name: 'Add Spot 1 as a candidate' }));
    expect(onAdd).toHaveBeenCalledWith(suggestion(1).activity);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Added Spot 1 as a candidate.');
    // Focus stays in the section instead of leaving with the added card.
    expect(screen.getByRole('heading', { name: 'Suggested for this trip' })).toHaveFocus();
  });

  it('says nothing and leaves focus alone when the add fails', async () => {
    const onAdd = vi.fn<(a: Activity) => Promise<boolean>>().mockResolvedValue(false);
    renderIt({ onAdd });
    const add = screen.getByRole('button', { name: 'Add Spot 1 as a candidate' });
    await userEvent.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(add).toHaveFocus();
  });

  it('takes focus without joining the tab order', () => {
    renderIt();
    expect(screen.getByRole('heading', { name: 'Suggested for this trip' })).toHaveAttribute(
      'tabindex',
      '-1',
    );
  });

  it('copes with the section going away before the add finishes', async () => {
    let unmountIt = () => {};
    const onAdd = vi.fn<(a: Activity) => Promise<boolean>>(() => {
      // Voting closed meanwhile, say: the trip page drops the section.
      unmountIt();
      return Promise.resolve(true);
    });
    const { unmount } = render(
      <TripSuggestions suggestions={many(1)} busy={false} onAdd={onAdd} onOpen={vi.fn()} />,
    );
    unmountIt = unmount;
    await userEvent.click(screen.getByRole('button', { name: 'Add Spot 1 as a candidate' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('holds Add while another trip action is in flight', () => {
    renderIt({ busy: true });
    expect(screen.getByRole('button', { name: 'Add Spot 1 as a candidate' })).toBeDisabled();
  });

  it('allows Add when nothing else is in flight', () => {
    renderIt({ busy: false });
    expect(screen.getByRole('button', { name: 'Add Spot 1 as a candidate' })).toBeEnabled();
  });

  it('shows a page at a time, with Show more until all are shown', async () => {
    renderIt({ suggestions: many(TRIP_SUGGESTIONS_PAGE * 2 + 1) });
    expect(items()).toHaveLength(TRIP_SUGGESTIONS_PAGE);

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(items()).toHaveLength(TRIP_SUGGESTIONS_PAGE * 2);

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(items()).toHaveLength(TRIP_SUGGESTIONS_PAGE * 2 + 1);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('has no Show more when one page holds them all', () => {
    renderIt({ suggestions: many(TRIP_SUGGESTIONS_PAGE) });
    expect(items()).toHaveLength(TRIP_SUGGESTIONS_PAGE);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
