// What an eval run spent, in time and paid calls, added up from the events
// its drafts log (draft.generated, draft.timing, draft.trail_search) and the
// judge calls it made: where a draft's time goes, and what costs credits.

/** One case's events, and how many judge calls it made. */
export interface CaseUsage {
  events: readonly Record<string, unknown>[];
  judgeCalls: number;
}

export interface Usage {
  drafts: number;
  googleSearches: number;
  allTrailsSearches: number;
  judgeCalls: number;
  tokens: { prompt: number; thinking: number; output: number };
  /** Each draft's whole time, Gemini's part of it, and the lookups after. */
  draftMs: number[];
  geminiMs: number[];
  lookupsMs: number[];
}

// Google's price for a search past the month's free ones, and Agent
// Search's for a query (2026-10).
const GOOGLE_SEARCH_USD = 0.014;
const AGENT_SEARCH_USD = 0.004;

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** A run's usage, from its cases'. */
export function usageOf(cases: readonly CaseUsage[]): Usage {
  const usage: Usage = {
    drafts: 0,
    googleSearches: 0,
    allTrailsSearches: 0,
    judgeCalls: 0,
    tokens: { prompt: 0, thinking: 0, output: 0 },
    draftMs: [],
    geminiMs: [],
    lookupsMs: [],
  };
  for (const c of cases) {
    usage.judgeCalls += c.judgeCalls;
    for (const e of c.events) {
      if (e.event === 'draft.generated') {
        usage.drafts += 1;
        usage.googleSearches += count(e.queries);
        const tokens = (e.tokens ?? {}) as Record<string, unknown>;
        usage.tokens.prompt += num(tokens.prompt) + num(tokens.tools);
        usage.tokens.thinking += num(tokens.thinking);
        usage.tokens.output += num(tokens.output);
      } else if (e.event === 'draft.timing') {
        usage.draftMs.push(num(e.ms));
        usage.geminiMs.push(num(e.geminiMs));
        usage.lookupsMs.push(num(e.lookupsMs));
      } else if (e.event === 'draft.trail_search') {
        usage.allTrailsSearches += count(e.queries);
      }
    }
  }
  return usage;
}

/** The middle value, or 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** The usage as lines for the run's log. */
export function renderUsage(usage: Usage): string {
  const searchesUsd =
    usage.googleSearches * GOOGLE_SEARCH_USD + usage.allTrailsSearches * AGENT_SEARCH_USD;
  const lines = [
    'USAGE',
    `  ${usage.drafts} drafts · ${usage.googleSearches} Google searches by drafts · ${usage.allTrailsSearches} AllTrails searches · ${usage.judgeCalls} judge calls`,
    `  drafts' tokens: ${usage.tokens.prompt} in, ${usage.tokens.thinking} thinking, ${usage.tokens.output} out`,
  ];
  if (usage.draftMs.length > 0) {
    lines.push(
      `  a draft took ${seconds(median(usage.draftMs))} (median; slowest ${seconds(Math.max(...usage.draftMs))}): Gemini ${seconds(median(usage.geminiMs))}, then ${seconds(median(usage.lookupsMs))} for its cover, trail and park`,
    );
  }
  lines.push(
    `  drafts' searches: about $${searchesUsd.toFixed(2)} past Google's free ones (judge calls search too, and aren't counted)`,
  );
  return lines.join('\n');
}
