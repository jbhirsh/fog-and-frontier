import { useId, useState } from 'react';
import { trailNumbers, type TrailOption } from '../lib/trailOptions';

export type { TrailOption };

// An http(s) link to an AllTrails page, as a link may only open one.
function allTrailsLink(value: string | undefined): string | null {
  try {
    const url = new URL((value ?? '').trim());
    const onAllTrails = /(^|\.)alltrails\.com$/i.test(url.hostname);
    return /^https?:$/.test(url.protocol) && onAllTrails ? url.href : null;
  } catch {
    return null;
  }
}

// A trail's name from its address, for one typed in by hand:
// …/alamere-falls-trail--2 reads "Alamere falls trail".
function nameFromLink(link: string): string {
  const slug = new URL(link).pathname.split('/').filter(Boolean).pop() ?? '';
  const words = slug.replace(/--\d+$/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1) || 'AllTrails page';
}

/**
 * One trail: its picture (when the search had one) beside its name and
 * numbers, its description in full under them, and a footer with a link
 * that opens it on AllTrails and, at the other end, `status`.
 */
function TrailCard({
  trail,
  titleId,
  status,
}: {
  trail: TrailOption;
  titleId?: string;
  status?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const pictured = Boolean(trail.image) && !broken;
  const numbers = trailNumbers(trail);
  return (
    <div className="space-y-sm">
      {/* The name beside the picture; the numbers beside it too on a wide
          screen, and under it, across the card, on a phone. */}
      <div
        className={`grid items-start gap-x-sm gap-y-xs ${pictured ? 'grid-cols-[auto_1fr]' : 'grid-cols-1'}`}
      >
        {pictured && (
          <img
            src={trail.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="size-16 rounded-md bg-surface-variant object-cover sm:row-span-2 sm:size-20"
          />
        )}
        <div id={titleId} className="min-w-0 font-body-md font-semibold">
          {trail.title}
        </div>
        {numbers.length > 0 && (
          <div
            className={`col-span-full flex flex-wrap gap-x-xs font-body-sm text-on-surface-variant ${pictured ? 'sm:col-span-1 sm:col-start-2' : ''}`}
          >
            {numbers.map((n, i) => (
              <span key={n} className="whitespace-nowrap">
                {i > 0 && '· '}
                {n}
              </span>
            ))}
          </div>
        )}
      </div>
      {trail.description && <p className="font-body-sm">{trail.description}</p>}
      <div className="flex items-center justify-between gap-sm">
        <a
          href={trail.url}
          target="_blank"
          rel="noopener noreferrer"
          title={trail.url}
          className="font-body-sm text-primary underline underline-offset-2"
        >
          View on AllTrails ↗
        </a>
        {status}
      </div>
    </div>
  );
}

/**
 * The trail an AllTrails URL field holds, drawn as a card under it, and
 * the other trails the draft's search found (#6) behind "Not the right
 * trail?": opened, the card becomes a list of them all to select one from
 * (a tap anywhere on a card), each with a link to check it on AllTrails
 * first. A link typed by hand gets a card too, named from its address.
 */
export function TrailPicker({
  url,
  options,
  onChoose,
}: {
  url: string | undefined;
  options: readonly TrailOption[];
  onChoose: (trail: TrailOption) => void;
}) {
  const [open, setOpen] = useState(false);
  // A trail typed by hand, kept in the list from when it opened, so
  // selecting another doesn't drop it.
  const [typedTrail, setTypedTrail] = useState<TrailOption | null>(null);
  const group = useId();
  const link = allTrailsLink(url);
  const current = link
    ? (options.find((o) => o.url === link) ??
      (typedTrail?.url === link ? typedTrail : null) ?? {
        url: link,
        title: nameFromLink(link),
        description: '',
      })
    : null;
  const typed = current !== null && !options.some((o) => o.url === current.url);
  // Every trail, in the search's order; one typed by hand first.
  const trails = typedTrail ? [typedTrail, ...options] : options;
  const others = options.length - (current && !typed ? 1 : 0);
  const frame = 'block rounded-lg bg-surface-container-low p-sm';

  function toggle() {
    if (!open) setTypedTrail(typed ? current : null);
    setOpen(!open);
  }

  return (
    <div className="space-y-xs">
      {open ? (
        <fieldset>
          <legend className="sr-only">AllTrails trails</legend>
          <ul className="space-y-xs">
            {trails.map((trail, i) => {
              const chosen = trail.url === current?.url;
              const titleId = `${group}-${i}`;
              return (
                <li key={trail.url}>
                  <label
                    className={`${frame} cursor-pointer border-2 has-focus-visible:ring-2 has-focus-visible:ring-primary-container ${chosen ? 'border-primary' : 'border-transparent hover:border-outline-variant'}`}
                  >
                    <input
                      type="radio"
                      name={group}
                      value={trail.url}
                      checked={chosen}
                      onChange={() => onChoose(trail)}
                      aria-labelledby={titleId}
                      className="sr-only"
                    />
                    <TrailCard
                      trail={trail}
                      titleId={titleId}
                      status={
                        chosen ? (
                          <span className="font-body-sm font-semibold text-primary">
                            ✓ Selected
                          </span>
                        ) : (
                          <span
                            aria-hidden
                            className="rounded-full border border-outline-variant px-sm py-xs font-body-sm"
                          >
                            Select
                          </span>
                        )
                      }
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : (
        current && (
          <div className={frame}>
            <TrailCard trail={current} />
          </div>
        )
      )}
      {others > 0 && (
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="font-body-sm text-on-surface-variant underline underline-offset-2"
        >
          {open
            ? 'Done ▴'
            : current
              ? `Not the right trail? See ${others} ${others === 1 ? 'other' : 'others'} ▾`
              : `Pick from ${others} ${others === 1 ? 'trail' : 'trails'} it found ▾`}
        </button>
      )}
    </div>
  );
}
