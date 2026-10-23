import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tabbables, useFocusTrap, useReturnFocus } from './focusTrap';

afterEach(() => {
  vi.restoreAllMocks();
});

function fromHtml(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  return container;
}

describe('tabbables', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('lists what Tab reaches, in order', () => {
    const box = fromHtml(`
      <a href="#a" id="link">link</a>
      <a id="bare">no href</a>
      <button id="button">button</button>
      <input id="input" />
      <input type="hidden" id="secret" />
      <select id="select"></select>
      <textarea id="text"></textarea>
      <span id="plain">text</span>
      <div tabindex="0" id="custom"></div>
    `);
    expect(tabbables(box).map((el) => el.id)).toEqual([
      'link',
      'button',
      'input',
      'select',
      'text',
      'custom',
    ]);
  });

  it('skips the disabled, the untabbable, the inert and the hidden', () => {
    const box = fromHtml(`
      <button id="on">on</button>
      <button disabled id="off">off</button>
      <input disabled id="field" />
      <button tabindex="-1" id="skipped">skipped</button>
      <div tabindex="-1" id="focusable"></div>
      <div inert><button id="inert">inert</button></div>
      <div hidden><button id="hidden">hidden</button></div>
    `);
    expect(tabbables(box).map((el) => el.id)).toEqual(['on']);
  });

  it('skips what the browser lays out invisibly, where it can tell', () => {
    const box = fromHtml('<button id="shown">shown</button><button id="gone">gone</button>');
    const gone = box.querySelector<HTMLElement>('#gone')!;
    const shown = box.querySelector<HTMLElement>('#shown')!;
    const check = vi.fn(() => false);
    gone.checkVisibility = check;
    shown.checkVisibility = () => true;
    expect(tabbables(box)).toEqual([shown]);
    // visibility: hidden counts too, not just display: none.
    expect(check).toHaveBeenCalledWith({ visibilityProperty: true });
  });
});

function Dialog({ enabled = true, empty = false }: { enabled?: boolean; empty?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, enabled);
  return (
    <>
      <button type="button">before</button>
      <div ref={ref} role="dialog" tabIndex={-1} aria-label="Trap">
        {!empty && (
          <>
            <button type="button">first</button>
            <button type="button">middle</button>
            <button type="button">last</button>
          </>
        )}
      </div>
      <button type="button">after</button>
    </>
  );
}

function button(name: string) {
  return screen.getByRole('button', { name });
}

describe('useFocusTrap', () => {
  it('wraps Tab from the last control to the first', async () => {
    render(<Dialog />);
    button('last').focus();
    await userEvent.tab();
    expect(button('first')).toHaveFocus();
  });

  it('wraps Shift+Tab from the first control to the last', async () => {
    render(<Dialog />);
    button('first').focus();
    await userEvent.tab({ shift: true });
    expect(button('last')).toHaveFocus();
  });

  it('takes Shift+Tab from the dialog itself to its last control', async () => {
    render(<Dialog />);
    screen.getByRole('dialog').focus();
    await userEvent.tab({ shift: true });
    expect(button('last')).toHaveFocus();
  });

  it('leaves the steps in between to the browser', async () => {
    render(<Dialog />);
    screen.getByRole('dialog').focus();
    await userEvent.tab();
    expect(button('first')).toHaveFocus();
    await userEvent.tab();
    expect(button('middle')).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(button('first')).toHaveFocus();
  });

  it('never lets Tab out, either way round', async () => {
    render(<Dialog />);
    screen.getByRole('dialog').focus();
    for (let i = 0; i < 7; i++) {
      await userEvent.tab();
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    }
    for (let i = 0; i < 7; i++) {
      await userEvent.tab({ shift: true });
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('holds focus on a dialog with nothing to tab to', async () => {
    render(<Dialog empty />);
    const dialog = screen.getByRole('dialog');
    dialog.focus();
    await userEvent.tab();
    expect(dialog).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(dialog).toHaveFocus();
  });

  it('leaves other keys, and Tab with a modifier, alone', () => {
    render(<Dialog />);
    const last = button('last');
    last.focus();
    for (const init of [
      { key: 'Enter' },
      { key: 'Tab', altKey: true },
      { key: 'Tab', ctrlKey: true },
      { key: 'Tab', metaKey: true },
    ]) {
      expect(fireEvent.keyDown(last, init)).toBe(true);
      expect(last).toHaveFocus();
    }
  });

  it('does nothing while turned off', async () => {
    render(<Dialog enabled={false} />);
    button('last').focus();
    await userEvent.tab();
    expect(button('after')).toHaveFocus();
  });

  it('stops listening once unmounted', () => {
    const { container, unmount } = render(<Dialog />);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const remove = vi.spyOn(dialog, 'removeEventListener');
    unmount();
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('copes with nothing to trap', () => {
    function Nothing() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(ref);
      return null;
    }
    expect(() => render(<Nothing />)).not.toThrow();
  });
});

function Opener({ removeOpener = false }: { removeOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!(removeOpener && open) && (
        <button type="button" onClick={() => setOpen(true)}>
          open
        </button>
      )}
      <button type="button" onClick={() => setOpen(false)}>
        close
      </button>
      {open && <Returner />}
    </>
  );
}

function Returner() {
  useReturnFocus();
  // Takes focus once mounted, as a dialog does.
  const inside = useRef<HTMLButtonElement>(null);
  useEffect(() => inside.current?.focus(), []);
  return (
    <button ref={inside} type="button">
      inside
    </button>
  );
}

describe('useReturnFocus', () => {
  it('hands focus back to what opened it', async () => {
    render(<Opener />);
    await userEvent.click(button('open'));
    expect(button('inside')).toHaveFocus();
    fireEvent.click(button('close'));
    expect(button('open')).toHaveFocus();
  });

  it("doesn't scroll the page to it", async () => {
    render(<Opener />);
    await userEvent.click(button('open'));
    const focus = vi.spyOn(button('open'), 'focus');
    fireEvent.click(button('close'));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('leaves focus alone when the opener has gone', async () => {
    render(<Opener removeOpener />);
    await userEvent.click(button('open'));
    expect(screen.queryByRole('button', { name: 'open' })).not.toBeInTheDocument();
    const close = button('close');
    close.focus();
    fireEvent.click(close);
    expect(close).toHaveFocus();
  });

  it('leaves focus alone when nothing had it', () => {
    const blur = vi.spyOn(document.body, 'focus');
    const { unmount } = render(<Returner />);
    // Focus came from the body, which isn't handed anything back.
    unmount();
    expect(blur).not.toHaveBeenCalled();
  });
});
