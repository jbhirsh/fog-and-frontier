// The shapes jbhirsh/ci's GIF tool hands this app's scenarios and setup
// module (gif/scenario.mjs there says what each part does). Written here so
// they type-check with no ../ci checkout; scripts/gif.mjs says why, and how
// the tool's self-test keeps them honest. Each is exported for a scenario
// or setup module to use (the parts of them only, unexported, while none
// needs them on its own).
import type { Locator, Page } from '@playwright/test';

/**
 * The part of the window recorded, in CSS pixels.
 */
interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/**
 * A locator (its middle), or a point.
 */
type Target = Pick<Locator, 'boundingBox'> | Point;

/**
 * What a scenario's functions get as `gif`: the moves, which go at a
 * person's pace (never page.mouse or locator.click alone), and which build
 * is playing.
 */
export interface Gif {
  glide(page: Page, target: Target, ms?: number): Promise<Point>;
  click(page: Page, target: Target, options?: { ms?: number; holdMs?: number }): Promise<Point>;
  drag(page: Page, from: Target, to: Target, ms?: number): Promise<void>;
  scroll(page: Page, dy: number, ms?: number): Promise<void>;
  swipe(page: Page, from: Target, to: Target, ms?: number): Promise<void>;
  side: 'before' | 'after';
  origin: string;
}

/** A scenario module's default export. */
export interface Scenario {
  name?: string;
  path?: string;
  viewport?: { width: number; height: number };
  colorScheme?: 'light' | 'dark';
  clip?: Clip | ((page: Page) => Promise<Clip>);
  width?: number;
  setup?(page: Page, gif: Gif): Promise<void>;
  ready?(page: Page, gif: Gif): Promise<void>;
  play(page: Page, gif: Gif): Promise<void>;
}

/**
 * What the setup module's functions get.
 */
export interface SetupContext {
  side: 'before' | 'after';
  origin: string;
  options: Record<string, string | boolean | undefined>;
  root: string;
}

/** The setup module's default export. */
export interface Setup {
  options?: Record<string, { type: 'boolean' | 'string'; default?: boolean | string }>;
  beforeSetup?(page: Page, ctx: SetupContext): Promise<void>;
  afterSetup?(page: Page, ctx: SetupContext): Promise<void>;
  check?(page: Page, ctx: SetupContext): Promise<void>;
}
