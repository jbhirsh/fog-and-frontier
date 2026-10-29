import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Google's One Tap prompt on production, put off until the page has settled
// and is idle, and kept away while the sign-in card is open.

const client = vi.hoisted(() => ({
  oneTap: vi.fn<(opts: unknown) => Promise<void>>(),
  notify: vi.fn(),
  id: 'one-tap-client',
}));
vi.mock('./authClient', () => ({
  authClient: { oneTap: client.oneTap, $store: { notify: client.notify } },
  get ONE_TAP_CLIENT_ID() {
    return client.id;
  },
}));

const { holdOneTapPrompt, useOneTapPrompt } = await import('./oneTap');

type Opts = { fetchOptions: { onSuccess: () => void } };
const lastOpts = () => client.oneTap.mock.calls.at(-1)?.[0] as Opts;

type IdleWindow = {
  requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};
const idle = window as unknown as IdleWindow;

beforeEach(() => {
  client.id = 'one-tap-client';
  client.oneTap.mockResolvedValue(undefined);
});

afterEach(() => {
  client.oneTap.mockReset();
  client.notify.mockReset();
  delete idle.requestIdleCallback;
  delete idle.cancelIdleCallback;
  vi.useRealTimers();
});

describe('useOneTapPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('asks a signed-out visitor once the page has settled and is idle, and no sooner', () => {
    let run = () => {};
    idle.requestIdleCallback = vi.fn((cb: () => void) => {
      run = cb;
      return 7;
    });
    idle.cancelIdleCallback = vi.fn();
    const { unmount } = renderHook(() => useOneTapPrompt(true));
    vi.advanceTimersByTime(2999);
    expect(idle.requestIdleCallback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(idle.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 });
    expect(client.oneTap).not.toHaveBeenCalled();
    run();
    expect(client.oneTap).toHaveBeenCalledOnce();
    unmount();
  });

  it('asks after three seconds where the browser has no idle callback', () => {
    renderHook(() => useOneTapPrompt(true));
    vi.advanceTimersByTime(2999);
    expect(client.oneTap).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(client.oneTap).toHaveBeenCalledOnce();
  });

  it('re-reads the session after a One Tap sign-in', () => {
    renderHook(() => useOneTapPrompt(true));
    vi.advanceTimersByTime(3000);
    lastOpts().fetchOptions.onSuccess();
    expect(client.notify).toHaveBeenCalledWith('$sessionSignal');
  });

  it('stops waiting once the visitor signs in or leaves', () => {
    const { rerender } = renderHook(({ out }) => useOneTapPrompt(out), {
      initialProps: { out: true },
    });
    rerender({ out: false });
    vi.advanceTimersByTime(5000);
    expect(client.oneTap).not.toHaveBeenCalled();
    idle.requestIdleCallback = vi.fn(() => 7);
    idle.cancelIdleCallback = vi.fn();
    const { unmount } = renderHook(() => useOneTapPrompt(true));
    vi.advanceTimersByTime(3000);
    unmount();
    expect(idle.cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(client.oneTap).not.toHaveBeenCalled();
  });

  describe('with Google’s script on the page', () => {
    const cancel = vi.fn();
    beforeEach(() => {
      (window as { google?: unknown }).google = { accounts: { id: { cancel } } };
    });
    afterEach(() => {
      delete (window as { google?: unknown }).google;
      cancel.mockReset();
    });

    it('asks no one while a sign-in dialog holds it, and asks again once it lets go', () => {
      const release = holdOneTapPrompt();
      const { unmount } = renderHook(() => useOneTapPrompt(true));
      vi.advanceTimersByTime(3000);
      expect(client.oneTap).not.toHaveBeenCalled();
      release();
      unmount();
      renderHook(() => useOneTapPrompt(true));
      vi.advanceTimersByTime(3000);
      expect(client.oneTap).toHaveBeenCalledOnce();
    });

    it('closes a prompt that’s showing as a dialog opens', () => {
      const release = holdOneTapPrompt();
      expect(cancel).toHaveBeenCalledOnce();
      release();
    });

    it('closes the prompt once the visitor signs in another way', () => {
      const { rerender } = renderHook(({ out }) => useOneTapPrompt(out), {
        initialProps: { out: true },
      });
      vi.advanceTimersByTime(3000);
      rerender({ out: false });
      expect(cancel).toHaveBeenCalledOnce();
    });
  });

  it('asks no one signed in, nor anywhere off production', () => {
    renderHook(() => useOneTapPrompt(false));
    client.id = '';
    renderHook(() => useOneTapPrompt(true));
    vi.advanceTimersByTime(5000);
    expect(client.oneTap).not.toHaveBeenCalled();
  });

  // A mock's own promise tracking would hide an unhandled rejection, so
  // this checks for the .catch itself.
  it('lets a prompt that fails go (its script blocked)', () => {
    const failed = Promise.reject(new Error('blocked'));
    const caught = vi.spyOn(failed, 'catch');
    client.oneTap.mockReturnValue(failed);
    renderHook(() => useOneTapPrompt(true));
    vi.advanceTimersByTime(3000);
    expect(caught).toHaveBeenCalledOnce();
  });
});
