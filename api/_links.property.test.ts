import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LINK_HOSTS, isSavableUrl, keepSavableLinks } from './_links.js';

// Suggestions (#73) carry links written by people who aren't owners, so the
// filter must hold for anything they send. Example tests are in
// _links.test.ts.

// Real-looking links, junk, and the Google redirect Gemini sometimes cites.
const link = fc.oneof(
  fc.webUrl(),
  fc.webUrl().map((u) => u.replace(/^https?:/, 'javascript:')),
  fc.constant('https://vertexaisearch.cloud.google.com/grounding-api-redirect/x'),
  fc.constant('https://www.alltrails.com/trail/us/california/x'),
  fc.string(),
  fc.anything(),
);

const activity = fc.record(
  {
    name: fc.string(),
    allTrailsUrl: link,
    reservationUrl: link,
    menuUrl: link,
    coverImage: link,
    coverCredit: fc.option(fc.string()),
    galleryImages: fc.oneof(fc.array(link), link),
  },
  { requiredKeys: ['name'] },
);

describe('keepSavableLinks, for any suggestion', () => {
  it('leaves every link field savable or null, and the cover savable or empty', () => {
    fc.assert(
      fc.property(activity, (input) => {
        const out = keepSavableLinks(input);
        for (const [field, host] of Object.entries(LINK_HOSTS)) {
          const value = out[field as keyof typeof out];
          if (value != null) expect(isSavableUrl(value, host)).toBe(true);
        }
        if (out.coverImage !== '') expect(isSavableUrl(out.coverImage, null)).toBe(true);
        else expect(out.coverCredit ?? null).toBeNull();
        if (Array.isArray(out.galleryImages)) {
          for (const image of out.galleryImages as unknown[])
            expect(isSavableUrl(image, null)).toBe(true);
        }
      }),
    );
  });

  it('keeps the savable gallery images, in order', () => {
    fc.assert(
      fc.property(fc.array(link), (images) => {
        const out = keepSavableLinks({ coverImage: '', galleryImages: images });
        expect(out.galleryImages).toEqual(images.filter((u) => isSavableUrl(u, null)));
      }),
    );
  });

  it('changes nothing on a second pass, nor any field that is not a link', () => {
    fc.assert(
      fc.property(activity, (input) => {
        const once = keepSavableLinks(input);
        expect(keepSavableLinks(once)).toEqual(once);
        expect(once.name).toBe(input.name);
      }),
    );
  });

  it('never keeps a link that is not http(s)', () => {
    fc.assert(
      fc.property(fc.anything(), fc.constantFrom(null, LINK_HOSTS.allTrailsUrl), (value, host) => {
        if (isSavableUrl(value, host)) {
          expect(typeof value).toBe('string');
          expect(new URL(value as string).protocol).toMatch(/^https?:$/);
        }
      }),
    );
  });
});
