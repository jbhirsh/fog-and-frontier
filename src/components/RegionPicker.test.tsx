import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Region } from '../data/types';
import { RegionPicker } from './RegionPicker';

// The region list scrolls its option into view (#274), which jsdom doesn't do.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function Picker({
  start = '',
  onChange = () => {},
}: {
  start?: Region | '';
  onChange?: (r: Region) => void;
}) {
  const [value, setValue] = useState<Region | ''>(start);
  return (
    <RegionPicker
      label="Region"
      value={value}
      onChange={(r) => {
        setValue(r);
        onChange(r);
      }}
      className="w-full"
    />
  );
}

const field = () => screen.getByRole('combobox', { name: 'Region' });
const shown = () =>
  within(screen.getByRole('listbox'))
    .queryAllByRole('option')
    .map((o) => o.textContent);

describe('RegionPicker (#274)', () => {
  it('shows the region chosen, a California area at once and any other once loaded', async () => {
    const { unmount } = render(<Picker start="south-bay" />);
    expect(field()).toHaveValue('South Bay');
    expect(field()).toHaveClass('w-full');
    unmount();
    render(<Picker start="JP-26" />);
    await waitFor(() => expect(field()).toHaveValue('Kyoto, Japan'));
  });

  it('asks for one when none is chosen', () => {
    render(<Picker />);
    expect(field()).toHaveValue('');
    expect(field()).toHaveAttribute('placeholder', 'Search a place, state or country');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });

  it('offers California’s areas on focus, and finds anywhere as it’s typed', async () => {
    render(<Picker />);
    await userEvent.click(field());
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    await waitFor(() => expect(shown()[0]).toBe('San Francisco'));
    expect(shown()).toHaveLength(8);
    await userEvent.type(field(), 'kyo');
    expect(shown()).toEqual(['Kyoto, Japan']);
    await userEvent.clear(field());
    await userEvent.type(field(), 'zzqx');
    expect(screen.getByRole('status')).toHaveTextContent('No region matches');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('finds California’s areas by the state’s name, and lets Escape close only the list', async () => {
    const onKeyDown = vi.fn();
    window.addEventListener('keydown', onKeyDown);
    render(<Picker />);
    await userEvent.click(field());
    await userEvent.type(field(), 'california');
    expect(shown()).toEqual([
      'San Francisco',
      'North Bay',
      'East Bay',
      'South Bay',
      'Peninsula',
      'Central Coast',
      'NorCal',
      'SoCal',
    ]);
    // The dialog around it closes on Escape; with the list open, only the list does.
    await userEvent.keyboard('{Escape}');
    expect(onKeyDown).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    await userEvent.keyboard('{Escape}');
    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    window.removeEventListener('keydown', onKeyDown);
  });

  it('keeps the option the keys are on in view', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<Picker />);
    await userEvent.click(field());
    await userEvent.type(field(), 'japan');
    scrolled.mockClear();
    await userEvent.keyboard('{ArrowDown}');
    const option = within(screen.getByRole('listbox')).getAllByRole('option')[1];
    expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrolled.mock.contexts.at(-1)).toBe(option);
    // Not while it's closed.
    await userEvent.keyboard('{Escape}');
    scrolled.mockClear();
    await userEvent.tab();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('picks with the arrow keys and Enter, without sending the form', async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Picker onChange={onChange} />
      </form>,
    );
    await userEvent.click(field());
    await waitFor(() => expect(shown()).toHaveLength(8));
    const options = () => within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    expect(field()).toHaveAttribute('aria-activedescendant', options()[0].id);
    await userEvent.keyboard('{ArrowDown}');
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(field()).toHaveAttribute('aria-activedescendant', options()[1].id);
    // Up from the top wraps to the bottom.
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(options()[7]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('socal');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(field()).toHaveValue('SoCal');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // The arrow keys open it again.
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('picks by pointer, following it over the list', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await userEvent.click(field());
    await userEvent.type(field(), 'utah');
    const option = await screen.findByRole('option', { name: 'Utah, United States' });
    await userEvent.hover(option);
    expect(option).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('US-UT');
    expect(field()).toHaveValue('Utah, United States');
  });

  it('marks only the option the keys are on, and only while the list is open', async () => {
    render(<Picker />);
    await userEvent.click(field());
    await waitFor(() => expect(shown()).toHaveLength(8));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveClass('bg-primary-fixed');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveClass('text-on-surface');
    expect(options[1]).not.toHaveClass('bg-primary-fixed');
    // The pointer moves it too.
    await userEvent.hover(options[3]);
    expect(options[3]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    // Nothing is said to be active once it closes, or when nothing matches.
    await userEvent.keyboard('{Escape}');
    expect(field()).not.toHaveAttribute('aria-activedescendant');
    await userEvent.type(field(), 'zzqx');
    expect(field()).not.toHaveAttribute('aria-activedescendant');
    expect(screen.queryByText('No region matches')).toBeInTheDocument();
    await userEvent.clear(field());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('starts each opening at the top, with the search cleared', async () => {
    render(
      <>
        <Picker />
        <button type="button">elsewhere</button>
      </>,
    );
    await userEvent.click(field());
    await waitFor(() => expect(shown()).toHaveLength(8));
    const selected = () =>
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .findIndex((o) => o.getAttribute('aria-selected') === 'true');
    // Reopened by the arrow keys after Escape.
    await userEvent.type(field(), 'u{ArrowDown}{ArrowDown}');
    expect(selected()).toBe(2);
    await userEvent.keyboard('{Escape}{ArrowDown}');
    expect(field()).toHaveValue('');
    expect(selected()).toBe(0);
    expect(shown()).toHaveLength(8);
    // Reopened by focus after leaving.
    await userEvent.type(field(), 'u{ArrowDown}');
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    await userEvent.click(field());
    expect(field()).toHaveValue('');
    expect(selected()).toBe(0);
    // Typing moves back to the top.
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.type(field(), 'u');
    expect(selected()).toBe(0);
  });

  it('reopens with the search cleared after a pick, focus kept in the field', async () => {
    render(<Picker />);
    await userEvent.click(field());
    await userEvent.type(field(), 'utah');
    await userEvent.click(await screen.findByRole('option', { name: 'Utah, United States' }));
    expect(field()).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(field()).toHaveValue('');
    expect(shown()).toHaveLength(8);
  });

  it('keeps the arrow keys and Escape from moving the caret, and Enter on nothing picks nothing', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    await userEvent.click(field());
    // fireEvent returns false when the default was prevented.
    expect(fireEvent.keyDown(field(), { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(field(), { key: 'ArrowUp' })).toBe(false);
    await userEvent.type(field(), 'zzqx{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(fireEvent.keyDown(field(), { key: 'Escape' })).toBe(false);
    // Closed, Escape is the page's again.
    expect(fireEvent.keyDown(field(), { key: 'Escape' })).toBe(true);
  });

  it('keeps what was chosen when Escape or leaving the field closes it', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Picker start="sf" onChange={onChange} />
        <button type="button">elsewhere</button>
      </>,
    );
    await userEvent.click(field());
    await userEvent.type(field(), 'kyo');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveValue('San Francisco');
    await userEvent.type(field(), 'ore');
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toHaveValue('San Francisco');
    expect(onChange).not.toHaveBeenCalled();
  });
});
