import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// ffmpeg itself isn't run here: what's asked of it is checked instead.
const execSpy = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: execSpy }));

import {
  LIVE_GRAPHQL,
  PHOTO_CACHE,
  cachePhotos,
  describeFailed,
  photoFile,
  POINTER_LAYER_ID,
  activeRange,
  concatList,
  cropFilter,
  cropOf,
  pngSize,
  POINTER_EVERY_MS,
  FIRST_FRAME_MS,
  type ScreencastFrame,
  drawPointer,
  frameName,
  framesToGif,
  gifArgs,
  click,
  drag,
  glide,
  scroll,
  smoothstep,
  STEP_MS,
  liveSite,
  pictureSource,
  CDN_QUALITY,
  CDN_WIDTH,
  PRODUCTION,
  offFrame,
  osmTile,
  recordFrames,
  showPointer,
  shownFrames,
  sideBySide,
  sideBySideArgs,
  steadyGifArgs,
  waitForPhotos,
  type Point,
  type Timing,
} from './pr-gif';

const PALETTE =
  'split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';

const temp = () => mkdtempSync(join(tmpdir(), 'pr-gif-'));

beforeEach(() => {
  execSpy.mockReset();
});

describe('showPointer', () => {
  it('draws the pointer from an init script, on every page the context opens', async () => {
    const addInitScript = vi.fn(() => Promise.resolve());
    await showPointer({ addInitScript });
    expect(addInitScript).toHaveBeenCalledWith(drawPointer);
  });
});

describe('drawPointer (in the page)', () => {
  const layer = () => document.getElementById(POINTER_LAYER_ID);
  const part = (name: string) => layer()!.querySelector<HTMLElement>(`[data-part="${name}"]`)!;
  const trail = () => layer()!.querySelectorAll('[data-part="trail"]');
  const pointer = (type: string, x: number, y: number) =>
    window.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }));
  const wheel = (deltaX: number, deltaY: number) =>
    window.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY }));
  const key = (k: string, mods: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...mods }));
  const pointerState = () =>
    (window as unknown as { __prGifPointer?: Point & { known: boolean } }).__prGifPointer;

  // Each test starts on a page with no layer and no listeners left over.
  let listeners: [string, EventListenerOrEventListenerObject, unknown][];
  beforeEach(() => {
    vi.useFakeTimers();
    listeners = [];
    const add = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, options) => {
      if (fn) listeners.push([type, fn, options]);
      add(type, fn, options);
    });
  });
  afterEach(() => {
    for (const [type, fn, options] of listeners) {
      window.removeEventListener(type, fn, options as EventListenerOptions);
    }
    layer()?.remove();
    delete (window as unknown as { __prGifPointer?: unknown }).__prGifPointer;
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('lays a layer over the page that can never take a pointer event', () => {
    drawPointer();
    expect(layer()!.style.cssText).toBe(
      'position: fixed; inset: 0px; z-index: 99999; pointer-events: none; overflow: hidden;',
    );
    expect(layer()!.parentElement).toBe(document.documentElement);
    // The arrow is drawn above the ring, and waits off-screen for a move.
    expect([...layer()!.children].map((c) => (c as HTMLElement).dataset.part)).toEqual([
      'ring',
      'arrow',
      'wheel',
      'keys',
    ]);
    expect(part('arrow').style.transform).toBe('translate(-100px,-100px)');
    expect(part('arrow').querySelector('svg path')?.getAttribute('fill')).toBe('#000');
    expect(pointerState()).toEqual({ x: -100, y: -100, known: false });
  });

  it('listens on the capture phase, where the page can’t stop an event', () => {
    drawPointer();
    expect(listeners.map(([type, , options]) => [type, options])).toEqual(
      ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'wheel', 'keydown'].map(
        (type) => [type, { capture: true, passive: true }],
      ),
    );
  });

  it('waits for the DOM while the page is still loading', () => {
    const state = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    drawPointer();
    expect(layer()).toBeNull();
    state.mockReturnValue('interactive');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(layer()).not.toBeNull();
    // Only once.
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(document.querySelectorAll(`#${POINTER_LAYER_ID}`)).toHaveLength(1);
  });

  it('adds one layer however many times it runs', () => {
    drawPointer();
    drawPointer();
    expect(document.querySelectorAll(`#${POINTER_LAYER_ID}`)).toHaveLength(1);
  });

  it('puts the arrow’s tip on the pointer as it moves, and says where it is', () => {
    drawPointer();
    pointer('pointermove', 120, 80);
    expect(part('arrow').style.transform).toBe('translate(119px, 79px)');
    expect(part('ring').style.left).toBe('120px');
    expect(part('ring').style.top).toBe('80px');
    expect(part('wheel').style.left).toBe('120px');
    expect(part('wheel').style.top).toBe('80px');
    expect(pointerState()).toEqual({ x: 120, y: 80, known: true });
    // A plain move leaves no trail.
    expect(trail()).toHaveLength(0);
  });

  it('keeps the pointer where it was across a page load', () => {
    drawPointer();
    pointer('pointermove', 120, 80);
    expect(JSON.parse(sessionStorage.getItem('prGif:pointer')!)).toEqual({ x: 120, y: 80 });
    // The page loads again: a new layer, from the init script.
    layer()!.remove();
    drawPointer();
    expect(part('arrow').style.transform).toBe('translate(119px, 79px)');
    expect(part('ring').style.left).toBe('120px');
    expect(pointerState()).toEqual({ x: 120, y: 80, known: true });
  });

  it('starts off the page when what’s saved can’t be read, or there’s no storage', () => {
    sessionStorage.setItem('prGif:pointer', '{not json');
    drawPointer();
    expect(pointerState()).toEqual({ x: -100, y: -100, known: false });
    layer()!.remove();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    drawPointer();
    expect(pointerState()).toEqual({ x: -100, y: -100, known: false });
    expect(() => pointer('pointermove', 10, 10)).not.toThrow();
    expect(pointerState()).toEqual({ x: 10, y: 10, known: true });
  });

  it('rings a press, and lets the ring go on release', () => {
    drawPointer();
    const ring = part('ring');
    expect(ring.style.opacity).toBe('0');
    expect(ring.style.width).toBe('34px');
    expect(ring.style.border).toBe('3px solid rgb(225, 29, 72)');
    pointer('pointerdown', 40, 50);
    expect(ring.style.opacity).toBe('1');
    expect(ring.style.transform).toBe('scale(1)');
    // At once, so even a short press is in a frame.
    expect(ring.style.transition).toBe('none');
    // At the press, even with no move before it.
    expect(ring.style.left).toBe('40px');
    pointer('pointerup', 40, 50);
    expect(ring.style.opacity).toBe('0');
    expect(ring.style.transform).toBe('scale(1.6)');
    // Slowly, so a quick click is still seen going.
    expect(ring.style.transition).toBe('opacity 350ms ease-out, transform 350ms ease-out');
    pointer('pointerdown', 40, 50);
    pointer('pointercancel', 40, 50);
    expect(ring.style.opacity).toBe('0');
  });

  it('leaves a fading trail while it drags, and none once released', () => {
    drawPointer();
    pointer('pointerdown', 10, 10);
    pointer('pointermove', 20, 12);
    pointer('pointermove', 30, 14);
    const dots = trail();
    expect(dots).toHaveLength(2);
    const dot = dots[1] as HTMLElement;
    expect(dot.style.left).toBe('30px');
    expect(dot.style.top).toBe('14px');
    // Under the arrow.
    expect(dot.nextElementSibling).toBe(part('arrow'));
    expect(dot.style.opacity).toBe('0.85');
    vi.advanceTimersByTime(20);
    expect(dot.style.opacity).toBe('0');
    vi.advanceTimersByTime(629);
    expect(trail()).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(trail()).toHaveLength(0);

    pointer('pointerup', 30, 14);
    pointer('pointermove', 40, 16);
    expect(trail()).toHaveLength(0);
  });

  it('shows which way the wheel scrolls, then fades once it stops', () => {
    drawPointer();
    const badge = part('wheel');
    expect(badge.style.opacity).toBe('0');
    wheel(0, 120);
    expect(badge.textContent).toBe('↓');
    expect(badge.style.opacity).toBe('1');
    wheel(0, -120);
    expect(badge.textContent).toBe('↑');
    wheel(80, 10);
    expect(badge.textContent).toBe('→');
    wheel(-80, 10);
    expect(badge.textContent).toBe('←');
    // A tie goes to the vertical.
    wheel(50, 50);
    expect(badge.textContent).toBe('↓');
    // It stays while the wheel keeps going.
    vi.advanceTimersByTime(399);
    wheel(0, 50);
    vi.advanceTimersByTime(399);
    expect(badge.style.opacity).toBe('1');
    vi.advanceTimersByTime(1);
    expect(badge.style.opacity).toBe('0');
  });

  it('names each key pressed at the bottom, then fades', () => {
    drawPointer();
    const label = part('keys');
    expect(label.style.opacity).toBe('0');
    expect(label.style.bottom).toBe('16px');
    expect(label.style.left).toBe('50%');
    const shown: [string, KeyboardEventInit?][] = [
      ['Tab'],
      ['Tab', { shiftKey: true }],
      ['ArrowRight'],
      ['ArrowLeft'],
      ['ArrowUp'],
      ['ArrowDown'],
      ['Enter'],
      ['Escape'],
      [' '],
      ['k', { ctrlKey: true }],
      ['k', { metaKey: true, shiftKey: true }],
      ['a', { altKey: true }],
    ];
    const names = shown.map(([k, mods]) => {
      key(k, mods);
      return label.textContent;
    });
    expect(names).toEqual([
      'Tab',
      'Shift+Tab',
      '→',
      '←',
      '↑',
      '↓',
      'Enter',
      'Esc',
      'Space',
      'Ctrl+K',
      'Cmd+Shift+K',
      'Alt+A',
    ]);
    expect(label.style.opacity).toBe('1');
    vi.advanceTimersByTime(599);
    expect(label.style.opacity).toBe('1');
    vi.advanceTimersByTime(1);
    expect(label.style.opacity).toBe('0');
  });

  it('puts the label at the bottom of the recorded area', () => {
    drawPointer();
    const label = part('keys');
    (window as unknown as { __prGifClip?: unknown }).__prGifClip = {
      x: 100,
      y: 80,
      width: 600,
      height: 300,
    };
    try {
      key('Tab');
      expect(label.style.left).toBe('400px');
      // 16px up from the clip's bottom edge, at y = 380.
      expect(label.style.bottom).toBe(`${innerHeight - 380 + 16}px`);
    } finally {
      delete (window as unknown as { __prGifClip?: unknown }).__prGifClip;
    }
    key('Enter');
    expect(label.style.left).toBe('50%');
    expect(label.style.bottom).toBe('16px');
  });

  it('says nothing for a modifier on its own', () => {
    drawPointer();
    const label = part('keys');
    key('Tab');
    for (const modifier of ['Shift', 'Control', 'Alt', 'Meta']) key(modifier, { shiftKey: true });
    expect(label.textContent).toBe('Tab');
  });

  it('builds up text as it’s typed, spaces too, and starts afresh after a pause or another key', () => {
    drawPointer();
    const label = part('keys');
    key('B', { shiftKey: true });
    key('i');
    key('g');
    key(' ');
    key('S', { shiftKey: true });
    key('u');
    expect(label.textContent).toBe('Big Su');
    vi.advanceTimersByTime(600);
    key('r');
    expect(label.textContent).toBe('r');
    key('Enter');
    key('k');
    expect(label.textContent).toBe('k');
    // A space that isn't part of typing is a key press.
    key('Tab');
    key(' ');
    expect(label.textContent).toBe('Space');
  });
});

describe('smoothstep', () => {
  it('eases from 0 to 1, holding either end', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.25)).toBeCloseTo(0.15625);
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
  });
});

// A page whose mouse notes what it's sent, and when.
function fakePage() {
  const start = performance.now();
  const sent: { at: number; what: string; x?: number; y?: number }[] = [];
  const note = (what: string, x?: number, y?: number) => {
    sent.push({ at: performance.now() - start, what, x, y });
    return Promise.resolve();
  };
  const mouse = {
    move: (x: number, y: number) => note('move', x, y),
    down: () => note('down'),
    up: () => note('up'),
    wheel: (_dx: number, dy: number) => note('wheel', 0, dy),
  };
  return { page: { mouse }, sent };
}

describe('glide', () => {
  it('puts the pointer straight on the middle of a target the first time', async () => {
    const { page, sent } = fakePage();
    const target = { boundingBox: () => Promise.resolve({ x: 10, y: 20, width: 100, height: 40 }) };
    expect(await glide(page, target)).toEqual({ x: 60, y: 40 });
    expect(sent.every((s) => s.x === 60 && s.y === 40)).toBe(true);
  });

  it('then moves by the clock from where it was, easing in and out', async () => {
    const { page, sent } = fakePage();
    await glide(page, { x: 0, y: 0 }, 0);
    expect(sent).toHaveLength(1);
    expect(await glide(page, { x: 100, y: 50 }, 200)).toEqual({ x: 100, y: 50 });
    const moves = sent.slice(1);
    // About one move every STEP_MS for the time asked, not all at once.
    expect(STEP_MS).toBe(16);
    expect(moves.length).toBeGreaterThan(4);
    expect(moves[moves.length - 1].at - moves[0].at).toBeGreaterThanOrEqual(190);
    // Along the line, never back, and ending on the target.
    for (const m of moves) expect(m.y).toBeCloseTo(m.x! / 2);
    const xs = moves.map((m) => m.x!);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[0]).toBeLessThan(20);
    expect(moves[moves.length - 1]).toMatchObject({ x: 100, y: 50 });
    // The next one starts from there.
    await glide(page, { x: 100, y: 150 }, 50);
    expect(sent[moves.length + 1]).toMatchObject({ x: 100 });
    expect(sent[moves.length + 1].y).toBeLessThan(60);
  });

  it('says so when the target isn’t on the page', async () => {
    const { page } = fakePage();
    await expect(glide(page, { boundingBox: () => Promise.resolve(null) })).rejects.toThrow(
      'glide: the target has no box',
    );
  });
});

describe('click', () => {
  it('glides there, pauses, and holds the button long enough to be seen', async () => {
    const { page, sent } = fakePage();
    await glide(page, { x: 0, y: 0 }, 0);
    expect(await click(page, { x: 30, y: 40 }, { ms: 50 })).toEqual({ x: 30, y: 40 });
    const down = sent.find((s) => s.what === 'down')!;
    const up = sent.find((s) => s.what === 'up')!;
    const lastMove = sent.filter((s) => s.what === 'move').pop()!;
    expect(lastMove).toMatchObject({ x: 30, y: 40 });
    expect(down.at - lastMove.at).toBeGreaterThanOrEqual(140);
    expect(up.at - down.at).toBeGreaterThanOrEqual(190);
    expect(sent.indexOf(up)).toBe(sent.length - 1);
  });

  it('takes how long to hold', async () => {
    const { page, sent } = fakePage();
    await click(page, { x: 1, y: 1 }, { holdMs: 0 });
    const down = sent.find((s) => s.what === 'down')!;
    const up = sent.find((s) => s.what === 'up')!;
    expect(up.at - down.at).toBeLessThan(100);
  });
});

describe('drag', () => {
  it('presses at one point, moves by the clock to the other, and lets go there', async () => {
    const { page, sent } = fakePage();
    await drag(page, { x: 0, y: 0 }, { x: 200, y: 0 }, 150);
    const what = sent.map((s) => s.what);
    const down = what.indexOf('down');
    const up = what.indexOf('up');
    expect(sent[down - 1]).toMatchObject({ x: 0, y: 0 });
    expect(up).toBe(sent.length - 1);
    const during = sent.slice(down + 1, up);
    expect(during.every((s) => s.what === 'move')).toBe(true);
    expect(during.length).toBeGreaterThan(3);
    expect(during[during.length - 1]).toMatchObject({ x: 200 });
    // A moment held at either end.
    expect(during[0].at - sent[down].at).toBeGreaterThanOrEqual(240);
    expect(sent[up].at - during[during.length - 1].at).toBeGreaterThanOrEqual(240);
  });
});

describe('scroll', () => {
  it('turns the wheel a little at a time, by the clock, to the whole distance', async () => {
    const { page, sent } = fakePage();
    await scroll(page, 300, 200);
    const turns = sent.map((s) => s.y!);
    expect(turns.length).toBeGreaterThan(4);
    expect(turns.every((dy) => dy > 0)).toBe(true);
    expect(turns.reduce((a, b) => a + b, 0)).toBe(300);
    expect(sent[sent.length - 1].at - sent[0].at).toBeGreaterThanOrEqual(150);
  });

  it('goes up too, and sends nothing while the eased distance hasn’t moved', async () => {
    const { page, sent } = fakePage();
    await scroll(page, -2, 100);
    expect(sent.map((s) => s.y)).toEqual([-1, -1]);
    await scroll(page, 0, 0);
    expect(sent).toHaveLength(2);
  });
});

describe('frameName', () => {
  it('numbers frames to four digits', () => {
    expect(frameName(0)).toBe('f0000.png');
    expect(frameName(42)).toBe('f0042.png');
    expect(frameName(1234)).toBe('f1234.png');
  });
});

describe('offFrame', () => {
  const clip = { x: 0, y: 100, width: 400, height: 200 };
  const times = [0, 100, 200, 300, 400, 500, 600, 700, 800];
  const inside = { x: 10, y: 150 };

  it('finds where the pointer rested outside the clip for over half a second', () => {
    const below = { x: 10, y: 350 };
    const pointer = [inside, below, below, below, below, below, below, inside, inside];
    expect(offFrame(times, pointer, clip)).toEqual([{ from: 100, to: 700 }]);
  });

  it('lets a shorter trip outside go', () => {
    const above = { x: 10, y: 99 };
    const pointer = [inside, above, above, above, above, above, inside, inside, inside];
    // Exactly 500 ms isn't over it.
    expect(offFrame(times, pointer, clip)).toEqual([]);
  });

  it('counts each edge: the clip runs up to, not including, x + width and y + height', () => {
    expect(
      offFrame(
        [0, 1000],
        [
          { x: 0, y: 100 },
          { x: 399, y: 299 },
        ],
        clip,
        0,
      ),
    ).toEqual([]);
    for (const p of [
      { x: -1, y: 150 },
      { x: 400, y: 150 },
      { x: 10, y: 99 },
      { x: 10, y: 300 },
    ]) {
      expect(offFrame([0, 1000, 2000], [p, p, inside], clip, 0)).toEqual([{ from: 0, to: 2000 }]);
    }
  });

  it('closes a stretch still open at the end, and ignores a pointer that hasn’t moved', () => {
    const away = { x: 900, y: 900 };
    expect(offFrame([0, 600, 1200], [away, away, away], clip)).toEqual([{ from: 0, to: 1200 }]);
    expect(offFrame([0, 600, 1200], [null, null, null], clip)).toEqual([]);
    expect(offFrame([0, 600, 1200], [null, away, away], clip)).toEqual([{ from: 600, to: 1200 }]);
    expect(offFrame([], [], clip)).toEqual([]);
  });
});

describe('pngSize', () => {
  it('reads a PNG’s width and height from its header', () => {
    expect(pngSize(png(2200, 1280))).toEqual({ width: 2200, height: 1280 });
    // From a slice of a larger buffer too.
    const inside = Buffer.concat([Buffer.from('xx'), png(10, 20)]).subarray(2);
    expect(pngSize(inside)).toEqual({ width: 10, height: 20 });
  });
});

describe('cropOf', () => {
  it('scales the clip to the frames’ pixels, rounding', () => {
    expect(cropOf({ x: 0, y: 80, width: 1100, height: 560 }, 2)).toEqual({
      x: 0,
      y: 160,
      width: 2200,
      height: 1120,
    });
    expect(cropOf({ x: 1, y: 1, width: 3, height: 3 }, 1.5)).toEqual({
      x: 2,
      y: 2,
      width: 5,
      height: 5,
    });
  });
});

// A PNG's first 24 bytes, its size in the header, and `tag` after.
function png(width: number, height: number, tag = ''): Buffer {
  const head = Buffer.alloc(24);
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.from(tag)]);
}

describe('recordFrames', () => {
  // A page whose screencast sends a frame every 5 ms once started, each
  // stamped (in seconds) as `stamps` says, until it's stopped.
  function fakePage({
    at,
    stamps = (n: number) => 1000 + n * 0.01,
    width = 1100,
    fail,
    silent,
  }: {
    at?: () => Point | null;
    stamps?: (n: number) => number | undefined;
    width?: number;
    fail?: boolean;
    silent?: boolean;
  } = {}) {
    let listener: ((frame: ScreencastFrame) => void) | undefined;
    let sending: ReturnType<typeof setInterval> | undefined;
    let n = 0;
    const cdp = {
      on: vi.fn((_event: string, fn: (frame: ScreencastFrame) => void) => {
        listener = fn;
      }),
      send: vi.fn<(method: string, params?: object) => Promise<void>>((method) => {
        if (method === 'Page.startScreencast' && !silent) {
          sending = setInterval(() => {
            const i = n++;
            listener?.({
              data: png(width, 640, `frame ${i}`).toString('base64'),
              sessionId: i,
              metadata: { deviceWidth: 1100, timestamp: stamps(i) },
            });
          }, 5);
        }
        if (method === 'Page.stopScreencast') clearInterval(sending);
        return Promise.resolve();
      }),
      detach: vi.fn(() => Promise.resolve()),
    };
    const page = {
      context: () => ({
        newCDPSession: vi.fn(() =>
          fail ? Promise.reject(new Error('target closed')) : Promise.resolve(cdp),
        ),
      }),
      // The real one runs in the page: here, a pointer the test decides.
      evaluate: vi.fn((_fn: unknown, arg?: unknown) =>
        Promise.resolve(arg === undefined && at ? at() : null),
      ),
    };
    return {
      page,
      cdp,
      sent: () => n,
      recordable: page as unknown as Parameters<typeof recordFrames>[0],
    };
  }
  const frameText = (dir: string, i: number) =>
    readFileSync(join(dir, frameName(i)))
      .subarray(24)
      .toString();

  it('saves every frame painted until stopped, in order, noting each one’s time', async () => {
    const dir = join(temp(), 'frames');
    // Whatever was there goes.
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'stale.png'), 'old');
    const { page, cdp, sent, recordable } = fakePage({ at: () => ({ x: 5, y: 5 }) });
    const clip = { x: 0, y: 80, width: 900, height: 400 };
    const stop = recordFrames(recordable, clip, dir);
    await new Promise((r) => setTimeout(r, 80));
    const { frames, fps, warnings } = await stop();
    expect(frames).toBeGreaterThan(3);
    expect(frames).toBe(sent());
    expect(readdirSync(dir).sort()).toEqual([
      ...Array.from({ length: frames }, (_, i) => frameName(i)),
      'timing.json',
    ]);
    expect(frameText(dir, 0)).toBe('frame 0');
    expect(frameText(dir, frames - 1)).toBe(`frame ${frames - 1}`);
    // Every frame, as PNG, each acknowledged so the next comes.
    expect(cdp.send.mock.calls[0]).toEqual([
      'Page.startScreencast',
      { format: 'png', everyNthFrame: 1 },
    ]);
    const acks = cdp.send.mock.calls.filter(([method]) => method === 'Page.screencastFrameAck');
    expect(acks.map(([, params]) => params)).toEqual(
      Array.from({ length: frames }, (_, i) => ({ sessionId: i })),
    );
    expect(cdp.send).toHaveBeenLastCalledWith('Page.stopScreencast');
    expect(cdp.detach).toHaveBeenCalledTimes(1);
    // Frames a second, over the whole recording.
    expect(fps).toBeGreaterThan(frames / 1);
    expect(fps).toBeLessThan(frames / 0.05);
    expect(warnings).toEqual([]);
    // It tells the page what's recorded before anything else.
    expect(page.evaluate.mock.calls[0][1]).toEqual(clip);

    const timing = JSON.parse(readFileSync(join(dir, 'timing.json'), 'utf8')) as Timing;
    expect(timing.clip).toEqual(clip);
    // Frames as wide as the viewport: the clip as it is.
    expect(timing.crop).toEqual(clip);
    expect(timing.times).toHaveLength(frames);
    expect(timing.times[0]).toBeGreaterThanOrEqual(0);
    expect(timing.times[0]).toBeLessThan(40);
    // By the page's own clock: 10 ms apart, as stamped.
    for (let i = 1; i < frames; i++) {
      expect(timing.times[i] - timing.times[i - 1]).toBeCloseTo(10, 5);
    }
    expect(timing.end).toBeGreaterThan(70);
    // Where the pointer was, looked up as it went.
    expect(timing.pointer.at.length).toBeGreaterThan(0);
    expect(timing.pointer.at.length).toBe(timing.pointer.times.length);
    expect(timing.pointer.at[0]).toEqual({ x: 5, y: 5 });
    expect(POINTER_EVERY_MS).toBe(100);
    // Nothing more once stopped.
    await new Promise((r) => setTimeout(r, 20));
    expect(sent()).toBe(frames);
  });

  it('puts frames that arrive out of order back in the order they were painted', async () => {
    const dir = temp();
    // The second frame was painted before the first.
    const { recordable } = fakePage({ stamps: (n) => (n === 1 ? 999 : 1000 + n * 0.01) });
    const stop = recordFrames(recordable, { x: 0, y: 0, width: 10, height: 10 }, dir);
    await new Promise((r) => setTimeout(r, 40));
    await stop();
    expect(frameText(dir, 0)).toBe('frame 1');
    expect(frameText(dir, 1)).toBe('frame 0');
    expect(frameText(dir, 2)).toBe('frame 2');
    const { times } = JSON.parse(readFileSync(join(dir, 'timing.json'), 'utf8')) as Timing;
    // Never before the start.
    expect(times[0]).toBe(0);
  });

  it('crops in the frames’ pixels when they’re drawn at a higher density', async () => {
    const dir = temp();
    const { recordable } = fakePage({ width: 2200 });
    const stop = recordFrames(recordable, { x: 0, y: 80, width: 1100, height: 560 }, dir);
    await new Promise((r) => setTimeout(r, 20));
    await stop();
    const { crop } = JSON.parse(readFileSync(join(dir, 'timing.json'), 'utf8')) as Timing;
    expect(crop).toEqual({ x: 0, y: 160, width: 2200, height: 1120 });
  });

  it('goes by when frames arrive if they aren’t stamped', async () => {
    const dir = temp();
    const { recordable } = fakePage({ stamps: () => undefined });
    const stop = recordFrames(recordable, { x: 0, y: 0, width: 10, height: 10 }, dir);
    await new Promise((r) => setTimeout(r, 40));
    await stop();
    const { times } = JSON.parse(readFileSync(join(dir, 'timing.json'), 'utf8')) as Timing;
    expect(times.length).toBeGreaterThan(2);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('keeps at least the first frame, however soon it’s stopped', async () => {
    const dir = join(temp(), 'a', 'b');
    const { recordable } = fakePage();
    const stop = recordFrames(recordable, { x: 0, y: 0, width: 10, height: 10 }, dir);
    const { frames } = await stop();
    expect(frames).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dir, 'f0000.png'))).toBe(true);
  });

  it('warns when the pointer rests outside the clip', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { recordable } = fakePage({ at: () => ({ x: 950, y: 10 }) });
      const stop = recordFrames(recordable, { x: 0, y: 0, width: 900, height: 400 }, temp());
      await new Promise((r) => setTimeout(r, 700));
      const { warnings } = await stop();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(
        /^pr-gif: the pointer was outside the recorded area for 0\.\d s, from 0\.0 s; it won't show there$/,
      );
      expect(warn).toHaveBeenCalledWith(warnings[0]);
    } finally {
      warn.mockRestore();
    }
  });

  it('gives up on a screencast that sends nothing', async () => {
    vi.useFakeTimers();
    try {
      const { recordable } = fakePage({ silent: true });
      const stop = recordFrames(recordable, { x: 0, y: 0, width: 10, height: 10 }, temp());
      const stopped = stop();
      const failed = expect(stopped).rejects.toThrow('recordFrames: no frame came in 5 s');
      await vi.advanceTimersByTimeAsync(FIRST_FRAME_MS);
      await failed;
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failure from stop(), not as an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { recordable } = fakePage({ fail: true });
      const stop = recordFrames(recordable, { x: 0, y: 0, width: 10, height: 10 }, temp());
      await new Promise((r) => setTimeout(r, 40));
      expect(unhandled).not.toHaveBeenCalled();
      await expect(stop()).rejects.toThrow('target closed');
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('activeRange', () => {
  const times = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400];

  it('trims the stills at both ends, keeping a little before and after', () => {
    // Still to 0.6 s, changing to 0.9 s, still after.
    const hashes = 'aaaaaaabcdeeeee'.split('');
    expect(activeRange(hashes, times, { leadMs: 200, tailMs: 300 })).toEqual([5, 13]);
    // The defaults: 500 ms before, and up to 1.5 s after, the pause the GIF
    // ends on.
    expect(activeRange(hashes, times)).toEqual([2, 14]);
    // A longer still at the end is cut to 1.5 s.
    const long = Array.from({ length: 23 }, (_, i) => i * 100);
    expect(activeRange(['a', ...Array<string>(22).fill('b')], long)).toEqual([0, 16]);
  });

  it('keeps everything when nothing changes, and copes with nothing at all', () => {
    expect(activeRange(['a', 'a', 'a'], [0, 100, 200])).toEqual([0, 2]);
    expect(activeRange([], [])).toEqual([0, -1]);
  });

  it('keeps a recording that starts or ends on a change', () => {
    expect(activeRange(['a', 'b', 'c'], [0, 100, 200], { leadMs: 0, tailMs: 0 })).toEqual([1, 2]);
    expect(activeRange(['a', 'b', 'b'], [0, 100, 200], { leadMs: 100, tailMs: 0 })).toEqual([0, 1]);
  });
});

describe('shownFrames', () => {
  it('shows each frame for as long as it lasted, the last included', () => {
    expect(shownFrames([0, 80, 200, 260], 300, [1, 3])).toEqual([
      { frame: 1, ms: 120 },
      { frame: 2, ms: 60 },
      { frame: 3, ms: 40 },
    ]);
    expect(shownFrames([0, 100], 2500, [0, 1])).toEqual([
      { frame: 0, ms: 100 },
      { frame: 1, ms: 2400 },
    ]);
    expect(shownFrames([], 0, [0, -1])).toEqual([]);
  });

  it('merges a repeat into the frame it repeats, keeping how long it held', () => {
    expect(
      shownFrames([0, 100, 200, 300, 400, 1000], 1200, [0, 5], ['a', 'a', 'b', 'b', 'b', 'c']),
    ).toEqual([
      { frame: 0, ms: 200 },
      { frame: 2, ms: 800 },
      { frame: 5, ms: 200 },
    ]);
    // A, B, A isn't a repeat.
    expect(shownFrames([0, 100, 200], 300, [0, 2], ['a', 'b', 'a'])).toHaveLength(3);
  });
});

describe('concatList', () => {
  const entry = (frame: string, duration?: string) => [
    `file '${frame}'`,
    'option framerate 100',
    ...(duration ? [`duration ${duration}`] : []),
  ];

  it('reads each frame at 100 fps for its time, the last one listed twice', () => {
    expect(
      concatList([
        { frame: 1, ms: 120 },
        { frame: 2, ms: 60 },
        { frame: 3, ms: 1000 },
      ]),
    ).toBe(
      [
        'ffconcat version 1.0',
        ...entry('f0001.png', '0.120'),
        ...entry('f0002.png', '0.060'),
        ...entry('f0003.png', '1.000'),
        ...entry('f0003.png'),
        '',
      ].join('\n'),
    );
    expect(concatList([])).toBe('ffconcat version 1.0\n');
  });
});

describe('gifArgs', () => {
  it('scales down, shares one palette, loops forever', () => {
    expect(gifArgs('frames/frames.ffconcat', 'out/after.gif', 480)).toEqual([
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'frames/frames.ffconcat',
      '-vf',
      `scale=480:-1:flags=lanczos,${PALETTE}`,
      '-fps_mode',
      'vfr',
      '-loop',
      '0',
      'out/after.gif',
    ]);
    expect(gifArgs('l', 'o')[10]).toMatch(/^scale=600:-1:/);
  });

  it('cuts the frames to the clip first', () => {
    expect(gifArgs('l', 'o', 480, { x: 0, y: 160, width: 2200, height: 1120 })[10]).toBe(
      `crop=2200:1120:0:160,scale=480:-1:flags=lanczos,${PALETTE}`,
    );
  });
});

describe('cropFilter', () => {
  it('crops to the clip, then on to the next filter, or is nothing', () => {
    expect(cropFilter({ x: 1, y: 2, width: 3, height: 4 })).toBe('crop=3:4:1:2,');
    expect(cropFilter()).toBe('');
  });
});

describe('steadyGifArgs', () => {
  it('plays numbered frames at a steady rate', () => {
    expect(steadyGifArgs('frames', 'after.gif', 480, 14.5)).toEqual([
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      '14.5',
      '-i',
      join('frames', 'f%04d.png'),
      '-vf',
      `scale=480:-1:flags=lanczos,${PALETTE}`,
      '-loop',
      '0',
      'after.gif',
    ]);
    const args = steadyGifArgs('frames', 'after.gif');
    expect(args[args.indexOf('-framerate') + 1]).toBe('10');
    expect(args[args.indexOf('-vf') + 1]).toMatch(/^scale=600:-1:/);
  });
});

describe('sideBySideArgs', () => {
  it('labels each, holds the shorter on its last frame, and stacks them', () => {
    const args = sideBySideArgs(
      { list: 'b/side.ffconcat', ms: 3000 },
      { list: 'a/side.ffconcat', ms: 4250 },
      'out.gif',
      1012,
    );
    expect(args.slice(0, 15)).toEqual([
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'b/side.ffconcat',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'a/side.ffconcat',
    ]);
    expect(args[15]).toBe('-filter_complex');
    expect(args[16].split(';')).toEqual([
      '[0:v]fps=25,scale=500:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=1.250,pad=iw+12:ih+44:0:44:white,drawtext=text=Before:font=sans:fontsize=22:fontcolor=0x111827:x=12:y=10[Before]',
      '[1:v]fps=25,scale=500:-1:flags=lanczos,tpad=stop_mode=clone:stop_duration=0.000,pad=iw:ih+44:0:44:white,drawtext=text=After:font=sans:fontsize=22:fontcolor=0x111827:x=12:y=10[After]',
      '[Before][After]hstack=inputs=2,split[a][b]',
      '[a]palettegen=max_colors=96:stats_mode=diff[p]',
      '[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    ]);
    expect(args.slice(17)).toEqual(['-fps_mode', 'vfr', '-loop', '0', 'out.gif']);
    // Each cut to its own clip first.
    const cropped = sideBySideArgs(
      { list: 'b', ms: 1, crop: { x: 0, y: 80, width: 900, height: 400 } },
      { list: 'a', ms: 1, crop: { x: 0, y: 160, width: 1800, height: 800 } },
      'o',
    )[16].split(';');
    expect(cropped[0]).toMatch(/^\[0:v\]crop=900:400:0:80,fps=25,/);
    expect(cropped[1]).toMatch(/^\[1:v\]crop=1800:800:0:160,fps=25,/);
    // 1000 wide by default.
    expect(sideBySideArgs({ list: 'b', ms: 1 }, { list: 'a', ms: 1 }, 'o')[16]).toMatch(
      /scale=494:-1/,
    );
  });
});

// A recording as recordFrames leaves it: frames that change at the fourth
// and fifth, then hold.
const FAKE_TIMES = [0, 1000, 2000, 2100, 2200, 2300, 4000];
const FAKE_LOOKS = ['x', 'x', 'x', 'y', 'z', 'z', 'z'];
// sha1 of each frame's bytes, as framesToGif tells frames apart.
const FAKE_HASHES = FAKE_LOOKS.map((look) => createHash('sha1').update(look).digest('hex'));
function fakeRecording(dir: string) {
  mkdirSync(dir, { recursive: true });
  const looks = FAKE_LOOKS;
  looks.forEach((look, i) => writeFileSync(join(dir, frameName(i)), look));
  const timing: Timing = {
    clip: { x: 0, y: 0, width: 10, height: 10 },
    crop: { x: 0, y: 0, width: 20, height: 20 },
    times: FAKE_TIMES,
    pointer: { times: [], at: [] },
    end: 5000,
  };
  writeFileSync(join(dir, 'timing.json'), JSON.stringify(timing));
}

describe('framesToGif', () => {
  it('plays a recording at its own speed, trimmed, making the GIF’s directory first', () => {
    const dir = temp();
    fakeRecording(dir);
    const out = join(temp(), 'pics', 'after.gif');
    framesToGif(dir, out, { width: 480 });
    expect(existsSync(join(out, '..'))).toBe(true);
    const list = join(dir, 'frames.ffconcat');
    // From the frame just before the change to up to 1.5 s after it
    // settled, the repeated z frames merged into one.
    expect(readFileSync(join(dir, 'frames.ffconcat'), 'utf8').match(/^file '.*'$/gm)).toEqual([
      "file 'f0002.png'",
      "file 'f0003.png'",
      "file 'f0004.png'",
      "file 'f0004.png'",
    ]);
    expect(readFileSync(list, 'utf8')).toBe(
      concatList(shownFrames(FAKE_TIMES, 5000, [2, 5], FAKE_HASHES)),
    );
    // Cut to the clip, in the frames' pixels.
    const crop = { x: 0, y: 0, width: 20, height: 20 };
    expect(execSpy).toHaveBeenCalledWith('ffmpeg', gifArgs(list, out, 480, crop), {
      stdio: 'inherit',
    });
    framesToGif(dir, out);
    expect(execSpy).toHaveBeenLastCalledWith('ffmpeg', gifArgs(list, out, 600, crop), {
      stdio: 'inherit',
    });
  });

  it('plays frames with no timing.json at a steady rate', () => {
    const dir = temp();
    const out = join(dir, 'after.gif');
    framesToGif(dir, out, { width: 480, fps: 12 });
    expect(execSpy).toHaveBeenCalledWith('ffmpeg', steadyGifArgs(dir, out, 480, 12), {
      stdio: 'inherit',
    });
    framesToGif(dir, out);
    expect(execSpy).toHaveBeenLastCalledWith('ffmpeg', steadyGifArgs(dir, out, 600, 10), {
      stdio: 'inherit',
    });
  });
});

describe('sideBySide', () => {
  it('joins two recordings, each trimmed, the shorter held to the longer', () => {
    const before = temp();
    const after = temp();
    fakeRecording(before);
    fakeRecording(after);
    const out = join(temp(), 'side.gif');
    sideBySide(before, after, out, { width: 812 });
    const lists = [join(before, 'side.ffconcat'), join(after, 'side.ffconcat')];
    for (const list of lists) {
      expect(readFileSync(list, 'utf8')).toBe(
        concatList(shownFrames(FAKE_TIMES, 5000, [2, 5], FAKE_HASHES)),
      );
    }
    // Frames 2 to 4 show from 2000 ms; the last, merged with frame 5, holds
    // the 1800 ms it lasted: 100 + 100 + 1800.
    const crop = { x: 0, y: 0, width: 20, height: 20 };
    expect(execSpy).toHaveBeenCalledWith(
      'ffmpeg',
      sideBySideArgs(
        { list: lists[0], ms: 2000, crop },
        { list: lists[1], ms: 2000, crop },
        out,
        812,
      ),
      { stdio: 'inherit' },
    );
    sideBySide(before, after, out);
    expect(execSpy).toHaveBeenLastCalledWith(
      'ffmpeg',
      sideBySideArgs(
        { list: lists[0], ms: 2000, crop },
        { list: lists[1], ms: 2000, crop },
        out,
        1000,
      ),
      { stdio: 'inherit' },
    );
  });

  it('needs both recordings’ timing', () => {
    const before = temp();
    fakeRecording(before);
    expect(() => sideBySide(before, temp(), 'x.gif')).toThrow(
      'sideBySide: both recordings need their timing.json',
    );
    expect(() => sideBySide(temp(), before, 'x.gif')).toThrow('both recordings');
    expect(execSpy).not.toHaveBeenCalled();
  });
});

describe('osmTile', () => {
  it('maps a CARTO tile to the same OpenStreetMap tile', () => {
    expect(osmTile('https://a.basemaps.cartocdn.com/light_all/8/40/98.png')).toBe(
      'https://tile.openstreetmap.org/8/40/98.png',
    );
    expect(
      osmTile('https://d.basemaps.cartocdn.com/rastertiles/voyager/12/655/1582@2x.png?api_key=k'),
    ).toBeNull();
    expect(osmTile('https://c.basemaps.cartocdn.com/light_all/12/655/1582@2x.png?api_key=k')).toBe(
      'https://tile.openstreetmap.org/12/655/1582.png',
    );
    expect(osmTile('https://example.com/8/40/98.png')).toBeNull();
  });
});

describe('liveSite', () => {
  type Handler = (route: ReturnType<typeof readRoute>) => Promise<unknown>;
  async function routes(api?: string) {
    const added: [string | RegExp, Handler][] = [];
    const page = {
      route: vi.fn((match: string | RegExp, h: Handler) => {
        added.push([match, h]);
        return Promise.resolve();
      }),
    };
    await liveSite(page as unknown as Parameters<typeof liveSite>[0], api);
    return added;
  }
  function readRoute(body: { query?: string; operationName?: string } | null, response?: unknown) {
    return {
      request: () => ({ postDataJSON: () => body }),
      fetch: vi.fn(() =>
        response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
      ),
      fulfill: vi.fn(() => Promise.resolve()),
      fallback: vi.fn(() => Promise.resolve()),
      continue: vi.fn(() => Promise.resolve()),
    };
  }
  const answer = (json: unknown, ok = true) => ({
    ok: () => ok,
    json: () => Promise.resolve(json),
  });
  const read = (name: string) => ({ operationName: name, query: `query ${name} { a }` });

  it('routes the API, then the fonts', async () => {
    expect((await routes()).map(([match]) => String(match))).toEqual([
      '**/api/graphql',
      String(/fonts\.(googleapis|gstatic)\.com/),
    ]);
  });

  it('answers every read from production', async () => {
    const [[, reads]] = await routes();
    const response = answer({ data: { activities: [] } });
    const r = readRoute(
      { operationName: 'Activities', query: 'query Activities { activities { id } }' },
      response,
    );
    await reads(r);
    expect(r.fetch).toHaveBeenCalledWith({ url: LIVE_GRAPHQL });
    expect(r.fulfill).toHaveBeenCalledWith({ response, json: { data: { activities: [] } } });
    expect(r.fallback).not.toHaveBeenCalled();
    expect(PRODUCTION).toBe('https://fog-and-frontier.vercel.app');
    expect(LIVE_GRAPHQL).toBe('https://fog-and-frontier.vercel.app/api/graphql');
    // Any other production, and a read with space before it.
    const [[, other]] = await routes('https://example.com/api/graphql');
    const r2 = readRoute(
      { query: '  query DrivingMiles { drivingMiles { id } }' },
      answer({ data: {} }),
    );
    await other(r2);
    expect(r2.fetch).toHaveBeenCalledWith({ url: 'https://example.com/api/graphql' });
  });

  it('leaves writes, and anything that isn’t a read, to the stub', async () => {
    const [[, reads]] = await routes();
    for (const body of [
      { query: 'mutation SaveActivity { saveActivity { id } }' },
      { query: 'queryless' },
      {},
      null,
    ]) {
      const r = readRoute(body);
      await reads(r);
      expect(r.fetch).not.toHaveBeenCalled();
      expect(r.fallback).toHaveBeenCalledTimes(1);
    }
  });

  it('gives a read production can’t answer to the stub, saying so once a read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const [[, reads]] = await routes();
      for (const response of [
        answer({ errors: [{ message: 'Not signed in' }] }),
        answer({ data: {} }, false),
        new Error('offline'),
      ]) {
        const r = readRoute(read('TripsList'), response);
        await reads(r);
        expect(r.fallback).toHaveBeenCalledTimes(1);
        expect(r.fulfill).not.toHaveBeenCalled();
      }
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        `pr-gif: ${LIVE_GRAPHQL} couldn't answer TripsList, so the stub did`,
      );
      // Another read gets its own note; one with no name is "a read".
      await reads(readRoute(read('TripDetail'), new Error('offline')));
      await reads(readRoute({ query: 'query { a }' }, new Error('offline')));
      expect(warn).toHaveBeenLastCalledWith(
        `pr-gif: ${LIVE_GRAPHQL} couldn't answer a read, so the stub did`,
      );
      expect(warn).toHaveBeenCalledTimes(3);
      // An empty errors list is still an answer.
      const r = readRoute(read('A'), answer({ data: {}, errors: [] }));
      await reads(r);
      expect(r.fulfill).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('lets the fonts through to the network', async () => {
    const [, [, fonts]] = await routes();
    const r = readRoute(null);
    await fonts(r);
    expect(r.continue).toHaveBeenCalledTimes(1);
  });
});

describe('pictureSource', () => {
  const PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Library.jpg';
  const viaProduction = (url: string) =>
    `${PRODUCTION}/_vercel/image?url=${encodeURIComponent(url)}&w=1280&q=75`;

  it('takes a photo through production’s image CDN, its own URL next', () => {
    expect(pictureSource(PHOTO)).toEqual({ url: viaProduction(PHOTO), direct: PHOTO });
    expect(pictureSource('http://img.example/a.png')).toEqual({
      url: viaProduction('http://img.example/a.png'),
      direct: 'http://img.example/a.png',
    });
    // At the CDN's largest width and its one quality, as vercel.json lists them.
    const images = (
      JSON.parse(readFileSync('vercel.json', 'utf8')) as {
        images: { sizes: number[]; qualities: number[] };
      }
    ).images;
    expect(CDN_WIDTH).toBe(Math.max(...images.sizes));
    expect(images.qualities).toEqual([CDN_QUALITY]);
  });

  it('sends the build’s own image CDN requests to production’s', () => {
    const asked = `/_vercel/image?url=${encodeURIComponent(PHOTO)}&w=384&q=75`;
    expect(pictureSource(`http://localhost:4173${asked}`)).toEqual({
      url: `${PRODUCTION}${asked}`,
      direct: PHOTO,
    });
    expect(pictureSource('http://localhost:4173/_vercel/image?w=384', 'https://x.app')).toEqual({
      url: 'https://x.app/_vercel/image?w=384',
      direct: undefined,
    });
  });

  it('draws OpenStreetMap tiles in place of CARTO ones', () => {
    expect(pictureSource('https://b.basemaps.cartocdn.com/light_all/9/81/197.png')).toEqual({
      url: 'https://tile.openstreetmap.org/9/81/197.png',
    });
  });

  it('asks production another site was given', () => {
    expect(pictureSource(PHOTO, 'https://x.app')?.url).toBe(
      `https://x.app/_vercel/image?url=${encodeURIComponent(PHOTO)}&w=1280&q=75`,
    );
  });

  it('leaves the build’s own pictures, and anything that isn’t a web address, alone', () => {
    expect(pictureSource('http://localhost:4173/icon.png')).toBeNull();
    expect(pictureSource('http://127.0.0.1:4173/icon.png')).toBeNull();
    expect(pictureSource('data:image/png;base64,AAAA')).toBeNull();
    expect(pictureSource('not a url.png')).toBeNull();
  });
});

describe('waitForPhotos', () => {
  it('waits for the photos in view to load', async () => {
    const waitForFunction = vi.fn(() => Promise.resolve());
    expect(
      await waitForPhotos(
        { waitForFunction } as unknown as Parameters<typeof waitForPhotos>[0],
        5000,
      ),
    ).toBe(true);
    expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, {
      timeout: 5000,
    });
  });

  it('gives up with a warning, not an error, after 20 s by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const waitForFunction = vi.fn(() => Promise.reject(new Error('Timeout')));
      expect(await waitForPhotos({ waitForFunction })).toBe(false);
      expect(waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, {
        timeout: 20_000,
      });
      expect(warn).toHaveBeenCalledWith("pr-gif: some photos in view hadn't loaded after 20 s");
    } finally {
      warn.mockRestore();
    }
  });

  it('counts a photo loaded or broken, out of view, or with no src', async () => {
    // The check itself, run here against jsdom's images.
    let check: () => boolean = () => false;
    const waitForFunction = vi.fn((fn: () => boolean) => {
      check = fn;
      return Promise.resolve();
    });
    await waitForPhotos({ waitForFunction } as unknown as Parameters<typeof waitForPhotos>[0]);
    const img = document.createElement('img');
    document.body.append(img);
    const box = (top: number, width = 100) =>
      vi
        .spyOn(img, 'getBoundingClientRect')
        .mockReturnValue({ top, bottom: top + 50, width } as DOMRect);
    const complete = (value: boolean) =>
      Object.defineProperty(img, 'complete', { value, configurable: true });
    try {
      box(10);
      // A lazy photo in view that hasn't started yet still counts.
      img.setAttribute('src', 'https://upload.wikimedia.org/a.jpg');
      img.loading = 'lazy';
      complete(false);
      expect(check()).toBe(false);
      // Loaded, or broken: either way, what the site shows.
      complete(true);
      expect(check()).toBe(true);
      complete(false);
      // Below the fold, above it, or not laid out.
      box(5000);
      expect(check()).toBe(true);
      box(-60);
      expect(check()).toBe(true);
      box(10, 0);
      expect(check()).toBe(true);
      // No src.
      box(10);
      img.removeAttribute('src');
      expect(check()).toBe(true);
    } finally {
      img.remove();
    }
  });
});

describe('cachePhotos', () => {
  type Handler = (route: ReturnType<typeof photoRoute>) => Promise<unknown>;
  async function setUp(cache: string, production?: string) {
    let added: [(url: URL) => boolean, Handler] | undefined;
    const page = {
      route: vi.fn((match: (url: URL) => boolean, h: Handler) => {
        added = [match, h];
        return Promise.resolve();
      }),
    };
    const { failed } = await cachePhotos(page as unknown as Parameters<typeof cachePhotos>[0], {
      cache,
      production,
    });
    return { handler: added![1], match: (url: string) => added![0](new URL(url)), failed };
  }
  // A route whose fetches answer, in turn, with `responses` (an Error throws).
  function photoRoute(url: string, ...responses: unknown[]) {
    let n = 0;
    return {
      request: () => ({ url: () => url }),
      fetch: vi.fn(() => {
        const response = responses[n++];
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      }),
      fulfill: vi.fn(() => Promise.resolve()),
      fallback: vi.fn(() => Promise.resolve()),
      abort: vi.fn(() => Promise.resolve()),
    };
  }
  const ok = (body: string, type?: string) => ({
    ok: () => true,
    status: () => 200,
    body: () => Promise.resolve(Buffer.from(body)),
    headers: () => (type ? { 'content-type': type } : {}),
  });
  const refused = (status: number) => ({
    ok: () => false,
    status: () => status,
    headers: () => ({}),
  });
  const URL_A = 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Library.jpg';
  const CDN_A = pictureSource(URL_A)!.url;

  it('keeps photos in ~/.cache/pr-gif/photos by default, one file per URL', () => {
    expect(PHOTO_CACHE).toBe(join(homedir(), '.cache', 'pr-gif', 'photos'));
    expect(photoFile('/c', URL_A)).toBe(join('/c', createHash('sha1').update(URL_A).digest('hex')));
  });

  it('takes images and image CDN requests, and nothing else', async () => {
    const { match } = await setUp(temp());
    expect(match(URL_A)).toBe(true);
    expect(match('https://tile.openstreetmap.org/9/81/197.png?x=1')).toBe(true);
    expect(match('http://localhost:4173/_vercel/image?url=x&w=96&q=75')).toBe(true);
    expect(match('http://localhost:4173/api/graphql')).toBe(false);
    expect(match('https://fonts.gstatic.com/s/inter.woff2')).toBe(false);
  });

  it('fetches a photo once through production’s CDN, then serves it from disk', async () => {
    const cache = join(temp(), 'photos');
    const { handler, failed } = await setUp(cache);
    const response = ok('avif bytes', 'image/avif');
    const first = photoRoute(URL_A, response);
    await handler(first);
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(first.fetch).toHaveBeenCalledWith({ url: CDN_A });
    expect(first.fulfill).toHaveBeenCalledWith({ response, body: Buffer.from('avif bytes') });
    expect(readFileSync(photoFile(cache, CDN_A), 'utf8')).toBe('avif bytes');
    expect(readFileSync(`${photoFile(cache, CDN_A)}.type`, 'utf8')).toBe('image/avif');

    // The next recording, or the next run: no fetch.
    const again = await setUp(cache);
    const second = photoRoute(URL_A);
    await again.handler(second);
    expect(second.fetch).not.toHaveBeenCalled();
    expect(second.fulfill).toHaveBeenCalledWith({
      body: Buffer.from('avif bytes'),
      contentType: 'image/avif',
    });
    expect(failed.size).toBe(0);
  });

  it('asks the production it was given', async () => {
    const { handler } = await setUp(temp(), 'https://x.app');
    const r = photoRoute(URL_A, ok('bytes'));
    await handler(r);
    expect(r.fetch).toHaveBeenCalledWith({ url: pictureSource(URL_A, 'https://x.app')!.url });
  });

  it('falls back to the photo’s own URL when production’s CDN can’t serve it', async () => {
    const cache = temp();
    const { handler, failed } = await setUp(cache);
    for (const cdnAnswer of [refused(400), new Error('net::ERR_FAILED')]) {
      const response = ok('jpeg bytes', 'image/jpeg');
      const r = photoRoute(URL_A, cdnAnswer, response);
      await handler(r);
      expect(r.fetch).toHaveBeenNthCalledWith(1, { url: CDN_A });
      expect(r.fetch).toHaveBeenNthCalledWith(2, { url: URL_A });
      expect(r.fulfill).toHaveBeenCalledWith({ response, body: Buffer.from('jpeg bytes') });
      rmSync(cache, { recursive: true, force: true });
      mkdirSync(cache, { recursive: true });
    }
    expect(failed.size).toBe(0);
  });

  it('takes only an image: a site without the CDN answers with its index.html', async () => {
    const cache = temp();
    const { handler, failed } = await setUp(cache);
    const response = ok('jpeg bytes', 'image/jpeg');
    const r = photoRoute(URL_A, ok('<!doctype html>', 'text/html; charset=utf-8'), response);
    await handler(r);
    expect(r.fetch).toHaveBeenNthCalledWith(2, { url: URL_A });
    expect(r.fulfill).toHaveBeenCalledWith({ response, body: Buffer.from('jpeg bytes') });
    expect(readFileSync(photoFile(cache, CDN_A), 'utf8')).toBe('jpeg bytes');
    // HTML both ways is a gap, passed on as it came.
    const html = ok('<!doctype html>', 'text/html');
    const r2 = photoRoute('https://www.nps.gov/b.jpg', ok('x', 'text/html'), html);
    await handler(r2);
    expect(r2.fulfill).toHaveBeenCalledWith({ response: html });
    expect(failed.get('https://www.nps.gov/b.jpg')).toBe('not an image (text/html)');
  });

  it('assumes a JPEG when the host doesn’t say', async () => {
    const cache = temp();
    const { handler } = await setUp(cache);
    await handler(photoRoute(URL_A, ok('bytes')));
    expect(readFileSync(`${photoFile(cache, CDN_A)}.type`, 'utf8')).toBe('image/jpeg');
  });

  it('notes a photo refused both ways by its own URL, passes the refusal on, and doesn’t cache it', async () => {
    const cache = temp();
    const { handler, failed } = await setUp(cache);
    const response = refused(429);
    const r = photoRoute(URL_A, refused(400), response);
    await handler(r);
    expect(r.fulfill).toHaveBeenCalledWith({ response });
    expect(failed).toEqual(new Map([[URL_A, 'HTTP 429']]));
    expect(existsSync(photoFile(cache, CDN_A))).toBe(false);
    // Loaded on a later try: no longer a gap.
    await handler(photoRoute(URL_A, ok('bytes')));
    expect(failed.size).toBe(0);
  });

  it('notes a photo it couldn’t reach at all, and aborts it', async () => {
    const { handler, failed } = await setUp(temp());
    const r = photoRoute(
      URL_A,
      new Error('offline'),
      new Error('net::ERR_CONNECTION_RESET\nmore detail'),
    );
    await handler(r);
    expect(r.abort).toHaveBeenCalledTimes(1);
    expect(failed.get(URL_A)).toBe('net::ERR_CONNECTION_RESET');
  });

  it('fetches a map tile from OpenStreetMap only, named as the tile', async () => {
    const { handler, failed } = await setUp(temp());
    const tile = 'https://b.basemaps.cartocdn.com/light_all/9/81/197.png';
    const r = photoRoute(tile, refused(503));
    await handler(r);
    expect(r.fetch).toHaveBeenCalledTimes(1);
    expect(r.fetch).toHaveBeenCalledWith({ url: 'https://tile.openstreetmap.org/9/81/197.png' });
    expect(failed).toEqual(new Map([['https://tile.openstreetmap.org/9/81/197.png', 'HTTP 503']]));
  });

  it('leaves the build’s own pictures to its server', async () => {
    const { handler } = await setUp(temp());
    const r = photoRoute('http://localhost:4173/icon.png');
    await handler(r);
    expect(r.fallback).toHaveBeenCalledTimes(1);
    expect(r.fetch).not.toHaveBeenCalled();
  });
});

describe('describeFailed', () => {
  it('counts the failed photos by host, with why', () => {
    expect(
      describeFailed(
        new Map([
          ['https://upload.wikimedia.org/a.jpg', 'HTTP 429'],
          ['https://upload.wikimedia.org/b.jpg', 'HTTP 429'],
          ['https://upload.wikimedia.org/c.jpg', 'HTTP 503'],
          ['https://www.nps.gov/d.jpg', 'net::ERR_TIMED_OUT'],
          ['not a url', 'HTTP 404'],
        ]),
      ),
    ).toBe(
      '3 from upload.wikimedia.org (HTTP 429, HTTP 503); 1 from www.nps.gov (net::ERR_TIMED_OUT); 1 from not a url (HTTP 404)',
    );
    expect(describeFailed(new Map())).toBe('');
  });
});
