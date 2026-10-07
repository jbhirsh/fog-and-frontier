import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkPrVisuals, uiFiles } from './pr-visuals.mjs';

describe('uiFiles', () => {
  it('keeps components and stylesheets under src', () => {
    expect(
      uiFiles(['src/pages/Trips.tsx', 'src/index.css', 'src/lib/geo.ts', 'api/graphql.ts']),
    ).toEqual(['src/pages/Trips.tsx', 'src/index.css']);
  });

  it('drops tests and test scaffolding', () => {
    expect(
      uiFiles(['src/pages/Trips.test.tsx', 'src/test/render.tsx', 'README.md']),
    ).toEqual([]);
  });
});

describe('checkPrVisuals', () => {
  const ui = ['src/components/BottomSheet.tsx'];

  it('passes a PR with no UI files, whatever the description', () => {
    expect(checkPrVisuals({ files: ['api/_db.ts'], body: '' }).ok).toBe(true);
    expect(checkPrVisuals({ files: ['package-lock.json'], body: undefined }).ok).toBe(true);
  });

  it('fails a UI change with no picture, naming the files', () => {
    expect(checkPrVisuals({ files: ui, body: 'Fixes the sheet.' })).toEqual({
      ok: false,
      ui,
    });
    expect(checkPrVisuals({ files: ui, body: undefined }).ok).toBe(false);
  });

  it.each([
    ['a markdown image', '![after](https://example.com/a.png)'],
    ['a markdown GIF', '![drag](https://example.com/drag.gif)'],
    ['an HTML image', '<img src="https://example.com/a.png" width="300">'],
    ['an HTML video', '<video src="https://example.com/a.mp4"></video>'],
    ['an uploaded video', 'https://github.com/user-attachments/assets/0f1e2d3c'],
  ])('passes a UI change whose description has %s', (_, body) => {
    expect(checkPrVisuals({ files: ui, body }).ok).toBe(true);
  });

  it('passes a UI change ticked "No visible UI change"', () => {
    expect(checkPrVisuals({ files: ui, body: '- [x] No visible UI change' }).ok).toBe(true);
    expect(checkPrVisuals({ files: ui, body: '* [X] No visible UI change (refactor)' }).ok).toBe(true);
  });

  it('fails the untouched template, whose example sits in a comment', () => {
    const template = readFileSync('.github/pull_request_template.md', 'utf8');
    expect(checkPrVisuals({ files: ui, body: template }).ok).toBe(false);
  });

  it('passes the template once its box is ticked', () => {
    const template = readFileSync('.github/pull_request_template.md', 'utf8');
    const ticked = template.replace('- [ ] No visible UI change', '- [x] No visible UI change');
    expect(checkPrVisuals({ files: ui, body: ticked }).ok).toBe(true);
  });

  it('ignores pictures in comments, closed or not', () => {
    const img = '<img src="a.png">';
    expect(checkPrVisuals({ files: ui, body: `<!-- ${img} -->` }).ok).toBe(false);
    // An unclosed comment hides the rest of the description.
    expect(checkPrVisuals({ files: ui, body: `<!-- note\n${img}` }).ok).toBe(false);
    // Text after a closed comment still counts.
    expect(checkPrVisuals({ files: ui, body: `<!-- note -->\n${img}` }).ok).toBe(true);
    expect(
      checkPrVisuals({ files: ui, body: `<!-- a --><!-- b -->${img}` }).ok,
    ).toBe(true);
  });

  it('ignores pictures quoted in code', () => {
    expect(checkPrVisuals({ files: ui, body: 'Use `<img src="a.png">` here' }).ok).toBe(false);
    expect(
      checkPrVisuals({ files: ui, body: '```html\n<img src="a.png">\n```' }).ok,
    ).toBe(false);
  });

  it('does not count an unticked box or a mention of an image', () => {
    expect(checkPrVisuals({ files: ui, body: '- [ ] No visible UI change' }).ok).toBe(false);
    expect(checkPrVisuals({ files: ui, body: 'Screenshots: <img> to follow' }).ok).toBe(false);
    expect(checkPrVisuals({ files: ui, body: 'see ![]() later' }).ok).toBe(false);
  });
});
