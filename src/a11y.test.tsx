import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { ViewModeToggle } from './components/ViewModeToggle';
import { MembersStrip } from './components/MembersStrip';
import type { TripMember, TripInvite } from './lib/userTrips';

// Accessibility smoke test: run axe-core against a couple of key rendered
// components so a regression that introduces an obvious a11y violation (missing
// accessible name, bad ARIA, list/label misuse) fails CI. This complements the
// static jsx-a11y ESLint rules — axe checks the *rendered* DOM, which catches
// issues static analysis can't see. Layout-dependent rules (e.g. color-contrast)
// are inert under jsdom and axe skips them automatically.
//
// We assert on `results.violations` directly rather than via vitest-axe's
// `toHaveNoViolations` matcher: that matcher ships a type-only `.d.ts` and an
// empty runtime `extend-expect`, so it neither type-checks nor registers under
// this project's `verbatimModuleSyntax` + Vitest 4 setup. The `axe()` runner
// itself is a proper value export and all we need.

const CREATOR: TripMember = {
  email: 'alice@example.com',
  display_name: 'Alice',
  added_by_email: 'alice@example.com',
  added_at: 0,
  is_creator: true,
};

const MEMBER: TripMember = {
  email: 'bob@example.com',
  display_name: 'Bob',
  added_by_email: 'alice@example.com',
  added_at: 1,
  is_creator: false,
};

const INVITE: TripInvite = {
  invite_token: 'tok-123',
  invited_email: 'carol@example.com',
  invited_by_email: 'alice@example.com',
  invited_at: 2,
};

describe('accessibility smoke test', () => {
  it('ViewModeToggle has no axe violations', async () => {
    const { container } = render(
      <ViewModeToggle value="split" onChange={() => {}} />,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('MembersStrip has no axe violations', async () => {
    const { container } = render(
      <MembersStrip
        members={[CREATOR, MEMBER]}
        invites={[INVITE]}
        currentEmail="alice@example.com"
        isCreator
        onInvite={() => {}}
        onRemoveMember={() => {}}
        onRevokeInvite={() => {}}
        onLeave={() => {}}
      />,
    );
    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });
});
