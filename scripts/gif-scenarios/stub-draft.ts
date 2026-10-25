// Gemini's draft for a recording, stubbed since its key is only on the
// deployment, with the cover the real lookup finds (findCoverImage, as
// generateActivity does). Call from a scenario's setup, after mockApis.

import type { Page } from '@playwright/test';
import { findCoverImage } from '../../api/_coverImage.ts';
import type { Gif } from '../gif-types.ts';

/** A drafted activity, as GenerateActivity returns it. */
export interface Draft {
  name: string;
  category: string;
  lat: number;
  lng: number;
  [field: string]: unknown;
}

/**
 * Answers GenerateActivity with `draft` after `delayMs`, as a draft takes a
 * moment; with the cover Commons finds, unless `cover` is false (the draft
 * has its own, or none).
 */
export async function stubDraft(
  page: Page,
  draft: Draft,
  delayMs: number,
  { cover: findCover = true } = {},
): Promise<void> {
  const cover = findCover
    ? await findCoverImage({
        name: draft.name,
        lat: draft.lat,
        lng: draft.lng,
        category: draft.category,
      })
    : null;
  const activity = {
    __typename: 'GeneratedActivity',
    ...draft,
    coverImage: cover?.url ?? draft.coverImage ?? null,
    coverCredit: cover?.credit ?? draft.coverCredit ?? null,
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

/** A scenario's ready(): the page's Add button and fonts in, the pointer mid-page. */
export async function readyToAdd(page: Page, gif: Gif): Promise<void> {
  await page.getByRole('button', { name: 'Add activity' }).first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await gif.glide(page, { x: 500, y: 400 }, 0);
}

/** Opens Add activity, types `title` and drafts it, ending on the review. */
export async function draftActivity(page: Page, gif: Gif, title: string): Promise<void> {
  await page.waitForTimeout(400);
  await gif.click(page, page.getByRole('button', { name: 'Add activity' }).first(), { ms: 600 });
  await page.getByLabel('Title').waitFor();
  await gif.click(page, page.getByLabel('Title'), { ms: 400 });
  await page.keyboard.type(title, { delay: 40 });
  await page.waitForTimeout(300);
  await gif.click(page, page.getByRole('button', { name: /Generate/ }), { ms: 500 });
  await page.getByLabel('Short description').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);
}
