import { describe, expect, it } from 'vitest';
import { LINK_HOSTS, isDogRulesPage, isSavableUrl, keepSavableLinks } from './_links.js';

describe('isSavableUrl', () => {
  it('keeps http(s) pages and drops everything else', () => {
    expect(isSavableUrl('https://example.com/a', null)).toBe(true);
    expect(isSavableUrl('http://example.com/a', null)).toBe(true);
    expect(isSavableUrl('ftp://example.com/a', null)).toBe(false);
    expect(isSavableUrl('javascript:alert(1)', null)).toBe(false);
    expect(isSavableUrl('not a url', null)).toBe(false);
    expect(isSavableUrl(42, null)).toBe(false);
  });

  it("drops Google's grounding redirect", () => {
    expect(
      isSavableUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/x', null),
    ).toBe(false);
  });

  it('holds AllTrails links to trail pages on alltrails.com', () => {
    const host = LINK_HOSTS.allTrailsUrl;
    expect(isSavableUrl('https://www.alltrails.com/trail/us/california/x', host)).toBe(true);
    expect(isSavableUrl('https://alltrails.com/trail/x', host)).toBe(true);
    expect(isSavableUrl('https://www.alltrails.com/parks/x', host)).toBe(false);
    expect(isSavableUrl('https://alltrails.com.evil.example/trail/x', host)).toBe(false);
    expect(isSavableUrl('https://notalltrails.com/trail/x', host)).toBe(false);
    expect(LINK_HOSTS.reservationUrl).toBeNull();
    expect(LINK_HOSTS.menuUrl).toBeNull();
    expect(LINK_HOSTS.sourceUrl).toBeNull();
  });
});

describe('keepSavableLinks (#73)', () => {
  it('nulls bad link fields, empties a bad cover with its credit, and filters the gallery', () => {
    expect(
      keepSavableLinks({
        name: 'X',
        coverImage: 'data:image/png;base64,AAAA',
        coverCredit: 'Someone',
        galleryImages: ['https://img.example/1.jpg', 'javascript:x', 7],
        allTrailsUrl: 'https://example.com/trail/x',
        reservationUrl: 'mailto:a@example.com',
        menuUrl: 'https://example.com/menu',
        dogRulesUrl: 'ftp://parks.example/dogs',
      }),
    ).toEqual({
      name: 'X',
      coverImage: '',
      coverCredit: null,
      galleryImages: ['https://img.example/1.jpg'],
      allTrailsUrl: null,
      reservationUrl: null,
      menuUrl: 'https://example.com/menu',
      dogRulesUrl: null,
    });
  });

  it('leaves good links, and absent ones, as they were', () => {
    const activity = {
      coverImage: 'https://img.example/c.jpg',
      coverCredit: 'Photo: A',
      allTrailsUrl: 'https://www.alltrails.com/trail/x',
      reservationUrl: null,
    };
    expect(keepSavableLinks(activity)).toEqual(activity);
    expect(keepSavableLinks({ coverImage: 'https://img.example/c.jpg' })).toEqual({
      coverImage: 'https://img.example/c.jpg',
    });
  });

  it("doesn't change what it's given", () => {
    const activity = { coverImage: 'bad', menuUrl: 'bad' };
    keepSavableLinks(activity);
    expect(activity).toEqual({ coverImage: 'bad', menuUrl: 'bad' });
  });
});

describe('isDogRulesPage (#296)', () => {
  it("keeps a page of the place's or its park's own site", () => {
    expect(isDogRulesPage('https://www.parks.ca.gov/?page_id=518')).toBe(true);
    expect(isDogRulesPage('http://www.ebparks.org/dogs')).toBe(true);
  });

  it('drops a listing or review of the place', () => {
    expect(isDogRulesPage('https://www.alltrails.com/trail/us/california/x')).toBe(false);
    expect(isDogRulesPage('https://www.bringfido.com/attraction/1234')).toBe(false);
    expect(isDogRulesPage('https://yelp.com/biz/x')).toBe(false);
    expect(isDogRulesPage('https://www.yelp.com./biz/x')).toBe(false);
  });

  it('tells a listing site from a name that merely ends like one', () => {
    expect(isDogRulesPage('https://notyelp.com/dogs')).toBe(true);
    expect(isDogRulesPage('https://yelp.com.example.org/dogs')).toBe(true);
  });

  it('drops what could not be saved at all', () => {
    expect(isDogRulesPage('mailto:ranger@parks.example')).toBe(false);
    expect(isDogRulesPage('https://vertexaisearch.cloud.google.com/grounding-api-redirect/x')).toBe(
      false,
    );
    expect(isDogRulesPage(null)).toBe(false);
    expect(isDogRulesPage(42)).toBe(false);
  });
});
