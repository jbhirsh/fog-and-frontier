import { describe, expect, it } from 'vitest';
import { linkMessage, linkResult, linkReturnURL, withoutLinkResult } from './accountLinks';

describe('linkReturnURL', () => {
  it('marks this page, its own query kept, with the provider and outcome', () => {
    expect(linkReturnURL('https://example.com/trips?view=map#x', 'apple', 'linked')).toBe(
      'https://example.com/trips?view=map&account=linked&provider=apple#x',
    );
    expect(linkReturnURL('https://example.com/', 'google', 'link-failed')).toBe(
      'https://example.com/?account=link-failed&provider=google',
    );
  });
});

describe('linkResult', () => {
  it('reads a success, and a failure with Better Auth’s error', () => {
    expect(linkResult('?account=linked&provider=apple')).toEqual({
      provider: 'apple',
      linked: true,
      error: null,
    });
    expect(linkResult('?account=link-failed&provider=google&error=unable_to_link_account')).toEqual(
      { provider: 'google', linked: false, error: 'unable_to_link_account' },
    );
    expect(linkResult('?account=link-failed&provider=google')).toEqual({
      provider: 'google',
      linked: false,
      error: null,
    });
  });

  it.each([
    '',
    '?view=map',
    '?account=linked',
    '?account=linked&provider=github',
    '?account=other&provider=apple',
  ])('is nothing for %j', (search) => {
    expect(linkResult(search)).toBeNull();
  });
});

describe('withoutLinkResult', () => {
  it('drops only the linking’s marks and its error', () => {
    expect(
      withoutLinkResult('?view=map&account=link-failed&provider=apple&error=x&error_description=y'),
    ).toBe('?view=map');
    expect(withoutLinkResult('?account=linked&provider=apple')).toBe('');
  });
});

describe('linkMessage', () => {
  it('says it’s connected, already someone else’s, or didn’t work', () => {
    expect(linkMessage({ provider: 'apple', linked: true, error: null })).toBe(
      'Apple is connected. You can sign in with it now.',
    );
    expect(
      linkMessage({
        provider: 'google',
        linked: false,
        error: 'account_already_linked_to_different_user',
      }),
    ).toBe(
      'That Google account already has its own account here, so it can’t be connected to this one.',
    );
    expect(linkMessage({ provider: 'apple', linked: false, error: 'unable_to_link_account' })).toBe(
      'Apple couldn’t be connected. Try again.',
    );
  });
});
