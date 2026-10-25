import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TrailPicker, type TrailOption } from './TrailPicker';

const T = 'https://www.alltrails.com/trail/us/california/';
const PICK: TrailOption = {
  url: `${T}alamere-falls-via-coast-trail-from-palomarin-trailhead`,
  title: 'Alamere Falls via Coast Trail from Palomarin Trailhead',
  description: 'Head out on this 8.4-mile out-and-back trail near Bolinas.',
  image: 'https://images.alltrails.com/pick.jpg',
  rating: 4.7,
  reviews: 6412,
  miles: 8.4,
  feet: 1640,
};
const BEAR_VALLEY: TrailOption = {
  url: `${T}alamere-falls-and-wildcat-camp-via-bear-valley-trail`,
  title: 'Alamere Falls and Wildcat Camp via Bear Valley Trail',
  description: 'Explore this 13.4-mile out-and-back trail near Olema.',
};
const WILDCAT: TrailOption = {
  url: `${T}wildcat-camp-trail-to-alamere-falls`,
  title: 'Wildcat Camp Trail to Alamere Falls',
  description: '',
  image: 'https://images.alltrails.com/wildcat.jpg',
  miles: 5.6,
};
const OPTIONS = [PICK, BEAR_VALLEY, WILDCAT];

/** The picker under a field it changes, as the form holds it. */
function Field({ start, options = OPTIONS }: { start?: string; options?: TrailOption[] }) {
  const [url, setUrl] = useState(start);
  return (
    <>
      <output aria-label="url">{url ?? ''}</output>
      <TrailPicker url={url} options={options} onChoose={(t) => setUrl(t.url)} />
    </>
  );
}

const views = () => screen.queryAllByRole('link', { name: 'View on AllTrails ↗' });

describe('TrailPicker', () => {
  it('draws the trail in use as a card: picture, name, numbers, description and View', () => {
    const { container } = render(<Field start={PICK.url} />);
    expect(screen.getByText(PICK.title)).toBeInTheDocument();
    expect(screen.getByText(PICK.description)).toBeInTheDocument();
    expect(screen.getByText('★ 4.7 (6,412)')).toBeInTheDocument();
    // Each kept whole on its line, the ones after the first after a dot.
    const numbers = screen.getByText('★ 4.7 (6,412)').parentElement!;
    expect([...numbers.children].map((n) => n.textContent)).toEqual([
      '★ 4.7 (6,412)',
      '· 8.4 mi',
      '· 1,640 ft gain',
    ]);
    expect([...numbers.children].every((n) => n.classList.contains('whitespace-nowrap'))).toBe(
      true,
    );
    const view = screen.getByRole('link', { name: 'View on AllTrails ↗' });
    expect(view).toHaveAttribute('href', PICK.url);
    expect(view).toHaveAttribute('title', PICK.url);
    // Opens AllTrails beside the form, without giving it a handle on the app.
    expect(view).toHaveAttribute('target', '_blank');
    expect(view).toHaveAttribute('rel', 'noopener noreferrer');
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', PICK.image);
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('loading', 'lazy');
    // The numbers under the picture on a phone, beside it on a wide screen.
    expect(numbers).toHaveClass('col-span-full', 'sm:col-span-1', 'sm:col-start-2');
    expect(img).toHaveClass('sm:row-span-2');
    // No list until asked for.
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('keeps the others behind "Not the right trail?"', () => {
    render(<Field start={PICK.url} />);
    const toggle = screen.getByRole('button', { name: 'Not the right trail? See 2 others ▾' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(BEAR_VALLEY.title)).toBeNull();
    expect(views()).toHaveLength(1);
  });

  it('opens onto every trail to pick one, the one in use picked, each with View', async () => {
    const user = userEvent.setup();
    render(<Field start={PICK.url} />);
    await user.click(screen.getByRole('button', { name: /Not the right trail/ }));
    const list = screen.getByRole('group', { name: 'AllTrails trails' });
    const radios = within(list).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      PICK.url,
      BEAR_VALLEY.url,
      WILDCAT.url,
    ]);
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([true, false, false]);
    // One group, so one pick.
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1);
    // Each named by its trail alone, and its card ringed when it has the keyboard's focus.
    expect(within(list).getByRole('radio', { name: BEAR_VALLEY.title })).toBe(radios[1]);
    expect(radios[1]?.closest('label')).toHaveClass(
      'has-focus-visible:ring-2',
      'has-focus-visible:ring-primary-container',
    );
    expect(views().map((a) => a.getAttribute('href'))).toEqual([
      PICK.url,
      BEAR_VALLEY.url,
      WILDCAT.url,
    ]);
    // The one in use is outlined and says so; the others offer themselves.
    expect(radios[0]?.closest('label')).toHaveClass('border-primary');
    expect(radios[1]?.closest('label')).toHaveClass('border-transparent');
    expect(within(radios[0].closest('label')!).getByText('✓ Selected')).toBeInTheDocument();
    expect(within(list).getAllByText('Select')).toHaveLength(2);
    const toggle = screen.getByRole('button', { name: 'Done ▴' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('picks the trail clicked, anywhere on it', async () => {
    const user = userEvent.setup();
    render(<Field start={PICK.url} />);
    await user.click(screen.getByRole('button', { name: /Not the right trail/ }));
    await user.click(screen.getByText(BEAR_VALLEY.description));
    expect(screen.getByLabelText('url')).toHaveTextContent(BEAR_VALLEY.url);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).checked)).toEqual([false, true, false]);
    // The list stays as it was, so nothing jumps; closed, the card is the new pick.
    await user.click(screen.getByRole('button', { name: 'Done ▴' }));
    expect(screen.getByText(BEAR_VALLEY.title)).toBeInTheDocument();
    expect(screen.queryByText(PICK.title)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Not the right trail? See 2 others ▾' }),
    ).toBeInTheDocument();
  });

  it('says how many others, one or more', () => {
    render(<Field start={PICK.url} options={[PICK, WILDCAT]} />);
    expect(
      screen.getByRole('button', { name: 'Not the right trail? See 1 other ▾' }),
    ).toBeInTheDocument();
  });

  it('names a link typed by hand from its address, and lists it first with the others', async () => {
    const user = userEvent.setup();
    for (const [link, name] of [
      [`${T}mission-peak-trail--2`, 'Mission peak trail'],
      ['https://alltrails.com/trail/us/california/x', 'X'],
      ['https://www.alltrails.com/', 'AllTrails page'],
      [` http://www.alltrails.com/trail/us/oregon/multnomah-falls `, 'Multnomah falls'],
    ] as const) {
      const { unmount } = render(<Field start={link} options={[]} />);
      expect(screen.getByText(name), link).toBeInTheDocument();
      expect(screen.getByRole('link')).toHaveAttribute('href', new URL(link.trim()).href);
      // Nothing else was found.
      expect(screen.queryByRole('button')).toBeNull();
      unmount();
    }
    render(<Field start={`${T}mission-peak-trail`} options={[PICK]} />);
    await user.click(screen.getByRole('button', { name: 'Not the right trail? See 1 other ▾' }));
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      `${T}mission-peak-trail`,
      PICK.url,
    ]);
    // Selecting another keeps it in the list, to go back to.
    await user.click(screen.getByText(PICK.title));
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).checked)).toEqual([
      false,
      true,
    ]);
    await user.click(screen.getByText('Mission peak trail'));
    expect(screen.getByLabelText('url')).toHaveTextContent(`${T}mission-peak-trail`);
    // Closed and opened again, it's still there.
    await user.click(screen.getByRole('button', { name: 'Done ▴' }));
    await user.click(screen.getByRole('button', { name: /Not the right trail/ }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('draws no card for an empty field, or one that isn’t an AllTrails page', () => {
    for (const link of [
      undefined,
      '',
      'alltrails',
      'https://example.com/trail/x',
      'https://notalltrails.com/trail/x',
      'javascript://www.alltrails.com/%0aalert(1)',
      'ftp://www.alltrails.com/trail/x',
    ]) {
      const { unmount } = render(<Field start={link} options={[]} />);
      expect(views(), String(link)).toHaveLength(0);
      unmount();
    }
  });

  it('offers what the search found when there’s no trail in the field', async () => {
    const user = userEvent.setup();
    render(<Field options={OPTIONS} />);
    expect(views()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Pick from 3 trails it found ▾' }));
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
    await user.click(screen.getByText(WILDCAT.title));
    expect(screen.getByLabelText('url')).toHaveTextContent(WILDCAT.url);
  });

  it('says one trail when it found one', () => {
    render(<Field options={[WILDCAT]} />);
    expect(
      screen.getByRole('button', { name: 'Pick from 1 trail it found ▾' }),
    ).toBeInTheDocument();
  });

  it('lays a card out by what it has', () => {
    // No picture: the name and numbers take the whole row.
    render(<Field start={WILDCAT.url} options={[{ ...WILDCAT, image: undefined }]} />);
    const numbers = screen.getByText('5.6 mi').parentElement!;
    expect(numbers.parentElement).toHaveClass('grid-cols-1');
    expect(numbers).not.toHaveClass('sm:col-start-2');
    // Nor any line for a description it hasn't got.
    expect(document.querySelectorAll('p')).toHaveLength(0);
  });

  it('drops a picture that doesn’t load, keeping the card', () => {
    const { container } = render(<Field start={PICK.url} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(PICK.title)).toBeInTheDocument();
    expect(screen.getByText('★ 4.7 (6,412)').parentElement).not.toHaveClass('sm:col-start-2');
  });

  it('calls onChoose with the trail picked', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<TrailPicker url={PICK.url} options={OPTIONS} onChoose={onChoose} />);
    await user.click(screen.getByRole('button', { name: /Not the right trail/ }));
    await user.click(screen.getAllByRole('radio')[2]);
    // The whole trail, numbers and all, for the form to take them with it.
    expect(onChoose).toHaveBeenCalledWith(WILDCAT);
  });
});
