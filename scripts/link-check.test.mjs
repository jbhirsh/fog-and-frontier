import { describe, expect, it } from 'vitest';
import {
  ACTIVITIES_QUERY,
  BOT_BLOCKING_HOSTS,
  HOST_STRIKES,
  LINK_FIELDS,
  collectLinks,
  judge,
  report,
  retryDelayMs,
} from './link-check.mjs';

const page = { url: 'https://example.com/trail', image: false };
const image = { url: 'https://upload.wikimedia.org/a.jpg', image: true };

describe('collectLinks', () => {
  it('lists every outbound link an activity surfaces', () => {
    expect(LINK_FIELDS.map((f) => f.field)).toEqual([
      'allTrailsUrl',
      'menuUrl',
      'reservationUrl',
      'coverImage',
    ]);
    expect(ACTIVITIES_QUERY).toBe(
      '{ activities { id name allTrailsUrl menuUrl reservationUrl coverImage } }',
    );
    const links = collectLinks([
      {
        id: 'muir',
        name: 'Muir Woods',
        allTrailsUrl: ' https://www.alltrails.com/trail/x ',
        menuUrl: null,
        reservationUrl: '',
        coverImage: 'https://upload.wikimedia.org/m.jpg',
      },
      { id: 'cafe', name: 'Cafe', menuUrl: 'https://cafe.example/menu', coverImage: '  ' },
    ]);
    expect(links).toEqual([
      {
        id: 'muir',
        name: 'Muir Woods',
        field: 'allTrailsUrl',
        url: 'https://www.alltrails.com/trail/x',
        image: false,
      },
      {
        id: 'muir',
        name: 'Muir Woods',
        field: 'coverImage',
        url: 'https://upload.wikimedia.org/m.jpg',
        image: true,
      },
      { id: 'cafe', name: 'Cafe', field: 'menuUrl', url: 'https://cafe.example/menu', image: false },
    ]);
  });
});

describe('judge', () => {
  it('passes a page that answers 2xx', () => {
    expect(judge(page, { status: 200, contentType: 'text/html' })).toEqual({
      verdict: 'ok',
      reason: 'HTTP 200',
    });
    expect(judge(page, { status: 203 }).verdict).toBe('ok');
    expect(judge(page, { status: 206 }).verdict).toBe('ok');
  });

  it('passes an image link only when it serves an image', () => {
    expect(judge(image, { status: 200, contentType: 'image/jpeg' }).verdict).toBe('ok');
    expect(judge(image, { status: 200, contentType: 'IMAGE/PNG' }).verdict).toBe('ok');
    expect(judge(image, { status: 200, contentType: 'text/html; charset=UTF-8' })).toEqual({
      verdict: 'dead',
      reason: 'not an image (HTTP 200, text/html; charset=UTF-8)',
    });
    expect(judge(image, { status: 200 })).toEqual({
      verdict: 'dead',
      reason: 'not an image (HTTP 200, no content type)',
    });
  });

  it.each([404, 410])('calls %s dead', (status) => {
    expect(judge(page, { status })).toEqual({ verdict: 'dead', reason: `HTTP ${status}` });
  });

  it.each([300, 199])('calls an unexpected %s dead', (status) => {
    expect(judge(page, { status })).toEqual({ verdict: 'dead', reason: `HTTP ${status}` });
  });

  it.each([400, 401, 403, 405, 406, 429, 451, 499, 999])(
    'sends %s to review: a block, not proof',
    (status) => {
      expect(judge(page, { status })).toEqual({ verdict: 'review', reason: `HTTP ${status}` });
    },
  );

  it.each([201, 202, 204, 299])('sends a %s, likely a challenge page, to review', (status) => {
    expect(judge(image, { status, contentType: 'text/html' })).toEqual({
      verdict: 'review',
      reason: `HTTP ${status} (a challenge page?)`,
    });
  });

  it('sends a page that now redirects to the home page to review', () => {
    expect(
      judge(
        { url: 'https://cafe.example/menu', image: false },
        { status: 200, contentType: 'text/html', finalUrl: 'https://cafe.example/' },
      ),
    ).toEqual({ verdict: 'review', reason: 'redirects to the home page' });
    // A home page link, or a redirect somewhere else, is fine.
    expect(
      judge(
        { url: 'https://cafe.example/', image: false },
        { status: 200, finalUrl: 'https://cafe.example/' },
      ).verdict,
    ).toBe('ok');
    expect(
      judge(
        { url: 'https://cafe.example/menu', image: false },
        { status: 200, finalUrl: 'https://cafe.example/menus/fall' },
      ).verdict,
    ).toBe('ok');
  });

  it('sends a link left unprobed to review, saying why', () => {
    expect(judge(page, { skipped: 'host kept refusing; not probed' })).toEqual({
      verdict: 'review',
      reason: 'host kept refusing; not probed',
    });
    expect(HOST_STRIKES).toBe(3);
  });

  it('says when a host blocks every script', () => {
    expect(BOT_BLOCKING_HOSTS).toEqual(['alltrails.com']);
    for (const url of ['https://www.alltrails.com/trail/x', 'https://alltrails.com/trail/x']) {
      expect(judge({ url, image: false }, { status: 403 })).toEqual({
        verdict: 'review',
        reason: 'HTTP 403 (blocks scripts)',
      });
    }
    expect(judge({ url: 'https://notalltrails.com/x', image: false }, { status: 403 }).reason).toBe(
      'HTTP 403',
    );
  });

  it('sends a server error to review', () => {
    expect(judge(page, { status: 500 })).toEqual({ verdict: 'review', reason: 'HTTP 500' });
    expect(judge(page, { status: 503 }).verdict).toBe('review');
  });

  it('calls a host that doesn’t resolve dead', () => {
    expect(judge(page, { error: 'ENOTFOUND' })).toEqual({
      verdict: 'dead',
      reason: "host doesn't resolve",
    });
  });

  it('sends other failures to review', () => {
    expect(judge(page, { error: 'timeout' })).toEqual({ verdict: 'review', reason: 'timed out' });
    expect(judge(page, { error: 'ECONNRESET' })).toEqual({ verdict: 'review', reason: 'ECONNRESET' });
  });

  it('calls a link that isn’t a web address dead, whatever came back', () => {
    for (const url of ['not a url', 'ftp://example.com/x', 'javascript:alert(1)']) {
      expect(judge({ url, image: false }, { status: 200 })).toEqual({
        verdict: 'dead',
        reason: 'not a web address',
      });
    }
  });
});

describe('report', () => {
  const row = (verdict, name, reason) => ({
    id: name.toLowerCase(),
    name,
    field: 'coverImage',
    url: `https://x.test/${name}`,
    verdict,
    reason,
  });

  it('lists the dead, then the ones to review, with a count', () => {
    const md = report([
      row('ok', 'Fine', 'HTTP 200'),
      row('review', 'Blocked', 'HTTP 403'),
      row('dead', 'Gone', 'HTTP 404'),
    ]);
    expect(md).toBe(
      [
        '# Link audit',
        '',
        '3 links: 1 dead, 1 to review, 1 ok.',
        '',
        '## Dead',
        '',
        '| Activity | Field | Why | Link |',
        '|---|---|---|---|',
        '| Gone (`gone`) | coverImage | HTTP 404 | https://x.test/Gone |',
        '',
        '## Review by hand',
        '',
        '| Activity | Field | Why | Link |',
        '|---|---|---|---|',
        '| Blocked (`blocked`) | coverImage | HTTP 403 | https://x.test/Blocked |',
        '',
      ].join('\n'),
    );
  });

  it('leaves out an empty section', () => {
    expect(report([row('ok', 'Fine', 'HTTP 200')])).toBe(
      '# Link audit\n\n1 link: 0 dead, 0 to review, 1 ok.\n',
    );
  });
});

describe('retryDelayMs', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');

  it('waits the seconds a 429 asks for, up to the cap', () => {
    expect(retryDelayMs('7', now)).toBe(7000);
    expect(retryDelayMs(' 0 ', now)).toBe(0);
    expect(retryDelayMs('600', now)).toBe(30_000);
  });

  it('waits until an HTTP date, never less than nothing', () => {
    expect(retryDelayMs('Fri, 09 Oct 2026 12:00:12 GMT', now)).toBe(12_000);
    expect(retryDelayMs('Fri, 09 Oct 2026 11:00:00 GMT', now)).toBe(0);
  });

  it('falls back to a pause, not an instant retry, without a usable header', () => {
    for (const header of [null, undefined, '', '  ', 'soon', '-5']) {
      expect(retryDelayMs(header, now)).toBe(5000);
    }
  });

  it('takes another fallback and cap', () => {
    expect(retryDelayMs(null, now, { fallback: 1000 })).toBe(1000);
    expect(retryDelayMs('60', now, { cap: 10_000 })).toBe(10_000);
  });
});

describe('report cells', () => {
  it('escapes a | so it can’t end a table cell', () => {
    const md = report([
      {
        id: 'a',
        name: 'Fish | Chips',
        field: 'menuUrl',
        url: 'https://x.test/a|b',
        verdict: 'dead',
        reason: 'HTTP 404',
      },
    ]);
    expect(md).toContain('| Fish \\| Chips (`a`) | menuUrl | HTTP 404 | https://x.test/a\\|b |');
  });
});
