import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { TripActivityCard } from '../components/TripActivityCard';
import { TripMap } from '../components/TripMap';
import { VotingCandidateCard } from '../components/VotingCandidateCard';
import { PromoteToPlanningModal } from '../components/PromoteToPlanningModal';
import { InlineError } from '../components/InlineError';
import { MembersStrip } from '../components/MembersStrip';
import { InviteModal } from '../components/InviteModal';
import { ActivityDetail } from '../components/ActivityDetail';
import type { Activity } from '../data/types';
import { SignInButton } from '@clerk/clerk-react';
import { CLERK_ENABLED } from '../lib/authShim';
import { useOwner } from '../lib/useOwner';
import { useVisibilityInterval } from '../lib/useVisibilityInterval';
import {
  assignSlot,
  castVote,
  claimInvite,
  dayCount,
  dayLabel,
  defaultStartTimeForDay,
  deleteTrip,
  fetchUsers,
  formatHHMM,
  inviteLinkPath,
  inviteMember,
  markTripPast,
  memberVoteBreakdown,
  myVote,
  patchTrip,
  removeMember,
  removeTripActivity,
  revertToVoting,
  revokeInvite,
  setDisplayOrder,
  sortByNetScore,
  tallyFor,
  transitionToPlanning,
  useTrip,
  type PatchTripInput,
  type Trip,
  type TripActivity,
  type UserSummary,
} from '../lib/userTrips';

const TALLY_REFRESH_MS = 30_000;

const DRAG_MIME = 'application/x-fnf-trip-activity-id';
const PAST_TOOLTIP = 'This trip is past';

export function TripDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isLoaded: ownerLoaded, email } = useOwner();
  const { trip, isLoading, error, reload } = useTrip(id);
  const [searchParams, setSearchParams] = useSearchParams();

  const [editingHeader, setEditingHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slotDialog, setSlotDialog] = useState<SlotDialogState | null>(null);
  const [markPastOpen, setMarkPastOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [detail, setDetail] = useState<Activity | null>(null);

  const isPast = trip?.status === 'past';
  const isVoting = trip?.status === 'voting';
  const isCreator = !!trip && !!email && trip.creator_email === email;

  const buckets = useMemo(() => bucketByDay(trip), [trip]);

  // Invite claim (#51 c2): a SIGNED-IN visitor opening /trips/:id?invite=<token>
  // claims it (token IS the credential — no email match), becoming a member.
  // Signed-out visitors are handled in render (prompted to sign in; the ?invite
  // token stays in the URL so this fires once they authenticate). Runs once,
  // strips the param, then refetches so the (previously 404) trip resolves.
  const inviteToken = searchParams.get('invite');
  const claimStartedRef = useRef(false);
  const [claimDone, setClaimDone] = useState(false);
  // True from a signed-in invitee's arrival until the claim resolves — keeps the
  // page in "Loading…" instead of flashing the not-found / sign-in screens.
  const claimInProgress = inviteToken !== null && email !== null && !claimDone;
  useEffect(() => {
    if (!inviteToken || !ownerLoaded || !email) return;
    if (claimStartedRef.current) return;
    claimStartedRef.current = true;
    void (async () => {
      try {
        await claimInvite(inviteToken);
      } catch (err) {
        console.error(err);
      } finally {
        const next = new URLSearchParams(searchParams);
        next.delete('invite');
        setSearchParams(next, { replace: true });
        // Await the refetch before clearing the in-progress gate so the now-
        // visible trip is loaded rather than briefly flashing not-found.
        await reload();
        setClaimDone(true);
      }
    })();
  }, [inviteToken, ownerLoaded, email, reload, searchParams, setSearchParams]);

  const runAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      setActionError(null);
      try {
        await fn();
        await reload();
      } catch (err) {
        console.error(err);
        // Resync on failure so a stale view corrects itself — e.g. an action
        // that conflicts because the creator just changed the trip under us.
        setActionError(
          "That didn't go through — the trip may have changed. We've refreshed it.",
        );
        await reload();
      } finally {
        setBusy(false);
      }
    },
    [busy, reload],
  );

  // Poll for fresh vote tallies while voting is open (#51 c14): every 30s,
  // paused while the tab is hidden, and immediately on regaining
  // visibility/focus. reload() is the existing useTrip refetch.
  useVisibilityInterval(() => void reload(), TALLY_REFRESH_MS, isVoting);

  // Optimistic voting: castVote writes the optimistic vote straight into the
  // cache (Apollo optimisticResponse + cache update) so the thumb feels
  // instant, then persists in the background. No busy-guard (rapid toggles are
  // fine) and no full reload on success — the 30s poll reconciles other
  // members' votes. On failure, resync + surface the error.
  function handleVote(taId: string, value: -1 | 0 | 1) {
    if (!trip || !isVoting || !email) return;
    void castVote(trip.id, taId, value, email).catch((err: unknown) => {
      console.error(err);
      setActionError(
        "Your vote didn't save — the trip may have changed. We've refreshed it.",
      );
      void reload();
    });
  }

  function handleOpenActivity(a: TripActivity) {
    if (a.snapshot) setDetail(a.snapshot);
  }

  function handleFinalize(keptActivityIds: string[]) {
    if (!trip) return;
    setPromoteOpen(false);
    void runAction(() => transitionToPlanning(trip.id, keptActivityIds));
  }

  function handleRevert() {
    if (!trip) return;
    setConfirmingRevert(false);
    void runAction(() => revertToVoting(trip.id));
  }

  // Drag-reorder candidates during voting: rebuild the ordered id list with the
  // dragged card moved before the drop target, then renumber display_order.
  function handleReorderCandidate(draggedId: string, targetId: string) {
    if (!trip || draggedId === targetId) return;
    const ordered = trip.activities.map((a) => a.id);
    const from = ordered.indexOf(draggedId);
    const to = ordered.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ordered.splice(from, 1);
    ordered.splice(ordered.indexOf(targetId), 0, draggedId);
    void runAction(async () => {
      for (let i = 0; i < ordered.length; i++) {
        await setDisplayOrder(ordered[i], i);
      }
    });
  }

  async function handleOpenInvite() {
    setInviteOpen(true);
    // Lazy-load the global account list for the picker autocomplete.
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCreateInvite(inviteEmail: string) {
    if (!trip) throw new Error('no trip');
    const invite = await inviteMember(trip.id, inviteEmail);
    await reload(); // surface the new pending-invite chip
    return { invite_token: invite.invite_token };
  }

  function handleRemoveMember(memberEmail: string) {
    if (!trip) return;
    void runAction(() => removeMember(trip.id, memberEmail));
  }

  function handleRevokeInvite(token: string) {
    if (!trip) return;
    void runAction(() => revokeInvite(trip.id, token));
  }

  function handleLeave() {
    if (!trip || !email) return;
    const tripEmail = email;
    void (async () => {
      try {
        await removeMember(trip.id, tripEmail);
        void navigate('/trips');
      } catch (err) {
        console.error(err);
        setActionError("Couldn't leave the trip. Try again.");
      }
    })();
  }

  function handleDropOnDay(dayIndex: number) {
    return (e: React.DragEvent<HTMLDivElement>) => {
      if (isPast || !trip) return;
      const taId = e.dataTransfer.getData(DRAG_MIME);
      if (!taId) return;
      e.preventDefault();
      const activity = trip.activities.find((a) => a.id === taId);
      if (!activity) return;
      // Dropping a card back onto the day it already belongs to is a no-op —
      // don't fire a PATCH or recompute start_time (#79).
      if (activity.day_index === dayIndex) return;
      const onDay = trip.activities.filter(
        (a) => a.day_index === dayIndex && a.id !== taId && a.start_time,
      );
      const start_time = defaultStartTimeForDay(onDay);
      void runAction(() =>
        assignSlot(taId, { day_index: dayIndex, start_time }),
      );
    };
  }

  function handleDropOnUnscheduled(e: React.DragEvent<HTMLDivElement>) {
    if (isPast) return;
    const taId = e.dataTransfer.getData(DRAG_MIME);
    if (!taId) return;
    e.preventDefault();
    void runAction(() =>
      assignSlot(taId, { day_index: null, start_time: null }),
    );
  }

  function handleAssignOrEdit(activity: TripActivity) {
    if (!trip) return;
    setSlotDialog({
      taId: activity.id,
      activityName: activity.snapshot?.name ?? '(activity)',
      dayIndex: activity.day_index ?? 0,
      startTime: activity.start_time ?? defaultStartTimeForDay(
        trip.activities.filter(
          (a) => a.day_index === 0 && a.id !== activity.id && a.start_time,
        ),
      ),
    });
  }

  function handleSubmitSlot(dayIndex: number, startTime: string) {
    if (!slotDialog) return;
    const taId = slotDialog.taId;
    setSlotDialog(null);
    void runAction(() =>
      assignSlot(taId, { day_index: dayIndex, start_time: startTime }),
    );
  }

  function handleMoveToUnscheduled(activity: TripActivity) {
    void runAction(() =>
      assignSlot(activity.id, { day_index: null, start_time: null }),
    );
  }

  function handleRemove(activity: TripActivity) {
    void runAction(() => removeTripActivity(activity.id));
  }

  async function handleSaveHeader(input: HeaderEditInput) {
    if (!trip) return;
    // On past trips, title and dates are disabled in the form; only send
    // the still-editable fields so the server doesn't 409 on the disabled
    // ones (the patch handler rejects any title/start_date/end_date in the
    // body when status === 'past', even if the value hasn't changed).
    const body: PatchTripInput = {
      description: input.description || null,
      cover_image_url: input.cover_image_url || null,
    };
    if (trip.status !== 'past') {
      body.title = input.title;
      body.start_date = input.start_date;
      body.end_date = input.end_date;
    }
    await runAction(() => patchTrip(trip.id, body));
    setEditingHeader(false);
  }

  function handleConfirmDelete() {
    if (!trip) return;
    setConfirmingDelete(false);
    void (async () => {
      try {
        await deleteTrip(trip.id);
        void navigate('/trips');
      } catch (err) {
        console.error(err);
      }
    })();
  }

  function handleSubmitMarkPast(ids: string[]) {
    if (!trip) return;
    setMarkPastOpen(false);
    void runAction(() => markTripPast(trip.id, ids));
  }

  if (!ownerLoaded || isLoading || claimInProgress) {
    return (
      <section className="px-margin py-xl text-center text-on-surface-variant">
        Loading…
      </section>
    );
  }

  // Signed-out visitor arriving via an invite link: prompt them to sign in so
  // the claim can run (the ?invite token stays in the URL through the modal
  // sign-in, then the claim effect fires once they're authenticated).
  if (inviteToken && !email) {
    return (
      <section className="px-margin py-xl max-w-2xl mx-auto text-center space-y-md">
        <h1 className="font-display text-headline-lg text-primary">
          You&apos;re invited
        </h1>
        <p className="font-body-lg text-on-surface-variant">
          Sign in to accept your invitation and join this trip.
        </p>
        {CLERK_ENABLED ? (
          <SignInButton mode="modal">
            <button
              type="button"
              className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
            >
              Sign in to accept
            </button>
          </SignInButton>
        ) : (
          <p className="font-body-md text-on-surface-variant">
            Sign-in isn&apos;t available right now — try again later.
          </p>
        )}
      </section>
    );
  }

  // Anonymous callers get 401 from the API. Members (owners or invited editors)
  // get the trip; non-members get 404 (existence hidden) and fall through to the
  // not-found branch below.
  if (error === 'unauthorized') {
    return (
      <section className="px-margin py-xl max-w-2xl mx-auto text-center space-y-md">
        <h1 className="font-display text-headline-lg text-primary">Trip</h1>
        <p className="font-body-lg text-on-surface-variant">
          Sign in to view this trip.
        </p>
        <Link to="/trips" className="text-primary underline">
          Back to trips
        </Link>
      </section>
    );
  }

  if (error || !trip) {
    return (
      <section className="px-margin py-xl max-w-2xl mx-auto text-center space-y-md">
        <p className="font-body-lg text-on-surface-variant">
          {error === 'not-found'
            ? "We couldn't find that trip."
            : "Couldn't load this trip."}
        </p>
        <Link to="/trips" className="text-primary underline">
          Back to trips
        </Link>
      </section>
    );
  }

  return (
    <>
      <TripHeader
        trip={trip}
        isPast={isPast}
        isVoting={isVoting}
        isCreator={isCreator}
        editing={editingHeader}
        onEdit={() => setEditingHeader(true)}
        onCancelEdit={() => setEditingHeader(false)}
        onSave={(input) => void handleSaveHeader(input)}
        onMarkPast={() => setMarkPastOpen(true)}
        onDelete={() => setConfirmingDelete(true)}
        onRevert={() => setConfirmingRevert(true)}
      />

      {actionError && (
        <div className="px-margin pt-md max-w-screen-2xl mx-auto">
          <InlineError
            message={actionError}
            onDismiss={() => setActionError(null)}
          />
        </div>
      )}

      <div className="px-margin pt-md max-w-screen-2xl mx-auto">
        <MembersStrip
          members={trip.members}
          invites={trip.invites}
          currentEmail={email}
          isCreator={isCreator}
          onInvite={() => void handleOpenInvite()}
          onRemoveMember={handleRemoveMember}
          onRevokeInvite={handleRevokeInvite}
          onLeave={handleLeave}
        />
      </div>

      {isVoting ? (
        <VotingView
          trip={trip}
          email={email}
          isCreator={isCreator}
          busy={busy}
          onVote={handleVote}
          onRemove={(a) => handleRemove(a)}
          onOpen={handleOpenActivity}
          onReorder={handleReorderCandidate}
          onFinalize={() => setPromoteOpen(true)}
          onAddFromCurated={() =>
            void navigate('/', {
              state: { target_trip_id: trip.id, target_trip_title: trip.title },
            })
          }
        />
      ) : (
        <section className="px-margin py-lg max-w-screen-2xl mx-auto space-y-lg">
          <TripMap trip={trip} />

          <div className="flex items-center justify-between gap-md flex-wrap">
            <h2 className="font-headline-md text-headline-md text-on-surface">
              Itinerary
            </h2>
            <button
              type="button"
              onClick={() => {
                if (isPast) return;
                void navigate('/', {
                  state: {
                    target_trip_id: trip.id,
                    target_trip_title: trip.title,
                  },
                });
              }}
              disabled={isPast}
              title={isPast ? PAST_TOOLTIP : undefined}
              className="inline-flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-body-md">add</span>
              Add activity
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
            <div className="lg:col-span-2 space-y-md">
              {buckets.map((bucket) => (
                <DaySection
                  key={bucket.dayIndex}
                  trip={trip}
                  bucket={bucket}
                  isPast={isPast}
                  onDropOnDay={handleDropOnDay(bucket.dayIndex)}
                  onEditTime={(a) => handleAssignOrEdit(a)}
                  onMoveToUnscheduled={(a) => handleMoveToUnscheduled(a)}
                  onRemove={(a) => handleRemove(a)}
                  onOpen={handleOpenActivity}
                />
              ))}
            </div>
            <UnscheduledPanel
              trip={trip}
              isPast={isPast}
              onDrop={handleDropOnUnscheduled}
              onAssign={(a) => handleAssignOrEdit(a)}
              onRemove={(a) => handleRemove(a)}
              onOpen={handleOpenActivity}
              onAddFromCurated={() => {
                if (isPast) return;
                void navigate('/', {
                  state: {
                    target_trip_id: trip.id,
                    target_trip_title: trip.title,
                  },
                });
              }}
            />
          </div>

          {/* Final vote tallies stay visible after voting closes, as
              historical context (#51). */}
          <VotingResults trip={trip} onOpen={handleOpenActivity} />
        </section>
      )}

      {slotDialog && trip && (
        <SlotDialog
          state={slotDialog}
          dayCount={dayCount(trip)}
          dayLabelFor={(i) => dayLabel(trip, i)}
          onCancel={() => setSlotDialog(null)}
          onSubmit={handleSubmitSlot}
        />
      )}

      {markPastOpen && trip && (
        <MarkPastModal
          trip={trip}
          onCancel={() => setMarkPastOpen(false)}
          onSubmit={handleSubmitMarkPast}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this trip?"
          message="The trip and its itinerary will be removed permanently. Completed activities stay completed."
          confirmLabel="Delete trip"
          destructive
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleConfirmDelete}
        />
      )}

      {promoteOpen && trip && (
        <PromoteToPlanningModal
          candidates={sortByNetScore(trip.activities, trip.votes).map((a) => ({
            activity: a,
            tally: tallyFor(trip.votes, a.id),
          }))}
          onCancel={() => setPromoteOpen(false)}
          onConfirm={handleFinalize}
        />
      )}

      {confirmingRevert && (
        <ConfirmDialog
          title="Reopen voting?"
          message="This moves the trip back to voting. All day/time assignments are cleared; votes are kept. You can finalize again afterward."
          confirmLabel="Reopen voting"
          onCancel={() => setConfirmingRevert(false)}
          onConfirm={handleRevert}
        />
      )}

      {inviteOpen && trip && (
        <InviteModal
          users={users}
          excludeEmails={[
            ...trip.members.map((m) => m.email),
            ...trip.invites.map((i) => i.invited_email ?? ''),
          ].filter(Boolean)}
          onClose={() => setInviteOpen(false)}
          onCreateInvite={handleCreateInvite}
          buildLink={(token) =>
            `${window.location.origin}${inviteLinkPath(trip.id, token)}`
          }
        />
      )}

      {detail && (
        <ActivityDetail activity={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

// Voting-phase body: candidate list with vote controls + live tallies, drag to
// reorder, and the creator's "Finalize voting" action. Itinerary scheduling is
// intentionally absent here — it unlocks once voting is finalized (#51).
function VotingView({
  trip,
  email,
  isCreator,
  busy,
  onVote,
  onRemove,
  onOpen,
  onReorder,
  onFinalize,
  onAddFromCurated,
}: {
  trip: Trip;
  email: string | null;
  isCreator: boolean;
  busy: boolean;
  onVote: (taId: string, value: -1 | 0 | 1) => void;
  onRemove: (a: TripActivity) => void;
  onOpen: (a: TripActivity) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onFinalize: () => void;
  onAddFromCurated: () => void;
}) {
  const candidates = trip.activities;
  return (
    <section className="px-margin py-lg max-w-screen-2xl mx-auto space-y-lg">
      <div className="rounded-xl bg-tertiary-container/40 border border-outline-variant/20 px-md py-sm font-body-md text-on-surface-variant">
        Voting is open — react to each candidate. Scheduling unlocks once the
        trip creator finalizes voting.
      </div>

      <div className="flex items-center justify-between gap-md flex-wrap">
        <h2 className="font-headline-md text-headline-md text-on-surface">
          Candidates
        </h2>
        <div className="flex items-center gap-sm">
          <button
            type="button"
            onClick={onAddFromCurated}
            className="inline-flex items-center gap-xs rounded-full border border-outline-variant/40 text-on-surface-variant px-md py-sm font-body-md hover:bg-surface-variant"
          >
            <span className="material-symbols-outlined text-body-md">add</span>
            Add candidate
          </button>
          <button
            type="button"
            onClick={onFinalize}
            disabled={!isCreator || busy || candidates.length === 0}
            title={
              !isCreator
                ? 'Only the trip creator can finalize voting'
                : candidates.length === 0
                  ? 'Add candidates before finalizing'
                  : undefined
            }
            className="inline-flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-body-md">
              how_to_vote
            </span>
            Finalize voting
          </button>
        </div>
      </div>

      {candidates.length === 0 ? (
        <p className="font-body-md text-on-surface-variant">
          No candidates yet.{' '}
          <button
            type="button"
            onClick={onAddFromCurated}
            className="text-primary underline"
          >
            Add some from the curated catalog
          </button>{' '}
          to start voting.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
          {candidates.map((a) => (
            <div key={a.id} className="space-y-xs">
              <VotingCandidateCard
                activity={a}
                tally={tallyFor(trip.votes, a.id)}
                myVote={myVote(trip.votes, a.id, email)}
                votingOpen
                canRemove
                onVote={(value) => onVote(a.id, value)}
                onRemove={() => onRemove(a)}
                onOpen={() => onOpen(a)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, a.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const draggedId = e.dataTransfer.getData(DRAG_MIME);
                  if (draggedId) onReorder(draggedId, a.id);
                }}
              />
              <VoteBreakdown trip={trip} tripActivityId={a.id} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Per-candidate by-member breakdown (#51 c5). A member who voted then left the
// trip still appears here, labeled "(left trip)" — their vote keeps counting.
function VoteBreakdown({
  trip,
  tripActivityId,
}: {
  trip: Trip;
  tripActivityId: string;
}) {
  const rows = memberVoteBreakdown(trip.votes, trip.members, tripActivityId);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-xs px-sm">
      {rows.map((r) => (
        <span
          key={r.email}
          className="inline-flex items-center gap-xs text-sm font-body-md text-on-surface-variant bg-surface-container-low rounded-full px-sm py-xs"
        >
          <span
            className={`material-symbols-outlined text-body-md ${
              r.value === 1 ? 'text-primary' : 'text-error'
            }`}
          >
            {r.value === 1 ? 'thumb_up' : 'thumb_down'}
          </span>
          {r.display_name ?? r.email}
          {r.leftTrip && (
            <span className="italic opacity-70">&nbsp;(left trip)</span>
          )}
        </span>
      ))}
    </div>
  );
}

// Read-only final tallies shown under the itinerary once voting has closed.
function VotingResults({
  trip,
  onOpen,
}: {
  trip: Trip;
  onOpen: (a: TripActivity) => void;
}) {
  if (trip.votes.length === 0) return null;
  const ranked = sortByNetScore(trip.activities, trip.votes);
  return (
    <div className="space-y-md pt-md border-t border-outline-variant/20">
      <h2 className="font-headline-md text-headline-md text-on-surface">
        Voting results
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
        {ranked.map((a) => (
          <div key={a.id} className="space-y-xs">
            <VotingCandidateCard
              activity={a}
              tally={tallyFor(trip.votes, a.id)}
              myVote={0}
              votingOpen={false}
              canRemove={false}
              onOpen={() => onOpen(a)}
            />
            <VoteBreakdown trip={trip} tripActivityId={a.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

type DayBucket = { dayIndex: number; activities: TripActivity[] };

function bucketByDay(trip: Trip | null): DayBucket[] {
  if (!trip) return [];
  const total = dayCount(trip);
  const out: DayBucket[] = [];
  for (let i = 0; i < total; i++) {
    out.push({
      dayIndex: i,
      activities: trip.activities
        .filter((a) => a.day_index === i)
        .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '')),
    });
  }
  return out;
}

type HeaderEditInput = {
  title: string;
  start_date: string;
  end_date: string;
  description: string;
  cover_image_url: string;
};

function TripHeader({
  trip,
  isPast,
  isVoting,
  isCreator,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onMarkPast,
  onDelete,
  onRevert,
}: {
  trip: Trip;
  isPast: boolean;
  isVoting: boolean;
  isCreator: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (input: HeaderEditInput) => void;
  onMarkPast: () => void;
  onDelete: () => void;
  onRevert: () => void;
}) {
  const [draft, setDraft] = useState<HeaderEditInput>({
    title: trip.title,
    start_date: trip.start_date,
    end_date: trip.end_date,
    description: trip.description ?? '',
    cover_image_url: trip.cover_image_url ?? '',
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the overflow menu on outside click or Escape — matches the
  // AddToTripDropdown pattern.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (editing) {
    return (
      <section className="px-margin py-lg bg-surface-container-low border-b border-outline-variant/20">
        <form
          className="max-w-3xl mx-auto space-y-md"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
          }}
        >
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            required
            disabled={isPast}
            title={isPast ? 'This trip is past' : undefined}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm font-display text-headline-md disabled:opacity-60"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
            <input
              type="date"
              value={draft.start_date}
              onChange={(e) =>
                setDraft({ ...draft, start_date: e.target.value })
              }
              disabled={isPast}
              title={isPast ? 'This trip is past' : undefined}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm disabled:opacity-60"
            />
            <input
              type="date"
              value={draft.end_date}
              onChange={(e) =>
                setDraft({ ...draft, end_date: e.target.value })
              }
              min={draft.start_date || undefined}
              disabled={isPast}
              title={isPast ? 'This trip is past' : undefined}
              className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm disabled:opacity-60"
            />
          </div>
          <textarea
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            rows={2}
            placeholder="Description (optional)"
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm"
          />
          <input
            type="url"
            value={draft.cover_image_url}
            onChange={(e) =>
              setDraft({ ...draft, cover_image_url: e.target.value })
            }
            placeholder="Cover image URL (optional)"
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm"
          />
          <div className="flex items-center gap-md">
            <button
              type="submit"
              className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="font-body-md text-on-surface-variant"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  const dateRange = formatDateRange(trip.start_date, trip.end_date);
  const editTooltip = isPast ? 'This trip is past' : undefined;

  return (
    <section className="px-margin py-lg bg-surface-container-low border-b border-outline-variant/20">
      <div className="max-w-screen-2xl mx-auto flex flex-wrap items-start justify-between gap-md">
        <div className="space-y-xs">
          <Link
            to="/trips"
            className="text-body-sm text-on-surface-variant underline"
          >
            ← Trips
          </Link>
          <h1 className="font-display text-headline-lg md:text-display text-primary">
            {trip.title}
          </h1>
          <p className="font-body-md text-on-surface-variant">{dateRange}</p>
          {trip.description && (
            <p className="font-body-md text-on-surface max-w-2xl">
              {trip.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-sm">
          {isPast ? (
            <span className="font-label-caps text-label-caps text-on-surface-variant bg-surface-variant px-sm py-xs rounded-full">
              {trip.marked_past_at
                ? `Past · ended ${new Date(trip.marked_past_at).toLocaleDateString(
                    'en-US',
                    { month: 'short', day: 'numeric' },
                  )}`
                : 'Past'}
            </span>
          ) : isVoting ? (
            <span className="font-label-caps text-label-caps text-on-tertiary-container bg-tertiary-container px-sm py-xs rounded-full">
              Voting
            </span>
          ) : (
            <span className="font-label-caps text-label-caps text-primary bg-primary-fixed px-sm py-xs rounded-full">
              Planning
            </span>
          )}
          <button
            type="button"
            onClick={onEdit}
            title={isPast ? 'Past trip — only cover and description are editable' : editTooltip}
            className="font-body-md text-sm px-sm py-xs rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant"
          >
            Edit
          </button>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant"
            >
              <span className="material-symbols-outlined">more_horiz</span>
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 mt-xs w-56 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-lg z-10 overflow-hidden"
              >
                {!isPast && !isVoting && (
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false);
                      onRevert();
                    }}
                    disabled={!isCreator}
                    tooltip={
                      !isCreator
                        ? 'Only the trip creator can reopen voting'
                        : undefined
                    }
                  >
                    Reopen voting…
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onMarkPast();
                  }}
                  disabled={isPast || !isCreator}
                  tooltip={
                    isPast
                      ? 'Already past'
                      : !isCreator
                        ? 'Only the trip creator can mark a trip past'
                        : undefined
                  }
                >
                  Mark as past…
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete();
                  }}
                  disabled={!isCreator}
                  tooltip={
                    !isCreator
                      ? 'Only the trip creator can delete this trip'
                      : undefined
                  }
                  destructive
                >
                  Delete trip…
                </MenuItem>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MenuItem({
  onClick,
  disabled,
  tooltip,
  destructive,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tooltip?: string;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={`w-full text-left font-body-md px-md py-sm hover:bg-surface-variant disabled:opacity-60 disabled:cursor-not-allowed ${
        destructive ? 'text-error' : 'text-on-surface'
      }`}
    >
      {children}
    </button>
  );
}

function DaySection({
  trip,
  bucket,
  isPast,
  onDropOnDay,
  onEditTime,
  onMoveToUnscheduled,
  onRemove,
  onOpen,
}: {
  trip: Trip;
  bucket: DayBucket;
  isPast: boolean;
  onDropOnDay: (e: React.DragEvent<HTMLDivElement>) => void;
  onEditTime: (a: TripActivity) => void;
  onMoveToUnscheduled: (a: TripActivity) => void;
  onRemove: (a: TripActivity) => void;
  onOpen: (a: TripActivity) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (isPast) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        onDropOnDay(e);
      }}
      className={`rounded-xl border-2 transition-colors p-md space-y-sm ${
        dragOver
          ? 'border-primary bg-primary-fixed/40'
          : 'border-outline-variant/30 bg-surface-container-low'
      }`}
    >
      <h3 className="font-headline-md text-body-lg text-on-surface">
        {dayLabel(trip, bucket.dayIndex)}
      </h3>
      {bucket.activities.length === 0 ? (
        <p className="font-body-md text-sm text-on-surface-variant">
          Drag an activity from Unscheduled, or use the card menu.
        </p>
      ) : (
        bucket.activities.map((a) => (
          <TripActivityCard
            key={a.id}
            activity={a}
            disabled={isPast}
            pastTooltip={PAST_TOOLTIP}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, a.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onEditTime={() => onEditTime(a)}
            onMoveToUnscheduled={() => onMoveToUnscheduled(a)}
            onRemove={() => onRemove(a)}
            onOpen={() => onOpen(a)}
            showTimeRange
          />
        ))
      )}
    </div>
  );
}

function UnscheduledPanel({
  trip,
  isPast,
  onDrop,
  onAssign,
  onRemove,
  onOpen,
  onAddFromCurated,
}: {
  trip: Trip;
  isPast: boolean;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onAssign: (a: TripActivity) => void;
  onRemove: (a: TripActivity) => void;
  onOpen: (a: TripActivity) => void;
  onAddFromCurated: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const items = trip.activities.filter((a) => a.day_index === null);

  return (
    <div
      onDragOver={(e) => {
        if (isPast) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        onDrop(e);
      }}
      className={`rounded-xl border-2 transition-colors p-md space-y-sm h-fit ${
        dragOver
          ? 'border-primary bg-primary-fixed/40'
          : 'border-outline-variant/30 bg-surface-container-low'
      }`}
    >
      <div className="flex items-center justify-between gap-sm">
        <h2 className="font-headline-md text-headline-md text-on-surface">
          Unscheduled
        </h2>
        <button
          type="button"
          onClick={onAddFromCurated}
          disabled={isPast}
          title={isPast ? PAST_TOOLTIP : undefined}
          className="font-body-md text-sm px-sm py-xs rounded-full border border-outline-variant/40 text-on-surface-variant hover:bg-surface-variant disabled:opacity-60 disabled:cursor-not-allowed"
        >
          + Add
        </button>
      </div>
      {items.length === 0 ? (
        <p className="font-body-md text-sm text-on-surface-variant">
          Use{' '}
          <button
            type="button"
            onClick={onAddFromCurated}
            disabled={isPast}
            className="text-primary underline disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Add activity
          </button>{' '}
          to multi-select from the curated catalog into this trip.
        </p>
      ) : (
        items.map((a) => (
          <TripActivityCard
            key={a.id}
            activity={a}
            disabled={isPast}
            pastTooltip={PAST_TOOLTIP}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, a.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onAssignToDay={() => onAssign(a)}
            onRemove={() => onRemove(a)}
            onOpen={() => onOpen(a)}
          />
        ))
      )}
    </div>
  );
}

type SlotDialogState = {
  taId: string;
  activityName: string;
  dayIndex: number;
  startTime: string;
};

function SlotDialog({
  state,
  dayCount,
  dayLabelFor,
  onCancel,
  onSubmit,
}: {
  state: SlotDialogState;
  dayCount: number;
  dayLabelFor: (dayIndex: number) => string;
  onCancel: () => void;
  onSubmit: (dayIndex: number, startTime: string) => void;
}) {
  const [dayIndex, setDayIndex] = useState(state.dayIndex);
  const [startTime, setStartTime] = useState(state.startTime);

  return (
    <ModalShell onCancel={onCancel} title={`Schedule ${state.activityName}`}>
      <div className="space-y-md">
        <label className="block space-y-xs">
          <span className="font-body-md text-on-surface-variant">Day</span>
          <select
            value={dayIndex}
            onChange={(e) => setDayIndex(Number(e.target.value))}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm"
          >
            {Array.from({ length: dayCount }, (_, i) => (
              <option key={i} value={i}>
                {dayLabelFor(i)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-xs">
          <span className="font-body-md text-on-surface-variant">Start time</span>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-md py-sm"
          />
        </label>
        <div className="flex items-center justify-end gap-md">
          <button
            type="button"
            onClick={onCancel}
            className="font-body-md text-on-surface-variant"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(dayIndex, startTime)}
            className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function MarkPastModal({
  trip,
  onCancel,
  onSubmit,
}: {
  trip: Trip;
  onCancel: () => void;
  onSubmit: (ids: string[]) => void;
}) {
  const scheduled = useMemo(
    () =>
      trip.activities
        .filter(
          (a) =>
            a.day_index !== null &&
            a.activity_id !== null &&
            a.start_time !== null,
        )
        .sort((a, b) => {
          if (a.day_index !== b.day_index)
            return (a.day_index ?? 0) - (b.day_index ?? 0);
          return (a.start_time ?? '').localeCompare(b.start_time ?? '');
        }),
    [trip],
  );

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(scheduled.map((a) => [a.activity_id ?? '', true])),
  );

  function toggle(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function submit() {
    const ids = scheduled
      .map((a) => a.activity_id ?? '')
      .filter((id) => id && checked[id]);
    onSubmit(ids);
  }

  return (
    <ModalShell
      onCancel={onCancel}
      title="Which scheduled activities did we actually do?"
    >
      {scheduled.length === 0 ? (
        <p className="font-body-md text-on-surface-variant">
          Nothing was scheduled, so there&apos;s nothing to mark completed.
          Marking past anyway is fine.
        </p>
      ) : (
        <div className="space-y-xs max-h-96 overflow-y-auto">
          {scheduled.map((a) => {
            const aid = a.activity_id ?? '';
            const inputId = `mp-${a.id}`;
            return (
              <div
                key={a.id}
                className="flex items-start gap-sm py-sm border-b border-outline-variant/20 last:border-b-0"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={!!checked[aid]}
                  onChange={() => toggle(aid)}
                  className="mt-1 accent-primary"
                />
                <label
                  htmlFor={inputId}
                  className="flex-1 space-y-xs cursor-pointer"
                >
                  <span className="block font-body-md text-on-surface">
                    {a.snapshot?.name ?? '(activity)'}
                  </span>
                  <span className="block font-body-md text-sm text-on-surface-variant">
                    {dayLabel(trip, a.day_index ?? 0)} ·{' '}
                    {formatHHMM(a.start_time)}
                    {(() => {
                      const t = tallyFor(trip.votes, a.id);
                      return t.up + t.down > 0
                        ? ` · Voted ${t.up} to ${t.down}`
                        : '';
                    })()}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-end gap-md pt-md">
        <button
          type="button"
          onClick={onCancel}
          className="font-body-md text-on-surface-variant"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
        >
          Mark trip past
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell onCancel={onCancel} title={title}>
      <p className="font-body-md text-on-surface-variant">{message}</p>
      <div className="flex items-center justify-end gap-md pt-md">
        <button
          type="button"
          onClick={onCancel}
          className="font-body-md text-on-surface-variant"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`px-md py-sm rounded-full font-body-md hover:opacity-90 ${
            destructive
              ? 'bg-error text-on-error'
              : 'bg-primary text-on-primary'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-margin">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-2xl bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-xl p-lg space-y-md"
      >
        <h2 className="font-headline-md text-headline-md text-on-surface">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${start} – ${end}`;
  }
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const startFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  const endFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${startFmt.format(startDate)} – ${endFmt.format(endDate)}`;
}
