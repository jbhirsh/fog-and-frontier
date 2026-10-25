// Production's catalog for a branch that asks it for fields production
// doesn't have yet (sourceUrl, #6): the read goes to production without
// them, and they're filled in here, so a recording shows the real catalog
// rather than the visual tests' stub. Call from a scenario's setup, after
// mockApis; liveSite's own route sends the read here when production
// refuses it.

import type { Page } from '@playwright/test';
import { LIVE_GRAPHQL } from '../live-site.ts';

/** Fields production lacks, and what each activity reads for them. */
export type NewFields = Record<string, (activity: { id: string }) => unknown>;

export async function liveCatalog(page: Page, fields: NewFields): Promise<void> {
  const names = Object.keys(fields);
  await page.route('**/api/graphql', async (route) => {
    const body = route.request().postDataJSON() as {
      operationName?: string;
      query?: string;
    } | null;
    if (body?.operationName !== 'Activities' || !body.query) return route.fallback();
    // The query without the new fields: a selection is whitespace-separated words.
    const query = body.query
      .split(/(\s+)/)
      .filter((word) => !names.includes(word))
      .join('');
    const response = await route.fetch({
      url: LIVE_GRAPHQL,
      postData: JSON.stringify({ ...body, query }),
    });
    const json = (await response.json()) as { data?: { activities?: { id: string }[] } };
    for (const activity of json.data?.activities ?? []) {
      for (const name of names)
        (activity as Record<string, unknown>)[name] = fields[name](activity) ?? null;
    }
    return route.fulfill({ response, json });
  });
}
