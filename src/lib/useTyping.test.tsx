import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { takesTyping, useTyping } from './useTyping';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

describe('takesTyping', () => {
  it.each(['text', 'search', 'email', 'number', 'url', 'tel', 'password', 'date'])(
    'is true for a %s field',
    (type) => {
      expect(takesTyping(el('input', { type }))).toBe(true);
    },
  );

  it.each(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'])(
    'is false for a %s input, which is tapped',
    (type) => {
      expect(takesTyping(el('input', { type }))).toBe(false);
    },
  );

  it('is true for a textarea, and false for a read-only one or a read-only input', () => {
    expect(takesTyping(el('textarea'))).toBe(true);
    expect(takesTyping(el('textarea', { readOnly: true }))).toBe(false);
    expect(takesTyping(el('input', { readOnly: true }))).toBe(false);
  });

  it('is true for editable content only', () => {
    const editable = el('div');
    // jsdom computes isContentEditable from no attribute, so it's set here.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(takesTyping(editable)).toBe(true);
    expect(takesTyping(el('button'))).toBe(false);
    expect(takesTyping(el('select'))).toBe(false);
  });

  it('is false for nothing, or something not an element', () => {
    expect(takesTyping(null)).toBe(false);
    expect(takesTyping(window)).toBe(false);
  });
});

function Probe() {
  return (
    <>
      <output>{useTyping() ? 'typing' : 'idle'}</output>
      <input aria-label="Name" />
      <input aria-label="Other" />
      <input type="checkbox" aria-label="Dogs" />
    </>
  );
}

describe('useTyping', () => {
  it('follows focus into and out of fields that type', () => {
    render(<Probe />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('idle');
    act(() => screen.getByLabelText('Name').focus());
    expect(status).toHaveTextContent('typing');
    // Field to field: still typing.
    act(() => screen.getByLabelText('Other').focus());
    expect(status).toHaveTextContent('typing');
    act(() => screen.getByLabelText('Dogs').focus());
    expect(status).toHaveTextContent('idle');
    act(() => screen.getByLabelText('Other').focus());
    act(() => screen.getByLabelText('Other').blur());
    expect(status).toHaveTextContent('idle');
  });

  it('starts out typing when a field already has focus', () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    render(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('typing');
    field.remove();
  });

  it('stops listening once gone', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Probe />);
    const added = add.mock.calls.filter(([type]) => type === 'focusin' || type === 'focusout');
    expect(added.map(([type]) => type).sort()).toEqual(['focusin', 'focusout']);
    unmount();
    for (const [type, listener] of added) expect(remove).toHaveBeenCalledWith(type, listener);
    vi.restoreAllMocks();
  });

  it('stops once the focused field is taken off the page without a focusout', () => {
    const { rerender } = render(<Probe />);
    const field = document.createElement('input');
    document.body.append(field);
    act(() => field.focus());
    expect(screen.getByRole('status')).toHaveTextContent('typing');
    // Safari sends no focusout for a removed field; jsdom does, so the
    // removal is made silent here, as Safari's is.
    const quiet = (e: Event) => e.stopImmediatePropagation();
    document.addEventListener('focusout', quiet, { capture: true });
    field.remove();
    document.removeEventListener('focusout', quiet, { capture: true });
    rerender(<Probe />);
    expect(screen.getByRole('status')).toHaveTextContent('idle');
  });
});
