import { useEffect, useId, useRef } from 'react';
import { categoryOptionLabel } from '../lib/activityLabels';
import {
  appliedFilters,
  CATEGORY_OPTIONS,
  DISTANCE_LIMITS,
  DURATION_OPTIONS,
  NO_FILTERS,
  PARK_TYPE_LABELS,
  PARK_TYPE_OPTIONS,
  type FilterValues,
} from '../lib/catalogFilterOptions';
import { useFocusTrap, useReturnFocus } from '../lib/focusTrap';
import { usePersonLabel } from '../lib/people';
import { glyphBleed } from '../lib/iconMetrics';

export interface FilterSheetProps {
  values: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
  /** How many places the filters leave, for the button that closes the sheet. */
  count: number;
  /** Where distances are measured from: "you", or home's short name. */
  originName: string;
  /** Whether to offer "Free": once anything is known to be free (#85), or while it's on. */
  showFree: boolean;
  /** The accounts to offer under "Added by"; empty hides it (signed out, #9). */
  contributorOptions: readonly string[];
}

const CHIP =
  'inline-flex min-h-10 items-center rounded-full border px-sm text-body-sm font-medium transition-colors';
const CHIP_ON = 'border-primary bg-primary text-on-primary';
const CHIP_OFF =
  'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low';

/** A wrapping set of chips, one of them chosen (`aria-pressed`). */
function ChipChoice<T extends string>({
  label,
  options,
  value,
  optionLabel,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  optionLabel: (option: T) => string;
  onChange: (option: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-base">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={`${CHIP} ${option === value ? CHIP_ON : CHIP_OFF}`}
        >
          {optionLabel(option)}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-sm">
      <h3 className="text-body-md font-semibold text-on-surface">{title}</h3>
      {children}
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-md text-body-md text-on-surface">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-5 shrink-0 cursor-pointer accent-primary"
      />
    </label>
  );
}

/**
 * The phone's catalog filters, all in one sheet that rises from the bottom
 * of the screen: a change applies to the list at once, and the footer's
 * button, which says how many places are left, closes it. The common
 * filters come first, the rarer park type and contributors lower down.
 */
export function FilterSheet({
  values,
  onChange,
  count,
  originName,
  showFree,
  contributorOptions,
  onClose,
}: FilterSheetProps & { onClose: () => void }) {
  const authorLabel = usePersonLabel();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  useReturnFocus();

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
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

  function toggleContributor(email: string) {
    const on = values.contributors.includes(email);
    onChange({
      contributors: on
        ? values.contributors.filter((e) => e !== email)
        : [...values.contributors, email],
    });
  }

  // z-70: above the mobile map's list sheet (z-60), which this opens from.
  return (
    <div className="fixed inset-0 z-70 flex items-end justify-center md:items-center md:p-md">
      <button
        type="button"
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
        className="relative flex max-h-[calc(100dvh-var(--spacing-lg))] w-full flex-col rounded-t-2xl bg-surface-container-lowest shadow-2xl focus:outline-none motion-safe:animate-sheet-in md:max-w-lg md:rounded-xl md:motion-safe:animate-dialog-in"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-outline-variant/40 py-xs pr-sm pl-md">
          <h2 id={titleId} className="font-display text-headline-md text-primary">
            Filters
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
        <div className="min-h-0 flex-1 space-y-md overflow-y-auto overscroll-contain p-md">
          <Section title="Category">
            <ChipChoice
              label="Category"
              options={CATEGORY_OPTIONS}
              value={values.category}
              optionLabel={(c) => (c === 'Any' ? 'Any' : categoryOptionLabel(c))}
              onChange={(category) => onChange({ category })}
            />
          </Section>
          <Section title={`How far from ${originName}`}>
            {/* Segments, since the distances run in order. */}
            <div
              role="group"
              aria-label="How far"
              className="grid grid-cols-5 gap-xs rounded-full bg-surface-container p-xs"
            >
              {[Infinity, ...DISTANCE_LIMITS].map((miles) => {
                const on = values.maxDistance === miles;
                return (
                  <button
                    key={miles}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onChange({ maxDistance: miles })}
                    className={`min-h-10 rounded-full text-body-sm whitespace-nowrap transition-colors ${
                      on
                        ? 'bg-surface-container-lowest font-semibold text-primary shadow-sm'
                        : 'text-on-surface hover:bg-surface-container-low'
                    }`}
                  >
                    {miles === Infinity ? 'Any' : `${miles} mi`}
                  </button>
                );
              })}
            </div>
          </Section>
          <Section title="How long">
            <ChipChoice
              label="How long"
              options={DURATION_OPTIONS}
              value={values.duration}
              optionLabel={(d) => d}
              onChange={(duration) => onChange({ duration })}
            />
          </Section>
          <Section title="Good to know">
            <div className="-my-xs">
              <Toggle
                label="Dog friendly"
                checked={values.dogOnly}
                onChange={(dogOnly) => onChange({ dogOnly })}
              />
              {showFree && (
                <Toggle
                  label="Free"
                  checked={values.freeOnly}
                  onChange={(freeOnly) => onChange({ freeOnly })}
                />
              )}
              <Toggle
                label="Completed only"
                checked={values.completedOnly}
                onChange={(completedOnly) => onChange({ completedOnly })}
              />
            </div>
          </Section>
          <Section title="Park type">
            <ChipChoice
              label="Park type"
              options={PARK_TYPE_OPTIONS}
              value={values.parkType}
              optionLabel={(p) => (p === 'Any' ? 'Any' : PARK_TYPE_LABELS[p])}
              onChange={(parkType) => onChange({ parkType })}
            />
          </Section>
          {contributorOptions.length > 0 && (
            <Section title="Added by">
              <div role="group" aria-label="Added by" className="flex flex-wrap gap-base">
                {contributorOptions.map((email) => {
                  const on = values.contributors.includes(email);
                  return (
                    <button
                      key={email}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleContributor(email)}
                      className={`${CHIP} gap-xs ${on ? CHIP_ON : CHIP_OFF}`}
                    >
                      <span
                        className="material-symbols-outlined inline-flex size-4.5 shrink-0 items-center justify-center overflow-hidden text-icon-sm"
                        style={{ marginLeft: glyphBleed('person') }}
                        aria-hidden="true"
                      >
                        person
                      </span>
                      {authorLabel(email)}
                    </button>
                  );
                })}
              </div>
            </Section>
          )}
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
