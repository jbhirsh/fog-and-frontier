import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../test/render';
import userEvent from '@testing-library/user-event';
import { ActivityCard } from './ActivityCard';
import { completedHike, dogFriendlyTidepools, muirWoods } from '../test/fixtures';

describe('ActivityCard', () => {
  it('renders core fields', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.getByText('Test Muir Woods')).toBeInTheDocument();
    expect(screen.getByText('Short redwoods description.')).toBeInTheDocument();
    expect(screen.getByText('Half Day')).toBeInTheDocument();
    expect(screen.getByText('HIKING')).toBeInTheDocument();
  });

  it('shows the whole short description, wrapped, under a 3:2 photo from md up (#269)', () => {
    render(<ActivityCard activity={muirWoods} />);
    const description = screen.getByText('Short redwoods description.');
    expect(description.className).not.toMatch(/line-clamp|truncate/);
    expect(description).toHaveClass('hidden', 'md:block');
    expect(document.querySelector('.md\\:aspect-3\\/2')).not.toBeNull();
  });

  it('does not render difficulty (it lives in the detail view, not the card)', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('moderate')).not.toBeInTheDocument();
  });

  it('shows a distance label computed from home', () => {
    render(<ActivityCard activity={muirWoods} />);
    expect(screen.getByText(/\d+\s*mi from San Jose/)).toBeInTheDocument();
  });

  it('renders the dog-friendly meta only when applicable', () => {
    const { rerender } = render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('Dog OK')).not.toBeInTheDocument();
    rerender(<ActivityCard activity={dogFriendlyTidepools} />);
    expect(screen.getByText('Dog OK')).toBeInTheDocument();
  });

  it('renders the completed badge only when activity.completed is true', () => {
    const { rerender } = render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText('COMPLETED')).not.toBeInTheDocument();
    rerender(<ActivityCard activity={completedHike} />);
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
  });

  it('credits contributors only when the activity carries them (#9)', () => {
    const { rerender } = render(<ActivityCard activity={muirWoods} />);
    expect(screen.queryByText(/Contributed by/)).not.toBeInTheDocument();
    rerender(
      <ActivityCard
        activity={{
          ...muirWoods,
          contributors: ['tarun@example.com', 'jess.hirsh@example.com', 'c@example.com'],
        }}
      />,
    );
    expect(screen.getByText('Contributed by Tarun, Jess Hirsh +1')).toBeInTheDocument();
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
    // Only the category pill carries the glyph while the cover loads.
    expect(screen.getAllByText('directions_walk')).toHaveLength(1);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('directions_walk')).toHaveLength(2);
  });

  it('shows the AllTrails rating when present, on the photo for a phone and beside the name wider', () => {
    render(<ActivityCard activity={{ ...muirWoods, allTrailsRating: 4.7 }} />);
    const [onPhoto, besideName] = screen.getAllByText('4.7');
    expect(onPhoto.closest('.md\\:hidden')).not.toBeNull();
    expect(besideName).toHaveClass('hidden', 'md:flex');
  });

  it('renders an actionSlot overlay', () => {
    render(<ActivityCard activity={muirWoods} actionSlot={<button type="button">Trip</button>} />);
    expect(screen.getByRole('button', { name: 'Trip' })).toBeInTheDocument();
  });

  it('shows both the completed badge and the actionSlot without dropping either', () => {
    render(
      <ActivityCard activity={completedHike} actionSlot={<button type="button">Trip</button>} />,
    );
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trip' })).toBeInTheDocument();
  });

  describe('on a phone (#290)', () => {
    it('lays the time and distance on the photo, short', () => {
      render(<ActivityCard activity={muirWoods} />);
      const facts = screen.getByText(/· \S+ mi$/);
      expect(facts.textContent).toMatch(/^Half Day · \S+ mi$/);
      expect(facts.closest('.md\\:hidden')).not.toBeNull();
    });

    it('marks a free place with a Free pill, unless selecting', () => {
      const { rerender } = render(<ActivityCard activity={muirWoods} />);
      expect(screen.queryByText('Free')).not.toBeInTheDocument();
      rerender(<ActivityCard activity={{ ...muirWoods, costTier: 'free' }} />);
      expect(screen.getByText('Free')).toHaveClass('md:hidden');
      rerender(<ActivityCard activity={{ ...muirWoods, costTier: 'free' }} selectionMode />);
      expect(screen.queryByText('Free')).not.toBeInTheDocument();
      rerender(<ActivityCard activity={{ ...muirWoods, costTier: '$' }} />);
      expect(screen.queryByText('Free')).not.toBeInTheDocument();
    });

    it('badges a place that welcomes dogs, and no other', () => {
      const { rerender } = render(<ActivityCard activity={muirWoods} />);
      expect(screen.queryByRole('img', { name: 'Dogs welcome' })).not.toBeInTheDocument();
      rerender(<ActivityCard activity={dogFriendlyTidepools} />);
      expect(screen.getByRole('img', { name: 'Dogs welcome' })).toHaveClass('md:hidden');
    });

    it('shows the card line whole in place of the short description', () => {
      const { rerender } = render(<ActivityCard activity={muirWoods} />);
      expect(screen.queryByText('Redwoods in a quiet canyon.')).not.toBeInTheDocument();
      rerender(
        <ActivityCard activity={{ ...muirWoods, cardLine: 'Redwoods in a quiet canyon.' }} />,
      );
      const line = screen.getByText('Redwoods in a quiet canyon.');
      expect(line).toHaveClass('md:hidden');
      expect(line.className).not.toMatch(/line-clamp|truncate/);
    });

    it('shows the card name for a long name, and the name whole wider up', () => {
      render(
        <ActivityCard
          activity={{
            ...muirWoods,
            name: 'Castle Rock State Park (Saratoga Gap & Ridge Loop)',
            cardName: 'Castle Rock State Park',
          }}
        />,
      );
      expect(screen.getByText('Castle Rock State Park')).toHaveClass('md:hidden');
      expect(screen.getByText('Castle Rock State Park (Saratoga Gap & Ridge Loop)')).toHaveClass(
        'hidden',
        'md:inline',
      );
    });

    it('wraps the name rather than cutting it off', () => {
      render(<ActivityCard activity={muirWoods} />);
      const heading = screen.getByRole('heading', { name: 'Test Muir Woods' });
      expect(heading.className.split(' ')).not.toContain('truncate');
      expect(heading).toHaveClass('md:truncate');
      // A phone's tighter leading for the wrapped name; wider up, as before.
      expect(heading).toHaveClass('leading-snug', 'md:leading-normal');
    });

    it('shows a completed place by its check, named for screen readers', () => {
      render(<ActivityCard activity={completedHike} />);
      expect(screen.getByText('COMPLETED')).toHaveClass('hidden', 'md:inline');
      expect(screen.getByText('Completed')).toHaveClass('sr-only', 'md:hidden');
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
      expect(done).toHaveClass('size-5.5', 'md:size-auto');
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
      expect(check).toHaveClass('top-base', 'left-base', 'md:bottom-sm', 'md:left-sm');
    });
  });
});
