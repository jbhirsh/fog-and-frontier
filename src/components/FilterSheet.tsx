import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Category } from '../data/types';
import {
  appliedFilters,
  COST_OPTIONS,
  DISTANCE_LIMITS,
  DURATION_LABELS,
  DURATION_OPTIONS,
  NO_FILTERS,
  PARK_TYPE_LABELS,
  PARK_TYPE_OPTIONS,
  type FilterValues,
} from '../lib/catalogFilterOptions';
import { useFocusTrap, useReturnFocus } from '../lib/focusTrap';
import { CATEGORY_ICON } from '../lib/mapPins';
import { usePersonLabel } from '../lib/people';
import { useSwipe } from '../lib/swipe';
import { useMediaQuery } from '../lib/useMediaQuery';

export interface FilterSheetProps {
  values: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
  /** How many places the filters leave, for the button that closes the sheet. */
  count: number;
  /** Where distances are measured from: "you", or home's short name. */
  originName: string;
  /** Whether to offer How much: once any cost is known (#85), or while one is picked. */
  showCost: boolean;
  /** The accounts to offer under "Added by"; empty hides it (signed out, #9). */
  contributorOptions: readonly string[];
}

// The categories as tiles (#292), most asked for first, named as people
// say them; More holds the rest.
const TILES: readonly { category: Category; label: string }[] = [
  { category: 'hiking', label: 'Hikes' },
  { category: 'food', label: 'Food' },
  { category: 'scenic', label: 'Views' },
  { category: 'water', label: 'Water' },
  { category: 'culture', label: 'Culture' },
  { category: 'cycling', label: 'Bikes' },
  { category: 'camping', label: 'Camping' },
];
const MORE_TILES: readonly { category: Category; label: string }[] = [
  { category: 'climbing', label: 'Climbing' },
  { category: 'other', label: 'Other' },
];

const TILE =
  'flex h-17 flex-col items-center justify-center gap-1.5 rounded-[14px] text-[12px] font-medium transition-colors';
const TILE_ON = 'bg-primary text-on-primary';
const TILE_OFF = 'bg-surface-container-low text-on-surface hover:bg-surface-container';

function Tile({
  icon,
  label,
  on,
  onClick,
  expanded,
  controls,
}: {
  icon: string;
  label: string;
  on: boolean;
  onClick: () => void;
  /** For More: whether the rest are showing, which it says instead of pressed. */
  expanded?: boolean;
  /** For More: the row of the rest, while it shows. */
  controls?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={expanded === undefined ? on : undefined}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className={`${TILE} ${on ? TILE_ON : TILE_OFF}`}
    >
      <span
        className="material-symbols-outlined inline-flex size-5.5 shrink-0 items-center justify-center overflow-hidden text-[22px]"
        aria-hidden="true"
      >
        {icon}
      </span>
      {label}
    </button>
  );
}

/** One choice of several in a row, in order (`aria-pressed`): distances, durations. */
function Segments<T extends string | number>({
  label,
  options,
  value,
  optionLabel,
  onChange,
  even,
}: {
  label: string;
  options: readonly T[];
  value: T;
  optionLabel: (option: T) => string;
  onChange: (option: T) => void;
  /** Equal widths; otherwise each as wide as its words, sharing what's left. */
  even?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`${even ? 'grid grid-cols-5' : 'flex'} gap-0.5 rounded-[14px] bg-surface-container-low p-[3px]`}
    >
      {options.map((option) => {
        const on = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option)}
            className={`h-10 flex-auto rounded-[11px] px-xs text-body-sm whitespace-nowrap transition-colors ${
              on
                ? 'bg-surface-container-lowest font-semibold text-primary shadow-sm'
                : 'font-medium text-on-surface hover:bg-surface-container'
            }`}
          >
            {optionLabel(option)}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-xs">
      <h3 className="text-body-sm font-semibold text-on-surface-variant">{title}</h3>
      {children}
    </section>
  );
}

const ROW =
  'flex min-h-12 w-full items-center justify-between gap-md border-b border-outline-variant/40 text-left text-body-md text-on-surface last:border-b-0';

/** An on/off filter as a switch, the whole row its label. */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`${ROW} cursor-pointer`}>
      {label}
      <span className="relative h-7.5 w-12.5 shrink-0">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-10 m-0 cursor-pointer opacity-0"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-surface-container-highest transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"
        />
        <span
          aria-hidden="true"
          className="absolute top-[3px] left-[3px] size-6 rounded-full bg-surface-container-lowest shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform peer-checked:translate-x-5"
        />
      </span>
    </label>
  );
}

const CHEVRON =
  'material-symbols-outlined inline-flex size-5 shrink-0 items-center justify-center overflow-hidden text-[20px]';

/** A row naming a rarer filter and what it's set to, opening its own list. */
function ListRow({
  label,
  value,
  onOpen,
  buttonRef,
}: {
  label: string;
  value: string;
  onOpen: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={buttonRef} type="button" onClick={onOpen} className={ROW}>
      {label}
      <span className="inline-flex items-center gap-xs text-body-sm text-on-surface-variant">
        {value}
        <span className={CHEVRON} aria-hidden="true">
          chevron_right
        </span>
      </span>
    </button>
  );
}

type Page = 'main' | 'park' | 'people';

/**
 * The phone's catalog filters, all in one sheet that rises from the bottom
 * of the screen (#287, calmed in #292): the categories as tiles, distance
 * and duration as segments, the yes-or-no filters as switches, and park type
 * and contributors as rows that open their own lists. It fits a phone's
 * screen without scrolling. A change applies to the list at once, and the
 * footer's button, which says how many places are left, closes it.
 */
export function FilterSheet({
  values,
  onChange,
  count,
  originName,
  showCost,
  contributorOptions,
  onClose,
}: FilterSheetProps & { onClose: () => void }) {
  const authorLabel = usePersonLabel();
  const titleId = useId();
  const moreId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const parkRowRef = useRef<HTMLButtonElement>(null);
  const peopleRowRef = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState<Page>('main');
  // For the Escape handler, which outlives a render.
  const pageRef = useRef<Page>('main');
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  // The list last open, whose row focus goes back to with the filters.
  const cameFrom = useRef<Page>('main');
  const [moreOpen, setMoreOpen] = useState(() =>
    MORE_TILES.some((t) => t.category === values.category),
  );
  useFocusTrap(dialogRef);
  useReturnFocus();
  // Swiped down, as a place's sheet is, it closes: from anywhere on it once
  // its list is at the top.
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  useSwipe(dialogRef, scrimRef, {
    onClose,
    enabled: true,
    reduceMotion,
    atTop: () => (bodyRef.current?.scrollTop ?? 0) <= 0,
  });

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);
  // Focus follows the page: a list's back button, or the row it came from.
  useEffect(() => {
    const target =
      page !== 'main'
        ? backRef.current
        : cameFrom.current === 'park'
          ? parkRowRef.current
          : cameFrom.current === 'people'
            ? peopleRowRef.current
            : null;
    target?.focus({ preventScroll: true });
  }, [page]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // From a list, back to the filters; from them, closed.
      if (pageRef.current === 'main') onClose();
      else setPage('main');
    };
    window.addEventListener('keydown', onKey);
    // Put back whatever lock was there, as AddActivity does.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const anyOn = appliedFilters(values, authorLabel).length > 0;

  function open(next: Exclude<Page, 'main'>) {
    cameFrom.current = next;
    setPage(next);
  }
  function back() {
    setPage('main');
  }

  function pick(category: Category) {
    onChange({ category: values.category === category ? 'Any' : category });
  }
  function toggleContributor(email: string) {
    const on = values.contributors.includes(email);
    onChange({
      contributors: on
        ? values.contributors.filter((e) => e !== email)
        : [...values.contributors, email],
    });
  }

  const moreOn = MORE_TILES.some((t) => t.category === values.category);
  const peopleValue =
    values.contributors.length === 0
      ? 'Anyone'
      : values.contributors.length === 1
        ? authorLabel(values.contributors[0])
        : `${values.contributors.length} people`;

  const mainPage = (
    <>
      <Section title="What">
        <div role="group" aria-label="What" className="grid grid-cols-4 gap-base">
          {TILES.map((t) => (
            <Tile
              key={t.category}
              icon={CATEGORY_ICON[t.category]}
              label={t.label}
              on={values.category === t.category}
              onClick={() => pick(t.category)}
            />
          ))}
          <Tile
            icon="more_horiz"
            label="More"
            on={moreOn}
            expanded={moreOpen}
            controls={moreOpen ? moreId : undefined}
            onClick={() => setMoreOpen((v) => !v)}
          />
          {moreOpen && (
            <div id={moreId} className="col-span-full grid grid-cols-4 gap-base">
              {MORE_TILES.map((t) => (
                <Tile
                  key={t.category}
                  icon={CATEGORY_ICON[t.category]}
                  label={t.label}
                  on={values.category === t.category}
                  onClick={() => pick(t.category)}
                />
              ))}
            </div>
          )}
        </div>
      </Section>
      <Section title={`How far from ${originName}`}>
        <Segments
          label="How far"
          even
          options={[Infinity, ...DISTANCE_LIMITS]}
          value={values.maxDistance}
          optionLabel={(miles) => (miles === Infinity ? 'Any' : `${miles} mi`)}
          onChange={(maxDistance) => onChange({ maxDistance })}
        />
      </Section>
      <Section title="How long">
        <Segments
          label="How long"
          options={DURATION_OPTIONS}
          value={values.duration}
          optionLabel={(d) => (d === 'Any' ? 'Any' : DURATION_LABELS[d])}
          onChange={(duration) => onChange({ duration })}
        />
      </Section>
      {showCost && (
        <Section title="How much">
          <Segments
            label="How much"
            even
            options={COST_OPTIONS}
            value={values.maxCost}
            optionLabel={(c) => (c === 'Any' ? 'Any' : c === 'free' ? 'Free' : c)}
            onChange={(maxCost) => onChange({ maxCost })}
          />
        </Section>
      )}
      <div className="border-t border-outline-variant/40">
        <Switch
          label="Dogs welcome"
          checked={values.dogOnly}
          onChange={(dogOnly) => onChange({ dogOnly })}
        />
        <Switch
          label="Only places we’ve done"
          checked={values.completedOnly}
          onChange={(completedOnly) => onChange({ completedOnly })}
        />
        <ListRow
          label="Park type"
          value={values.parkType === 'Any' ? 'Any' : PARK_TYPE_LABELS[values.parkType]}
          onOpen={() => open('park')}
          buttonRef={parkRowRef}
        />
        {contributorOptions.length > 0 && (
          <ListRow
            label="Added by"
            value={peopleValue}
            onOpen={() => open('people')}
            buttonRef={peopleRowRef}
          />
        )}
      </div>
    </>
  );

  // Buttons, not radios: a radio changes on an arrow key, which would
  // pick a type and leave the list at every step.
  const parkPage = (
    <div role="group" aria-label="Park type">
      {PARK_TYPE_OPTIONS.map((p) => {
        const on = values.parkType === p;
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onChange({ parkType: p });
              back();
            }}
            className={`${ROW} ${on ? 'font-semibold text-primary' : ''}`}
          >
            {p === 'Any' ? 'Any' : PARK_TYPE_LABELS[p]}
            {on && (
              <span className={CHEVRON} aria-hidden="true">
                check
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const peoplePage = (
    <fieldset>
      <legend className="sr-only">Added by</legend>
      {contributorOptions.map((email) => (
        <label key={email} className={`${ROW} cursor-pointer`}>
          {authorLabel(email)}
          <input
            type="checkbox"
            checked={values.contributors.includes(email)}
            onChange={() => toggleContributor(email)}
            className="size-5 shrink-0 cursor-pointer accent-primary"
          />
        </label>
      ))}
    </fieldset>
  );

  // z-70: above the mobile map's list sheet (z-60), which this opens from.
  return (
    <div className="fixed inset-0 z-70 flex items-end justify-center md:items-center md:p-md">
      <button
        type="button"
        ref={scrimRef}
        aria-label="Close filters"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-on-surface/60 backdrop-blur-sm motion-safe:animate-scrim-in"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex max-h-[calc(100dvh-var(--spacing-lg))] w-full flex-col rounded-t-2xl bg-surface-container-lowest shadow-2xl focus:outline-none motion-safe:animate-sheet-in md:max-w-128 md:rounded-xl md:motion-safe:animate-dialog-in"
      >
        <div className="flex shrink-0 items-center gap-xs py-xs pr-sm pl-md">
          {page !== 'main' && (
            <button
              ref={backRef}
              type="button"
              aria-label="Back to filters"
              onClick={back}
              className="-ml-sm inline-flex size-11 items-center justify-center rounded-full text-on-surface hover:bg-surface-container-low"
            >
              <span className={CHEVRON} aria-hidden="true">
                chevron_left
              </span>
            </button>
          )}
          <h2 id={titleId} className="flex-1 font-display text-headline-md text-primary">
            {page === 'park' ? 'Park type' : page === 'people' ? 'Added by' : 'Filters'}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex size-11 items-center justify-center rounded-full text-on-surface hover:bg-surface-container-low"
          >
            <span
              className="material-symbols-outlined inline-flex size-5.5 shrink-0 items-center justify-center overflow-hidden text-[22px]"
              aria-hidden="true"
            >
              close
            </span>
          </button>
        </div>
        <div
          ref={bodyRef}
          className="min-h-0 flex-1 space-y-md overflow-y-auto overscroll-contain px-md py-xs"
        >
          {page === 'park' ? parkPage : page === 'people' ? peoplePage : mainPage}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-md border-t border-outline-variant/40 px-md pt-sm pb-[calc(var(--spacing-sm)+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            disabled={!anyOn}
            className="min-h-11 px-xs text-body-md font-semibold text-on-surface underline underline-offset-4 disabled:cursor-not-allowed disabled:text-on-surface-variant/60 disabled:no-underline"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-12 items-center rounded-full bg-primary px-md text-body-md font-semibold text-on-primary hover:opacity-90"
          >
            Show {count} place{count === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
