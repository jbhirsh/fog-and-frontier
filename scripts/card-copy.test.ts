import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MODEL,
  batches,
  checkReview,
  fit,
  parseReply,
  placesToDraft,
  prompt,
  saveStatements,
  type Entry,
  type Place,
} from './card-copy';

const LONG = 'Castle Rock State Park (Saratoga Gap & Ridge Loop)';

function place(over: Partial<Place> = {}): Place {
  return {
    id: 'lands-end',
    name: 'Lands End Trail',
    shortDescription: 'Cliffside trail to the ruins of the Sutro Baths.',
    category: 'hiking',
    city: 'San Francisco',
    cardLine: null,
    cardName: null,
    ...over,
  };
}

function reply(places: unknown): unknown {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify({ places }) }] } }] };
}

describe('card-copy', () => {
  it('drafts with the same model as the app', () => {
    // Read as text: importing the resolver would bring the API into the
    // scripts' build.
    const api = readFileSync('api/_resolvers/gemini.ts', 'utf8');
    expect(api).toContain(`export const MODEL = '${MODEL}';`);
  });

  it('drafts only the places without a card line, unless asked for all', () => {
    const with_ = place({ id: 'a', cardLine: 'Has one.' });
    const blank = place({ id: 'b', cardLine: '  ' });
    const none = place({ id: 'c' });
    expect(placesToDraft([with_, blank, none], false).map((p) => p.id)).toEqual(['b', 'c']);
    expect(placesToDraft([with_, blank, none], true).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('splits a list into runs', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 40)).toEqual([]);
  });

  it('asks about each place, with its name’s length and any last try that was too long', () => {
    const asked = JSON.parse(
      prompt([place(), place({ id: 'x', name: LONG })], new Map([['x', 'y'.repeat(55)]])),
    ) as Record<string, unknown>[];
    expect(asked[0]).toEqual({
      id: 'lands-end',
      name: 'Lands End Trail',
      nameLength: 15,
      description: 'Cliffside trail to the ruins of the Sutro Baths.',
      category: 'hiking',
      city: 'San Francisco',
    });
    expect(asked[1]).toMatchObject({ nameLength: 50, lastTry: 'y'.repeat(55), lastTryLength: 55 });
  });

  it('reads a reply by place id, skipping what it can’t read', () => {
    const read = parseReply(
      reply([{ id: 'a', cardLine: 'One.' }, { cardLine: 'No id.' }, { id: 'b', cardName: 'B' }]),
    );
    expect([...read.keys()]).toEqual(['a', 'b']);
    expect(read.get('a')).toEqual({ cardLine: 'One.', cardName: undefined });
    for (const junk of [null, {}, { candidates: [] }, reply('not a list')]) {
      expect(parseReply(junk).size).toBe(0);
    }
    expect(parseReply({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }).size).toBe(
      0,
    );
  });

  it('keeps drafted copy that fits, trimmed, and drops what doesn’t', () => {
    expect(
      fit(place(), { cardLine: ' Cliffs, ruins and a hidden labyrinth. ', cardName: 'x' }),
    ).toEqual({
      id: 'lands-end',
      name: 'Lands End Trail',
      shortDescription: 'Cliffside trail to the ruins of the Sutro Baths.',
      cardLine: 'Cliffs, ruins and a hidden labyrinth.',
      cardName: null,
      stored: { cardLine: null, cardName: null },
    });
    // What the catalog held, so saving can tell whether it changed since.
    expect(fit(place({ cardLine: 'Was.', cardName: 'Bea' }), undefined).stored).toEqual({
      cardLine: 'Was.',
      cardName: 'Bea',
    });
    expect(fit(place(), { cardLine: 'x'.repeat(51), cardName: undefined }).cardLine).toBeNull();
    expect(fit(place(), undefined).cardLine).toBeNull();
    const long = place({ name: LONG });
    expect(fit(long, { cardLine: 'x', cardName: 'Castle Rock State Park' }).cardName).toBe(
      'Castle Rock State Park',
    );
    expect(fit(long, { cardLine: 'x', cardName: 'y'.repeat(41) }).cardName).toBeNull();
  });

  it('passes a file whose places all have copy that fits', () => {
    const ok: Entry[] = [
      { id: 'a', name: 'A', shortDescription: '', cardLine: 'x'.repeat(50), cardName: null },
      { id: 'b', name: 'B', shortDescription: '', cardLine: 'Fits.', cardName: 'y'.repeat(40) },
    ];
    expect(checkReview(ok)).toEqual([]);
  });

  it('says what’s wrong with a file, place by place', () => {
    expect(checkReview({})).toEqual(['the file must hold a list of places']);
    expect(
      checkReview([
        { name: 'No Id', cardLine: 'x' },
        { id: 'a', name: 'Blank', cardLine: '  ' },
        { id: 'b', name: 'Long', cardLine: 'x'.repeat(51) },
        { id: 'c', name: 'Long name', cardLine: 'x', cardName: 'y'.repeat(41) },
        { id: 'd', cardLine: 'x', cardName: 7 },
        { id: 'c', name: 'Again', cardLine: 'x' },
      ]),
    ).toEqual([
      'No Id: no id',
      'Blank: no card line',
      'Long: card line is 51 characters, over 50',
      'Long name: card name is 41 characters, over 40',
      "place 5: card name isn't text",
      'Again: listed twice',
    ]);
  });

  it('saves each place’s copy into its stored JSON, trimmed, an empty name as none', () => {
    const sql =
      "UPDATE a SET j = json_set(j, '$.cardLine', ?, '$.cardName', ?) WHERE id = ?" +
      " AND json_extract(j, '$.cardLine') IS ? AND json_extract(j, '$.cardName') IS ?";
    expect(
      saveStatements([
        { id: 'a', name: 'A', shortDescription: '', cardLine: ' Fits. ', cardName: ' ' },
        {
          id: 'b',
          name: 'B',
          shortDescription: '',
          cardLine: 'Also.',
          cardName: 'Bee',
          stored: { cardLine: 'Old.', cardName: 'Bea' },
        },
      ]),
    ).toEqual([
      // Only while the stored copy is what the draft started from, the
      // last-edited time untouched.
      { sql, args: ['Fits.', null, 'a', null, null] },
      { sql, args: ['Also.', 'Bee', 'b', 'Old.', 'Bea'] },
    ]);
  });
});
