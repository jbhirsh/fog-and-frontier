import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TripActivity } from '../lib/userTrips';
import { TripActivityCard } from './TripActivityCard';

const LONG = 'Completed Scenic Overlook at Stinson Beach and Bolinas Lagoon';

const activity: TripActivity = {
  id: 'ta-1',
  trip_id: 'trip-1',
  activity_id: 'stinson',
  added_by_email: 'test@example.com',
  added_at: 0,
  day_index: null,
  start_time: null,
  display_order: 0,
  snapshot: {
    id: 'stinson',
    name: LONG,
    shortDescription: '',
    category: 'scenic',
    region: 'sf',
    duration: 'Full Day',
    difficulty: 'easy',
    location: { city: 'Stinson Beach', coords: { lat: 37.9, lng: -122.6 } },
    coverImage: '',
  },
};

describe('TripActivityCard', () => {
  it('shows a long name whole on a phone, and on one line wider up', () => {
    render(<TripActivityCard activity={activity} onAssignToDay={() => {}} />);
    const name = screen.getByText(LONG);
    expect(name).toHaveClass('wrap-break-word', 'md:line-clamp-1');
    expect(name.className.split(' ')).not.toContain('line-clamp-1');
    expect(screen.getByText('Stinson Beach · Full Day')).toHaveClass('md:line-clamp-1');
  });

  it('opens the place from its name, and offers its actions', async () => {
    const onOpen = vi.fn();
    const onAssignToDay = vi.fn();
    const onRemove = vi.fn();
    render(
      <TripActivityCard
        activity={activity}
        onOpen={onOpen}
        onAssignToDay={onAssignToDay}
        onRemove={onRemove}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: (n) => n.includes(LONG) }));
    expect(onOpen).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Assign to day' }));
    expect(onAssignToDay).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
