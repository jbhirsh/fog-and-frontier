import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { muirWoods } from '../test/fixtures';
import type { Activity } from '../data/types';
import type { Trip, TripActivity, TripInvite, TripVote } from '../lib/userTrips';
import type { TripPhone } from '../components/TripPhone';
import type { MembersStrip } from '../components/MembersStrip';
import type { VotingCandidateCard } from '../components/VotingCandidateCard';
import type { TripActivityCard } from '../components/TripActivityCard';
import type { TripSuggestions } from '../components/TripSuggestions';
import type { PromoteToPlanningModal } from '../components/PromoteToPlanningModal';
import type { InviteModal } from '../components/InviteModal';
import { glyphBleed } from '../lib/iconMetrics';
import { TripDetail, TripMenu } from './TripDetail';
import { getIcon, textWithIcons } from '../test/icons';
import { RouteStateProbe } from '../test/RouteStateProbe';
import { makeTrip, tripActivity } from '../test/trips';
import { deferred } from '../test/deferred';

// The trip's page (#51, #294): its loading, invite and error screens, the
// voting and planning bodies, and every action it sends. Its children are
// stubs that record their props, so each test drives the page's own handlers
// and reads what it hands down; the children have their own tests.

const h = vi.hoisted(() => ({
  props: Object.create(null) as Record<string, unknown>,
  owner: { isLoaded: true, isOwner: false, email: null as string | null },
  tripId: undefined as string | undefined,
  tripState: {
    trip: null as Trip | null,
    isLoading: false,
    error: null as string | null,
    reload: vi.fn<() => Promise<void>>(),
  },
  catalog: { activities: [] as Activity[], loading: false, error: null as string | null },
  signIn: false,
  openActivity: vi.fn(),
  suggest: vi.fn(),
  interval: vi.fn(),
  api: {
    addActivityToTrip: vi.fn(),
    assignSlot: vi.fn(),
    castVote: vi.fn(),
    claimInvite: vi.fn(),
    deleteTrip: vi.fn(),
    fetchUsers: vi.fn(),
    inviteMember: vi.fn(),
    markTripPast: vi.fn(),
    patchTrip: vi.fn(),
    removeMember: vi.fn(),
    removeTripActivity: vi.fn(),
    revertToVoting: vi.fn(),
    revokeInvite: vi.fn(),
    setDisplayOrder: vi.fn(),
    setStartTimes: vi.fn(),
    transitionToPlanning: vi.fn(),
  },
}));

vi.mock('../lib/userTrips', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/userTrips')>()),
  ...h.api,
  useTrip: (id: string | undefined) => {
    h.tripId = id;
    return h.tripState;
  },
}));
vi.mock('../lib/useOwner', () => ({ useOwner: () => h.owner }));
vi.mock('../lib/userActivities', () => ({ useUserActivities: () => h.catalog }));
vi.mock('../lib/activityRoute', () => ({ useOpenActivity: () => h.openActivity }));
vi.mock('../lib/useVisibilityInterval', () => ({ useVisibilityInterval: h.interval }));
vi.mock('../lib/tripSuggestions', () => ({ suggestForTrip: h.suggest }));
vi.mock('../lib/authShim', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/authShim')>()),
  get SIGN_IN_ENABLED() {
    return h.signIn;
  },
}));
vi.mock('../components/SignIn', () => ({
  SignInButton: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock('../components/TripPhone', () => ({
  TripPhone: (p: { notice: ReactNode; menu: ReactNode; members: ReactNode; ideas: ReactNode }) => {
    h.props.TripPhone = p;
    return (
      <div data-testid="phone">
        {p.notice}
        {p.menu}
        {p.members}
        {p.ideas}
      </div>
    );
  },
}));
vi.mock('../components/TripMap', () => ({
  TripMap: ({ trip }: { trip: Trip }) => <p>map of {trip.title}</p>,
}));
vi.mock('../components/MembersStrip', () => ({
  MembersStrip: (p: unknown) => {
    h.props.MembersStrip = p;
    return null;
  },
}));
vi.mock('../components/VotingCandidateCard', () => ({
  VotingCandidateCard: (p: { activity: TripActivity; votingOpen: boolean }) => {
    h.props[`card:${p.votingOpen ? 'open' : 'closed'}:${p.activity.id}`] = p;
    return <p data-testid="candidate">{p.activity.id}</p>;
  },
}));
vi.mock('../components/TripActivityCard', () => ({
  TripActivityCard: (p: { activity: TripActivity }) => {
    h.props[`unscheduled:${p.activity.id}`] = p;
    return <p data-testid="unscheduled">{p.activity.id}</p>;
  },
}));
vi.mock('../components/TripSuggestions', () => ({
  TripSuggestions: (p: unknown) => {
    h.props.TripSuggestions = p;
    return <p>suggestions</p>;
  },
}));
vi.mock('../components/PromoteToPlanningModal', () => ({
  PromoteToPlanningModal: (p: unknown) => {
    h.props.Promote = p;
    return <p>promote modal</p>;
  },
}));
vi.mock('../components/InviteModal', () => ({
  InviteModal: (p: unknown) => {
    h.props.Invite = p;
    return <p>invite modal</p>;
  },
}));
vi.mock('../components/ActivityDetail', () => ({
  ActivityDetail: ({ activity, onClose }: { activity: Activity; onClose: () => void }) => (
    <div role="dialog" aria-label={`detail ${activity.name}`}>
      <button type="button" onClick={onClose}>
        Close detail
      </button>
    </div>
  ),
}));

type PhoneProps = ComponentProps<typeof TripPhone>;
type CardProps = ComponentProps<typeof VotingCandidateCard>;
const phone = () => h.props.TripPhone as PhoneProps;
const members = () => h.props.MembersStrip as ComponentProps<typeof MembersStrip>;
const card = (id: string, open = true) =>
  h.props[`card:${open ? 'open' : 'closed'}:${id}`] as CardProps;
const unscheduled = (id: string) =>
  h.props[`unscheduled:${id}`] as ComponentProps<typeof TripActivityCard>;
const suggestionsProps = () => h.props.TripSuggestions as ComponentProps<typeof TripSuggestions>;
const promote = () => h.props.Promote as ComponentProps<typeof PromoteToPlanningModal>;
const invite = () => h.props.Invite as ComponentProps<typeof InviteModal>;

const JESS = 'jess@example.com';
const TARUN = 'tarun@example.com';

function vote(id: string, email: string, value: -1 | 1): TripVote {
  return { trip_activity_id: id, member_email: email, value };
}

function ui(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/trips/:id"
          element={
            <>
              <TripDetail />
              <RouteStateProbe />
            </>
          }
        />
        <Route path="/trips" element={<p>Trips list</p>} />
        <Route path="/" element={<RouteStateProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

async function show(trip: Trip | null = makeTrip(), path = '/trips/trip-1') {
  h.tripState.trip = trip;
  const view = render(ui(path));
  if (trip) await screen.findByTestId('phone');
  return { ...view, rerenderPage: () => view.rerender(ui(path)) };
}

// Runs a handler that starts async work, and lets that work land.
async function settle(fn: () => unknown) {
  await act(async () => {
    await fn();
  });
}

// How the router got where it is, and where: the claim strips ?invite in place.
const location = () =>
  `${screen.getByTestId('route-navigation').textContent} ${screen.getByTestId('route-state').textContent}`;

// The page logs a failed action to the console; a test expecting one says so
// with expectLogged, and any other log fails the test.
let consoleError: MockInstance<typeof console.error>;

function expectLogged(err: unknown) {
  expect(consoleError.mock.calls).toEqual([[err]]);
  consoleError.mockClear();
}

beforeEach(() => {
  for (const key of Object.keys(h.props)) delete h.props[key];
  h.owner = { isLoaded: true, isOwner: false, email: JESS };
  h.tripId = undefined;
  h.tripState = {
    trip: null,
    isLoading: false,
    error: null,
    reload: vi.fn(() => Promise.resolve()),
  };
  h.catalog = { activities: [], loading: false, error: null };
  h.signIn = false;
  h.openActivity.mockReset();
  h.suggest.mockReset();
  h.interval.mockReset();
  for (const fn of Object.values(h.api)) fn.mockReset().mockResolvedValue(undefined);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  const logged = consoleError.mock.calls;
  consoleError.mockRestore();
  expect(logged, 'console.error the test did not expect').toEqual([]);
});

describe('TripDetail: before the trip', () => {
  it('loads the trip named in the route', async () => {
    await show();
    expect(h.tripId).toBe('trip-1');
  });

  it('says Loading while the session or the trip loads', () => {
    h.owner.isLoaded = false;
    h.tripState.trip = makeTrip();
    const { rerender } = render(ui('/trips/trip-1'));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    h.owner.isLoaded = true;
    h.tripState.isLoading = true;
    rerender(ui('/trips/trip-1'));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByTestId('phone')).not.toBeInTheDocument();
  });

  it('asks a signed-out invitee to sign in, keeping the token', () => {
    h.owner.email = null;
    h.signIn = true;
    render(ui('/trips/trip-1?invite=tok'));
    expect(screen.getByRole('heading', { name: "You're invited" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in to accept' })).toBeInTheDocument();
    expect(location()).toContain('?invite=tok');
    expect(h.api.claimInvite).not.toHaveBeenCalled();
  });

  it('tells a signed-out invitee when sign-in is unavailable', () => {
    h.owner.email = null;
    render(ui('/trips/trip-1?invite=tok'));
    expect(
      screen.getByText("Sign-in isn't available right now — try again later."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in to accept' })).not.toBeInTheDocument();
  });

  it('asks a signed-out visitor to sign in on unauthorized', () => {
    h.tripState.error = 'unauthorized';
    render(ui('/trips/trip-1'));
    expect(screen.getByRole('heading', { name: 'Trip' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to view this trip.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to trips' })).toHaveAttribute('href', '/trips');
  });

  it('tells a missing trip from one that failed to load', () => {
    h.tripState.error = 'not-found';
    const { rerender } = render(ui('/trips/trip-1'));
    expect(screen.getByText("We couldn't find that trip.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to trips' })).toHaveAttribute('href', '/trips');
    h.tripState.error = 'network';
    rerender(ui('/trips/trip-1'));
    expect(screen.getByText("Couldn't load this trip.")).toBeInTheDocument();
    h.tripState.error = null;
    rerender(ui('/trips/trip-1'));
    expect(screen.getByText("Couldn't load this trip.")).toBeInTheDocument();
    expect(screen.queryByText('Sign in to view this trip.')).not.toBeInTheDocument();
  });
});

describe('TripDetail: claiming an invite', () => {
  it('claims once signed in, reloads the trip, then strips the token in place', async () => {
    const claim = deferred<null>();
    const reload = deferred();
    h.api.claimInvite.mockReturnValue(claim.promise);
    h.owner.isLoaded = false;
    // Before the claim the invitee isn't a member, so the trip reads as not-found.
    h.tripState.trip = null;
    h.tripState.error = 'not-found';
    const firstReload = vi.fn(() => reload.promise);
    h.tripState.reload = firstReload;
    const { rerender } = render(ui('/trips/trip-1?invite=tok&tab=ideas'));
    expect(h.api.claimInvite).not.toHaveBeenCalled();

    h.owner.isLoaded = true;
    rerender(ui('/trips/trip-1?invite=tok&tab=ideas'));
    expect(h.api.claimInvite).toHaveBeenCalledWith('tok');
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    // A rerender with new deps while the claim runs doesn't claim again.
    h.tripState.reload = vi.fn(() => reload.promise);
    rerender(ui('/trips/trip-1?invite=tok&tab=ideas'));
    await settle(() => claim.resolve(null));
    expect(h.api.claimInvite).toHaveBeenCalledTimes(1);
    expect(firstReload).toHaveBeenCalledTimes(1);
    // The refetch is still out: the page keeps loading, the token in the URL.
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText("We couldn't find that trip.")).not.toBeInTheDocument();
    expect(location()).toContain('?invite=tok');

    h.tripState.trip = makeTrip();
    h.tripState.error = null;
    await settle(() => reload.resolve());
    await waitFor(() => expect(location()).toBe('REPLACE /trips/trip-1?tab=ideas null'));
    expect(await screen.findByTestId('phone')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('ends the claim and shows the load error when the refetch fails', async () => {
    const err = new Error('offline');
    h.api.claimInvite.mockResolvedValue(null);
    h.tripState.error = 'network';
    h.tripState.reload = vi.fn(() => Promise.reject(err));
    render(ui('/trips/trip-1?invite=tok'));
    expect(await screen.findByText("Couldn't load this trip.")).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expectLogged(err);
    await waitFor(() => expect(location()).toBe('REPLACE /trips/trip-1 null'));
  });

  it('still strips the token and loads when the claim fails', async () => {
    const err = new Error('expired');
    h.api.claimInvite.mockRejectedValue(err);
    h.tripState.trip = makeTrip();
    render(ui('/trips/trip-1?invite=tok'));
    expect(await screen.findByTestId('phone')).toBeInTheDocument();
    expectLogged(err);
    // The router strips the token in a transition, which can land after the
    // claim's own update has shown the trip.
    await waitFor(() => expect(location()).toBe('REPLACE /trips/trip-1 null'));
  });
});

describe('TripDetail: the planning page', () => {
  const planning = () =>
    makeTrip({
      activities: [
        tripActivity('s3', { day_index: 1, start_time: '18:00' }),
        tripActivity('s1', { day_index: 0, start_time: '09:00' }),
        tripActivity('u1'),
        tripActivity('u2', { snapshot: null }),
      ],
    });

  it('hands the phone the trip, its ideas and its map', async () => {
    const trip = planning();
    await show(trip);
    const p = phone();
    expect(p.trip).toBe(trip);
    expect(p.isPast).toBe(false);
    expect(p.isVoting).toBe(false);
    expect(p.busy).toBe(false);
    expect(p.ideasCount).toBe(2);
    render(<>{p.map}</>);
    expect(screen.getByText('map of Coast Weekend')).toBeInTheDocument();
    expect(screen.getAllByTestId('unscheduled').map((e) => e.textContent)).toEqual(['u1', 'u2']);
    expect(screen.getByRole('heading', { name: 'Unscheduled' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Candidates' })).not.toBeInTheDocument();
    expect(h.interval).toHaveBeenCalledWith(expect.any(Function), 30_000, false);
    expect(h.suggest).not.toHaveBeenCalled();
  });

  it('marks the unscheduled cards past on a past trip, and disables adding', async () => {
    await show(makeTrip({ status: 'past', activities: [tripActivity('u1')] }));
    expect(phone().isPast).toBe(true);
    expect(phone().ideasCount).toBe(1);
    expect(unscheduled('u1').disabled).toBe(true);
    expect(unscheduled('u1').pastTooltip).toBe('This trip is past');
    const add = screen.getByRole('button', { name: '+ Add' });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', 'This trip is past');
  });

  it('offers adding from the catalog when nothing is unscheduled', async () => {
    const user = userEvent.setup();
    await show(makeTrip());
    expect(screen.getByRole('button', { name: '+ Add' })).not.toHaveAttribute('title');
    const link = screen.getByRole('button', { name: 'Add activity' });
    expect(link).toBeEnabled();
    await user.click(link);
    expect(location()).toBe(
      'PUSH / {"target_trip_id":"trip-1","target_trip_title":"Coast Weekend"}',
    );
  });

  it('disables the empty-list link on a past trip', async () => {
    await show(makeTrip({ status: 'past' }));
    expect(screen.getByRole('button', { name: 'Add activity' })).toBeDisabled();
  });

  it('browses from the phone only while the trip is not past', async () => {
    const view = await show(makeTrip());
    act(() => phone().onBrowse());
    expect(location()).toBe(
      'PUSH / {"target_trip_id":"trip-1","target_trip_title":"Coast Weekend"}',
    );
    view.unmount();
    await show(makeTrip({ status: 'past' }));
    act(() => phone().onBrowse());
    expect(location()).toBe('POP /trips/trip-1 null');
  });

  it('opens a card in the catalog by its permalink, and an orphan from its snapshot', async () => {
    const user = userEvent.setup();
    h.catalog.activities = [{ ...muirWoods, id: 'act-u1' }];
    await show(planning());
    act(() => unscheduled('u1').onOpen?.());
    expect(h.openActivity).toHaveBeenCalledWith('act-u1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => phone().onOpen(tripActivity('gone', { activity_id: 'act-gone' })));
    expect(screen.getByRole('dialog', { name: 'detail Place gone' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close detail' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => phone().onOpen(tripActivity('none', { activity_id: null })));
    expect(screen.getByRole('dialog', { name: 'detail Place none' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close detail' }));

    act(() => phone().onOpen(tripActivity('blank', { activity_id: 'act-blank', snapshot: null })));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.openActivity).toHaveBeenCalledTimes(1);
  });

  it('schedules an unscheduled card after what day one already holds', async () => {
    const user = userEvent.setup();
    await show(planning());
    act(() => unscheduled('u1').onAssignToDay?.());
    const dialog = screen.getByRole('dialog', { name: 'Schedule Place u1' });
    const select = within(dialog).getByRole('combobox');
    expect(select).toHaveValue('0');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Day 1 · Sat, Apr 11', 'Day 2 · Sun, Apr 12']);
    // Day one's 09:00 half day ends at 13:00; the default is half an hour on.
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('13:30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(h.api.assignSlot).toHaveBeenCalledWith('u1', { day_index: 0, start_time: '13:30' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names a card without a snapshot, and edits a scheduled one at its own slot', async () => {
    const user = userEvent.setup();
    await show(planning());
    act(() => unscheduled('u2').onAssignToDay?.());
    expect(screen.getByRole('dialog', { name: 'Schedule (activity)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.api.assignSlot).not.toHaveBeenCalled();

    act(() => phone().onEditTime(tripActivity('s3', { day_index: 1, start_time: '18:00' })));
    const dialog = screen.getByRole('dialog', { name: 'Schedule Place s3' });
    expect(within(dialog).getByRole('combobox')).toHaveValue('1');
    expect(within(dialog).getByLabelText('Start time')).toHaveValue('18:00');
    await user.selectOptions(within(dialog).getByRole('combobox'), '0');
    fireEvent.change(within(dialog).getByLabelText('Start time'), { target: { value: '11:30' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(h.api.assignSlot).toHaveBeenCalledWith('s3', { day_index: 0, start_time: '11:30' });
  });

  it('starts an unscheduled card on day one at 09:00 when nothing is there', async () => {
    await show(makeTrip({ activities: [tripActivity('u1')] }));
    act(() => unscheduled('u1').onAssignToDay?.());
    expect(screen.getByLabelText('Start time')).toHaveValue('09:00');
  });

  it('schedules onto a day after that day’s last timed stop', async () => {
    const trip = makeTrip({
      activities: [
        tripActivity('late', { day_index: 0, start_time: '20:00' }),
        tripActivity('s3', { day_index: 1, start_time: '10:00' }),
        tripActivity('u1'),
      ],
    });
    await show(trip);
    await settle(() => phone().onSchedule(trip.activities[2], 1));
    // Day two's 10:00 half day ends at 14:00; day one's 20:00 doesn't count.
    expect(h.api.assignSlot).toHaveBeenCalledWith('u1', { day_index: 1, start_time: '14:30' });
  });

  it('moves stops within a day in one write, unschedules and removes', async () => {
    const trip = planning();
    await show(trip);
    act(() => phone().onMove([]));
    expect(h.api.setStartTimes).not.toHaveBeenCalled();
    const times = [{ id: 's1', start_time: '10:00' }];
    await settle(() => phone().onMove(times));
    expect(h.api.setStartTimes).toHaveBeenCalledWith('trip-1', times);
    await settle(() => phone().onUnschedule(trip.activities[1]));
    expect(h.api.assignSlot).toHaveBeenCalledWith('s1', { day_index: null, start_time: null });
    await settle(() => unscheduled('u1').onRemove?.());
    expect(h.api.removeTripActivity).toHaveBeenCalledWith('u1');
    await settle(() => phone().onRemove(trip.activities[0]));
    expect(h.api.removeTripActivity).toHaveBeenCalledWith('s3');
    expect(h.tripState.reload).toHaveBeenCalledTimes(4);
  });

  it('shows the closed vote ranked by net score', async () => {
    const trip = makeTrip({
      activities: [
        tripActivity('a'),
        tripActivity('b'),
        tripActivity('c', { day_index: 0, start_time: '09:00' }),
      ],
      votes: [vote('b', JESS, 1), vote('b', TARUN, 1), vote('c', JESS, 1), vote('a', TARUN, -1)],
    });
    await show(trip);
    expect(screen.getByRole('heading', { name: 'Voting results' })).toBeInTheDocument();
    expect(screen.getAllByTestId('candidate').map((e) => e.textContent)).toEqual(['b', 'c', 'a']);
    const b = card('b', false);
    expect(b.tally).toEqual({ up: 2, down: 0, net: 2 });
    expect(b.myVote).toBe(0);
    expect(b.canRemove).toBe(false);
    act(() => b.onOpen?.());
    expect(screen.getByRole('dialog', { name: 'detail Place b' })).toBeInTheDocument();
  });

  it('shows no results before anyone voted', async () => {
    await show(makeTrip({ activities: [tripActivity('a')] }));
    expect(screen.queryByRole('heading', { name: 'Voting results' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('candidate')).not.toBeInTheDocument();
  });
});

describe('TripDetail: running an action', () => {
  it('holds a second action while one runs, and shows the page busy', async () => {
    const pending = deferred();
    h.api.removeTripActivity.mockReturnValue(pending.promise);
    const trip = makeTrip({ activities: [tripActivity('u1')] });
    await show(trip);
    act(() => phone().onRemove(trip.activities[0]));
    expect(phone().busy).toBe(true);
    act(() => phone().onRemove(trip.activities[0]));
    expect(h.api.removeTripActivity).toHaveBeenCalledTimes(1);
    await settle(() => pending.resolve());
    expect(phone().busy).toBe(false);
    expect(h.tripState.reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a failed action, resyncs, and clears it on dismiss or the next action', async () => {
    const user = userEvent.setup();
    const err = new Error('409');
    h.api.removeTripActivity.mockRejectedValueOnce(err);
    const trip = makeTrip({ activities: [tripActivity('u1')] });
    await show(trip);
    await settle(() => phone().onRemove(trip.activities[0]));
    expect(screen.getByRole('alert')).toHaveTextContent(
      "That didn't go through — the trip may have changed. We've refreshed it.",
    );
    expectLogged(err);
    expect(h.tripState.reload).toHaveBeenCalledTimes(1);
    expect(phone().busy).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    h.api.removeTripActivity.mockRejectedValueOnce(err);
    await settle(() => phone().onRemove(trip.activities[0]));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expectLogged(err);
    const pending = deferred();
    h.api.removeTripActivity.mockReturnValueOnce(pending.promise);
    act(() => phone().onRemove(trip.activities[0]));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await settle(() => pending.resolve());
  });

  it('polls the tally only while voting, through reload', async () => {
    await show(makeTrip({ status: 'voting' }));
    expect(h.interval).toHaveBeenLastCalledWith(expect.any(Function), 30_000, true);
    const poll = h.interval.mock.lastCall?.[0] as () => void;
    poll();
    expect(h.tripState.reload).toHaveBeenCalledTimes(1);
  });
});

describe('TripDetail: voting', () => {
  const voting = (over: Partial<Trip> = {}) =>
    makeTrip({
      status: 'voting',
      activities: [tripActivity('a'), tripActivity('b'), tripActivity('c')],
      votes: [
        vote('a', JESS, 1),
        vote('a', TARUN, 1),
        vote('a', 'gone@example.com', 1),
        vote('b', JESS, -1),
      ],
      ...over,
    });

  it('lists the candidates in order with their tallies and my vote', async () => {
    await show(voting());
    expect(screen.getByRole('heading', { name: 'Candidates' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Unscheduled' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('candidate').map((e) => e.textContent)).toEqual(['a', 'b', 'c']);
    expect(phone().ideasCount).toBe(3);
    expect(phone().isVoting).toBe(true);
    expect(card('a').tally).toEqual({ up: 3, down: 0, net: 3 });
    expect(card('a').myVote).toBe(1);
    expect(card('b').myVote).toBe(-1);
    expect(card('c').myVote).toBe(0);
    expect(card('a').canRemove).toBe(true);
    expect(card('a').draggable).toBe(true);
  });

  it('breaks each vote down by member, a member who left still counting', async () => {
    await show(voting());
    const [a, b, c] = screen.getAllByTestId('candidate').map((e) => e.parentElement!);
    const chips = [...a.querySelectorAll<HTMLElement>('[data-icon^="thumb_"]')];
    expect(chips.map((chip) => textWithIcons(chip.parentElement!))).toEqual([
      '<thumb_up>Gone (left trip)',
      '<thumb_up>Jess',
      '<thumb_up>Tarun',
    ]);
    expect(chips[0]).toHaveClass('text-primary');
    const down = getIcon('thumb_down', b);
    expect(down).toHaveClass('text-error');
    expect(down).not.toHaveClass('text-primary');
    expect(textWithIcons(down.parentElement!)).toBe('<thumb_down>Jess');
    expect(c.childElementCount).toBe(1);
  });

  it('casts a vote as me, and resyncs when it fails', async () => {
    const err = new Error('409');
    await show(voting());
    act(() => card('c').onVote?.(1));
    expect(h.api.castVote).toHaveBeenCalledWith('trip-1', 'c', 1, JESS);
    expect(h.tripState.reload).not.toHaveBeenCalled();

    h.api.castVote.mockRejectedValueOnce(err);
    await settle(() => card('a').onVote?.(0));
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Your vote didn't save — the trip may have changed. We've refreshed it.",
    );
    expectLogged(err);
    expect(h.tripState.reload).toHaveBeenCalledTimes(1);
  });

  it('casts no vote without a signed-in email', async () => {
    h.owner.email = null;
    await show(voting());
    act(() => card('a').onVote?.(1));
    expect(h.api.castVote).not.toHaveBeenCalled();
    expect(card('a').myVote).toBe(0);
  });

  it('removes and opens a candidate', async () => {
    h.catalog.activities = [{ ...muirWoods, id: 'act-b' }];
    await show(voting());
    await settle(() => card('a').onRemove?.());
    expect(h.api.removeTripActivity).toHaveBeenCalledWith('a');
    act(() => card('b').onOpen?.());
    expect(h.openActivity).toHaveBeenCalledWith('act-b');
  });

  it('reorders by drag and drop, renumbering every candidate', async () => {
    await show(voting());
    const setData = vi.fn();
    const start = { dataTransfer: { setData, effectAllowed: 'all' } };
    card('a').onDragStart?.(start as never);
    expect(setData).toHaveBeenCalledWith('application/x-fnf-trip-activity-id', 'a');
    expect(start.dataTransfer.effectAllowed).toBe('move');

    const over = { preventDefault: vi.fn() };
    card('c').onDragOver?.(over as never);
    expect(over.preventDefault).toHaveBeenCalled();

    const drop = async (id: string, dragged: string) => {
      const e = { preventDefault: vi.fn(), dataTransfer: { getData: vi.fn(() => dragged) } };
      await settle(() => card(id).onDrop?.(e as never));
      return e;
    };
    const e = await drop('c', 'a');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer.getData).toHaveBeenCalledWith('application/x-fnf-trip-activity-id');
    expect(h.api.setDisplayOrder.mock.calls).toEqual([
      ['b', 0],
      ['a', 1],
      ['c', 2],
    ]);
    expect(h.tripState.reload).toHaveBeenCalledTimes(1);

    h.api.setDisplayOrder.mockClear();
    await drop('a', 'c');
    expect(h.api.setDisplayOrder.mock.calls).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ]);

    h.api.setDisplayOrder.mockClear();
    await drop('a', 'a');
    await drop('a', 'unknown');
    const blank = await drop('a', '');
    expect(blank.preventDefault).toHaveBeenCalled();
    expect(h.api.setDisplayOrder).not.toHaveBeenCalled();
    expect(h.tripState.reload).toHaveBeenCalledTimes(2);
  });

  it('adds a candidate from the catalog', async () => {
    const user = userEvent.setup();
    await show(voting());
    const add = screen.getByRole('button', { name: /Add candidate/ });
    expect(getIcon('add', add).style.marginLeft).toBe(glyphBleed('add'));
    await user.click(add);
    expect(location()).toBe(
      'PUSH / {"target_trip_id":"trip-1","target_trip_title":"Coast Weekend"}',
    );
  });

  it('prompts for candidates on an empty vote, with nothing to finalize', async () => {
    const user = userEvent.setup();
    await show(voting({ activities: [], votes: [] }));
    expect(phone().ideasCount).toBe(0);
    const finalize = screen.getByRole('button', { name: /Finalize voting/ });
    expect(finalize).toBeDisabled();
    expect(finalize).toHaveAttribute('title', 'Add candidates before finalizing');
    expect(screen.getByText(/No candidates yet\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add some from the curated catalog' }));
    expect(location()).toBe(
      'PUSH / {"target_trip_id":"trip-1","target_trip_title":"Coast Weekend"}',
    );
  });

  it('lets only the creator finalize, and not while busy', async () => {
    h.owner.email = TARUN;
    const view = await show(voting());
    const notMine = screen.getByRole('button', { name: /Finalize voting/ });
    expect(notMine).toBeDisabled();
    expect(notMine).toHaveAttribute('title', 'Only the trip creator can finalize voting');
    view.unmount();

    h.owner.email = JESS;
    const pending = deferred();
    h.api.removeTripActivity.mockReturnValue(pending.promise);
    await show(voting());
    const finalize = screen.getByRole('button', { name: /Finalize voting/ });
    expect(finalize).toBeEnabled();
    expect(finalize).not.toHaveAttribute('title');
    act(() => card('a').onRemove?.());
    expect(finalize).toBeDisabled();
    await settle(() => pending.resolve());
    expect(finalize).toBeEnabled();
  });

  it('finalizes the candidates kept, ranked by score', async () => {
    const user = userEvent.setup();
    await show(voting());
    expect(screen.queryByText('promote modal')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Finalize voting/ }));
    expect(screen.getByText('promote modal')).toBeInTheDocument();
    expect(promote().candidates.map((c) => [c.activity.id, c.tally.net])).toEqual([
      ['a', 3],
      ['c', 0],
      ['b', -1],
    ]);
    act(() => promote().onCancel());
    expect(screen.queryByText('promote modal')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Finalize voting/ }));
    await settle(() => promote().onConfirm(['act-a']));
    expect(h.api.transitionToPlanning).toHaveBeenCalledWith('trip-1', ['act-a']);
    expect(screen.queryByText('promote modal')).not.toBeInTheDocument();
  });

  it('suggests places near the candidates once the catalog is in', async () => {
    const found = [{ activity: muirWoods, miles: 3 }];
    h.suggest.mockReturnValue(found);
    h.catalog.activities = [muirWoods];
    const trip = voting();
    await show(trip);
    expect(h.suggest).toHaveBeenCalledWith(trip.activities, h.catalog.activities);
    const p = suggestionsProps();
    expect(p.suggestions).toBe(found);
    expect(p.busy).toBe(false);

    let added: boolean | undefined;
    await act(async () => {
      added = await p.onAdd(muirWoods);
    });
    expect(added).toBe(true);
    expect(h.api.addActivityToTrip).toHaveBeenCalledWith('trip-1', 'test-muir');
    const dup = new Error('dup');
    h.api.addActivityToTrip.mockRejectedValueOnce(dup);
    await act(async () => {
      added = await suggestionsProps().onAdd(muirWoods);
    });
    expect(added).toBe(false);
    expectLogged(dup);

    // Nothing more is added while another action runs.
    const pending = deferred();
    h.api.removeTripActivity.mockReturnValue(pending.promise);
    act(() => card('a').onRemove?.());
    await act(async () => {
      added = await suggestionsProps().onAdd(muirWoods);
    });
    expect(added).toBe(false);
    expect(h.api.addActivityToTrip).toHaveBeenCalledTimes(2);
    await settle(() => pending.resolve());

    suggestionsProps().onOpen(muirWoods);
    expect(h.openActivity).toHaveBeenCalledWith('test-muir');
  });

  it('suggests once the catalog arrives', async () => {
    h.suggest.mockReturnValue([{ activity: muirWoods, miles: 3 }]);
    h.catalog.loading = true;
    const view = await show(voting());
    expect(screen.queryByText('suggestions')).not.toBeInTheDocument();
    h.catalog = { activities: [muirWoods], loading: false, error: null };
    view.rerenderPage();
    expect(screen.getByText('suggestions')).toBeInTheDocument();
  });

  it('suggests nothing while the catalog loads, after it fails, or with no candidates', async () => {
    h.suggest.mockReturnValue([]);
    h.catalog.loading = true;
    const view = await show(voting());
    expect(h.suggest).not.toHaveBeenCalled();
    expect(screen.queryByText('suggestions')).not.toBeInTheDocument();
    view.unmount();

    h.catalog = { activities: [], loading: false, error: 'failed' };
    const failed = await show(voting());
    expect(h.suggest).not.toHaveBeenCalled();
    expect(screen.queryByText('suggestions')).not.toBeInTheDocument();
    failed.unmount();

    h.catalog.error = null;
    await show(voting({ activities: [], votes: [] }));
    expect(h.suggest).toHaveBeenCalled();
    expect(screen.queryByText('suggestions')).not.toBeInTheDocument();
  });
});

describe('TripDetail: members and invites', () => {
  const withInvites = () =>
    makeTrip({
      invites: [
        { invite_token: 't1', invited_email: 'kim@example.com' } as TripInvite,
        { invite_token: 't2', invited_email: null } as TripInvite,
      ],
    });

  it('hands the strip the members, invites and my role', async () => {
    const trip = withInvites();
    const view = await show(trip);
    expect(members().members).toBe(trip.members);
    expect(members().invites).toBe(trip.invites);
    expect(members().currentEmail).toBe(JESS);
    expect(members().isCreator).toBe(true);
    view.unmount();
    h.owner.email = TARUN;
    await show(trip);
    expect(members().isCreator).toBe(false);
  });

  it('removes a member and revokes an invite', async () => {
    await show(withInvites());
    await settle(() => members().onRemoveMember(TARUN));
    expect(h.api.removeMember).toHaveBeenCalledWith('trip-1', TARUN);
    await settle(() => members().onRevokeInvite('t1'));
    expect(h.api.revokeInvite).toHaveBeenCalledWith('trip-1', 't1');
    expect(h.tripState.reload).toHaveBeenCalledTimes(2);
  });

  it('leaves the trip for the trips list', async () => {
    h.owner.email = TARUN;
    await show();
    await settle(() => members().onLeave());
    expect(h.api.removeMember).toHaveBeenCalledWith('trip-1', TARUN);
    expect(screen.getByText('Trips list')).toBeInTheDocument();
  });

  it('stays and says so when leaving fails', async () => {
    const err = new Error('nope');
    h.api.removeMember.mockRejectedValue(err);
    await show();
    await settle(() => members().onLeave());
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't leave the trip. Try again.");
    expectLogged(err);
  });

  it('cannot leave without a signed-in email', async () => {
    h.owner.email = null;
    await show();
    act(() => members().onLeave());
    expect(h.api.removeMember).not.toHaveBeenCalled();
  });

  it('opens the invite picker with every account, excluding members and invitees', async () => {
    const users = [{ email: 'lee@example.com', display_name: null }];
    h.api.fetchUsers.mockResolvedValue(users);
    await show(withInvites());
    expect(screen.queryByText('invite modal')).not.toBeInTheDocument();
    await settle(() => members().onInvite());
    expect(invite().users).toBe(users);
    expect(invite().excludeEmails).toEqual([JESS, TARUN, 'kim@example.com']);
    expect(invite().buildLink('a b')).toBe(`${window.location.origin}/trips/trip-1?invite=a%20b`);
    act(() => invite().onClose());
    expect(screen.queryByText('invite modal')).not.toBeInTheDocument();
  });

  it('opens the picker from the phone even when the account list fails', async () => {
    const err = new Error('down');
    h.api.fetchUsers.mockRejectedValue(err);
    await show();
    await settle(() => phone().onInvite());
    expect(screen.getByText('invite modal')).toBeInTheDocument();
    expect(invite().users).toEqual([]);
    expectLogged(err);
  });

  it('creates an invite and shows its chip', async () => {
    h.api.inviteMember.mockResolvedValue({ invite_token: 'new-tok', invited_email: 'x' });
    await show();
    await settle(() => phone().onInvite());
    let made: { invite_token: string } | undefined;
    await act(async () => {
      made = await invite().onCreateInvite('lee@example.com');
    });
    expect(made).toEqual({ invite_token: 'new-tok' });
    expect(h.api.inviteMember).toHaveBeenCalledWith('trip-1', 'lee@example.com');
    expect(h.tripState.reload).toHaveBeenCalledTimes(1);
  });
});

describe('TripDetail: the menu’s actions', () => {
  async function openMenu() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More trip actions' }));
    return user;
  }

  it('edits the name and dates, sending them all on a trip not yet past', async () => {
    const patch = deferred();
    h.api.patchTrip.mockReturnValue(patch.promise);
    await show(makeTrip({ description: 'Old', cover_image_url: 'https://x/c.jpg' }));
    const user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Edit trip…' }));
    expect(screen.queryByTestId('phone')).not.toBeInTheDocument();

    expect(screen.getByPlaceholderText('Description (optional)')).toHaveValue('Old');
    expect(screen.getByPlaceholderText('Cover image URL (optional)')).toHaveValue(
      'https://x/c.jpg',
    );
    const title = screen.getByDisplayValue('Coast Weekend');
    expect(title).toBeEnabled();
    expect(title).not.toHaveAttribute('title');
    const [start, end] = screen.getAllByDisplayValue(/^2026-04-1/);
    expect(end).toHaveAttribute('min', '2026-04-11');
    await user.clear(title);
    await user.type(title, 'Big Sur');
    fireEvent.change(start, { target: { value: '2026-05-01' } });
    fireEvent.change(end, { target: { value: '2026-05-03' } });
    expect(end).toHaveAttribute('min', '2026-05-01');
    await user.clear(screen.getByPlaceholderText('Description (optional)'));
    await user.clear(screen.getByPlaceholderText('Cover image URL (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.api.patchTrip).toHaveBeenCalledWith('trip-1', {
      title: 'Big Sur',
      start_date: '2026-05-01',
      end_date: '2026-05-03',
      description: null,
      cover_image_url: null,
    });
    // The form stays until the save has gone through.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    await settle(() => patch.resolve());
    expect(screen.getByTestId('phone')).toBeInTheDocument();
  });

  it('edits only the description and cover of a past trip', async () => {
    await show(makeTrip({ status: 'past' }));
    const user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Edit trip…' }));
    const title = screen.getByDisplayValue('Coast Weekend');
    expect(title).toBeDisabled();
    expect(title).toHaveAttribute('title', 'This trip is past');
    for (const date of screen.getAllByDisplayValue(/^2026-04-1/)) {
      expect(date).toBeDisabled();
      expect(date).toHaveAttribute('title', 'This trip is past');
    }
    await user.type(screen.getByPlaceholderText('Description (optional)'), 'Foggy');
    await user.type(screen.getByPlaceholderText('Cover image URL (optional)'), 'https://x/c.jpg');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.api.patchTrip).toHaveBeenCalledWith('trip-1', {
      description: 'Foggy',
      cover_image_url: 'https://x/c.jpg',
    });
    expect(await screen.findByTestId('phone')).toBeInTheDocument();
  });

  it('cancels an edit, keeping an earlier error in view while editing', async () => {
    const err = new Error('409');
    h.api.removeTripActivity.mockRejectedValueOnce(err);
    const trip = makeTrip({ activities: [tripActivity('u1')] });
    await show(trip);
    await settle(() => phone().onRemove(trip.activities[0]));
    expectLogged(err);
    const user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Edit trip…' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('phone')).toBeInTheDocument();
    expect(h.api.patchTrip).not.toHaveBeenCalled();
  });

  it('deletes the trip after confirming, then goes to the trips list', async () => {
    await show();
    let user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Delete trip…' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this trip?' });
    expect(dialog).toHaveTextContent(
      'The trip and its itinerary will be removed permanently. Completed activities stay completed.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Delete trip…' }));
    const confirm = screen.getByRole('button', { name: 'Delete trip' });
    expect(confirm).toHaveClass('bg-error');
    expect(confirm).not.toHaveClass('bg-primary');
    await user.click(confirm);
    expect(h.api.deleteTrip).toHaveBeenCalledWith('trip-1');
    expect(await screen.findByText('Trips list')).toBeInTheDocument();
  });

  it('stays on the trip when deleting fails', async () => {
    const err = new Error('nope');
    h.api.deleteTrip.mockRejectedValue(err);
    await show();
    const user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Delete trip…' }));
    await user.click(screen.getByRole('button', { name: 'Delete trip' }));
    expectLogged(err);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('phone')).toBeInTheDocument();
  });

  it('reopens voting after confirming', async () => {
    await show();
    let user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Reopen voting…' }));
    const dialog = screen.getByRole('dialog', { name: 'Reopen voting?' });
    expect(dialog).toHaveTextContent(
      'This moves the trip back to voting. All day/time assignments are cleared; votes are kept. You can finalize again afterward.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Reopen voting…' }));
    const confirm = screen.getByRole('button', { name: 'Reopen voting' });
    expect(confirm).toHaveClass('bg-primary');
    expect(confirm).not.toHaveClass('bg-error');
    await user.click(confirm);
    expect(h.api.revertToVoting).toHaveBeenCalledWith('trip-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks the trip past with the scheduled activities still ticked, in day and time order', async () => {
    const trip = makeTrip({
      end_date: '2026-04-13',
      activities: [
        tripActivity('s3', { day_index: 1, start_time: '08:00' }),
        tripActivity('s4', { day_index: 2, start_time: '07:00' }),
        tripActivity('s1', { day_index: 0, start_time: '13:00' }),
        tripActivity('s2', { day_index: 0, start_time: '09:00', snapshot: null }),
        tripActivity('s5', { day_index: 0, start_time: '11:00' }),
        tripActivity('u1', { start_time: '07:00' }),
        tripActivity('n1', { day_index: 0, start_time: '10:00', activity_id: null }),
        tripActivity('t1', { day_index: 0, start_time: null }),
      ],
      votes: [
        vote('s1', JESS, 1),
        vote('s1', TARUN, 1),
        vote('s1', 'x@example.com', -1),
        vote('s3', JESS, 1),
        vote('s3', TARUN, -1),
      ],
    });
    await show(trip);
    const user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Mark as past…' }));
    const dialog = screen.getByRole('dialog', {
      name: 'Which scheduled activities did we actually do?',
    });
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes.map((b) => b.closest('div')!.textContent)).toEqual([
      '(activity)Day 1 · Sat, Apr 11 · 9:00 AM',
      'Place s5Day 1 · Sat, Apr 11 · 11:00 AM',
      'Place s1Day 1 · Sat, Apr 11 · 1:00 PM · Voted 2 to 1',
      'Place s3Day 2 · Sun, Apr 12 · 8:00 AM · Voted 1 to 1',
      'Place s4Day 3 · Mon, Apr 13 · 7:00 AM',
    ]);
    for (const box of boxes) expect(box).toBeChecked();
    await user.click(within(dialog).getByLabelText(/Place s1/));
    expect(boxes[2]).not.toBeChecked();
    await user.click(within(dialog).getByLabelText(/Place s3/));
    await user.click(within(dialog).getByLabelText(/Place s3/));
    expect(boxes[3]).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Mark trip past' }));
    expect(h.api.markTripPast).toHaveBeenCalledWith('trip-1', [
      'act-s2',
      'act-s5',
      'act-s3',
      'act-s4',
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists what the trip schedules as it reloads', async () => {
    const view = await show(makeTrip({ activities: [tripActivity('u1')] }));
    const user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Mark as past…' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    h.tripState.trip = makeTrip({
      activities: [tripActivity('u1', { day_index: 0, start_time: '09:00' })],
    });
    view.rerenderPage();
    expect(screen.getByLabelText(/Place u1/)).toBeInTheDocument();
  });

  it('marks a trip with nothing scheduled past with no activities, or cancels', async () => {
    await show(makeTrip({ activities: [tripActivity('u1')] }));
    let user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Mark as past…' }));
    expect(
      screen.getByText(
        "Nothing was scheduled, so there's nothing to mark completed. Marking past anyway is fine.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    user = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Mark as past…' }));
    await user.click(screen.getByRole('button', { name: 'Mark trip past' }));
    expect(h.api.markTripPast).toHaveBeenCalledWith('trip-1', []);
  });

  it('gives a member who is not the creator the menu disabled', async () => {
    h.owner.email = TARUN;
    await show();
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Edit trip…' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Delete trip…' })).toBeDisabled();
  });
});

describe('TripMenu', () => {
  type MenuProps = ComponentProps<typeof TripMenu>;
  function menu(over: Partial<MenuProps> = {}) {
    const props: MenuProps = {
      isPast: false,
      isVoting: false,
      isCreator: true,
      onEdit: vi.fn(),
      onMarkPast: vi.fn(),
      onDelete: vi.fn(),
      onRevert: vi.fn(),
      ...over,
    };
    render(
      <div>
        {/* Outside, and stopping its click before it bubbles to the document. */}
        <button type="button" onClick={(e) => e.stopPropagation()}>
          outside
        </button>
        <TripMenu {...props} />
      </div>,
    );
    return { props, user: userEvent.setup() };
  }
  const toggle = () => screen.getByRole('button', { name: 'More trip actions' });
  const items = () => screen.queryAllByRole('menuitem').map((i) => i.textContent);

  it('opens and closes from its button', async () => {
    const { user } = menu();
    expect(toggle()).toHaveAttribute('aria-haspopup', 'menu');
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(items()).toEqual([]);
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(items()).toEqual(['Edit trip…', 'Reopen voting…', 'Mark as past…', 'Delete trip…']);
    await user.click(toggle());
    expect(items()).toEqual([]);
  });

  it('closes on Escape or a click outside, not on another key or a click inside', async () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { user } = menu();
    await user.click(toggle());
    await user.keyboard('{Shift}');
    expect(items()).toHaveLength(4);
    await user.click(screen.getAllByRole('menuitem')[0].parentElement!);
    expect(items()).toHaveLength(4);
    await user.keyboard('{Escape}');
    expect(items()).toEqual([]);
    await user.click(toggle());
    await user.click(screen.getByText('outside'));
    expect(items()).toEqual([]);
    expect(remove).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
    remove.mockRestore();
  });

  it('runs each item and closes', async () => {
    const { props, user } = menu();
    const cases: [string, keyof MenuProps][] = [
      ['Edit trip…', 'onEdit'],
      ['Reopen voting…', 'onRevert'],
      ['Mark as past…', 'onMarkPast'],
      ['Delete trip…', 'onDelete'],
    ];
    for (const [name, handler] of cases) {
      await user.click(toggle());
      await user.click(screen.getByRole('menuitem', { name }));
      expect(props[handler]).toHaveBeenCalledTimes(1);
      expect(items()).toEqual([]);
    }
  });

  it('styles only Delete as destructive', async () => {
    const { user } = menu();
    await user.click(toggle());
    const del = screen.getByRole('menuitem', { name: 'Delete trip…' });
    expect(del).toHaveClass('text-error');
    expect(del).not.toHaveClass('text-on-surface');
    expect(screen.getByRole('menuitem', { name: 'Mark as past…' })).toHaveClass('text-on-surface');
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).toBeEnabled();
      expect(item).not.toHaveAttribute('title');
    }
  });

  it('leaves out Edit without a handler, and Reopen voting while voting or past', async () => {
    const { user } = menu({ onEdit: undefined, isVoting: true });
    await user.click(toggle());
    expect(items()).toEqual(['Mark as past…', 'Delete trip…']);
  });

  it('disables Mark as past on a past trip', async () => {
    const { user } = menu({ isPast: true });
    await user.click(toggle());
    expect(items()).toEqual(['Edit trip…', 'Mark as past…', 'Delete trip…']);
    const markPast = screen.getByRole('menuitem', { name: 'Mark as past…' });
    expect(markPast).toBeDisabled();
    expect(markPast).toHaveAttribute('title', 'Already past');
    expect(screen.getByRole('menuitem', { name: 'Delete trip…' })).toBeEnabled();
  });

  it('disables the creator’s actions for anyone else, saying why', async () => {
    const { user } = menu({ isCreator: false });
    await user.click(toggle());
    const expected: [string, string][] = [
      ['Reopen voting…', 'Only the trip creator can reopen voting'],
      ['Mark as past…', 'Only the trip creator can mark a trip past'],
      ['Delete trip…', 'Only the trip creator can delete this trip'],
    ];
    for (const [name, title] of expected) {
      const item = screen.getByRole('menuitem', { name });
      expect(item).toBeDisabled();
      expect(item).toHaveAttribute('title', title);
    }
    expect(screen.getByRole('menuitem', { name: 'Edit trip…' })).toBeEnabled();
  });
});
