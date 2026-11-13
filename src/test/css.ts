/**
 * An inline style value as this DOM writes it back. A test that checks what a
 * component put in `style` compares against this, never the literal it wrote:
 * engines canonicalize what they store (jsdom 31, as Firefox, reads
 * `translate(-200px, 0px)` back as `translate(-200px)`, and `'FILL' 1` as
 * `"FILL" 1`), so a literal tests the engine's spelling rather than the value.
 */
export function cssValue(property: 'transform' | 'fontVariationSettings', value: string): string {
  const probe = document.createElement('div');
  probe.style[property] = value;
  return probe.style[property];
}
