import { afterEach, describe, expect, it, vi } from 'vitest';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const event = (name: string, n: number) =>
  console.info(JSON.stringify({ level: 'info', event: name, n }));

// A fresh copy of the module, listening over a console.info that records
// what it's asked to print.
async function load() {
  const printed: unknown[][] = [];
  vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => void printed.push(args));
  vi.resetModules();
  const { withEvents } = await import('./events.js');
  return { withEvents, printed };
}

describe('withEvents', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps each case’s events to itself while cases run side by side', async () => {
    const { withEvents } = await load();
    const run = (id: string, delays: number[]) =>
      withEvents(id, async () => {
        await Promise.all(
          delays.map(async (ms, i) => {
            await pause(ms);
            event(`${id}.event`, i);
          }),
        );
        return id;
      });
    const [a, b] = await Promise.all([run('a', [5, 1, 9]), run('b', [3, 7])]);
    expect(a.result).toBe('a');
    expect(a.events.map((e) => e.event)).toEqual(['a.event', 'a.event', 'a.event']);
    expect(a.events.map((e) => e.n)).toEqual([1, 0, 2]);
    expect(b.events.map((e) => e.event)).toEqual(['b.event', 'b.event']);
  });

  it('prints each line after its case’s id, and keeps only event lines', async () => {
    const { withEvents, printed } = await load();
    const { events } = await withEvents('gen-big-basin', () => {
      console.info('not json');
      console.info(JSON.stringify({ level: 'info' }));
      event('draft.trail_search', 1);
      return Promise.resolve();
    });
    expect(events).toEqual([{ level: 'info', event: 'draft.trail_search', n: 1 }]);
    expect(printed[0]).toEqual(['[gen-big-basin]', 'not json']);
    expect(printed).toHaveLength(3);
    // Outside any case, a line prints as it is and is kept by none.
    console.info('outside');
    expect(printed.at(-1)).toEqual(['outside']);
    expect(events).toHaveLength(1);
  });

  it('listens once, however many cases run', async () => {
    const { withEvents, printed } = await load();
    await withEvents('one', () => Promise.resolve(event('x', 1)));
    await withEvents('two', () => Promise.resolve(event('y', 2)));
    expect(printed.map((p) => p[0])).toEqual(['[one]', '[two]']);
  });
});
