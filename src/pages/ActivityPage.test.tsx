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
import { act, fireEvent, render, screen, waitFor, within } from '../test/render';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';
import type { Activity } from '../data/types';
import { ActivityPermalinkRoutes } from '../components/ActivityPermalinkRoutes';
import { useOpenActivity } from '../lib/activityRoute';
import { CATALOG_LOAD_ERROR } from '../lib/userActivities';
import { tabbables } from '../lib/focusTrap';

function Probe() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="path">{pathname}</output>
      <output data-testid="search">{search}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        back
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        forward
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
      <button
        type="button"
        onClick={() => {
          open(muirWoods.id);
          open(muirWoods.id);
        }}
      >
        open Muir Woods twice
      </button>
      <label>
        Search <input />
      </label>
      <label>
        Notes <textarea />
      </label>
      <label>
        Sort{' '}
        <select>
          <option>Name</option>
        </select>
      </label>
      <div role="textbox" aria-label="Rich" contentEditable suppressContentEditableWarning />
      <div role="group" aria-label="Rating">
        <button type="button">3 stars</button>
      </div>
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

  it('leaves for the catalog filtered to a contributor clicked in the detail (#9)', async () => {
    const credited = { ...muirWoods, contributors: ['tarun@example.com'] };
    renderAt([`/activity/${muirWoods.id}`], [credited]);
    const dialog = screen.getByRole('dialog', { name: muirWoods.name });
    await userEvent.click(within(dialog).getByRole('button', { name: "Show Tarun's picks" }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(path()).toBe('/');
    expect(screen.getByTestId('search')).toHaveTextContent('?contributors=tarun%40example.com');
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

  it('opens another activity after closing one', async () => {
    // The page below keeps its own location while a detail is open over it,
    // so closing brings back the very entry it opened from. Opening again
    // from there must still work.
    renderAt(['/'], CATALOG);
    await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
    await userEvent.keyboard('{Escape}');
    expect(path()).toBe('/');
    await userEvent.click(screen.getByRole('button', { name: 'open the hike from the list' }));
    expect(path()).toBe(`/activity/${completedHike.id}`);
    expect(screen.getByRole('dialog', { name: completedHike.name })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
    expect(path()).toBe(`/activity/${muirWoods.id}`);
  });

  it('stacks an open from the page behind a detail on it, and closes past both', async () => {
    // Tab can't reach a card behind the detail any more (#258), but a script
    // or a screen reader's cursor can still focus one.
    renderAt(['/'], CATALOG);
    await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
    screen.getByRole('button', { name: 'open the hike from the list' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(path()).toBe(`/activity/${completedHike.id}`);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(path()).toBe('/');
  });

  it('opens only once from the page below before the first open lands', async () => {
    renderAt(['/'], CATALOG);
    await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods twice' }));
    expect(path()).toBe(`/activity/${muirWoods.id}`);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
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
      const nav = screen.getByRole('navigation', { name: 'Adventure 2 of 3 in this list' });
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

    it('stops at the ends rather than wrapping', async () => {
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
      for (const owner of [
        screen.getByRole('textbox', { name: 'Search', hidden: true }),
        screen.getByRole('textbox', { name: 'Notes', hidden: true }),
        screen.getByRole('combobox', { name: 'Sort', hidden: true }),
        screen.getByRole('textbox', { name: 'Rich', hidden: true }),
        screen.getByRole('button', { name: '3 stars', hidden: true }),
      ]) {
        owner.focus();
        await userEvent.keyboard('{ArrowRight}');
        expect(path()).toBe(`/activity/${completedHike.id}`);
      }
    });

    it('takes one step per press: a held key, or one already handled, does nothing', async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true }));
      const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
      handled.preventDefault();
      window.dispatchEvent(handled);
      expect(path()).toBe(`/activity/${completedHike.id}`);
      // A plain press steps, and marks the key handled.
      const press = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
      await act(async () => {
        window.dispatchEvent(press);
        await Promise.resolve();
      });
      expect(press.defaultPrevented).toBe(true);
      expect(path()).toBe(`/activity/${muirWoods.id}`);
    });

    it('pushes one entry for two quick steps, so close still leaves them all', async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      // Two presses before the router has applied the first.
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        await Promise.resolve();
      });
      expect(path()).toBe(`/activity/${muirWoods.id}`);
      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(path()).toBe('/');
    });

    it('steps over an activity removed from the catalog since', async () => {
      renderAt(['/'], [muirWoods, completedHike]);
      await openFromList();
      // The tide pools were first in the list, but aren't in the catalog now.
      expect(screen.getByText('1 of 2')).toBeInTheDocument();
      expect(prev()).toBeDisabled();
      await userEvent.click(next());
      expect(path()).toBe(`/activity/${muirWoods.id}`);
    });

    it('moves focus only on a step, not on a later Back', async () => {
      renderAt(['/'], CATALOG);
      await openFromList();
      await userEvent.click(next());
      expect(prev()).toHaveFocus();
      await userEvent.click(screen.getByRole('button', { name: 'back' }));
      expect(path()).toBe(`/activity/${completedHike.id}`);
      expect(prev()).not.toHaveFocus();
      expect(next()).not.toHaveFocus();
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

    describe('by swipe, on a touch screen', () => {
      beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
      });

      // A slow one-finger swipe across most of the panel.
      function swipe(dx: number, dy: number) {
        const panel = screen.getByRole('dialog');
        const at = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
        fireEvent.touchStart(panel, at(200, 200));
        fireEvent.touchMove(panel, at(200 + dx / 2, 200 + dy / 2));
        fireEvent.touchMove(panel, at(200 + dx, 200 + dy));
        fireEvent.touchEnd(panel, { touches: [] });
      }

      it('steps to the next on a swipe left and back on a swipe right, landing in place', async () => {
        renderAt(['/'], CATALOG);
        await openFromList();
        // Its neighbours wait beside it, out of reach of assistive tech.
        const next = screen.getByTestId('peek-next');
        expect(next).toHaveTextContent(muirWoods.name);
        expect(next).toHaveTextContent('3 of 3');
        expect(next).toHaveAttribute('aria-hidden', 'true');
        expect(next).toHaveAttribute('inert');
        expect(screen.getByTestId('peek-prev')).toHaveTextContent(dogFriendlyTidepools.name);
        swipe(-300, 0);
        await waitFor(() => expect(path()).toBe(`/activity/${muirWoods.id}`));
        // The preview already brought it in: no slide on top.
        const stepped = screen.getByRole('dialog', { name: muirWoods.name });
        expect(stepped.className).not.toContain('animate-');
        // The last in the list: nothing to preview after it.
        expect(screen.queryByTestId('peek-next')).toBeNull();
        swipe(300, 0);
        await waitFor(() => expect(path()).toBe(`/activity/${completedHike.id}`));
        expect(screen.getByRole('dialog', { name: completedHike.name }).className).not.toContain(
          'animate-',
        );
        // One step deeper each time: close leaves them all.
        await userEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(path()).toBe('/');
      });

      it('closes on a swipe down from the top', async () => {
        renderAt(['/'], CATALOG);
        await openFromList();
        swipe(0, 400);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(path()).toBe('/');
      });

      it("doesn't replay the slide-in, or move focus, on Back or Forward", async () => {
        renderAt(['/'], CATALOG);
        await openFromList();
        await userEvent.click(next());
        // A nearby pick from there, then Back onto the stepped-to activity.
        await userEvent.click(
          within(screen.getByRole('dialog')).getByRole('button', { name: /Test Completed Hike/ }),
        );
        await userEvent.click(screen.getByRole('button', { name: 'back' }));
        const back = screen.getByRole('dialog', { name: muirWoods.name });
        expect(back.className).not.toContain('animate-step-in');
        expect(prev()).not.toHaveFocus();
        // Back past the step, then Forward onto it again.
        await userEvent.click(screen.getByRole('button', { name: 'back' }));
        await userEvent.click(screen.getByRole('button', { name: 'forward' }));
        expect(screen.getByRole('dialog', { name: muirWoods.name }).className).not.toContain(
          'animate-step-in',
        );
        expect(prev()).not.toHaveFocus();
      });

      it('slides in on a step by button, but not on a nearby pick', async () => {
        renderAt(['/'], CATALOG);
        await openFromList();
        await userEvent.click(prev());
        expect(screen.getByRole('dialog', { name: dogFriendlyTidepools.name }).className).toContain(
          'motion-safe:animate-step-in-from-left',
        );
        await userEvent.click(next());
        await userEvent.click(next());
        expect(screen.getByRole('dialog', { name: muirWoods.name }).className).toContain(
          'motion-safe:animate-step-in-from-right',
        );
        await userEvent.click(
          within(screen.getByRole('dialog')).getByRole('button', { name: /Test Completed Hike/ }),
        );
        expect(screen.getByRole('dialog', { name: completedHike.name }).className).not.toContain(
          'motion-safe:animate-',
        );
      });
    });

    it('shows no steps without a list, or for an activity not in it', async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      expect(screen.queryByRole('navigation', { name: /in this list/ })).toBeNull();
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

    it('animates the not-found dialog in too, unless it replaces a detail', async () => {
      const { unmount } = renderAt(['/activity/no-such-thing'], CATALOG);
      expect(screen.getByRole('dialog', { name: 'Activity not found' }).className).toContain(
        'motion-safe:animate-dialog-in',
      );
      expect(screen.getByRole('button', { name: 'Close' }).className).toContain(
        'motion-safe:animate-scrim-in',
      );
      unmount();
      // Back from a dead link onto an open detail... and forward again.
      renderAt(['/', `/activity/${muirWoods.id}`, '/activity/no-such-thing'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'back' }));
      await userEvent.click(screen.getByRole('button', { name: 'forward' }));
      expect(path()).toBe('/activity/no-such-thing');
      expect(animated(screen.getByRole('dialog', { name: 'Activity not found' }))).toBe(false);
      expect(animated(screen.getByRole('button', { name: 'Close' }))).toBe(false);
    });
  });

  describe('keyboard focus (#258)', () => {
    function inDetail() {
      return screen.getByRole('dialog').contains(document.activeElement);
    }

    it('moves focus onto the detail when it opens', async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      expect(screen.getByRole('dialog', { name: muirWoods.name })).toHaveFocus();
    });

    it('keeps Tab and Shift+Tab inside the detail, wrapping at its ends', async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      const dialog = screen.getByRole('dialog');
      // Its first control is Close, at the top of the cover.
      await userEvent.tab();
      expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
      await userEvent.tab({ shift: true });
      const last = document.activeElement;
      expect(inDetail()).toBe(true);
      expect(last).not.toBe(within(dialog).getByRole('button', { name: 'Close' }));
      await userEvent.tab();
      expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
      for (let i = 0; i < 30; i++) {
        await userEvent.tab();
        expect(inDetail()).toBe(true);
      }
      for (let i = 0; i < 30; i++) {
        await userEvent.tab({ shift: true });
        expect(inDetail()).toBe(true);
      }
    });

    it('hands focus back to the card that opened it on close', async () => {
      renderAt(['/'], CATALOG);
      const card = screen.getByRole('button', { name: 'open Muir Woods' });
      await userEvent.click(card);
      await userEvent.keyboard('{Escape}');
      expect(card).toHaveFocus();

      await userEvent.click(card);
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }),
      );
      expect(card).toHaveFocus();
    });

    it('hands it back to the first card after stepping or a nearby pick', async () => {
      renderAt(['/'], CATALOG);
      const card = screen.getByRole('button', { name: 'open the hike from the list' });
      await userEvent.click(card);
      await userEvent.click(screen.getByRole('button', { name: 'Next adventure' }));
      expect(path()).toBe(`/activity/${muirWoods.id}`);
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: /Test Completed Hike/ }),
      );
      expect(screen.getByRole('dialog', { name: completedHike.name })).toHaveFocus();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(card).toHaveFocus();
    });

    it('focuses the detail again when Back brings up another one', async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      await userEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: /Test Completed Hike/ }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'back' }));
      expect(screen.getByRole('dialog', { name: muirWoods.name })).toHaveFocus();
    });

    it('keeps Tab on the not-found action', async () => {
      renderAt(['/activity/no-such-thing'], CATALOG);
      const action = screen.getByRole('button', { name: 'Browse adventures' });
      await userEvent.tab();
      expect(action).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(action).toHaveFocus();
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

    it('leaves arrow keys to the edit form while it is up (#64)', async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open the hike from the list' }));
      await userEvent.click(screen.getByRole('button', { name: /EDIT ACTIVITY/ }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      expect(path()).toBe(`/activity/${completedHike.id}`);
    });

    it('lets Tab on to the edit form layered over the detail (#258)', async () => {
      renderAt(['/'], CATALOG);
      await userEvent.click(screen.getByRole('button', { name: 'open Muir Woods' }));
      const detail = screen.getByRole('dialog', { name: muirWoods.name });
      // Once the form is up the detail's last control isn't the end of the
      // line: the form, drawn after it, comes next.
      await userEvent.click(screen.getByRole('button', { name: /EDIT ACTIVITY/ }));
      tabbables(detail).at(-1)!.focus();
      await userEvent.tab();
      // The form's own backdrop, the first thing in its layer.
      expect(screen.getByRole('button', { name: 'Cancel adding activity' })).toHaveFocus();
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
    expect(await screen.findByRole('dialog', { name: 'Activity not found' })).toBeInTheDocument();
  });

  it('leaves other pages alone', () => {
    renderAt(['/trips'], CATALOG);
    expect(screen.getByRole('heading', { name: 'Trips' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
