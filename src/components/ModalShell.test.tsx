import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalShell } from './ModalShell';

describe('ModalShell', () => {
  it('is a dialog named by its title, holding what it’s given', () => {
    render(
      <ModalShell title="Reopen voting?" onCancel={() => {}}>
        <p>Votes are kept.</p>
      </ModalShell>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Reopen voting?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Reopen voting?' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Votes are kept.');
  });

  it('closes from its backdrop', async () => {
    const onCancel = vi.fn();
    render(
      <ModalShell title="Members" onCancel={onCancel}>
        <p>x</p>
      </ModalShell>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('takes focus, keeps Tab inside, closes on Escape, and gives focus back', async () => {
    const onCancel = vi.fn();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <ModalShell title="Members" onCancel={onCancel}>
        <button type="button">Only</button>
      </ModalShell>,
    );
    expect(screen.getByRole('dialog')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Only' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Only' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('stops listening for Escape once closed', async () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <ModalShell title="Members" onCancel={onCancel}>
        <p>x</p>
      </ModalShell>,
    );
    unmount();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });
});
