import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Handler-level coverage for issue #23: when the daily Gemini budget is
// exceeded, /api/discover and /api/generate-activity must respond with
// 429 { error: "daily budget exceeded", resetsAt: <ISO> } where resetsAt
// is next UTC midnight. The helper has its own unit tests in
// `_gemini_budget.test.ts`; this file exercises the handler plumbing.

const { requireOwner, enforceDailyBudget } = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  enforceDailyBudget: vi.fn(),
}));

vi.mock('./_auth.js', () => ({
  requireOwner,
}));

vi.mock('./_gemini_budget.js', async () => {
  // Re-export the real BudgetExceededError so `instanceof` checks in the
  // handler work against the same constructor we throw with here.
  const actual = await vi.importActual<
    typeof import('./_gemini_budget.js')
  >('./_gemini_budget.js');
  return {
    ...actual,
    enforceDailyBudget,
  };
});

const { BudgetExceededError } = await import('./_gemini_budget.js');
const { default: discoverHandler } = await import('./discover.js');
const { default: generateHandler } = await import('./generate-activity.js');

function fakeReq(method: string, body: unknown = {}): VercelRequest {
  return {
    method,
    headers: { authorization: 'Bearer test' },
    body,
  } as unknown as VercelRequest;
}

type CapturingRes = VercelResponse & {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
};

function fakeRes(): CapturingRes {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res as unknown as CapturingRes;
}

const ISO_MIDNIGHT = /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/;

function nextUtcMidnightISO(): string {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  ).toISOString();
}

describe('handler 429 on budget exceeded', () => {
  beforeEach(() => {
    requireOwner.mockReset();
    enforceDailyBudget.mockReset();
    requireOwner.mockResolvedValue('owner@example.com');
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it('discover: returns 429 with resetsAt when budget exceeded', async () => {
    enforceDailyBudget.mockRejectedValueOnce(
      new BudgetExceededError('discover', 50, 51, nextUtcMidnightISO()),
    );
    const res = fakeRes();
    await discoverHandler(fakeReq('POST', { range: 'weekend' }), res);

    expect(enforceDailyBudget).toHaveBeenCalledWith('discover');
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: 'daily budget exceeded' });
    const body = res.body as { resetsAt: string };
    expect(body.resetsAt).toMatch(ISO_MIDNIGHT);
    expect(body.resetsAt).toBe(nextUtcMidnightISO());
  });

  it('generate-activity: returns 429 with resetsAt when budget exceeded', async () => {
    enforceDailyBudget.mockRejectedValueOnce(
      new BudgetExceededError('generate', 200, 201, nextUtcMidnightISO()),
    );
    const res = fakeRes();
    await generateHandler(fakeReq('POST', { title: 'Mount Tam loop' }), res);

    expect(enforceDailyBudget).toHaveBeenCalledWith('generate');
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: 'daily budget exceeded' });
    const body = res.body as { resetsAt: string };
    expect(body.resetsAt).toMatch(ISO_MIDNIGHT);
    expect(body.resetsAt).toBe(nextUtcMidnightISO());
  });
});
