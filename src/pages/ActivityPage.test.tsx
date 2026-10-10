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
      <button type="button" onClick={() => open(completedHike.id, LIST)}>
        open the hike from the list
      </button>
      <label>
        Search <input />
      </label>
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
// The browse list as shown: filtered and sorted, so not the catalog's order.
const LIST = [dogFriendlyTidepools.id, completedHike.id, muirWoods.id];

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

  describe('stepping through the list (#64)', () => {
    const prev = () => screen.getByRole('button', { name: 'Previous adventure' });
    const next = () => screen.getByRole('button', { name: 'Next adventure' });
    const openFromList = () =>
      userEvent.click(screen.getByRole('button', { name: 'open the hike from the list' }));

    it('steps to the neighbours in the order of the list it was opened from', async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      const nav = screen.getByRole('navigation', { name: 'Adventures in this list' });
      expect(within(nav).getByText('2 of 3')).toBeInTheDocument();
      await userEvent.click(next());
      expect(path()).toBe(`/activity/${muirWoods.id}`);
      expect(screen.getByRole('dialog', { name: muirWoods.name })).toBeInTheDocument();
      expect(screen.getByText('3 of 3')).toBeInTheDocument();
      await userEvent.click(prev());
      await userEvent.click(prev());
      expect(screen.getByRole('dialog', { name: dogFriendlyTidepools.name })).toBeInTheDocument();
      expect(screen.getByText('1 of 3')).toBeInTheDocument();
    });

    it("stops at the ends rather than wrapping", async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      await userEvent.click(next());
      expect(next()).toBeDisabled();
      expect(prev()).toBeEnabled();
      await userEvent.click(prev());
      await userEvent.click(prev());
      expect(prev()).toBeDisabled();
      expect(next()).toBeEnabled();
    });

    it('retraces the steps with Back, and closes past all of them', async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      await userEvent.click(next());
      await userEvent.click(screen.getByRole('button', { name: 'back' }));
      expect(path()).toBe(`/activity/${completedHike.id}`);
      await userEvent.click(next());
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(path()).toBe('/');
    });

    it('steps with the Left and Right keys', async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      await userEvent.keyboard('{ArrowRight}');
      expect(path()).toBe(`/activity/${muirWoods.id}`);
      // Nothing past the end.
      await userEvent.keyboard('{ArrowRight}');
      expect(path()).toBe(`/activity/${muirWoods.id}`);
      await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
      expect(path()).toBe(`/activity/${dogFriendlyTidepools.id}`);
    });

    it('leaves arrow keys alone with a modifier, or while typing', async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
      await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
      await userEvent.keyboard('{Control>}{ArrowRight}{/Control}');
      await userEvent.keyboard('{Meta>}{ArrowRight}{/Meta}');
      expect(path()).toBe(`/activity/${completedHike.id}`);
      const field = screen.getByRole('textbox', { name: 'Search', hidden: true });
      field.focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(path()).toBe(`/activity/${completedHike.id}`);
    });

    it('keeps focus on the step it took, or its partner at the end', async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      await userEvent.click(prev());
      // The first activity: Previous is disabled now, so Next has focus.
      expect(next()).toHaveFocus();
      await userEvent.click(next());
      expect(next()).toHaveFocus();
      // The last: Next is disabled, so Previous has focus.
      await userEvent.click(next());
      expect(prev()).toHaveFocus();
      await userEvent.click(prev());
      expect(prev()).toHaveFocus();
    });

    it('shows no steps without a list, or for an activity not in it', async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      expect(screen.queryByRole('navigation', { name: 'Adventures in this list' })).toBeNull();
      await userEvent.keyboard('{ArrowRight}');
      expect(path()).toBe(`/activity/${muirWoods.id}`);
    });
  });

  describe('open animation (#63)', () => {
    const animated = (el: HTMLElement) => el.className.includes('motion-safe:animate-');
    const scrim = () => screen.getByRole('button', { name: 'Close activity details' });

    it('animates the activity it opens with', async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      const dialog = screen.getByRole('dialog', { name: muirWoods.name });
      expect(dialog.className).toContain('motion-safe:animate-sheet-in');
      expect(dialog.className).toContain('md:motion-safe:animate-dialog-in');
      expect(scrim().className).toContain('motion-safe:animate-scrim-in');
    });

    it("doesn't replay when it moves to another activity, or back", async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: /Test Completed Hike/ }),
      );
      expect(animated(screen.getByRole('dialog', { name: completedHike.name }))).toBe(false);
      expect(animated(scrim())).toBe(false);
      await userEvent.click(screen.getByRole('button', { name: 'back' }));
      // Back to the one it opened with: the panel was on screen all along.
      expect(animated(screen.getByRole('dialog', { name: muirWoods.name }))).toBe(false);
      expect(animated(scrim())).toBe(false);
    });

    it('animates the not-found dialog in too', () => {
      renderAt(['/activity/no-such-thing'], CATALOG);
      expect(screen.getByRole('dialog', { name: 'Activity not found' }).className).toContain(
        'motion-safe:animate-dialog-in',
      );
    });
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

    // Your Photos is owner-only (#19).
    it('offers photo uploads only on a completed activity', () => {
      const { unmount } = renderAt([`/activity/${completedHike.id}`], CATALOG);
      expect(screen.getByText('Your Photos')).toBeInTheDocument();
      unmount();
      renderAt([`/activity/${muirWoods.id}`], CATALOG);
      expect(screen.queryByText('Your Photos')).not.toBeInTheDocument();
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
