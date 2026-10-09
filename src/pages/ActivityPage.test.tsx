import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  Link,
  MemoryRouter,
  Route,
  useLocation,
  useNavigate,
  type InitialEntry,
} from 'react-router-dom';
import { render, screen, within } from '../test/render';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';
import type { Activity } from '../data/types';
import { ActivityPermalinkRoutes } from '../components/ActivityPermalinkRoutes';
import { useOpenActivity } from '../lib/activityRoute';
import { CATALOG_LOAD_ERROR } from '../lib/userActivities';

function Probe() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="path">{pathname}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        back
      </button>
    </>
  );
}

function Catalog() {
  const open = useOpenActivity();
  return (
    <>
      <h1>Catalog</h1>
      <button type="button" onClick={() => open(muirWoods.id)}>
        open Muir Woods
      </button>
      <Link to="/trips">trips</Link>
    </>
  );
}

function renderAt(entries: InitialEntry[], activities?: Activity[]) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <ActivityPermalinkRoutes>
        <Route path="/" element={<Catalog />} />
        <Route path="/trips" element={<h1>Trips</h1>} />
      </ActivityPermalinkRoutes>
      <Probe />
    </MemoryRouter>,
    { activities },
  );
}

const CATALOG = [muirWoods, completedHike, dogFriendlyTidepools];

function path() {
  return screen.getByTestId('path').textContent;
}

describe('ActivityPage (#86)', () => {
  beforeEach(() => {
    // jsdom doesn't implement Element.scrollTo, which a nearby tap calls.
    Object.defineProperty(Element.prototype, 'scrollTo', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the linked activity over the catalog', () => {
    renderAt([`/activity/${muirWoods.id}`], CATALOG);
    const dialog = screen.getByRole('dialog', { name: muirWoods.name });
    expect(within(dialog).getByText(muirWoods.longDescription!)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Catalog' })).toBeInTheDocument();
  });

  it('resolves a restaurant on the same route', () => {
    const cafe: Activity = { ...muirWoods, id: 'test-cafe', name: 'Test Cafe', category: 'food' };
    renderAt(['/activity/test-cafe'], [cafe]);
    expect(screen.getByRole('dialog', { name: 'Test Cafe' })).toBeInTheDocument();
  });

  it('offers photo uploads only on a completed activity', () => {
    const { unmount } = renderAt([`/activity/${completedHike.id}`], CATALOG);
    expect(screen.getByText('Your Photos')).toBeInTheDocument();
    unmount();
    renderAt([`/activity/${muirWoods.id}`], CATALOG);
    expect(screen.queryByText('Your Photos')).not.toBeInTheDocument();
  });

  it('closes a link opened fresh to the catalog', async () => {
    renderAt([`/activity/${muirWoods.id}`], CATALOG);
    const dialog = screen.getByRole('dialog', { name: muirWoods.name });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(path()).toBe('/');
  });

  it('opens over the page below and closes back to it', async () => {
    renderAt(['/'], CATALOG);
    await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
    expect(path()).toBe(`/activity/${muirWoods.id}`);
    expect(screen.getByRole('heading', { name: 'Catalog' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(path()).toBe('/');
  });

  it('opens a nearby activity at its own permalink, and closes past both', async () => {
    renderAt(['/'], CATALOG);
    await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /Test Completed Hike/ }),
    );
    expect(path()).toBe(`/activity/${completedHike.id}`);
    expect(screen.getByRole('dialog', { name: completedHike.name })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(path()).toBe('/');
  });

  it('says an unknown id is not found, rather than bouncing home', async () => {
    renderAt(['/activity/no-such-thing'], CATALOG);
    const dialog = screen.getByRole('dialog', { name: 'Activity not found' });
    expect(path()).toBe('/activity/no-such-thing');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Browse adventures' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(path()).toBe('/');
  });

  it('closes not found from the backdrop or Escape', async () => {
    const { unmount } = renderAt(['/activity/no-such-thing'], CATALOG);
    const backdrop = screen
      .getAllByRole('button', { name: 'Close' })
      .find((b) => !screen.getByRole('dialog').contains(b));
    await userEvent.click(backdrop!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    renderAt(['/activity/no-such-thing'], CATALOG);
    await userEvent.keyboard('a');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stops listening for Escape once closed', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    renderAt(['/activity/no-such-thing'], CATALOG);
    const onKey = add.mock.calls.findLast(([type]) => type === 'keydown')?.[1];
    expect(onKey).toBeDefined();
    await userEvent.keyboard('{Escape}');
    expect(remove).toHaveBeenCalledWith('keydown', onKey);
  });

  it('focuses its action and holds the page behind still', async () => {
    renderAt(['/activity/no-such-thing'], CATALOG);
    expect(screen.getByRole('button', { name: 'Browse adventures' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('says the catalog failed to load, not that the activity is missing', async () => {
    render(
      <MemoryRouter initialEntries={[`/activity/${muirWoods.id}`]}>
        <ActivityPermalinkRoutes>
          <Route path="/" element={<Catalog />} />
        </ActivityPermalinkRoutes>
      </MemoryRouter>,
      { activitiesError: true },
    );
    const dialog = await screen.findByRole('dialog', {
      name: "Couldn't load this activity",
    });
    expect(within(dialog).getByText(CATALOG_LOAD_ERROR)).toBeInTheDocument();
    expect(screen.queryByText('Activity not found')).not.toBeInTheDocument();
  });

  describe('as the owner', () => {
    beforeEach(() => {
      (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__ = true;
    });
    afterEach(() => {
      delete (window as { __TEST_FORCE_OWNER__?: boolean }).__TEST_FORCE_OWNER__;
    });

    it("drops one activity's open edit form when Back moves to another", async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: /Test Completed Hike/ }),
      );
      await userEvent.click(screen.getByRole('button', { name: /EDIT ACTIVITY/ }));
      expect(screen.getByRole('dialog', { name: 'Edit activity' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'back' }));
      expect(path()).toBe(`/activity/${muirWoods.id}`);
      expect(screen.getByRole('dialog', { name: muirWoods.name })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Edit activity' })).not.toBeInTheDocument();
    });
  });

  it('shows nothing until the catalog first loads', async () => {
    renderAt(['/activity/no-such-thing']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      await screen.findByRole('dialog', { name: 'Activity not found' }),
    ).toBeInTheDocument();
  });

  it('leaves other pages alone', () => {
    renderAt(['/trips'], CATALOG);
    expect(screen.getByRole('heading', { name: 'Trips' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
