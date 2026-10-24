// Runs the eval's cases side by side, a few at a time: each case waits
// mostly on Gemini, so running them one after another took most of the
// job's time.

/**
 * `task` over every item, at most `limit` at once, each result at its item's
 * index whatever order they finish in.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
