import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../test/render';
import userEvent from '@testing-library/user-event';
import { ActivityCard } from './ActivityCard';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';

describe('ActivityCard', () => {
  it('renders core fields', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.getByRole('heading', { name: 'Test Muir Woods' })).toBeInTheDocument();
    expect(screen.getByText(/^Half Day · \S+ mi$/)).toBeInTheDocument();
    // The photo carries the facts; the description, category and contributors
    // are the place's page's.
    expect(screen.queryByText('Short redwoods description.')).not.toBeInTheDocument();
    expect(screen.queryByText('HIKING')).not.toBeInTheDocument();
  });

  it('does not render difficulty (it lives in the detail view, not the card)', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('moderate')).not.toBeInTheDocument();
  });

  it('credits no one on the card, contributors or not (#9)', () => {
    render(<ActivityCard activity={{ ...muirWoods, contributors: ['tarun@example.com'] }} />);
    expect(screen.queryByText(/Contributed by/)).not.toBeInTheDocument();
  });

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<ActivityCard activity={muirWoods} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('exposes data-activity-id on the root for scroll-into-view (#94)', () => {
    const { container } = render(<ActivityCard activity={muirWoods} />);
    expect(container.querySelector(`[data-activity-id="${muirWoods.id}"]`)).toBeInTheDocument();
  });

  it('fires onHoverChange on pointer enter/leave (#94)', async () => {
    const onHoverChange = vi.fn();
    render(<ActivityCard activity={muirWoods} onHoverChange={onHoverChange} />);
    const button = screen.getByRole('button');
    await userEvent.hover(button);
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    await userEvent.unhover(button);
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
  });

  it('fires onHoverChange on keyboard focus/blur (#94)', () => {
    const onHoverChange = vi.fn();
    render(<ActivityCard activity={muirWoods} onHoverChange={onHoverChange} />);
    const button = screen.getByRole('button');
    act(() => button.focus());
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
    act(() => button.blur());
    expect(onHoverChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps the highlight while focused even as the mouse leaves (#94)', async () => {
    const onHoverChange = vi.fn();
    render(<ActivityCard activity={muirWoods} onHoverChange={onHoverChange} />);
    const button = screen.getByRole('button');
    act(() => button.focus()); // keyboard focus → highlight on
    await userEvent.hover(button);
    await userEvent.unhover(button); // mouse leaves, but focus remains
    expect(onHoverChange).toHaveBeenLastCalledWith(true);
  });

  it('outlines the cover when highlighted by a hovered pin (#94)', () => {
    const { container, rerender } = render(<ActivityCard activity={muirWoods} />);
    expect(container.querySelector('.outline-2')).toBeNull();
    rerender(<ActivityCard activity={muirWoods} highlighted />);
    expect(container.querySelector('.outline-2')).not.toBeNull();
  });

  it('falls back to the category glyph when the cover fails to load (#120)', () => {
    const { container } = render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('directions_walk')).not.toBeInTheDocument();
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('directions_walk')).toBeInTheDocument();
  });

  it('shows the AllTrails rating on the photo, once', () => {
    const { rerender } = render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('star')).not.toBeInTheDocument();
    rerender(<ActivityCard activity={{ ...muirWoods, allTrailsRating: 4.7 }} />);
    expect(screen.getAllByText('4.7')).toHaveLength(1);
  });

  it('renders an actionSlot overlay', () => {
    render(<ActivityCard activity={muirWoods} actionSlot={<button type="button">Trip</button>} />);
    expect(screen.getByRole('button', { name: 'Trip' })).toBeInTheDocument();
  });

  it('shows both the completed check and the actionSlot without dropping either', () => {
    render(
      <ActivityCard activity={completedHike} actionSlot={<button type="button">Trip</button>} />,
    );
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trip' })).toBeInTheDocument();
  });

  describe('at every width (#290)', () => {
    it('lays the time and distance on the photo, short', () => {
      render(<ActivityCard activity={muirWoods} />);
      const facts = screen.getByText(/· \S+ mi$/);
      expect(facts.textContent).toMatch(/^Half Day · \S+ mi$/);
      expect(facts.closest('[class*="md:"]')).toBeNull();
    });

    it('marks a free place with a Free pill, unless selecting', () => {
      const { rerender } = render(<ActivityCard activity={muirWoods} />);
      expect(screen.queryByText('Free')).not.toBeInTheDocument();
      rerender(<ActivityCard activity={{ ...muirWoods, costTier: 'free' }} />);
      expect(screen.getByText('Free')).toHaveClass('leading-[22px]');
      rerender(<ActivityCard activity={{ ...muirWoods, costTier: 'free' }} selectionMode />);
      expect(screen.queryByText('Free')).not.toBeInTheDocument();
      rerender(<ActivityCard activity={{ ...muirWoods, costTier: '$' }} />);
      expect(screen.queryByText('Free')).not.toBeInTheDocument();
    });

    it('badges a place that welcomes dogs, and no other', () => {
      const { rerender } = render(<ActivityCard activity={muirWoods} />);
      expect(screen.queryByRole('img', { name: 'Dogs welcome' })).not.toBeInTheDocument();
      rerender(<ActivityCard activity={dogFriendlyTidepools} />);
      expect(screen.getByRole('img', { name: 'Dogs welcome' })).toHaveClass('size-5.5');
      // The place's page says the rest; there's no "Dog OK" line.
      expect(screen.queryByText('Dog OK')).not.toBeInTheDocument();
    });

    it('shows the card line whole in place of the short description', () => {
      const { rerender } = render(<ActivityCard activity={muirWoods} />);
      expect(screen.queryByText('Redwoods in a quiet canyon.')).not.toBeInTheDocument();
      rerender(
        <ActivityCard activity={{ ...muirWoods, cardLine: 'Redwoods in a quiet canyon.' }} />,
      );
      const line = screen.getByText('Redwoods in a quiet canyon.');
      expect(line.className).not.toMatch(/line-clamp|truncate|hidden/);
    });

    it('shows the card name for a long name', () => {
      render(
        <ActivityCard
          activity={{
            ...muirWoods,
            name: 'Castle Rock State Park (Saratoga Gap & Ridge Loop)',
            cardName: 'Castle Rock State Park',
          }}
        />,
      );
      expect(screen.getByRole('heading', { name: 'Castle Rock State Park' })).toBeInTheDocument();
      expect(
        screen.queryByText('Castle Rock State Park (Saratoga Gap & Ridge Loop)'),
      ).not.toBeInTheDocument();
    });

    it('wraps the name rather than cutting it off', () => {
      render(<ActivityCard activity={muirWoods} />);
      const heading = screen.getByRole('heading', { name: 'Test Muir Woods' });
      expect(heading.className).not.toMatch(/truncate|line-clamp/);
      expect(heading).toHaveClass('leading-snug');
    });

    it('shows a completed place by its check, named for screen readers', () => {
      render(<ActivityCard activity={completedHike} />);
      expect(screen.queryByText('COMPLETED')).not.toBeInTheDocument();
      expect(screen.getByText('Completed')).toHaveClass('sr-only');
      expect(screen.getByText('check')).toBeInTheDocument();
    });

    it('sits the dog beside the check, the same size, the check in the corner', () => {
      render(<ActivityCard activity={{ ...completedHike, dogFriendly: true }} />);
      const dog = screen.getByRole('img', { name: 'Dogs welcome' });
      const done = screen.getByText('Completed').parentElement;
      // One row, so the dog doesn't push the check down, with the check last.
      expect(dog.parentElement).toBe(done?.parentElement);
      expect(dog.parentElement).toHaveClass('flex', 'items-center');
      expect(dog.parentElement?.lastElementChild).toBe(done);
      expect(dog).toHaveClass('size-5.5');
      expect(done).toHaveClass('size-5.5');
    });

    it('draws a park as a stack, its count a button on the photo', async () => {
      const onToggle = vi.fn();
      const { rerender } = render(
        <ActivityCard
          activity={{ ...completedHike, dogFriendly: true }}
          stack={{
            count: 4,
            open: false,
            onToggle,
            id: 'park-bar-x',
            covers: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
          }}
        />,
      );
      const count = screen.getByRole('button', {
        name: `4 hikes & stops in ${completedHike.name}`,
      });
      expect(count).toHaveAttribute('id', 'park-bar-x');
      expect(count).toHaveAttribute('aria-expanded', 'false');
      expect(count).not.toHaveAttribute('aria-controls');
      expect(count).toHaveClass('bg-primary', 'h-5.5');
      // First in the corner's row: the check keeps the corner.
      const row = count.parentElement;
      expect(row?.firstElementChild).toBe(count);
      expect(row?.lastElementChild).toBe(screen.getByText('Completed').parentElement);
      expect(row?.parentElement).toHaveClass('right-6');
      // The photo fills a box the stack's edges fan out from.
      const box = document.querySelector('.pr-4');
      expect(box).toHaveClass('relative', 'aspect-4/3');
      // Two of its places, as the cards behind it, back to front.
      const behind = box?.querySelectorAll(':scope > span[aria-hidden="true"]');
      expect(behind).toHaveLength(2);
      expect(
        Array.from(behind ?? []).map((el) => el.querySelector('img')?.getAttribute('src')),
      ).toEqual(['https://example.com/b.jpg', 'https://example.com/a.jpg']);
      expect(behind?.[0]).toHaveClass('ring-2', 'ring-surface');
      await userEvent.click(count);
      expect(onToggle).toHaveBeenCalledOnce();
      rerender(
        <ActivityCard
          activity={completedHike}
          stack={{ count: 4, open: true, onToggle, id: 'park-bar-x', controls: 'park-x' }}
        />,
      );
      expect(count).toHaveAttribute('aria-expanded', 'true');
      expect(count).toHaveAttribute('aria-controls', 'park-x');
      expect(count).toHaveClass('bg-primary-fixed');
    });

    it('draws any other card flat, its photo 4:3', () => {
      render(<ActivityCard activity={completedHike} />);
      expect(screen.queryByRole('button', { name: /hikes & stops/ })).not.toBeInTheDocument();
      expect(document.querySelector('.pr-4')).toBeNull();
      expect(document.querySelector('.aspect-4\\/3')).not.toBeNull();
    });

    it('puts the selection check at the top left, clear of the facts', () => {
      render(<ActivityCard activity={muirWoods} selectionMode selected />);
      const check = screen.getByText('check').parentElement;
      expect(check).toHaveClass('top-base', 'left-base');
      expect(check?.className).not.toMatch(/md:/);
    });
  });
});
