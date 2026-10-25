import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_FILTERS, type FilterValues } from '../lib/catalogFilterOptions';
import { glyphBleed } from '../lib/iconMetrics';
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
      values: { ...NO_FILTERS, category: 'water', maxDistance: 100, duration: 'Weekend' },
    });
    expect(group('Category').getByRole('button', { name: 'Water' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(group('Category').getByRole('button', { name: 'Any' })).toHaveAttribute(
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
    expect(group('How long').getByRole('button', { name: 'Weekend' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(group('Park type').getByRole('button', { name: 'Any' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('changes each filter as it’s picked', async () => {
    const { onChange } = renderSheet();
    await userEvent.click(group('Category').getByRole('button', { name: 'Hiking' }));
    expect(onChange).toHaveBeenLastCalledWith({ category: 'hiking' });
    await userEvent.click(group('How far').getByRole('button', { name: '25 mi' }));
    expect(onChange).toHaveBeenLastCalledWith({ maxDistance: 25 });
    await userEvent.click(group('How long').getByRole('button', { name: 'Half Day' }));
    expect(onChange).toHaveBeenLastCalledWith({ duration: 'Half Day' });
    await userEvent.click(group('Park type').getByRole('button', { name: 'Regional park' }));
    expect(onChange).toHaveBeenLastCalledWith({ parkType: 'regional' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Dog friendly' }));
    expect(onChange).toHaveBeenLastCalledWith({ dogOnly: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Free' }));
    expect(onChange).toHaveBeenLastCalledWith({ freeOnly: true });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Completed only' }));
    expect(onChange).toHaveBeenLastCalledWith({ completedOnly: true });
  });

  it('sets a distance back to any', async () => {
    const { onChange } = renderSheet({ values: { ...NO_FILTERS, maxDistance: 50 } });
    await userEvent.click(group('How far').getByRole('button', { name: 'Any' }));
    expect(onChange).toHaveBeenLastCalledWith({ maxDistance: Infinity });
  });

  it('turns a toggle off again', async () => {
    const { onChange } = renderSheet({ values: { ...NO_FILTERS, dogOnly: true } });
    const dog = screen.getByRole('checkbox', { name: 'Dog friendly' });
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
    expect(screen.queryByRole('checkbox', { name: 'Free' })).not.toBeInTheDocument();
  });

  it('offers no contributors when there are none to offer', () => {
    renderSheet();
    expect(screen.queryByRole('group', { name: 'Added by' })).not.toBeInTheDocument();
  });

  it('adds and takes off contributors one at a time', async () => {
    const { onChange } = renderSheet({
      values: { ...NO_FILTERS, contributors: ['jess@example.com'] },
      contributorOptions: ['jess@example.com', 'tarun@example.com'],
    });
    const jess = group('Added by').getByRole('button', { name: /Jess/ });
    const tarun = group('Added by').getByRole('button', { name: /Tarun/ });
    expect(jess).toHaveAttribute('aria-pressed', 'true');
    expect(tarun).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(tarun);
    expect(onChange).toHaveBeenLastCalledWith({
      contributors: ['jess@example.com', 'tarun@example.com'],
    });
    await userEvent.click(jess);
    expect(onChange).toHaveBeenLastCalledWith({ contributors: [] });
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
  it('draws the chosen chip, segment and contributor filled, the rest outlined', () => {
    renderSheet({
      values: {
        ...NO_FILTERS,
        category: 'food',
        maxDistance: 25,
        contributors: ['jess@example.com'],
      },
      contributorOptions: ['jess@example.com', 'tarun@example.com'],
    });
    expect(group('Category').getByRole('button', { name: 'Food' })).toHaveClass('bg-primary');
    expect(group('Category').getByRole('button', { name: 'Any' })).not.toHaveClass('bg-primary');
    expect(group('How far').getByRole('button', { name: '25 mi' })).toHaveClass('shadow-sm');
    expect(group('How far').getByRole('button', { name: 'Any' })).not.toHaveClass('shadow-sm');
    expect(group('Added by').getByRole('button', { name: /Jess/ })).toHaveClass('bg-primary');
    expect(group('Added by').getByRole('button', { name: /Tarun/ })).not.toHaveClass('bg-primary');
  });

  it('takes one contributor off and keeps the others', async () => {
    const { onChange } = renderSheet({
      values: { ...NO_FILTERS, contributors: ['jess@example.com', 'tarun@example.com'] },
      contributorOptions: ['jess@example.com', 'tarun@example.com'],
    });
    await userEvent.click(group('Added by').getByRole('button', { name: /Jess/ }));
    expect(onChange).toHaveBeenLastCalledWith({ contributors: ['tarun@example.com'] });
  });

  it('pulls the contributor icon in by its glyph’s empty side', () => {
    renderSheet({ contributorOptions: ['jess@example.com'] });
    const icon = group('Added by').getByText('person');
    expect(icon.style.marginLeft).toBe(glyphBleed('person'));
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
});
