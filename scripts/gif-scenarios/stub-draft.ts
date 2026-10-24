// Gemini's draft for a recording, stubbed since its key is only on the
// deployment, with the cover the real lookup finds (findCoverImage, as
// generateActivity does). Call from a scenario's setup, after mockApis.

import type { Page } from '@playwright/test';
import { findCoverImage } from '../../api/_coverImage.ts';

/** A drafted activity, as GenerateActivity returns it. */
export interface Draft {
  name: string;
  category: string;
  lat: number;
  lng: number;
  [field: string]: unknown;
}

/** Answers GenerateActivity with `draft` after `delayMs`, as a draft takes a moment. */
export async function stubDraft(page: Page, draft: Draft, delayMs: number): Promise<void> {
  const cover = await findCoverImage({
    name: draft.name,
    lat: draft.lat,
    lng: draft.lng,
    category: draft.category,
  });
  const activity = {
    __typename: 'GeneratedActivity',
    ...draft,
    coverImage: cover?.url ?? null,
    coverCredit: cover?.credit ?? null,
  };
  await page.route('**/api/graphql', async (route) => {
    const op = (route.request().postDataJSON() as { operationName?: string } | null)?.operationName;
    if (op !== 'GenerateActivity') return route.fallback();
    await new Promise((r) => setTimeout(r, delayMs));
    return route.fulfill({
      json: { data: { generateActivity: { __typename: 'GenerateActivityPayload', activity } } },
    });
  });
}
