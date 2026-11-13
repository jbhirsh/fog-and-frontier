// An icon (#338): Material Symbols Outlined, drawn as inline SVG from the
// paths scripts/gen-icons.ts generates (src/lib/iconPaths.ts), where the app
// once loaded Google's icon font. The SVG is in the page's first paint (the
// font drew each icon's name as text until it loaded, or for good when
// Google was unreachable), and a name with no path is a type error. Add an
// icon with `npm run icons:gen -- <name>`.
//
// It keeps the font's sizing contract: a 1em square in a span (the `icon`
// class: 24px unless a class or `style` sets the font size), so a call
// site's `text-[14px]`, `size-5` or `style={{ fontSize }}` means what it did.
// `data-icon` names the icon, for tests.
import type { CSSProperties } from 'react';
import { FILLED_ICONS, ICONS, type FillableIconName, type IconName } from '../lib/iconPaths';

type IconProps = {
  className?: string;
  style?: CSSProperties;
  /** What the icon says, for an icon that's all a control shows. Without one it's hidden from assistive tech. */
  label?: string;
} & (
  | { name: IconName; fill?: never }
  // Only an icon with a filled cut can be drawn filled.
  | { name: FillableIconName; fill?: boolean }
);

export function Icon({ name, fill = false, className, style, label }: IconProps) {
  const d = fill ? FILLED_ICONS[name as FillableIconName] : ICONS[name];
  return (
    <span
      data-icon={name}
      className={className ? `icon ${className}` : 'icon'}
      style={style}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <svg viewBox="0 -960 960 960" width="1em" height="1em" fill="currentColor" aria-hidden="true">
        <path d={d} />
      </svg>
    </span>
  );
}
