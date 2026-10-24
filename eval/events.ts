// The events (api/_log.ts logEvent) each eval case's resolver call logs.
// Each call's are told apart by the async context they're logged in, which
// carries over every await, fetch and timer, so they stay with their case
// however cases overlap: one cut off by its time limit keeps its late ones
// to itself. Each still prints, for the job's log, after its case's id.

import { AsyncLocalStorage } from 'node:async_hooks';

interface CaseLog {
  id: string;
  events: Record<string, unknown>[];
}

const current = new AsyncLocalStorage<CaseLog>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  const info = console.info.bind(console);
  console.info = (...args: unknown[]) => {
    const log = current.getStore();
    if (!log) {
      info(...args);
      return;
    }
    info(`[${log.id}]`, ...args);
    try {
      const line: unknown = JSON.parse(String(args[0]));
      if (line && typeof line === 'object' && 'event' in line) log.events.push(line);
    } catch {
      // Not an event line.
    }
  };
}

/** `call`'s result and the events it logged, under case `id`. */
export async function withEvents<T>(
  id: string,
  call: () => Promise<T>,
): Promise<{ result: T; events: Record<string, unknown>[] }> {
  listen();
  const log: CaseLog = { id, events: [] };
  return { result: await current.run(log, call), events: log.events };
}
