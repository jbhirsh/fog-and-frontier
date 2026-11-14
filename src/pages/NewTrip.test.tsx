import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router-dom';

type Owner = { isOwner: boolean; isLoaded: boolean; email: string | null };
const state = vi.hoisted(() => {
  const owner: Owner = { isOwner: true, isLoaded: true, email: 'owner@example.com' };
  return { owner, createTrip: vi.fn() };
});
vi.mock('../lib/useOwner', () => ({ useOwner: () => state.owner }));
vi.mock('../lib/userTrips', () => ({ createTrip: state.createTrip }));
// The ideas panel has its own tests: here it only has to hand back picks.
vi.mock('../components/TripIdeas', () => ({
  TripIdeas: ({
    seeded,
    picked,
    onChange,
    max,
  }: {
    seeded: readonly string[];
    picked: readonly string[];
    onChange: (picked: string[]) => void;
    max: number;
  }) => (
    <div data-testid="ideas">
      {`seeded=${seeded.join(',')} picked=${picked.join(',')} max=${max}`}
      <button type="button" onClick={() => onChange([...picked, 'idea-1', 'a1'])}>
        pick ideas
      </button>
    </div>
  ),
}));

import { NewTrip } from './NewTrip';

function renderNewTrip(entry: InitialEntry = '/trips/new') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/trips/new" element={<NewTrip />} />
        <Route path="/trips/:id" element={<div>trip page</div>} />
        <Route path="/trips" element={<div>trips list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const withActivities = (ids: string[]): InitialEntry => ({
  pathname: '/trips/new',
  state: { initial_activity_ids: ids },
});

const user = () => userEvent.setup();
const title = () => screen.getByLabelText(/^Title/);
const start = () => screen.getByLabelText(/^Start date/);
const end = () => screen.getByLabelText(/^End date/);
const submit = () => screen.getByRole('button', { name: /Create trip|Creating…/ });

async function fillRequired(u: ReturnType<typeof user>, t = 'Big Sur') {
  await u.type(title(), t);
  await u.type(start(), '2026-03-03');
  await u.type(end(), '2026-03-05');
}

beforeEach(() => {
  state.owner = { isOwner: true, isLoaded: true, email: 'owner@example.com' };
  state.createTrip.mockReset();
});

describe('NewTrip', () => {
  it('waits for auth before showing anything', () => {
    state.owner = { isOwner: false, isLoaded: false, email: null };
    renderNewTrip();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('turns a non-owner away, with a way back', () => {
    state.owner = { isOwner: false, isLoaded: true, email: 'editor@example.com' };
    renderNewTrip();
    expect(screen.getByText(/Sign in with an owner account/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to trips' })).toHaveAttribute('href', '/trips');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the form, marking the required fields, with nothing to add yet', () => {
    renderNewTrip();
    expect(screen.getByRole('heading', { name: 'New trip' })).toBeInTheDocument();
    expect(title()).toBeRequired();
    expect(screen.getByText('Title').parentElement).toHaveTextContent('Title *');
    expect(screen.getByText('Description').parentElement).toHaveTextContent(/^Description$/);
    expect(end()).not.toHaveAttribute('min');
    expect(screen.queryByText(/will be added to the Unscheduled list/)).not.toBeInTheDocument();
    expect(screen.getByTestId('ideas')).toHaveTextContent('seeded= picked= max=50');
    expect(submit()).toHaveTextContent('Create trip');
    expect(submit()).toBeEnabled();
    // No error until a send goes wrong.
    expect(
      screen.queryByText(/ required\.$|^End date must be|^Failed to create trip\.$/),
    ).not.toBeInTheDocument();
  });

  it('handles the submit itself rather than letting the browser post the form', () => {
    state.createTrip.mockReturnValue(new Promise(() => {}));
    renderNewTrip();
    const form = submit().closest('form');
    if (!form) throw new Error('no form');
    // fireEvent returns false once the handler has called preventDefault.
    expect(fireEvent.submit(form)).toBe(false);
  });

  it('keeps the end date from coming before the start', async () => {
    const u = user();
    renderNewTrip();
    await u.type(start(), '2026-03-03');
    expect(end()).toHaveAttribute('min', '2026-03-03');
  });

  it('counts the activities brought in and the ideas picked, once each', async () => {
    const u = user();
    renderNewTrip(withActivities(['a1']));
    expect(screen.getByText(/will be added/)).toHaveTextContent(
      '1 activity will be added to the Unscheduled list once the trip is created.',
    );
    expect(screen.getByTestId('ideas')).toHaveTextContent('seeded=a1 picked=');
    await u.click(screen.getByRole('button', { name: 'pick ideas' }));
    expect(screen.getByText(/will be added/)).toHaveTextContent('2 activities will be added');
  });

  it.each([
    ['a blank title', '   ', '2026-03-03', '2026-03-05', 'Title is required.'],
    ['no start date', 'Big Sur', '', '2026-03-05', 'Start and end date are required.'],
    ['no end date', 'Big Sur', '2026-03-03', '', 'Start and end date are required.'],
    [
      'an end before the start',
      'Big Sur',
      '2026-03-05',
      '2026-03-03',
      'End date must be on or after start date.',
    ],
  ])('refuses %s without asking the server', async (_, t, s, e, message) => {
    const u = user();
    renderNewTrip();
    await u.type(title(), t);
    if (s) await u.type(start(), s);
    if (e) await u.type(end(), e);
    // Past the browser's own required checks, to reach the form's.
    const form = submit().closest('form');
    if (!form) throw new Error('no form');
    form.noValidate = true;
    await u.click(submit());
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(state.createTrip).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
  });

  it('creates a one-day trip with just the required fields, trimmed, and opens it', async () => {
    state.createTrip.mockResolvedValue({ id: 'new-1' });
    const u = user();
    renderNewTrip();
    await u.type(title(), '  Big Sur  ');
    await u.type(start(), '2026-03-03');
    await u.type(end(), '2026-03-03');
    await u.type(screen.getByLabelText('Description'), '   ');
    await u.type(screen.getByLabelText('Cover image URL'), '   ');
    await u.click(submit());
    expect(state.createTrip).toHaveBeenCalledExactlyOnceWith({
      title: 'Big Sur',
      start_date: '2026-03-03',
      end_date: '2026-03-03',
    });
    expect(await screen.findByText('trip page')).toBeInTheDocument();
  });

  it('sends everything filled in, the starting activities, and voting first', async () => {
    state.createTrip.mockResolvedValue({ id: 'new-1' });
    const u = user();
    renderNewTrip(withActivities(['a1', 'a2']));
    await fillRequired(u);
    await u.type(screen.getByLabelText('Description'), '  Coast drive  ');
    await u.type(screen.getByLabelText('Cover image URL'), ' https://example.com/c.jpg ');
    await u.click(screen.getByRole('button', { name: 'pick ideas' }));
    const voting = screen.getByRole('checkbox', { name: /Open voting first/ });
    expect(voting).not.toBeChecked();
    await u.click(voting);
    expect(voting).toBeChecked();
    await u.click(submit());
    expect(state.createTrip).toHaveBeenCalledExactlyOnceWith({
      title: 'Big Sur',
      start_date: '2026-03-03',
      end_date: '2026-03-05',
      description: 'Coast drive',
      cover_image_url: 'https://example.com/c.jpg',
      initial_activity_ids: ['a1', 'a2', 'idea-1'],
      status: 'voting',
    });
    expect(await screen.findByText('trip page')).toBeInTheDocument();
  });

  it('shows Creating… while it waits', async () => {
    state.createTrip.mockReturnValue(new Promise(() => {}));
    const u = user();
    renderNewTrip();
    await fillRequired(u);
    await u.click(submit());
    expect(submit()).toHaveTextContent('Creating…');
    expect(submit()).toBeDisabled();
  });

  it("shows the server's error, or a fallback, and lets them try again", async () => {
    state.createTrip.mockRejectedValueOnce(new Error('Too many trips')).mockRejectedValueOnce('x');
    const u = user();
    renderNewTrip();
    await fillRequired(u);
    await u.click(submit());
    expect(await screen.findByText('Too many trips')).toBeInTheDocument();
    expect(submit()).toBeEnabled();
    expect(submit()).toHaveTextContent('Create trip');

    await u.click(submit());
    expect(await screen.findByText('Failed to create trip.')).toBeInTheDocument();
    expect(screen.queryByText('Too many trips')).not.toBeInTheDocument();
    expect(screen.queryByText('trip page')).not.toBeInTheDocument();
  });

  it('clears an earlier error when the form is sent again', async () => {
    state.createTrip.mockReturnValue(new Promise(() => {}));
    const u = user();
    renderNewTrip();
    const form = submit().closest('form');
    if (!form) throw new Error('no form');
    form.noValidate = true;
    await u.click(submit());
    expect(screen.getByText('Title is required.')).toBeInTheDocument();
    await fillRequired(u);
    await u.click(submit());
    expect(screen.queryByText('Title is required.')).not.toBeInTheDocument();
  });

  it('links back to the trips list', () => {
    renderNewTrip();
    expect(screen.getByRole('link', { name: '← Trips' })).toHaveAttribute('href', '/trips');
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/trips');
  });
});
