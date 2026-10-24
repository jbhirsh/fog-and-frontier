import { describe, expect, it } from 'vitest';
import { mapPool } from './pool.js';

// A task that finishes when its item's own promise is resolved.
function deferred() {
  let resolve = () => {};
  const done = new Promise<void>((r) => (resolve = r));
  return { done, resolve };
}

describe('mapPool', () => {
  it('runs at most `limit` tasks at once, starting the next as each finishes', async () => {
    const gates = [deferred(), deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const run = mapPool([0, 1, 2, 3, 4], 2, async (n) => {
      started.push(n);
      await gates[n].done;
      return n * 10;
    });
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual([0, 1, 2]);
    for (const g of gates) g.resolve();
    // Results by item, not by finishing order.
    expect(await run).toEqual([0, 10, 20, 30, 40]);
    expect(started).toEqual([0, 1, 2, 3, 4]);
  });

  it('passes each item’s index, and runs one at a time for a limit below one', async () => {
    let running = 0;
    let most = 0;
    const out = await mapPool(['a', 'b', 'c'], 0, async (s, i) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return `${s}${i}`;
    });
    expect(out).toEqual(['a0', 'b1', 'c2']);
    expect(most).toBe(1);
  });

  it('rejects with the first task that throws', async () => {
    await expect(
      mapPool([1, 2, 3], 2, (n) =>
        n === 2 ? Promise.reject(new Error('case 2')) : Promise.resolve(n),
      ),
    ).rejects.toThrow('case 2');
  });

  it('starts no more workers than there are items, and handles none', async () => {
    let running = 0;
    let most = 0;
    await mapPool([1, 2], 8, async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
    });
    expect(most).toBe(2);
    expect(await mapPool([], 4, () => Promise.resolve(1))).toEqual([]);
  });
});
