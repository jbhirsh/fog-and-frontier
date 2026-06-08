import type { TripMember, TripInvite } from '../lib/userTrips';

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
  const currentMember = members.find(
    (m) => m.email.toLowerCase() === currentLower,
  );
  const showLeave = !!currentMember && !currentMember.is_creator;

  return (
    <div className="flex flex-wrap items-center gap-sm">
      {members.map((member) => {
        const isOwnChip = member.email.toLowerCase() === currentLower;
        const canRemove = isCreator && !member.is_creator;
        const removeDisabled = !isCreator || member.is_creator;
        // Never show the ✕ on the current user's own chip — they get the
        // Leave button instead.
        const showRemove = !isOwnChip && !member.is_creator;

        return (
          <div
            key={member.email}
            className="inline-flex items-center gap-xs bg-surface-variant rounded-full px-sm py-xs font-body-md text-on-surface-variant"
          >
            <span>
              {member.display_name ?? member.email}
              {isOwnChip && (
                <span className="ml-xs text-on-surface-variant/60">· You</span>
              )}
            </span>
            {member.is_creator && (
              <span className="font-label-caps text-label-caps text-primary bg-primary-fixed px-xs rounded-full text-xs">
                Creator
              </span>
            )}
            {showRemove && (
              <button
                type="button"
                onClick={() => {
                  if (canRemove) onRemoveMember(member.email);
                }}
                disabled={removeDisabled}
                title={
                  removeDisabled
                    ? 'Only the trip creator can remove members'
                    : undefined
                }
                aria-label={`Remove ${member.email}`}
                className="shrink-0 text-on-surface-variant/60 hover:text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-body-md">
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
          className="inline-flex items-center gap-xs bg-surface-variant rounded-full px-sm py-xs font-body-md text-on-surface-variant opacity-60 border border-dashed border-outline-variant"
        >
          <span>{invite.invited_email ?? 'pending invite'}</span>
          <button
            type="button"
            onClick={() => onRevokeInvite(invite.invite_token)}
            aria-label={`Revoke invite for ${invite.invited_email ?? 'pending invite'}`}
            className="shrink-0 text-on-surface-variant/60 hover:text-on-surface-variant"
          >
            <span className="material-symbols-outlined text-body-md">
              close
            </span>
          </button>
        </div>
      ))}

      {/* Leave trip — for current non-creator members */}
      {showLeave && (
        <button
          type="button"
          onClick={onLeave}
          className="font-body-md text-sm px-sm py-xs rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant"
        >
          Leave trip
        </button>
      )}

      {/* Invite button */}
      <button
        type="button"
        onClick={onInvite}
        className="inline-flex items-center gap-xs font-body-md text-sm px-sm py-xs rounded-full border border-outline-variant/40 text-primary hover:bg-surface-variant"
      >
        <span className="material-symbols-outlined text-body-md">
          person_add
        </span>
        + Invite
      </button>
    </div>
  );
}
