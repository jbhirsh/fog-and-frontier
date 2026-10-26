import { useId } from 'react';
import { copyLength } from '../lib/cardCopy';

/**
 * A field for card copy (#295), with a count of what's left: the copy is
 * shown whole on a phone's card, so it has to fit rather than be cut off.
 * Past the cap the count turns red, and the form won't save.
 */
export function CardCopyField({
  label,
  hint,
  value,
  max,
  onChange,
  className,
}: {
  label: string;
  hint: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  className: string;
}) {
  const id = useId();
  const used = copyLength(value.trim());
  const over = used > max;
  return (
    <div>
      <div className="mb-xs flex items-baseline justify-between gap-sm">
        <label htmlFor={id} className="font-body-sm text-on-surface-variant">
          {label}
        </label>
        <span
          id={`${id}-count`}
          className={`font-body-sm tabular-nums ${over ? 'font-semibold text-error' : 'text-on-surface-variant'}`}
        >
          {used}/{max}
        </span>
      </div>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={over}
        aria-describedby={`${id}-hint ${id}-count`}
        className={className}
      />
      <p id={`${id}-hint`} className="mt-xs font-body-sm text-on-surface-variant">
        {hint}
      </p>
    </div>
  );
}
