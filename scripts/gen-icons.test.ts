import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  main,
  parseIcon,
  pathOf,
  pathsIn,
  renderIcons,
  svgUrl,
  type Io,
  type Paths,
} from './gen-icons.ts';

afterEach(() => vi.restoreAllMocks());

const svg = (d: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path d="${d}"/></svg>`;

// Google's downloads, for a few icons: each cut's path names its icon and cut.
const SVGS: Record<string, string> = Object.fromEntries(
  ['search/default', 'star/default', 'star/fill1', 'home/wght500fill1', 'close/default'].map(
    (key) => {
      const [name, style] = key.split('/');
      return [
        svgUrl(name, style === 'default' ? 'outline' : style === 'fill1' ? 'fill' : 'pin'),
        svg(`M0 ${name.length}h${style.length}Z`),
      ];
    },
  ),
);

/** An Io over SVGS and an in-memory file; `written` is what main wrote. */
function fakeIo(existing: string | null = null) {
  const written: string[] = [];
  const io: Io = {
    fetch: vi.fn((url: string) =>
      Promise.resolve({
        ok: url in SVGS,
        status: url in SVGS ? 200 : 404,
        text: () => Promise.resolve(SVGS[url] ?? 'Not Found'),
      }),
    ),
    read: () => existing,
    write: (_file, text) => written.push(text),
  };
  return { io, written };
}

describe('svgUrl', () => {
  it('asks for each cut by Google’s style name, at 24 px', () => {
    const base = 'https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined';
    expect(svgUrl('star', 'outline')).toBe(`${base}/star/default/24px.svg`);
    expect(svgUrl('star', 'fill')).toBe(`${base}/star/fill1/24px.svg`);
    expect(svgUrl('home', 'pin')).toBe(`${base}/home/wght500fill1/24px.svg`);
  });
});

describe('pathOf', () => {
  it('reads the one path of an icon in the 960-unit box', () => {
    expect(pathOf(svg('M440-440H200v-80Z'))).toBe('M440-440H200v-80Z');
  });

  it('refuses an SVG in another box, with more than one path, or none', () => {
    expect(pathOf('<svg viewBox="0 0 24 24"><path d="M1 1Z"/></svg>')).toBeNull();
    expect(pathOf('<svg width="24" height="24"><path d="M1 1Z"/></svg>')).toBeNull();
    expect(
      pathOf('<svg viewBox="0 -960 960 960"><path d="M1 1Z"/><path d="M2 2Z"/></svg>'),
    ).toBeNull();
    expect(pathOf('<svg viewBox="0 -960 960 960"></svg>')).toBeNull();
    expect(pathOf('404: Not Found')).toBeNull();
  });

  it('refuses a path with anything but path data in it', () => {
    expect(pathOf(svg("M1 1Z' onload='x"))).toBeNull();
  });
});

describe('parseIcon', () => {
  it('reads an outlined icon, a filled one (outlined too), and a pin', () => {
    expect(parseIcon('search')).toEqual({ name: 'search', cuts: ['outline'] });
    expect(parseIcon('star:fill')).toEqual({ name: 'star', cuts: ['outline', 'fill'] });
    expect(parseIcon('home:pin')).toEqual({ name: 'home', cuts: ['pin'] });
  });

  it('refuses anything else', () => {
    for (const arg of ['', 'Search', 'star:bold', 'a b', 'star:', '../x']) {
      expect(parseIcon(arg)).toBeNull();
    }
  });
});

const names = (paths: Paths) => ({
  outline: [...paths.outline.keys()].sort(),
  fill: [...paths.fill.keys()].sort(),
  pin: [...paths.pin.keys()].sort(),
});

describe('renderIcons and pathsIn', () => {
  it('writes each cut’s list in order, typed by its names, and reads them back', () => {
    const paths: Paths = {
      outline: new Map([
        ['star', 'M2Z'],
        ['add', 'M1Z'],
      ]),
      fill: new Map([['star', 'M3Z']]),
      pin: new Map(),
    };
    const text = renderIcons(paths);
    expect(text).toContain("don't edit a path by hand");
    expect(text).toContain(
      "export const ICONS = {\n  'add': 'M1Z',\n  'star': 'M2Z',\n} as const;",
    );
    expect(text).toContain("export const FILLED_ICONS = {\n  'star': 'M3Z',\n} as const;");
    expect(text).toContain('export const PIN_ICONS = {\n\n} as const;');
    expect(text).toContain('export type FillableIconName = keyof typeof FILLED_ICONS;');
    expect(pathsIn(text)).toEqual(paths);
  });

  it('reads an entry Prettier put on two lines', () => {
    const text = "export const ICONS = {\n  add_a_photo:\n    'M440-440Z',\n} as const;";
    expect(pathsIn(text).outline).toEqual(new Map([['add_a_photo', 'M440-440Z']]));
  });

  it('reads nothing from an empty file', () => {
    expect(pathsIn('')).toEqual({ outline: new Map(), fill: new Map(), pin: new Map() });
  });
});

describe('main', () => {
  it('adds the icons named, laid out by Prettier', async () => {
    const { io, written } = fakeIo();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['star:fill', 'home:pin'], io, 'src/lib/iconPaths.ts');
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('export const ICONS = {\n  star: ');
    expect(names(pathsIn(written[0]))).toEqual({
      outline: ['star'],
      fill: ['star'],
      pin: ['home'],
    });
    expect(log).toHaveBeenCalledWith(
      'fetched 3; src/lib/iconPaths.ts has 2 icons (1 outline, 1 fill, 1 pin)',
    );
  });

  it('fetches only the icons it adds, keeping the rest as they are', async () => {
    const existing = renderIcons({
      outline: new Map([['search', 'kept']]),
      fill: new Map(),
      pin: new Map([['home', 'kept']]),
    });
    const { io, written } = fakeIo(existing);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await main(['close', 'search'], io, 'src/lib/iconPaths.ts');
    expect(io.fetch).toHaveBeenCalledTimes(1);
    expect(io.fetch).toHaveBeenCalledWith(svgUrl('close', 'outline'));
    const paths = pathsIn(written[0]);
    expect(names(paths)).toEqual({ outline: ['close', 'search'], fill: [], pin: ['home'] });
    expect(paths.outline.get('search')).toBe('kept');
    expect(paths.pin.get('home')).toBe('kept');
  });

  it('fetches every icon the file lists again when none is named', async () => {
    const existing = renderIcons({
      outline: new Map([['search', 'old']]),
      fill: new Map(),
      pin: new Map([['home', 'old']]),
    });
    const { io, written } = fakeIo(existing);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await main([], io, 'src/lib/iconPaths.ts');
    expect(io.fetch).toHaveBeenCalledTimes(2);
    expect(pathsIn(written[0])).toEqual({
      outline: new Map([['search', 'M0 6h7Z']]),
      fill: new Map(),
      pin: new Map([['home', 'M0 4h12Z']]),
    });
  });

  it('names the icon a failed request was for, and writes nothing', async () => {
    const { io, written } = fakeIo();
    vi.mocked(io.fetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(main(['search'], io, 'out.ts')).rejects.toThrow(
      `gen-icons: no outline cut of "search" (${svgUrl('search', 'outline')}: fetch failed)`,
    );
    expect(written).toEqual([]);
  });

  it('names an icon Google doesn’t have, and writes nothing', async () => {
    const { io, written } = fakeIo();
    await expect(main(['nope'], io, 'out.ts')).rejects.toThrow(
      `gen-icons: no outline cut of "nope" (${svgUrl('nope', 'outline')}: HTTP 404)`,
    );
    expect(written).toEqual([]);
  });

  it('refuses an SVG it can’t read as an icon', async () => {
    const { io } = fakeIo();
    SVGS[svgUrl('odd', 'outline')] = '<svg viewBox="0 0 24 24"><path d="M1 1Z"/></svg>';
    try {
      await expect(main(['odd'], io, 'out.ts')).rejects.toThrow("isn't a one-path icon");
    } finally {
      delete SVGS[svgUrl('odd', 'outline')];
    }
  });

  it('refuses a name it can’t read, and a run with nothing to fetch, as usage errors', async () => {
    const { io } = fakeIo();
    await expect(main(['Star'], io, 'out.ts')).rejects.toMatchObject({ exitCode: 2 });
    await expect(main([], io, 'out.ts')).rejects.toMatchObject({
      exitCode: 2,
      message: 'gen-icons: out.ts lists no icons; name one',
    });
    expect(io.fetch).not.toHaveBeenCalled();
  });
});
