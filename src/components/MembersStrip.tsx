import type { TripMember, TripInvite } from '../lib/userTrips';
import { glyphBleed } from '../lib/iconMetrics';
import { authorLabel } from '../lib/activityReviews';

type Props = {
  members: TripMember[];
  invites: TripInvite[];
  currentEmail: string | null;
  isCreator: boolean;
  onInvite: () => void;
  onRemoveMember: (email: string) => void;
  onRevokeInvite: (inviteToken: string) => void;
  onLeave: () => void;
};

export function MembersStrip({
  members,
  invites,
  currentEmail,
  isCreator,
  onInvite,
  onRemoveMember,
  onRevokeInvite,
  onLeave,
}: Props) {
  const currentLower = currentEmail?.toLowerCase() ?? null;

  // Is the current user a member but NOT the creator? If so show Leave button.
  const currentMember = members.find((m) => m.email.toLowerCase() === currentLower);
  const showLeave = !!currentMember && !currentMember.is_creator;

  return (
    <div className="space-y-md">
      <div className="flex flex-wrap items-center gap-sm">
        {members.map((member) => {
          const isOwnChip = member.email.toLowerCase() === currentLower;
          const removeDisabled = !isCreator || member.is_creator;
          // Never show the ✕ on the current user's own chip — they get the
          // Leave button instead.
          const showRemove = !isOwnChip && !member.is_creator;

          return (
            <div
              key={member.email}
              className="inline-flex items-center gap-xs rounded-full bg-surface-variant px-sm py-xs font-body-md text-on-surface-variant"
            >
              <span>
                {member.display_name ?? authorLabel(member.email)}
                {isOwnChip && <span className="ml-xs text-on-surface-variant/60">· You</span>}
              </span>
              {member.is_creator && (
                <span className="rounded-full bg-primary-fixed px-xs font-label-caps text-label-caps text-xs text-primary">
                  Creator
                </span>
              )}
              {showRemove && (
                <button
                  type="button"
                  onClick={() => onRemoveMember(member.email)}
                  disabled={removeDisabled}
                  title={removeDisabled ? 'Only the trip creator can remove members' : undefined}
                  aria-label={`Remove ${member.email}`}
                  className="relative inline-flex shrink-0 items-center justify-center text-on-surface-variant/60 before:absolute before:-inset-y-sm before:-right-sm before:left-0 before:content-[''] hover:text-on-surface-variant disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {/* Pulled out by the glyph's empty side, so the chip's insets
                    match; the hit area reaches past it up, down and right for
                    a finger, but never left over the name. */}
                  <span
                    className="material-symbols-outlined text-icon-sm"
                    style={{ marginRight: glyphBleed('close') }}
                  >
                    close
                  </span>
                </button>
              )}
            </div>
          );
        })}

        {/* Pending invite chips */}
        {invites.map((invite) => (
          <div
            key={invite.invite_token}
            className="inline-flex items-center gap-xs rounded-full border border-dashed border-outline-variant bg-surface-variant px-sm py-xs font-body-md text-on-surface-variant opacity-60"
          >
            <span>{invite.invited_email ?? 'pending invite'}</span>
            <button
              type="button"
              onClick={() => onRevokeInvite(invite.invite_token)}
              aria-label={`Revoke invite for ${invite.invited_email ?? 'pending invite'}`}
              className="inline-flex shrink-0 items-center justify-center text-on-surface-variant/60 hover:text-on-surface-variant"
            >
              <span
                className="material-symbols-outlined text-icon-sm"
                style={{ marginRight: glyphBleed('close') }}
              >
                close
              </span>
            </button>
          </div>
        ))}
      </div>

      {/* The dialog's actions, at its foot: leaving in red, inviting in the
          primary colour, the way forward on the right. */}
      <div className="flex flex-wrap justify-end gap-sm">
        {/* Leave trip — for current non-creator members */}
        {showLeave && (
          <button
            type="button"
            // Beside Invite, a slip would take you off the trip, and back
            // only by a new invite: it asks first.
            onClick={() => {
              if (window.confirm('Leave this trip? You’ll need a new invite to rejoin.')) onLeave();
            }}
            className="inline-flex min-h-11 items-center rounded-full bg-error px-md font-body-md text-sm font-medium text-on-error transition-opacity hover:opacity-90"
          >
            Leave trip
          </button>
        )}
        <button
          type="button"
          onClick={onInvite}
          className="inline-flex min-h-11 items-center gap-xs rounded-full bg-primary px-md font-body-md text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          <span className="material-symbols-outlined text-icon-sm" aria-hidden="true">
            person_add
          </span>
          Invite
        </button>
      </div>
    </div>
  );
}
