import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TripIdea } from '../lib/tripIdeas';

const suggestSpy = vi.hoisted(() => vi.fn());
vi.mock('../lib/tripIdeas', () => ({ suggestTripActivities: suggestSpy }));

import { TripIdeas } from './TripIdeas';

const idea = (activityId: string, name: string): TripIdea => ({
  activityId,
  name,
  reason: `${name} fits`,
  category: 'scenic',
  city: 'San Francisco',
});

function Harness({ seeded = [], max = 50 }: { seeded?: string[]; max?: number }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <>
      <TripIdeas seeded={seeded} picked={picked} onChange={setPicked} max={max} />
      <div data-testid="picked">{picked.join(',')}</div>
    </>
  );
}

const prompt = () => screen.getByLabelText('What are you in the mood for?');
const suggest = () => screen.getByRole('button', { name: /Suggest activities|Finding ideas/ });
const pickedIds = () => screen.getByTestId('picked').textContent;

beforeEach(() => {
  suggestSpy.mockReset();
});

describe('TripIdeas (#78)', () => {
  it('asks only once there is something to ask', async () => {
    render(<Harness />);
    expect(suggest()).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText(/No new ideas/)).not.toBeInTheDocument();
    await userEvent.type(prompt(), '   ');
    expect(suggest()).toBeDisabled();
    await userEvent.type(prompt(), 'dogs');
    expect(suggest()).toBeEnabled();
  });

  it('lists the ideas with their reasons, and ticks them into the trip', async () => {
    suggestSpy.mockResolvedValue([idea('ff', 'Fort Funston'), idea('le', 'Lands End')]);
    render(<Harness seeded={['muir']} />);
    await userEvent.type(prompt(), '  a dog day  ');
    await userEvent.click(suggest());
    expect(suggestSpy).toHaveBeenCalledWith('a dog day', ['muir']);
    expect(await screen.findByText('Fort Funston fits')).toBeInTheDocument();
    expect(screen.queryByText('No close matches. Try rephrasing.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Lands End/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Fort Funston/ }));
    expect(pickedIds()).toBe('le,ff');
    await userEvent.click(screen.getByRole('checkbox', { name: /Lands End/ }));
    expect(pickedIds()).toBe('ff');
  });

  it('asking again keeps what is ticked, and never suggests it twice', async () => {
    suggestSpy
      .mockResolvedValueOnce([idea('ff', 'Fort Funston'), idea('le', 'Lands End')])
      .mockResolvedValueOnce([idea('cb', 'Carmel Beach')]);
    render(<Harness seeded={['muir']} />);
    await userEvent.type(prompt(), 'dogs');
    await userEvent.click(suggest());
    await userEvent.click(await screen.findByRole('checkbox', { name: /Fort Funston/ }));
    await userEvent.click(suggest());
    expect(suggestSpy).toHaveBeenLastCalledWith('dogs', ['muir', 'ff']);
    await screen.findByText('Carmel Beach fits');
    expect(screen.getAllByRole('checkbox').map((c) => c.closest('li')?.textContent)).toEqual([
      expect.stringContaining('Fort Funston'),
      expect.stringContaining('Carmel Beach'),
    ]);
    expect(screen.getByRole('checkbox', { name: /Fort Funston/ })).toBeChecked();
    expect(screen.queryByText(/No new ideas/)).not.toBeInTheDocument();
  });

  it('says so when nothing fits', async () => {
    suggestSpy.mockResolvedValue([]);
    render(<Harness />);
    await userEvent.type(prompt(), 'skiing');
    await userEvent.click(suggest());
    expect(await screen.findByText('No close matches. Try rephrasing.')).toBeInTheDocument();
    expect(screen.queryByText(/No new ideas/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('ideas');
  });

  it('says so when the ideas cannot be fetched, and can try again', async () => {
    suggestSpy
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValue([idea('ff', 'Fort Funston')]);
    render(<Harness />);
    await userEvent.type(prompt(), 'dogs');
    await userEvent.click(suggest());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't get ideas. Try again in a moment.",
    );
    await userEvent.click(suggest());
    expect(await screen.findByText('Fort Funston fits')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows it is working, and holds the button meanwhile', async () => {
    let resolve: (v: TripIdea[]) => void = () => {};
    suggestSpy.mockReturnValue(new Promise<TripIdea[]>((r) => (resolve = r)));
    render(<Harness />);
    await userEvent.type(prompt(), 'dogs');
    await userEvent.click(suggest());
    expect(suggest()).toHaveTextContent('Finding ideas…');
    expect(suggest()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    resolve([]);
    expect(await screen.findByRole('button', { name: 'Suggest activities' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'false');
  });

  it('locks the ticks while asking again, so none can slip off the list', async () => {
    let resolve: (v: TripIdea[]) => void = () => {};
    suggestSpy
      .mockResolvedValueOnce([idea('ff', 'Fort Funston'), idea('le', 'Lands End')])
      .mockReturnValueOnce(new Promise<TripIdea[]>((r) => (resolve = r)));
    render(<Harness />);
    await userEvent.type(prompt(), 'dogs');
    await userEvent.click(suggest());
    await screen.findByText('Fort Funston fits');
    await userEvent.click(suggest());
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.queryByText(/No new ideas/)).not.toBeInTheDocument();
    resolve([]);
    expect(await screen.findByText('No close matches. Try rephrasing.')).toBeInTheDocument();
  });

  it('says when asking again finds nothing beyond what is ticked', async () => {
    suggestSpy.mockResolvedValueOnce([idea('ff', 'Fort Funston')]).mockResolvedValueOnce([]);
    render(<Harness />);
    await userEvent.type(prompt(), 'dogs');
    await userEvent.click(suggest());
    await userEvent.click(await screen.findByRole('checkbox', { name: /Fort Funston/ }));
    await userEvent.click(suggest());
    expect(
      await screen.findByText('No new ideas beyond the ones ticked. Try rephrasing.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No close matches. Try rephrasing.')).not.toBeInTheDocument();
  });

  it('names each idea with its city and kind, and describes it with its reason', async () => {
    suggestSpy.mockResolvedValue([idea('ff', 'Fort Funston'), idea('le', 'Lands End')]);
    render(<Harness />);
    await userEvent.type(prompt(), 'dogs');
    await userEvent.click(suggest());
    // The kind is spelled out ("Scenic"), so it's read as it's shown.
    const box = await screen.findByRole('checkbox', {
      name: 'Fort Funston · San Francisco · Scenic',
    });
    expect(box).toHaveAccessibleDescription('Fort Funston fits');
    expect(screen.getByRole('status')).toHaveTextContent('2 ideas');
  });

  it("centres each checkbox on its name's line", async () => {
    suggestSpy.mockResolvedValue([idea('ff', 'Fort Funston')]);
    render(<Harness />);
    await userEvent.type(prompt(), 'dogs');
    await userEvent.click(suggest());
    const box = await screen.findByRole('checkbox', { name: /^Fort Funston/ });
    // A box the line's height (24px) centres it, with no margin of its own.
    expect(box.parentElement).toHaveClass('flex', 'h-6', 'items-center');
    expect(box).not.toHaveClass('mt-1');
  });

  it('asks nothing when the trip already starts at the cap', async () => {
    render(<Harness seeded={['a', 'b']} max={2} />);
    await userEvent.type(prompt(), 'dogs');
    expect(suggest()).toBeDisabled();
    expect(
      screen.getByText('This trip already starts with 2 activities, the most it can.'),
    ).toBeInTheDocument();
  });

  it('stops new ticks at the cap a trip can start with', async () => {
    suggestSpy.mockResolvedValue([idea('ff', 'Fort Funston'), idea('le', 'Lands End')]);
    render(<Harness seeded={['muir']} max={2} />);
    expect(screen.queryByText(/already starts with/)).not.toBeInTheDocument();
    await userEvent.type(prompt(), 'dogs');
    await userEvent.click(suggest());
    expect(screen.queryByText(/A new trip can start with/)).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Fort Funston/ }));
    expect(screen.getByRole('checkbox', { name: /Lands End/ })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Fort Funston/ })).toBeEnabled();
    expect(
      screen.getByText('A new trip can start with 2 activities; untick one to pick another.'),
    ).toBeInTheDocument();
  });
});
