import { useId, useState } from 'react';

/**
 * The map tiles' credit, which OpenStreetMap's licence and CARTO require, as
 * a small ⓘ that opens it, in place of Leaflet's bar (which also named
 * Leaflet). Over the map's bottom-right corner, `bottom` px up, which full
 * bleed lifts above the list sheet's peek.
 */
export function MapCredit({ bottom = 8 }: { bottom?: number | string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="absolute right-2 z-1000 flex items-center gap-xs" style={{ bottom }}>
      {open && (
        <p
          id={id}
          className="rounded-full bg-white/85 px-sm py-0.5 text-[11px] text-on-surface shadow-sm backdrop-blur-sm"
        >
          ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            OpenStreetMap
          </a>{' '}
          contributors ©{' '}
          <a
            href="https://carto.com/attributions"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            CARTO
          </a>
        </p>
      )}
      <button
        type="button"
        aria-label="Map credits"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex size-6 items-center justify-center rounded-full bg-white/80 text-on-surface-variant shadow-sm backdrop-blur-sm"
      >
        <span
          className="material-symbols-outlined inline-flex size-4 items-center justify-center overflow-hidden text-[16px]"
          aria-hidden="true"
        >
          info
        </span>
      </button>
    </div>
  );
}
