import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jscpdCount, knipCount, lycheeReport, main } from './audit-report.mjs';

describe('knipCount', () => {
  it('counts unused files and every finding per file, but not file or owners', () => {
    const report = {
      files: ['src/dead.ts', 'src/gone.ts'],
      issues: [
        {
          file: 'package.json',
          owners: ['@me'],
          dependencies: [{ name: 'left-pad' }],
          devDependencies: [{ name: 'a' }, { name: 'b' }],
          exports: [],
        },
        {
          file: 'src/lib/geo.ts',
          owners: [],
          exports: [{ name: 'x' }],
          types: [{ name: 'T' }],
          enumMembers: { Colour: [{ name: 'Red' }, { name: 'Blue' }] },
          duplicates: [[{ name: 'a' }, { name: 'b' }]],
        },
      ],
    };
    expect(knipCount(report)).toBe(2 + 3 + 5);
  });

  it('counts an unused-file flag on an issue, and nothing for an empty report', () => {
    expect(knipCount({ issues: [{ file: 'src/dead.ts', files: true, exports: [] }] })).toBe(1);
    expect(knipCount({ files: [], issues: [] })).toBe(0);
    expect(knipCount({})).toBe(0);
  });

  it('ignores counts and flags that are not findings', () => {
    expect(knipCount({ issues: [{ file: 'a', files: false, line: 3, name: 'x' }] })).toBe(0);
  });
});

describe('jscpdCount', () => {
  it('reads the total clones', () => {
    expect(jscpdCount({ statistics: { total: { clones: 4 } } })).toBe(4);
  });

  it('is zero for a report without statistics', () => {
    expect(jscpdCount({})).toBe(0);
    expect(jscpdCount({ statistics: {} })).toBe(0);
  });
});

describe('lycheeReport', () => {
  const report = {
    fail_map: {
      'README.md': [
        { url: 'https://gone.example/', status: { text: 'Network error', code: 404 } },
        { url: 'file:///repo/docs/missing.png', status: 'Cannot find file' },
      ],
      'CLAUDE.md': [{ url: 'https://x.example/#nope', status: { text: 'Fragment not found' } }],
      'PLAN.md': [],
    },
  };

  it('counts every broken link and lists them by doc, docs in order', () => {
    const { count, markdown } = lycheeReport(report);
    expect(count).toBe(3);
    expect(markdown).toContain('- https://gone.example/ — 404 Network error');
    expect(markdown).toContain('- file:///repo/docs/missing.png — Cannot find file');
    expect(markdown).toContain('- https://x.example/#nope — Fragment not found');
    expect(markdown.indexOf('**CLAUDE.md**')).toBeLessThan(markdown.indexOf('**README.md**'));
    expect(markdown).not.toContain('PLAN.md');
    expect(markdown).not.toContain('From ');
  });

  it("reads lychee's current error_map as well as the older fail_map", () => {
    const failures = [{ url: 'https://gone.example/', status: { text: 'Gone', code: 410 } }];
    expect(lycheeReport({ error_map: { 'README.md': failures } })).toEqual(
      lycheeReport({ fail_map: { 'README.md': failures } }),
    );
    expect(lycheeReport({ error_map: { 'README.md': failures } }).count).toBe(1);
  });

  it('shows a status it does not know as JSON, and a bare code', () => {
    const { markdown } = lycheeReport({
      fail_map: {
        'a.md': [
          { url: 'u', status: { odd: 1 } },
          { url: 'v', status: { code: 500 } },
        ],
      },
    });
    expect(markdown).toContain('- u — {"odd":1}');
    expect(markdown).toContain('- v — 500');
  });

  it('is clean without failures, and links the run', () => {
    expect(lycheeReport({}).count).toBe(0);
    expect(lycheeReport({ fail_map: {} }, { runUrl: 'https://run/2' }).markdown).toMatch(
      /From https:\/\/run\/2\.$/,
    );
  });
});

describe('main', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-report-'));
  const file = (name, value) => {
    const p = path.join(dir, name);
    writeFileSync(p, JSON.stringify(value));
    return p;
  };
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('counts each tool from its report file', () => {
    expect(main(['knip', file('k.json', { files: ['a'] })], {})).toBe(1);
    expect(main(['jscpd', file('j.json', { statistics: { total: { clones: 2 } } })], {})).toBe(2);
  });

  it('writes the lychee report, linking the run', () => {
    const out = path.join(dir, 'links.md');
    const env = {
      GITHUB_RUN_ID: '9',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'o/r',
    };
    const input = file('l.json', { fail_map: { 'a.md': [{ url: 'u', status: 'gone' }] } });
    expect(main(['lychee', input, out], env)).toBe(1);
    expect(readFileSync(out, 'utf8')).toContain('From https://github.com/o/r/actions/runs/9.');
  });

  it('refuses an unknown tool or a lychee run with nowhere to write', () => {
    const input = file('e.json', {});
    expect(() => main(['eslint', input], {})).toThrow('unknown tool eslint');
    expect(() => main(['lychee', input], {})).toThrow('needs the report path');
  });
});
