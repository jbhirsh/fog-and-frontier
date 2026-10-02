import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '../test/render';
import userEvent from '@testing-library/user-event';
import { ActivityReviews } from './ActivityReviews';
import type { ReviewSeed } from '../test/render';

// Owner reviews (#184). The data layer is stubbed so these assert presentation
// and the role gate: reviews read for everyone, write affordances rendered for
// owners only, and only on their own review.

const ownerState = vi.hoisted((): { isOwner: boolean; email: string | null } => ({
  isOwner: true,
  email: 'jess@example.com',
}));

vi.mock('../lib/useOwner', () => ({
  useOwner: () => ({
    isOwner: ownerState.isOwner,
    isLoaded: true,
    email: ownerState.email,
  }),
}));

const saveSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const deleteSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Forces the "first read hasn't landed yet" state, which the seeded test cache
// otherwise never produces.
const hookState = vi.hoisted(() => ({ loading: false }));

vi.mock('../lib/activityReviews', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/activityReviews')>(
      '../lib/activityReviews',
    );
  return {
    ...actual,
    saveActivityReview: saveSpy,
    deleteActivityReview: deleteSpy,
    useActivityReviews: (activityId: string) => {
      const result = actual.useActivityReviews(activityId);
      return hookState.loading ? { reviews: [], loading: true } : result;
    },
  };
});

function seed(over: Partial<ReviewSeed> = {}): ReviewSeed {
  return {
    activityId: 'a1',
    authorEmail: 'jess@example.com',
    rating: 5,
    note: 'Worth the early start.',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...over,
  };
}

const TARUN = seed({
  authorEmail: 'tarun@example.com',
  rating: 3,
  note: 'Too windy for me.',
  updatedAt: '2026-02-01T00:00:00.000Z',
});

function renderReviews(reviews: ReviewSeed[] = []) {
  return render(<ActivityReviews activityId="a1" />, { reviews });
}

// The stars are the visible rating: a filled glyph per star up to the rating.
function isFilled(icon: Element): boolean {
  return (icon as HTMLElement).style.fontVariationSettings === "'FILL' 1";
}

// A server call that stays in flight until the test settles it.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<undefined>((res) => {
    resolve = () => res(undefined);
  });
  return { promise, resolve };
}

beforeEach(() => {
  ownerState.isOwner = true;
  ownerState.email = 'jess@example.com';
  hookState.loading = false;
  saveSpy.mockClear();
  deleteSpy.mockClear();
});

describe('reading reviews', () => {
  it('shows both owners’ reviews with attribution, stars and note', async () => {
    renderReviews([seed(), TARUN]);
    await screen.findByText('Jess');
    expect(screen.getByText('Tarun')).toBeInTheDocument();
    expect(screen.getByText('Worth the early start.')).toBeInTheDocument();
    expect(screen.getByText('Too windy for me.')).toBeInTheDocument();
    expect(screen.getByLabelText('5 out of 5 stars')).toBeInTheDocument();
    expect(screen.getByLabelText('3 out of 5 stars')).toBeInTheDocument();
  });

  it('marks the signed-in owner’s own review', async () => {
    renderReviews([seed(), TARUN]);
    await screen.findByText('Jess');
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('marks only the signed-in owner’s own review as theirs', async () => {
    renderReviews([seed(), TARUN]);
    const own = (await screen.findByText('Jess')).closest('article');
    const theirs = screen.getByText('Tarun').closest('article');
    expect(own).toHaveTextContent('(you)');
    expect(theirs).not.toHaveTextContent('(you)');
  });

  it('fills as many stars as the rating', async () => {
    renderReviews([TARUN]);
    const stars = await screen.findByLabelText('3 out of 5 stars');
    const icons = Array.from(stars.children);
    expect(icons).toHaveLength(5);
    expect(icons.map(isFilled)).toEqual([true, true, true, false, false]);
  });

  it('shows no star rating on a note-only review', async () => {
    renderReviews([{ ...TARUN, rating: null }]);
    await screen.findByText('Too windy for me.');
    expect(screen.queryByLabelText(/out of 5 stars/)).not.toBeInTheDocument();
  });

  it('renders the note as its own paragraph', async () => {
    renderReviews([TARUN]);
    const article = (await screen.findByText('Tarun')).closest('article');
    expect(
      within(article as HTMLElement).getByRole('paragraph'),
    ).toHaveTextContent('Too windy for me.');
  });

  it('drops the empty-state line once there is a review', async () => {
    // An owner who hasn't reviewed yet still sees the other owner's review —
    // so there are reviews, and "no reviews yet" would be wrong.
    renderReviews([TARUN]);
    await screen.findByText('Tarun');
    expect(
      screen.getByRole('button', { name: /write a review/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no reviews yet/i)).not.toBeInTheDocument();
  });

  it('renders nothing at all for a non-owner when there are no reviews', () => {
    ownerState.isOwner = false;
    ownerState.email = null;
    const { container } = renderReviews([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing until the first read lands', () => {
    // An owner with a saved review must not be told there are none, and must
    // not be offered a write that the in-flight read would then overwrite.
    hookState.loading = true;
    const { container } = renderReviews([seed()]);
    expect(container).toBeEmptyDOMElement();
  });

  it('prompts an owner to write the first review', async () => {
    renderReviews([]);
    expect(
      await screen.findByRole('button', { name: /write a review/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no reviews yet/i)).toBeInTheDocument();
  });
});

describe('role gate', () => {
  it('shows a signed-out visitor the reviews as read-only content', async () => {
    ownerState.isOwner = false;
    ownerState.email = null;
    renderReviews([seed(), TARUN]);
    await screen.findByText('Jess');
    expect(screen.getByText('Worth the early start.')).toBeInTheDocument();
    // No write affordances rendered at all — hidden, not disabled (#67).
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('hides write affordances from a signed-in non-owner', async () => {
    ownerState.isOwner = false;
    ownerState.email = 'someone@example.com';
    renderReviews([seed()]);
    await screen.findByText('Jess');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers an owner an edit control only on their own review', async () => {
    renderReviews([seed(), TARUN]);
    const own = (await screen.findByText('Jess')).closest('article');
    const theirs = screen.getByText('Tarun').closest('article');
    expect(
      within(own as HTMLElement).getByRole('button', { name: /edit review/i }),
    ).toBeInTheDocument();
    expect(
      within(theirs as HTMLElement).queryByRole('button'),
    ).not.toBeInTheDocument();
  });

  it('does not offer "write a review" when the owner already has one', async () => {
    renderReviews([seed()]);
    await screen.findByText('Jess');
    expect(
      screen.queryByRole('button', { name: /write a review/i }),
    ).not.toBeInTheDocument();
  });
});

describe('writing a review', () => {
  it('saves a new rating and note', async () => {
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '4 stars' }));
    await userEvent.type(screen.getByRole('textbox'), 'Go back in spring.');
    await userEvent.click(screen.getByRole('button', { name: /save review/i }));
    expect(saveSpy).toHaveBeenCalledWith({
      activityId: 'a1',
      rating: 4,
      note: 'Go back in spring.',
    });
  });

  it('names the one-star choice in the singular', async () => {
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    expect(screen.getByRole('button', { name: '1 star' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 stars' })).toBeInTheDocument();
  });

  it('fills every star up to the chosen rating', async () => {
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '4 stars' }));
    const stars = within(screen.getByRole('group', { name: 'Rating' })).getAllByRole(
      'button',
    );
    expect(stars.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'true',
      'true',
      'true',
      'false',
    ]);
    expect(
      stars.map((b) => isFilled(b.firstElementChild as Element)),
    ).toEqual([true, true, true, true, false]);
  });

  it('pre-fills the editor from the existing review', async () => {
    renderReviews([seed()]);
    await userEvent.click(
      await screen.findByRole('button', { name: /edit review/i }),
    );
    expect(screen.getByRole('textbox')).toHaveValue('Worth the early start.');
    expect(screen.getByRole('button', { name: '5 stars' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('clears the rating when the active star is clicked again', async () => {
    renderReviews([seed()]);
    await userEvent.click(
      await screen.findByRole('button', { name: /edit review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '5 stars' }));
    expect(screen.getByRole('button', { name: '5 stars' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('refuses to save an empty review without calling the server', async () => {
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /save review/i }));
    expect(saveSpy).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /rating or a note/i,
    );
  });

  it('locks the editor while a save is in flight, then closes it', async () => {
    const save = deferred();
    saveSpy.mockReturnValueOnce(save.promise);
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '3 stars' }));
    await userEvent.click(screen.getByRole('button', { name: /save review/i }));
    expect(screen.getByRole('button', { name: /save review/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
    save.resolve();
    await waitFor(() =>
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument(),
    );
  });

  it('unlocks the editor after a failed save so it can be retried', async () => {
    saveSpy.mockRejectedValueOnce(new Error('network'));
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '3 stars' }));
    await userEvent.click(screen.getByRole('button', { name: /save review/i }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /save review/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled();
  });

  it('surfaces a failed save and keeps the draft open', async () => {
    saveSpy.mockRejectedValueOnce(new Error('network'));
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: '3 stars' }));
    await userEvent.click(screen.getByRole('button', { name: /save review/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't save your review/i,
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('dismisses the error banner', async () => {
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /save review/i }));
    await userEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cancels back to the card without saving', async () => {
    renderReviews([seed()]);
    await userEvent.click(
      await screen.findByRole('button', { name: /edit review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(saveSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Worth the early start.')).toBeInTheDocument();
  });

  it('deletes an existing review', async () => {
    renderReviews([seed()]);
    await userEvent.click(
      await screen.findByRole('button', { name: /edit review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /delete review/i }));
    expect(deleteSpy).toHaveBeenCalledWith('a1');
    await waitFor(() =>
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument(),
    );
  });

  it('surfaces a failed delete', async () => {
    deleteSpy.mockRejectedValueOnce(new Error('network'));
    renderReviews([seed()]);
    await userEvent.click(
      await screen.findByRole('button', { name: /edit review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /delete review/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn't delete your review/i,
    );
  });

  it('locks the editor while a delete is in flight', async () => {
    const del = deferred();
    deleteSpy.mockReturnValueOnce(del.promise);
    renderReviews([seed()]);
    await userEvent.click(
      await screen.findByRole('button', { name: /edit review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /delete review/i }));
    expect(screen.getByRole('button', { name: /delete review/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /save review/i })).toBeDisabled();
    del.resolve();
    await waitFor(() =>
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument(),
    );
  });

  it('unlocks the editor after a failed delete so it can be retried', async () => {
    deleteSpy.mockRejectedValueOnce(new Error('network'));
    renderReviews([seed()]);
    await userEvent.click(
      await screen.findByRole('button', { name: /edit review/i }),
    );
    await userEvent.click(screen.getByRole('button', { name: /delete review/i }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /delete review/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /save review/i })).toBeEnabled();
  });

  it('offers no delete control when writing a first review', async () => {
    renderReviews([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /write a review/i }),
    );
    expect(
      screen.queryByRole('button', { name: /delete review/i }),
    ).not.toBeInTheDocument();
  });
});
