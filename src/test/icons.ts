// Which icon an element draws (#338): <Icon> names it in `data-icon`, where
// the icon font once put its name in the text, as a ligature.

/** The `name` icon in `container`, or null. */
export function queryIcon(name: string, container: ParentNode = document): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-icon="${name}"]`);
}

/** The `name` icon in `container`; throws if there's none. */
export function getIcon(name: string, container: ParentNode = document): HTMLElement {
  const icon = queryIcon(name, container);
  if (!icon) throw new Error(`No "${name}" icon`);
  return icon;
}

/** The icons in `container`, in order. */
export function iconNames(container: ParentNode = document): string[] {
  return [...container.querySelectorAll('[data-icon]')].map(
    (el) => el.getAttribute('data-icon') ?? '',
  );
}

/**
 * `el`'s text with each icon written in as `<name>` where it sits, as the
 * icon font's ligature once put its name in the text.
 */
export function textWithIcons(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const icon of copy.querySelectorAll('[data-icon]')) {
    icon.replaceWith(`<${icon.getAttribute('data-icon') ?? ''}>`);
  }
  return copy.textContent ?? '';
}
