import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { PendingSuggestion } from '../lib/suggestions';

const acceptSpy = vi.hoisted(() => vi.fn());
const rejectSpy = vi.hoisted(() => vi.fn());
const refreshSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/suggestions', () => ({
  acceptSuggestion: acceptSpy,
  rejectSuggestion: rejectSpy,
  refreshSuggestions: refreshSpy,
}));

import { PendingSuggestions } from './PendingSuggestions';

function suggestion(id: string, name: string, notes: string | null = null): PendingSuggestion {
  return {
    __typename: 'ActivitySuggestion',
    id,
    suggestedBy: 'sam.lee@example.com',
    suggestedAt: '2026-03-02T12:00:00.000Z',
    activity: {
      __typename: 'Activity',
      id,
      name,
      shortDescription: 'Bluffs and hang gliders',
      longDescription: null,
      category: 'scenic',
      location: { __typename: 'Location', city: 'San Francisco' },
      duration: 'Half Day',
      costTier: 'free',
      coverImage: '',
      allTrailsUrl: null,
      reservationUrl: null,
      menuUrl: null,
      notes,
    },
  } as PendingSuggestion;
}

const FF = suggestion('s1', 'Fort Funston', 'Great for dogs');
const LANDS_END = suggestion('s2', 'Lands End');

function duplicateError(message: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message, extensions: { code: 'CONFLICT', appCode: 'duplicate' } }],
  });
}

const DECIDED = new CombinedGraphQLErrors({
  errors: [{ message: 'no such pending suggestion', extensions: { code: 'NOT_FOUND' } }],
});

beforeEach(() => {
  acceptSpy.mockReset();
  rejectSpy.mockReset();
  acceptSpy.mockResolvedValue('fort-funston');
  rejectSpy.mockResolvedValue(undefined);
  refreshSpy.mockReset();
  refreshSpy.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PendingSuggestions (#73)', () => {
  it('renders nothing with no suggestions waiting', () => {
    const { container } = render(<PendingSuggestions suggestions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each with who suggested it, the count, and a way to fold it away', async () => {
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    const section = screen.getByRole('region', { name: /Waiting for review/ });
    const toggle = screen.getByRole('button', { name: 'Waiting for review 2' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The kind is spelled out, not left to CSS capitalize.
    expect(section).toHaveTextContent('San Francisco · Scenic · Half Day');
    expect(section).toHaveTextContent('Notes: Great for dogs');
    expect(screen.getAllByText(/Suggested by Sam/)).toHaveLength(2);
    expect(screen.getAllByText('Mar 2, 2026')[0]).toHaveAttribute(
      'datetime',
      '2026-03-02T12:00:00.000Z',
    );
    // Focusable from script only, so it can take focus as an item leaves.
    expect(screen.getByRole('heading', { name: /Waiting for review/ })).toHaveAttribute(
      'tabindex',
      '-1',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByText(/Notes:/)).toHaveLength(1);

    // The chevron is pulled out by its glyph's side bearing, either way up.
    const chevron = () => toggle.querySelector<HTMLElement>('.material-symbols-outlined');
    expect(chevron()).toHaveTextContent('expand_less');
    expect(chevron()?.style.marginLeft).toBe('-0.25em');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(chevron()).toHaveTextContent('expand_more');
    expect(chevron()?.style.marginLeft).toBe('-0.25em');
    await userEvent.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('accepts one, says so, and offers to open it', async () => {
    const onOpenActivity = vi.fn();
    const { rerender } = render(
      <PendingSuggestions suggestions={[FF, LANDS_END]} onOpenActivity={onOpenActivity} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    expect(acceptSpy).toHaveBeenCalledWith('s1', { allowDuplicate: false });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Added Fort Funston to the catalog.',
    );
    // Focus stays in the section as the accepted one leaves the list.
    expect(screen.getByRole('heading', { name: /Waiting for review/ })).toHaveFocus();
    rerender(<PendingSuggestions suggestions={[LANDS_END]} onOpenActivity={onOpenActivity} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(onOpenActivity).toHaveBeenCalledWith('fort-funston');
  });

  it('keeps the outcome showing after the last one leaves the queue', async () => {
    const { rerender } = render(<PendingSuggestions suggestions={[FF]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    await screen.findByText('Added Fort Funston to the catalog.');
    rerender(<PendingSuggestions suggestions={[]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Added Fort Funston to the catalog.');
    // No count or toggle for an empty queue.
    expect(
      screen.getByRole('heading', { name: 'Nothing else waiting for review' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Waiting for review/ })).not.toBeInTheDocument();
    // No way to open it without somewhere to open it.
    expect(screen.queryByRole('button', { name: 'Open it' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('holds a look-alike, then accepts anyway', async () => {
    acceptSpy.mockRejectedValueOnce(duplicateError('looks like a duplicate of Fort Funston'));
    render(<PendingSuggestions suggestions={[FF]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This looks like a duplicate of Fort Funston.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Accept anyway' }));
    expect(acceptSpy).toHaveBeenLastCalledWith('s1', { allowDuplicate: true });
    expect(await screen.findByText('Added Fort Funston to the catalog.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows why accepting failed, on that suggestion only', async () => {
    acceptSpy.mockRejectedValueOnce(new Error('Network down'));
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Network down');
    expect(screen.getAllByRole('listitem')[0]).toContainElement(alert);
    expect(screen.queryByRole('button', { name: 'Accept anyway' })).not.toBeInTheDocument();
  });

  it('falls back to a plain message for a non-Error failure', async () => {
    acceptSpy.mockRejectedValueOnce('nope');
    rejectSpy.mockRejectedValueOnce('nope');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    expect(await screen.findByText('Failed to accept')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reject Lands End' }));
    expect(await screen.findByText('Failed to reject')).toBeInTheDocument();
  });

  it('locks every button while one is being decided', async () => {
    let finish: (id: string) => void = () => {};
    acceptSpy.mockReturnValueOnce(new Promise<string>((r) => (finish = r)));
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    for (const b of screen.getAllByRole('button', { name: /^(Accept|Reject)/ })) {
      expect(b).toBeDisabled();
    }
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('listitem')[1]).toHaveAttribute('aria-busy', 'false');
    finish('fort-funston');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Accept Lands End' })).toBeEnabled(),
    );
  });

  it('rejects only once confirmed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    render(<PendingSuggestions suggestions={[FF]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject Fort Funston' }));
    expect(confirm).toHaveBeenCalledWith(
      'Reject "Fort Funston"? It leaves the queue and isn\'t added.',
    );
    expect(rejectSpy).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('button', { name: 'Reject Fort Funston' }));
    expect(rejectSpy).toHaveBeenCalledWith('s1');
    expect(await screen.findByRole('status')).toHaveTextContent('Rejected Fort Funston.');
    expect(screen.queryByRole('button', { name: 'Open it' })).not.toBeInTheDocument();
  });

  it("clears one suggestion's error without touching another's", async () => {
    acceptSpy
      .mockRejectedValueOnce(new Error('First down'))
      .mockRejectedValueOnce(new Error('Second down'));
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    await screen.findByText('First down');
    await userEvent.click(screen.getByRole('button', { name: 'Accept Lands End' }));
    await screen.findByText('Second down');
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    await screen.findByText('Added Fort Funston to the catalog.');
    expect(screen.queryByText('First down')).not.toBeInTheDocument();
    expect(screen.getByText('Second down')).toBeInTheDocument();
  });

  it('locks every button while one is being rejected', async () => {
    let finish: () => void = () => {};
    rejectSpy.mockReturnValueOnce(new Promise<void>((r) => (finish = r)));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject Fort Funston' }));
    for (const b of screen.getAllByRole('button', { name: /^(Accept|Reject)/ })) {
      expect(b).toBeDisabled();
    }
    finish();
    await screen.findByText('Rejected Fort Funston.');
  });

  it('clears an earlier error when trying again', async () => {
    rejectSpy.mockRejectedValueOnce(new Error('Network down'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PendingSuggestions suggestions={[FF]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reject Fort Funston' }));
    expect(await screen.findByText('Network down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reject Fort Funston' }));
    await screen.findByText('Rejected Fort Funston.');
    expect(screen.queryByText('Network down')).not.toBeInTheDocument();
  });

  it('brings the lists up to date when someone else decided it first', async () => {
    acceptSpy.mockRejectedValueOnce(DECIDED);
    rejectSpy.mockRejectedValueOnce(DECIDED);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Fort Funston was already decided.',
    );
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reject Lands End' }));
    expect(await screen.findByText('Lands End was already decided.')).toBeInTheDocument();
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still says so when that refresh fails', async () => {
    acceptSpy.mockRejectedValueOnce(DECIDED);
    refreshSpy.mockRejectedValueOnce(new Error('offline'));
    render(<PendingSuggestions suggestions={[FF]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    expect(await screen.findByText('Fort Funston was already decided.')).toBeInTheDocument();
  });

  it('clears the last outcome when deciding the next', async () => {
    let finish: (id: string) => void = () => {};
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    await screen.findByText('Added Fort Funston to the catalog.');
    acceptSpy.mockReturnValueOnce(new Promise<string>((r) => (finish = r)));
    await userEvent.click(screen.getByRole('button', { name: 'Accept Lands End' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    finish('lands-end');
    await screen.findByText('Added Lands End to the catalog.');
  });

  it('locks "Accept anyway" too while another is being decided', async () => {
    acceptSpy.mockRejectedValueOnce(duplicateError('looks like a duplicate of Fort Funston'));
    render(<PendingSuggestions suggestions={[FF, LANDS_END]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept Fort Funston' }));
    const anyway = await screen.findByRole('button', { name: 'Accept anyway' });
    acceptSpy.mockReturnValueOnce(new Promise<string>(() => {}));
    await userEvent.click(screen.getByRole('button', { name: 'Accept Lands End' }));
    expect(anyway).toBeDisabled();
  });

  describe('shown on request (#259)', () => {
    let scroll: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      // jsdom has no scrollIntoView.
      scroll = vi.fn();
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        value: scroll,
        writable: true,
        configurable: true,
      });
    });
    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('does nothing until asked', () => {
      const onRevealed = vi.fn();
      render(<PendingSuggestions suggestions={[FF]} onRevealed={onRevealed} />);
      expect(scroll).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { name: /Waiting for review/ })).not.toHaveFocus();
      expect(onRevealed).not.toHaveBeenCalled();
    });

    it('unfolds, scrolls into view and takes focus, then says it has', async () => {
      const onRevealed = vi.fn();
      const { rerender } = render(
        <PendingSuggestions suggestions={[FF]} onRevealed={onRevealed} />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Waiting for review 1' }));
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument();

      rerender(<PendingSuggestions suggestions={[FF]} reveal onRevealed={onRevealed} />);
      expect(screen.getByRole('button', { name: 'Waiting for review 1' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByRole('listitem')).toHaveTextContent('Fort Funston');
      const section = screen.getByRole('region', { name: /Waiting for review/ });
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(section);
      expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
      expect(screen.getByRole('heading', { name: /Waiting for review/ })).toHaveFocus();
      expect(onRevealed).toHaveBeenCalledTimes(1);
    });

    it('copes with being asked when nothing is waiting', () => {
      const onRevealed = vi.fn();
      const { container } = render(
        <PendingSuggestions suggestions={[]} reveal onRevealed={onRevealed} />,
      );
      expect(container).toBeEmptyDOMElement();
      expect(scroll).not.toHaveBeenCalled();
      expect(onRevealed).toHaveBeenCalledTimes(1);
    });

    it("doesn't let focus scroll the page as well", () => {
      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      render(<PendingSuggestions suggestions={[FF]} reveal />);
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    });

    it('clears the way below the header and the sticky toolbar', () => {
      render(<PendingSuggestions suggestions={[FF]} />);
      expect(screen.getByRole('region', { name: /Waiting for review/ })).toHaveClass(
        'scroll-mt-40',
        'md:scroll-mt-52',
      );
    });
  });
});
