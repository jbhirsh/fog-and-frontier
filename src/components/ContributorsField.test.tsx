import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContributorsField } from './ContributorsField';

const TARUN = 'tarun@example.com';
const JESS = 'jess.hirsh@example.com';
const SAM = 'sam@example.com';

function options() {
  return screen.getAllByRole('option').map((o) => o.textContent);
}

describe('ContributorsField (#9)', () => {
  it('shows each credited account by name, under a Contributors label', () => {
    render(<ContributorsField value={[TARUN, JESS]} users={[]} onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Contributors' });
    expect(group).toHaveTextContent('Tarun');
    expect(group).toHaveTextContent('Jess Hirsh');
  });

  it('offers only the registered accounts not yet credited, and adds the one picked', async () => {
    const onChange = vi.fn();
    render(<ContributorsField value={[TARUN]} users={[JESS, TARUN, SAM]} onChange={onChange} />);
    expect(options()).toEqual(['+ Add contributor', 'Jess Hirsh', 'Sam']);
    expect(screen.getByRole('option', { name: '+ Add contributor' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Add contributor' }), SAM);
    expect(onChange).toHaveBeenCalledWith([TARUN, SAM]);
  });

  it('pads a lone chip evenly, and keeps room for the remove button when there are more', () => {
    // A lone chip has no remove button, so it pads both sides alike; with one,
    // the button's own box supplies the room on the right.
    const { rerender } = render(
      <ContributorsField value={[TARUN]} users={[]} onChange={() => {}} />,
    );
    const chip = () => screen.getByText('Tarun', { selector: 'span' });
    expect(chip()).toHaveClass('pl-sm', 'pr-sm');
    expect(chip()).not.toHaveClass('pr-xs');
    rerender(<ContributorsField value={[TARUN, JESS]} users={[]} onChange={() => {}} />);
    expect(chip()).toHaveClass('pl-sm', 'pr-xs');
    expect(chip()).not.toHaveClass('pr-sm');
  });

  it('boxes the remove and caret icons at a fixed 18px', () => {
    // Sized inline: the icon font's own rule would otherwise set them.
    const { container } = render(
      <ContributorsField value={[TARUN, JESS]} users={[TARUN, JESS, SAM]} onChange={() => {}} />,
    );
    const icons = [...container.querySelectorAll<HTMLElement>('.material-symbols-outlined')];
    expect(icons.map((i) => i.textContent)).toEqual(['close', 'close', 'expand_more']);
    for (const icon of icons) {
      expect(icon.style).toMatchObject({ fontSize: '18px', width: '18px', height: '18px' });
    }
  });

  it('has no picker once everyone is credited', () => {
    render(<ContributorsField value={[TARUN]} users={[TARUN]} onChange={() => {}} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('removes a contributor, but never the last one', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ContributorsField value={[TARUN, JESS]} users={[]} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove Tarun' }));
    expect(onChange).toHaveBeenCalledWith([JESS]);

    rerender(<ContributorsField value={[JESS]} users={[]} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it('starts empty, with only the picker, for an uncredited activity', () => {
    render(<ContributorsField value={[]} users={[TARUN]} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Add contributor' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  describe('focus, when the control it was on goes away', () => {
    function Stateful({ initial, users }: { initial: string[]; users: string[] }) {
      const [value, setValue] = useState(initial);
      return <ContributorsField value={value} users={users} onChange={setValue} />;
    }

    it('moves to the next remove button, else the one before, else the picker', async () => {
      render(<Stateful initial={[TARUN, JESS, SAM]} users={[TARUN, JESS, SAM]} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove Jess Hirsh' }));
      expect(screen.getByRole('button', { name: 'Remove Sam' })).toHaveFocus();
      await userEvent.click(screen.getByRole('button', { name: 'Remove Sam' }));
      // One left: it has no remove button, so focus goes to the picker.
      expect(screen.getByRole('combobox', { name: 'Add contributor' })).toHaveFocus();
    });

    it('falls back to the button before when the last chip is removed', async () => {
      render(<Stateful initial={[TARUN, JESS, SAM]} users={[TARUN, JESS, SAM]} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove Sam' }));
      expect(screen.getByRole('button', { name: 'Remove Jess Hirsh' })).toHaveFocus();
    });

    it('leaves focus where it went when a browsed-to last name is added on leaving', async () => {
      render(
        <>
          <Stateful initial={[TARUN]} users={[TARUN, SAM]} />
          <button type="button">Save</button>
        </>,
      );
      const picker = screen.getByRole('combobox');
      picker.focus();
      fireEvent.keyDown(picker, { key: 'ArrowDown' });
      fireEvent.change(picker, { target: { value: SAM } });
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Remove Sam' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    });

    it('falls back to the group when a lone new chip has no remove button', async () => {
      render(<Stateful initial={[]} users={[SAM]} />);
      await userEvent.selectOptions(screen.getByRole('combobox'), SAM);
      const group = screen.getByRole('group', { name: 'Contributors' });
      expect(group).toHaveFocus();
      expect(group).toHaveAttribute('tabindex', '-1'); // focusable, but not a tab stop
    });

    it('falls back to the group when the accounts have not loaded', async () => {
      render(<Stateful initial={[TARUN, SAM]} users={[]} />);
      await userEvent.click(screen.getByRole('button', { name: 'Remove Sam' }));
      expect(screen.getByRole('group', { name: 'Contributors' })).toHaveFocus();
    });

    it('takes no focus on the first render', () => {
      render(<Stateful initial={[TARUN, SAM]} users={[TARUN, SAM, JESS]} />);
      expect(document.body).toHaveFocus();
    });

    it('stays on the picker while it has names left', async () => {
      render(<Stateful initial={[TARUN]} users={[TARUN, JESS, SAM]} />);
      const picker = screen.getByRole('combobox');
      picker.focus();
      await userEvent.selectOptions(picker, SAM);
      expect(picker).toHaveFocus();
    });

    it("moves to the new chip's remove button when the last name is picked", async () => {
      render(<Stateful initial={[TARUN]} users={[TARUN, SAM]} />);
      await userEvent.selectOptions(screen.getByRole('combobox'), SAM);
      expect(screen.getByRole('button', { name: 'Remove Sam' })).toHaveFocus();
    });
  });

  it('stops offering names at the ten the server will credit', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `p${i}@example.com`);
    const { rerender } = render(
      <ContributorsField value={ten.slice(0, 9)} users={[...ten, SAM]} onChange={() => {}} />,
    );
    expect(screen.getByRole('combobox', { name: 'Add contributor' })).toBeInTheDocument();
    rerender(<ContributorsField value={ten} users={[...ten, SAM]} onChange={() => {}} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
