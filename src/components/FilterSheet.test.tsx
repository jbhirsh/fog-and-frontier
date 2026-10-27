import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_FILTERS, type FilterValues } from '../lib/catalogFilterOptions';
import { FilterSheet, type FilterSheetProps } from './FilterSheet';

function renderSheet(props: Partial<FilterSheetProps> = {}) {
  const onChange = vi.fn<(patch: Partial<FilterValues>) => void>();
  const onClose = vi.fn<() => void>();
  render(
    <FilterSheet
      values={NO_FILTERS}
      onChange={onChange}
      count={12}
      originName="you"
      showFree
      contributorOptions={[]}
      onClose={onClose}
      {...props}
    />,
  );
  return { onChange, onClose };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function group(name: string) {
  return within(screen.getByRole('group', { name }));
}

describe('FilterSheet', () => {
  it('is a dialog named Filters, focused when it opens', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('marks the choices in force', () => {
    renderSheet({
      values: { ...NO_FILTERS, category: 'water', maxDistance: 100, duration: 'day' },
    });
    expect(group('What').getByRole('button', { name: 'Water' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(group('What').getByRole('button', { name: 'Hikes' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(group('How far').getByRole('button', { name: '100 mi' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(group('How far').getByRole('button', { name: 'Any' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(group('How long').getByRole('button', { name: 'A day or more' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /^Park type/ })).toHaveTextContent('Park typeAny');
  });

  it('changes each filter as it’s picked', async () => {
    const { onChange } = renderSheet();
    await userEvent.click(group('What').getByRole('button', { name: 'Hikes' }));
    expect(onChange).toHaveBeenLastCalledWith({ category: 'hiking' });
    await userEvent.click(group('How far').getByRole('button', { name: '25 mi' }));
    expect(onChange).toHaveBeenLastCalledWith({ maxDistance: 25 });
    await userEvent.click(group('How long').getByRole('button', { name: 'Half day' }));
    expect(onChange).toHaveBeenLastCalledWith({ duration: 'half' });
    await userEvent.click(screen.getByRole('switch', { name: 'Dogs welcome' }));
    expect(onChange).toHaveBeenLastCalledWith({ dogOnly: true });
    await userEvent.click(screen.getByRole('switch', { name: 'Free' }));
    expect(onChange).toHaveBeenLastCalledWith({ freeOnly: true });
    await userEvent.click(screen.getByRole('switch', { name: 'Only places we’ve done' }));
    expect(onChange).toHaveBeenLastCalledWith({ completedOnly: true });
  });

  it('offers the four durations, in order', () => {
    renderSheet();
    expect(
      group('How long')
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Any', 'A few hours', 'Half day', 'A day or more']);
  });

  it('names the main categories as tiles, each with its glyph', () => {
    renderSheet();
    const tiles = group('What').getAllByRole('button');
    expect(tiles.map((t) => t.textContent)).toEqual([
      'directions_walkHikes',
      'restaurantFood',
      'landscapeViews',
      'waterWater',
      'museumCulture',
      'pedal_bikeBikes',
      'forestCamping',
      'more_horizMore',
    ]);
  });

  it('takes a category off with a second tap', async () => {
    const { onChange } = renderSheet({ values: { ...NO_FILTERS, category: 'food' } });
    await userEvent.click(group('What').getByRole('button', { name: 'Food' }));
    expect(onChange).toHaveBeenLastCalledWith({ category: 'Any' });
  });

  it('opens the rest of the categories from More', async () => {
    const { onChange } = renderSheet();
    const more = group('What').getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).not.toHaveAttribute('aria-controls');
    expect(more).not.toHaveAttribute('aria-pressed');
    expect(screen.queryByRole('button', { name: 'Climbing' })).not.toBeInTheDocument();
    await userEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const climbing = screen.getByRole('button', { name: 'Climbing' });
    expect(more.getAttribute('aria-controls')).toBe(climbing.parentElement?.id);
    await userEvent.click(climbing);
    expect(onChange).toHaveBeenLastCalledWith({ category: 'climbing' });
    await userEvent.click(screen.getByRole('button', { name: 'Other' }));
    expect(onChange).toHaveBeenLastCalledWith({ category: 'other' });
    await userEvent.click(more);
    expect(screen.queryByRole('button', { name: 'Climbing' })).not.toBeInTheDocument();
  });

  it('opens More when the category in force is one of the rest, and fills it', () => {
    renderSheet({ values: { ...NO_FILTERS, category: 'climbing' } });
    const more = group('What').getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'Climbing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('picks a park type from its own list, then goes back to the filters', async () => {
    const { onChange } = renderSheet({ values: { ...NO_FILTERS, parkType: 'state' } });
    const row = screen.getByRole('button', { name: /^Park type/ });
    expect(row).toHaveTextContent('State park');
    await userEvent.click(row);
    expect(screen.getByRole('dialog', { name: 'Park type' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to filters' })).toHaveFocus();
    const types = within(screen.getByRole('group', { name: 'Park type' }));
    expect(types.getByRole('button', { name: 'State park' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(types.getAllByRole('button')).toHaveLength(8);
    await userEvent.click(types.getByRole('button', { name: 'Regional park' }));
    expect(onChange).toHaveBeenLastCalledWith({ parkType: 'regional' });
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Park type/ })).toHaveFocus();
  });

  it('goes back from a list without changing anything', async () => {
    const { onChange } = renderSheet();
    await userEvent.click(screen.getByRole('button', { name: /^Park type/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Back to filters' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Park type/ })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Back to filters' })).not.toBeInTheDocument();
  });

  it('sets a distance back to any', async () => {
    const { onChange } = renderSheet({ values: { ...NO_FILTERS, maxDistance: 50 } });
    await userEvent.click(group('How far').getByRole('button', { name: 'Any' }));
    expect(onChange).toHaveBeenLastCalledWith({ maxDistance: Infinity });
  });

  it('turns a switch off again', async () => {
    const { onChange } = renderSheet({ values: { ...NO_FILTERS, dogOnly: true } });
    const dog = screen.getByRole('switch', { name: 'Dogs welcome' });
    expect(dog).toBeChecked();
    await userEvent.click(dog);
    expect(onChange).toHaveBeenLastCalledWith({ dogOnly: false });
  });

  it('says where distances are measured from', () => {
    renderSheet({ originName: 'San Jose' });
    expect(screen.getByRole('heading', { name: 'How far from San Jose' })).toBeInTheDocument();
  });

  it('offers Free only when asked to', () => {
    renderSheet({ showFree: false });
    expect(screen.queryByRole('switch', { name: 'Free' })).not.toBeInTheDocument();
  });

  it('offers no contributors when there are none to offer', () => {
    renderSheet();
    expect(screen.queryByRole('button', { name: /^Added by/ })).not.toBeInTheDocument();
  });

  it('adds and takes off contributors one at a time, from their own list', async () => {
    const { onChange } = renderSheet({
      values: { ...NO_FILTERS, contributors: ['jess@example.com'] },
      contributorOptions: ['jess@example.com', 'tarun@example.com'],
    });
    const row = screen.getByRole('button', { name: /^Added by/ });
    expect(row).toHaveTextContent('Jess');
    await userEvent.click(row);
    expect(screen.getByRole('dialog', { name: 'Added by' })).toBeInTheDocument();
    const jess = screen.getByRole('checkbox', { name: 'Jess' });
    const tarun = screen.getByRole('checkbox', { name: 'Tarun' });
    expect(jess).toBeChecked();
    expect(tarun).not.toBeChecked();
    await userEvent.click(tarun);
    expect(onChange).toHaveBeenLastCalledWith({
      contributors: ['jess@example.com', 'tarun@example.com'],
    });
    await userEvent.click(jess);
    expect(onChange).toHaveBeenLastCalledWith({ contributors: [] });
    // Several can be picked, so the list stays open.
    expect(screen.getByRole('dialog', { name: 'Added by' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to filters' }));
    expect(screen.getByRole('button', { name: /^Added by/ })).toHaveFocus();
  });

  it('says who the contributors filter keeps', () => {
    const { rerender } = render(<></>);
    const sheet = (contributors: string[]) => (
      <FilterSheet
        values={{ ...NO_FILTERS, contributors }}
        onChange={() => {}}
        count={0}
        originName="you"
        showFree={false}
        contributorOptions={['jess@example.com', 'tarun@example.com']}
        onClose={() => {}}
      />
    );
    rerender(sheet([]));
    expect(screen.getByRole('button', { name: /^Added by/ })).toHaveTextContent('Anyone');
    rerender(sheet(['jess@example.com', 'tarun@example.com']));
    expect(screen.getByRole('button', { name: /^Added by/ })).toHaveTextContent('2 people');
  });

  it('offers Clear all only once a filter is on', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled();
  });

  it('clears every filter at once', async () => {
    const { onChange } = renderSheet({ values: { ...NO_FILTERS, freeOnly: true } });
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onChange).toHaveBeenCalledWith(NO_FILTERS);
  });

  it('closes from the count, the ✕, the backdrop and Escape', async () => {
    const { onClose } = renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Show 12 places' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('counts one place in the singular', () => {
    renderSheet({ count: 1 });
    expect(screen.getByRole('button', { name: 'Show 1 place' })).toBeInTheDocument();
  });

  it('holds the page still while open', () => {
    const { unmount } = render(
      <FilterSheet
        values={NO_FILTERS}
        onChange={() => {}}
        count={0}
        originName="you"
        showFree={false}
        contributorOptions={[]}
        onClose={() => {}}
      />,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps Tab inside the sheet', async () => {
    renderSheet();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Show 12 places' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
  it('fills the chosen tile and segment, and switches a switch on', () => {
    renderSheet({ values: { ...NO_FILTERS, category: 'food', maxDistance: 25, freeOnly: true } });
    expect(group('What').getByRole('button', { name: 'Food' })).toHaveClass('bg-primary');
    expect(group('What').getByRole('button', { name: 'Hikes' })).not.toHaveClass('bg-primary');
    expect(group('How far').getByRole('button', { name: '25 mi' })).toHaveClass('shadow-sm');
    expect(group('How far').getByRole('button', { name: 'Any' })).not.toHaveClass('shadow-sm');
    expect(screen.getByRole('switch', { name: 'Free' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Dogs welcome' })).not.toBeChecked();
  });

  it('takes one contributor off and keeps the others', async () => {
    const { onChange } = renderSheet({
      values: { ...NO_FILTERS, contributors: ['jess@example.com', 'tarun@example.com'] },
      contributorOptions: ['jess@example.com', 'tarun@example.com'],
    });
    await userEvent.click(screen.getByRole('button', { name: /^Added by/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Jess' }));
    expect(onChange).toHaveBeenLastCalledWith({ contributors: ['tarun@example.com'] });
  });

  it('goes back to the filters on Escape from a list, then closes', async () => {
    const { onClose } = renderSheet();
    await userEvent.click(screen.getByRole('button', { name: /^Park type/ }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Park type/ })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses itself without scrolling the page', () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    renderSheet();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('closes on Escape only', async () => {
    const { onClose } = renderSheet();
    await userEvent.keyboard('a');
    await userEvent.keyboard('{Enter}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening once closed', async () => {
    const onClose = vi.fn<() => void>();
    const { unmount } = render(
      <FilterSheet
        values={NO_FILTERS}
        onChange={() => {}}
        count={0}
        originName="you"
        showFree={false}
        contributorOptions={[]}
        onClose={onClose}
      />,
    );
    unmount();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes through the latest onClose it was given', async () => {
    const first = vi.fn<() => void>();
    const second = vi.fn<() => void>();
    const sheet = (onClose: () => void) => (
      <FilterSheet
        values={NO_FILTERS}
        onChange={() => {}}
        count={0}
        originName="you"
        showFree={false}
        contributorOptions={[]}
        onClose={onClose}
      />
    );
    const { rerender } = render(sheet(first));
    rerender(sheet(second));
    await userEvent.keyboard('{Escape}');
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it('keeps the backdrop and the sheet itself out of the Tab order', () => {
    renderSheet();
    expect(screen.getByRole('button', { name: 'Close filters' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('dialog')).toHaveAttribute('tabindex', '-1');
  });

  it('puts back a scroll lock that was already there', () => {
    document.body.style.overflow = 'clip';
    const { unmount } = render(
      <FilterSheet
        values={NO_FILTERS}
        onChange={() => {}}
        count={0}
        originName="you"
        showFree={false}
        contributorOptions={[]}
        onClose={() => {}}
      />,
    );
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('clip');
    document.body.style.overflow = '';
  });

  describe('swiped down', () => {
    // A one-finger pull down the sheet, released a second later.
    function pull(target: Element, dy: number) {
      const at = (y: number) => ({ touches: [{ clientX: 100, clientY: y }] });
      fireEvent.touchStart(target, at(100));
      for (const f of [0.25, 0.5, 1]) fireEvent.touchMove(target, at(100 + dy * f));
      vi.advanceTimersByTime(1000);
      fireEvent.touchEnd(target, { touches: [], changedTouches: [] });
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('closes, as a place’s sheet does, from its title or its list', () => {
      vi.useFakeTimers();
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
      const { onClose } = renderSheet();
      pull(screen.getByRole('heading', { name: 'Filters' }), 300);
      expect(onClose).toHaveBeenCalledTimes(1);
      // On a row's words: a gesture never starts on a field itself.
      pull(screen.getByText('Dogs welcome'), 300);
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('scrolls its list back up instead, while it’s scrolled down', () => {
      vi.useFakeTimers();
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
      const { onClose } = renderSheet();
      const dogs = screen.getByText('Dogs welcome');
      const list = dogs.closest('.overflow-y-auto');
      if (!(list instanceof HTMLElement)) throw new Error('no list');
      list.scrollTop = 80;
      pull(dogs, 300);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('stays for a short pull', () => {
      vi.useFakeTimers();
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
      const { onClose } = renderSheet();
      pull(screen.getByRole('heading', { name: 'Filters' }), 30);
      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
