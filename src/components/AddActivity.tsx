import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  Activity,
  Category,
  CostTier,
  Difficulty,
  Duration,
  ParkType,
  PriceRange,
} from '../data/types';
import { saveUserActivity } from '../lib/userActivities';
import { suggestUserActivity } from '../lib/suggestions';
import { checkDuplicates, unacknowledgedHigh, type DuplicateMatch } from '../lib/duplicates';
import { appCodeOf } from '../lib/gqlError';
import { hasUsableCoords } from '../lib/nearbyActivities';
import { COST_TIERS, costLabel } from '../lib/cost';
import { useOwner } from '../lib/useOwner';
import { fetchUsers } from '../lib/userTrips';
import { ContributorsField } from './ContributorsField';
import { RegionPicker } from './RegionPicker';
import { PartOfSelect } from './PartOfSelect';
import { DuplicateNotice } from './DuplicateNotice';
import { lookupAllTrails } from '../lib/alltrails';
import { sentenceCase } from '../lib/activityLabels';
import { generateActivity, type GeneratedFields } from '../lib/generateActivity';
import { CARD_LINE_MAX, CARD_NAME_MAX, cardCopyProblem, needsCardName } from '../lib/cardCopy';
import { CardCopyField } from './CardCopyField';
import { TrailPicker, type TrailOption } from './TrailPicker';

interface Props {
  onClose: () => void;
  // When provided, the form opens in "edit mode": skips the title/notes
  // generate step, seeds the review form from this activity, and upserts
  // against the same id on save. See issue #49.
  editActivity?: Activity;
  // Called with the saved activity right before onClose so the parent can
  // refresh any cached copy (e.g. ActivityDetail's displayed activity).
  onSaved?: (activity: Activity) => void;
  // Opens a saved activity's detail; offered when a new one looks like it
  // (#17). Without it the warning just names the look-alike.
  onOpenActivity?: (id: string) => void;
  // A signed-in non-owner's suggestion (#73): drafted the same way (a capped
  // number a day), then sent for the owners to review instead of saved. No
  // AllTrails refresh (an owner-only call) and no crediting: whoever suggests
  // it is credited when it's accepted.
  suggest?: boolean;
  // A place picked from a shared Instagram post (#6): the form starts with
  // its title and notes, and drafts it straight away.
  seed?: { title: string; notes: string };
  // Where it was found (#6): a shared post's link, kept on the activity as
  // its sourceUrl, so the catalog links back to the reel it came from.
  source?: string;
}

const CATEGORIES: Category[] = [
  'hiking',
  'cycling',
  'water',
  'food',
  'culture',
  'scenic',
  'climbing',
  'camping',
  'other',
];
const DURATIONS: Duration[] = [
  '1-2 Hours',
  '2-3 Hours',
  'Half Day',
  'Full Day',
  'Weekend',
  'Multi-Day',
];
const DIFFICULTIES: Difficulty[] = ['easy', 'moderate', 'advanced'];
const PARK_TYPES: ParkType[] = [
  'national',
  'state',
  'regional',
  'county',
  'city',
  'private',
  'none',
];
const PRICE_RANGES: PriceRange[] = ['$', '$$', '$$$', '$$$$'];

// When the AllTrails URL changes (or is newly added), refresh rating /
// distance / elevation from the lookup endpoint. When it's cleared, drop
// the derived fields so we don't keep stale data. When it's unchanged,
// pass through untouched. `previousUrl` is the URL on the activity before
// the user opened the editor — undefined in create mode means anything
// non-empty triggers a lookup. `knownUrl` is a trail whose three numbers
// the draft's AllTrails search already gave (#6): while the URL is still
// that one and all three are there, the lookup, a paid call, is skipped.
async function refreshTrailDetails(
  draft: Activity,
  previousUrl: string | undefined,
  knownUrl?: string,
): Promise<Activity> {
  const next = (draft.allTrailsUrl ?? '').trim();
  const prev = (previousUrl ?? '').trim();
  if (next === prev) return draft;
  const known =
    next === knownUrl &&
    draft.allTrailsRating !== undefined &&
    draft.hikeDistanceMiles !== undefined &&
    draft.hikeElevationFeet !== undefined;
  if (known) return { ...draft, allTrailsUrl: next };
  if (!next) {
    return {
      ...draft,
      allTrailsUrl: undefined,
      allTrailsRating: undefined,
      hikeDistanceMiles: undefined,
      hikeElevationFeet: undefined,
    };
  }
  const fresh = await lookupAllTrails(next);
  return {
    ...draft,
    allTrailsUrl: next,
    allTrailsRating: fresh.allTrailsRating,
    hikeDistanceMiles: fresh.hikeDistanceMiles,
    hikeElevationFeet: fresh.hikeElevationFeet,
  };
}

// A draft with a trail's link and its own numbers, as far as the search
// had them: what it lacks is cleared, since the draft's were another
// trail's, or Gemini's guess.
function withTrailNumbers(draft: Activity, trail: TrailOption): Activity {
  return {
    ...draft,
    allTrailsUrl: trail.url,
    allTrailsRating: trail.rating,
    hikeDistanceMiles: trail.miles,
    hikeElevationFeet: trail.feet,
  };
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || `activity-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function AddActivity({
  onClose,
  editActivity,
  onSaved,
  onOpenActivity,
  suggest = false,
  seed,
  source,
}: Props) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const mode: 'create' | 'edit' = editActivity ? 'edit' : 'create';
  const [step, setStep] = useState<'form' | 'generating' | 'review' | 'sent'>(
    editActivity ? 'review' : seed?.title ? 'generating' : 'form',
  );
  const [title, setTitle] = useState(seed?.title ?? '');
  const [notes, setNotes] = useState(seed?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  // Today's AI drafts are used up (#260): the form leads to filling the
  // details in by hand instead of a dead end.
  const [draftsUsed, setDraftsUsed] = useState(false);
  const [draft, setDraft] = useState<Activity | null>(editActivity ?? null);
  // The trails the draft's AllTrails search found to choose from (#6), and
  // the one whose numbers the draft now holds from it, if any.
  const [trailOptions, setTrailOptions] = useState<TrailOption[]>([]);
  const [numbersFor, setNumbersFor] = useState<string>();
  // A suggestion held back for what it lacks: said until it lacks nothing,
  // following the fields as they're filled in.
  const [heldBack, setHeldBack] = useState(false);
  const lacking = heldBack && draft ? missingForSuggestion(draft) : [];
  const held = lacking.length > 0 ? `Add ${listOf(lacking)} before sending.` : null;
  const [saving, setSaving] = useState(false);
  const { email } = useOwner();
  // The accounts the review step can credit (#9). If they can't be loaded,
  // the picker just has no one to offer; the credited chips still show.
  const [users, setUsers] = useState<string[]>([]);
  useEffect(() => {
    if (step !== 'review' || suggest) return;
    let live = true;
    fetchUsers()
      .then((list) => {
        if (live) setUsers(list.map((u) => u.email));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [step, suggest]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Save and restore the previous overflow value so we don't unlock the
    // body when this is rendered on top of another modal (e.g. ActivityDetail
    // opens the editor — closing the editor should leave the underlying
    // detail modal's scroll lock intact).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    titleInputRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  async function generate() {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setError(null);
    setTrailOptions([]);
    setNumbersFor(undefined);
    setStep('generating');
    try {
      const g: GeneratedFields = await generateActivity(title.trim(), notes.trim());
      const activity: Activity = {
        id: slugify(g.name || title),
        name: g.name,
        shortDescription: g.shortDescription,
        longDescription: g.longDescription,
        cardLine: g.cardLine,
        cardName: g.cardName,
        category: g.category,
        region: g.region ?? UNCHOSEN,
        parkType: g.parkType,
        location: { city: g.city, coords: { lat: g.lat, lng: g.lng } },
        duration: g.duration,
        durationDetail: g.durationDetail,
        difficulty: g.difficulty,
        dogFriendly: g.dogFriendly,
        hikeDistanceMiles: g.hikeDistanceMiles,
        hikeElevationFeet: g.hikeElevationFeet,
        allTrailsUrl: g.allTrailsUrl,
        cuisine: g.cuisine,
        priceRange: g.priceRange,
        costTier: g.costTier,
        hours: g.hours,
        reservationUrl: g.reservationUrl,
        menuUrl: g.menuUrl,
        dietary: g.dietary,
        sourceUrl: source,
        notes: g.notes,
        // No match → no cover: CoverImage renders the category glyph. A stock
        // landscape stand-in reads as a wrong photo of the place (#36).
        coverImage: g.coverImage ?? '',
        coverCredit: g.coverCredit,
        // Whoever adds it is credited (#9), and can add the others who
        // suggested it in the review step.
        contributors: email && !suggest ? [email] : undefined,
        // The saved park Gemini placed it in (#269); the owners decide that,
        // so a suggestion doesn't carry one.
        parentId: suggest ? undefined : g.parentId,
      };
      // The picked trail's own numbers, where its page gave them, over the
      // ones Gemini wrote down; where it gave none, Gemini's stand.
      const picked = g.allTrailsOptions?.find((o) => o.url === g.allTrailsUrl);
      const numbered: Activity = {
        ...activity,
        allTrailsRating: picked?.rating ?? activity.allTrailsRating,
        hikeDistanceMiles: picked?.miles ?? activity.hikeDistanceMiles,
        hikeElevationFeet: picked?.feet ?? activity.hikeElevationFeet,
      };
      setDraft(numbered);
      setTrailOptions(g.allTrailsOptions ?? []);
      // Known only when its page gave all three; a gap Gemini filled is a guess.
      const complete =
        picked?.rating !== undefined && picked.miles !== undefined && picked.feet !== undefined;
      setNumbersFor(complete ? picked.url : undefined);
      setStep('review');
      void lookAlikes(numbered);
    } catch (e) {
      if (suggest && appCodeOf(e) === 'assist_limit') {
        setDraftsUsed(true);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to generate');
      }
      setStep('form');
    }
  }

  // A seeded place (#6) is drafted as the dialog opens, once: on the next
  // tick, which a remount in development cancels.
  const draftSeed = useEffectEvent(() => void generate());
  const seeded = Boolean(seed?.title);
  useEffect(() => {
    if (!seeded) return;
    const start = setTimeout(draftSeed, 0);
    return () => clearTimeout(start);
  }, [seeded]);

  // A suggestion filled in by hand (#260), from the title and notes so far:
  // no draft is spent, and nothing is guessed. Its menus start on "Choose"
  // (UNCHOSEN), and there's no pin until one is dropped (0, 0 reads as none),
  // so no look-alike check until then either.
  function fillByHand() {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setError(null);
    setMatches([]);
    setDraft({
      id: slugify(title),
      name: title.trim(),
      shortDescription: '',
      category: UNCHOSEN,
      region: UNCHOSEN,
      location: { city: '', coords: { lat: 0, lng: 0 } },
      duration: UNCHOSEN,
      coverImage: '',
      sourceUrl: source,
      notes: notes.trim() || undefined,
    });
    setStep('review');
  }

  // A new activity that looks like a saved one (#17): matched as the review
  // opens, again whenever its name or pin changes (the newest answer wins),
  // and again on save. A high match holds the save until the owner picks
  // "Save anyway" for the matches on screen; one they haven't seen holds it
  // again.
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const checks = useRef(0);
  const recheck = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(recheck.current), []);
  async function lookAlikes(activity: Activity): Promise<DuplicateMatch[]> {
    const mine = ++checks.current;
    let found: DuplicateMatch[] = [];
    try {
      found = await checkDuplicates(activity);
    } catch {
      // Unanswered: the server still refuses a high match on save.
    }
    if (mine === checks.current) setMatches(found);
    return found;
  }
  function changeDraft(next: Activity) {
    const was = draft;
    setDraft(next);
    if (
      mode === 'create' &&
      was &&
      (!suggest || hasUsableCoords(next)) &&
      (next.name !== was.name ||
        next.location.coords.lat !== was.location.coords.lat ||
        next.location.coords.lng !== was.location.coords.lng)
    ) {
      clearTimeout(recheck.current);
      recheck.current = setTimeout(() => void lookAlikes(next), 400);
    }
  }
  function backToForm() {
    // What the review step said was about the review step.
    setError(null);
    setTrailOptions([]);
    setNumbersFor(undefined);
    setHeldBack(false);
    clearTimeout(recheck.current);
    checks.current += 1; // drop any answer still on its way
    setMatches([]);
    setStep('form');
  }

  async function save(acknowledged: readonly string[] = []) {
    if (!draft) return;
    // A suggestion may be filled in by hand (#260), and the owners can't
    // edit it before accepting it: it needs what a card and a pin need.
    if (suggest && missingForSuggestion(draft).length > 0) {
      setError(null);
      setHeldBack(true);
      return;
    }
    // A draft can come without one, when Gemini names a region not on the
    // list (#274); the server would refuse it.
    if (!draft.region) {
      setError('Choose a region before saving.');
      return;
    }
    // Shown whole on a card (#295), so it has to fit; the server agrees.
    // Every new place gets a line; one saved before #295 gets its line from
    // the backfill, so an edit doesn't ask for one.
    const cardProblem =
      cardCopyProblem(draft) ??
      (mode === 'create' && !draft.cardLine?.trim() ? 'Add a card line before saving.' : null);
    if (cardProblem) {
      setError(cardProblem);
      return;
    }
    setSaving(true);
    setError(null);
    let finalDraft = draft;
    try {
      if (!suggest) {
        finalDraft = await refreshTrailDetails(draft, editActivity?.allTrailsUrl, numbersFor);
      }
      if (mode === 'create') {
        const found = await lookAlikes(finalDraft);
        if (unacknowledgedHigh(found, acknowledged).length > 0) {
          setError(
            acknowledged.length > 0
              ? `Another saved activity looks like this one too. Check it before ${suggest ? 'sending' : 'saving'}.`
              : `This looks like one already saved. Open it, or choose ${suggest ? 'Send' : 'Save'} anyway if it's a different place.`,
          );
          setSaving(false);
          return;
        }
        const allowDuplicate = found.some((m) => m.confidence === 'high');
        if (suggest) {
          await suggestUserActivity(finalDraft, { allowDuplicate });
          setSaving(false);
          setStep('sent');
          return;
        }
        // The id follows the name as it is now; the server takes the next
        // free one if that's taken, and says which it used.
        const id = await saveUserActivity(
          { ...finalDraft, id: slugify(finalDraft.name) },
          { create: true, allowDuplicate },
        );
        finalDraft = { ...finalDraft, id };
      } else {
        await saveUserActivity(finalDraft);
      }
      onSaved?.(finalDraft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : suggest ? 'Failed to send' : 'Failed to save');
      setSaving(false);
      // The server found a look-alike the check missed: show it.
      if (appCodeOf(e) === 'duplicate') void lookAlikes(finalDraft);
    }
  }

  return (
    <div className="fixed inset-0 z-1000 flex items-end justify-center p-0 md:items-center md:p-md">
      <button
        type="button"
        aria-label="Cancel adding activity"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-on-surface/60 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          mode === 'edit' ? 'Edit activity' : suggest ? 'Suggest activity' : 'Add activity'
        }
        className="relative max-h-[95dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface-container-lowest shadow-2xl md:rounded-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-outline-variant/30 bg-surface-container-lowest p-md">
          <h2 className="font-display text-headline-md text-primary">
            {mode === 'edit'
              ? 'Edit activity'
              : step === 'sent'
                ? 'Suggestion sent'
                : step === 'review'
                  ? suggest
                    ? 'Review & send'
                    : 'Review & save'
                  : suggest
                    ? 'Suggest activity'
                    : 'Add activity'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            // Pulled out by its 10px of padding and the glyph's 4.5px of
            // empty side, so the × lines up with the fields' right edge; its
            // focus ring is drawn inside, where the panel can't clip it.
            className="mr-[-14.5px] flex size-11 items-center justify-center rounded-full transition-colors hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-inset"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {step === 'form' && (
          <FormStep
            title={title}
            notes={notes}
            error={error}
            titleInputRef={titleInputRef}
            onChangeTitle={setTitle}
            onChangeNotes={setNotes}
            onSubmit={() => (draftsUsed ? fillByHand() : void generate())}
            onFillByHand={suggest ? fillByHand : undefined}
            draftsUsed={draftsUsed}
            onCancel={onClose}
            suggest={suggest}
          />
        )}

        {step === 'generating' && <GeneratingStep title={title} />}

        {step === 'review' && draft && (
          <ReviewStep
            draft={draft}
            error={error ?? held}
            saving={saving}
            mode={mode}
            suggest={suggest}
            users={users}
            trailOptions={trailOptions}
            onChooseTrail={(trail) => {
              changeDraft(withTrailNumbers(draft, trail));
              setNumbersFor(trail.url);
            }}
            onChange={changeDraft}
            onBack={mode === 'edit' ? onClose : backToForm}
            onSave={() => void save()}
            matches={matches}
            onOpenActivity={onOpenActivity}
            onSaveAnyway={() => void save(unacknowledgedHigh(matches, []).map((m) => m.id))}
          />
        )}

        {step === 'sent' && <SentStep onDone={onClose} />}
      </div>
    </div>
  );
}

/**
 * A menu a hand-filled suggestion leaves for the person to pick (#260): no
 * category, region or duration is a fair guess, and the owners can't change
 * one before accepting it. Shown as "Choose", and never sent.
 */
const UNCHOSEN = '' as never;

/** What a suggestion still lacks before it can go to the owners (#260). */
function missingForSuggestion(a: Activity): string[] {
  const missing: string[] = [];
  if (!a.name.trim()) missing.push('a name');
  if (!a.shortDescription.trim()) missing.push('a short description');
  if (!a.cardLine?.trim()) missing.push('a card line');
  if (!a.category) missing.push('a category');
  if (!a.region) missing.push('a region');
  if (!a.duration) missing.push('a duration');
  if (!a.location.city.trim()) missing.push('a city');
  if (!hasUsableCoords(a)) missing.push('a pin on the map');
  return missing;
}

/** "a, b and c". */
function listOf(items: readonly string[]): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function SentStep({ onDone }: { onDone: () => void }) {
  // The review step's Send button is gone: keep focus in the dialog, on a
  // button that reads out what happened (a status rendered with its text
  // isn't reliably announced).
  const done = useRef<HTMLButtonElement>(null);
  const sentId = useId();
  useEffect(() => done.current?.focus(), []);
  return (
    <div className="space-y-md px-md pt-xl pb-[calc(var(--spacing-xl)+env(safe-area-inset-bottom))] text-center">
      {/* The glyph leaves 4px empty on its left and 1.3px on its right, so a
          centred box draws it 1.3px right of centre; shifted back by half
          the difference, its ink is centred instead. */}
      <span
        className="material-symbols-outlined text-primary"
        style={{ fontSize: 48, transform: 'translateX(-0.028em)' }}
        aria-hidden="true"
      >
        mark_email_read
      </span>
      <p id={sentId} className="font-body-lg text-on-surface">
        Sent to the owners for review.
      </p>
      <p id={`${sentId}-next`} className="mx-auto max-w-112 font-body-md text-on-surface-variant">
        If they add it, it joins the catalog with you credited for it.
      </p>
      <button
        ref={done}
        type="button"
        onClick={onDone}
        aria-describedby={`${sentId} ${sentId}-next`}
        className="rounded-full bg-primary px-md py-sm font-body-md text-on-primary hover:opacity-90"
      >
        Done
      </button>
    </div>
  );
}

function FormStep({
  title,
  notes,
  error,
  titleInputRef,
  onChangeTitle,
  onChangeNotes,
  onSubmit,
  onFillByHand,
  draftsUsed,
  onCancel,
  suggest,
}: {
  title: string;
  notes: string;
  error: string | null;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  onChangeTitle: (v: string) => void;
  onChangeNotes: (v: string) => void;
  onSubmit: () => void;
  /** A suggestion's way to skip the draft and fill the details in (#260). */
  onFillByHand?: () => void;
  /** Today's drafts are used up: filling in by hand is the way on. */
  draftsUsed: boolean;
  onCancel: () => void;
  suggest: boolean;
}) {
  // Generate is gone once the drafts are used up; focus goes to what
  // replaced it, which reads out why.
  const byHand = useRef<HTMLButtonElement>(null);
  const usedId = useId();
  useEffect(() => {
    if (draftsUsed) byHand.current?.focus();
  }, [draftsUsed]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-md p-md pb-[calc(var(--spacing-md)+env(safe-area-inset-bottom))]"
    >
      <p className="font-body-md text-on-surface-variant">
        {suggest
          ? "Give it a title and any notes or up to five links. Gemini will research the rest (up to five a day), or you can fill it in yourself, and you'll review it before it goes to the owners."
          : "Give it a title and any notes or links you have. Gemini will research the rest — you'll get to review before saving."}
      </p>

      <Field label="Title">
        <input
          type="text"
          // A suggestion's draft is bounded on the server (#73).
          maxLength={suggest ? 200 : undefined}
          value={title}
          onChange={(e) => onChangeTitle(e.target.value)}
          ref={titleInputRef}
          placeholder="e.g. Año Nuevo elephant seal walk"
          className="w-full rounded-md border border-outline-variant bg-surface-container-low p-sm focus:border-primary focus:outline-none"
        />
      </Field>

      <Field label="Notes / links (optional)">
        <textarea
          value={notes}
          onChange={(e) => onChangeNotes(e.target.value)}
          maxLength={suggest ? 2000 : undefined}
          rows={5}
          placeholder="Anything specific you know about it — links, who recommended it, what you want to do there."
          className={inputCls}
        />
      </Field>

      {draftsUsed && (
        <p
          id={usedId}
          role="status"
          className="rounded-lg bg-surface-container-low p-sm font-body-md text-on-surface"
        >
          You&apos;ve used today&apos;s AI drafts. You can still fill in the details yourself.
        </p>
      )}

      {error && <div className="font-body-md text-error">{error}</div>}

      <div className="flex justify-end gap-sm pt-sm">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-md py-sm text-on-surface-variant transition-colors hover:bg-surface-variant"
        >
          Cancel
        </button>
        {draftsUsed ? (
          <button
            ref={byHand}
            type="submit"
            aria-describedby={usedId}
            className="rounded-full bg-primary px-md py-sm font-body-md text-on-primary transition-opacity hover:opacity-90"
          >
            Fill in by hand
          </button>
        ) : (
          <button
            type="submit"
            className="flex items-center gap-xs rounded-full bg-primary px-md py-sm font-body-md text-on-primary transition-opacity hover:opacity-90"
          >
            <span className="material-symbols-outlined text-icon-md">auto_awesome</span>
            Generate
          </button>
        )}
      </div>

      {/* Someone who already knows the place needn't spend a draft. */}
      {onFillByHand && !draftsUsed && (
        <p className="text-right font-body-sm text-on-surface-variant">
          Know the details already?{' '}
          <button
            type="button"
            onClick={onFillByHand}
            className="min-h-11 font-semibold text-primary underline"
          >
            Fill them in yourself
          </button>
        </p>
      )}
    </form>
  );
}

function GeneratingStep({ title }: { title: string }) {
  return (
    <div className="space-y-md px-md pt-xl pb-[calc(var(--spacing-xl)+env(safe-area-inset-bottom))] text-center">
      <div className="mx-auto size-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <div className="font-body-lg text-on-surface">
        Researching <span className="font-bold">{title}</span>…
      </div>
      <p className="mx-auto max-w-112 font-body-md text-on-surface-variant">
        Gemini is pulling together a description, location, duration, photo, and trail details. This
        usually takes a few seconds.
      </p>
    </div>
  );
}

function ReviewStep({
  draft,
  error,
  saving,
  mode,
  suggest,
  users,
  trailOptions,
  onChooseTrail,
  onChange,
  onBack,
  onSave,
  matches,
  onOpenActivity,
  onSaveAnyway,
}: {
  draft: Activity;
  error: string | null;
  saving: boolean;
  mode: 'create' | 'edit';
  suggest: boolean;
  users: readonly string[];
  trailOptions: readonly TrailOption[];
  onChooseTrail: (trail: TrailOption) => void;
  onChange: (a: Activity) => void;
  onBack: () => void;
  onSave: () => void;
  matches: readonly DuplicateMatch[];
  onOpenActivity?: (id: string) => void;
  onSaveAnyway: () => void;
}) {
  function patch<K extends keyof Activity>(key: K, value: Activity[K]) {
    onChange({ ...draft, [key]: value });
  }
  function patchLoc(field: 'city' | 'lat' | 'lng', value: string | number) {
    if (field === 'city') {
      onChange({
        ...draft,
        location: { ...draft.location, city: String(value) },
      });
    } else {
      onChange({
        ...draft,
        location: {
          ...draft.location,
          coords: { ...draft.location.coords, [field]: Number(value) },
        },
      });
    }
  }

  return (
    <div className="space-y-md p-md">
      {draft.coverImage && (
        <div className="aspect-video overflow-hidden rounded-lg bg-surface-variant">
          <img
            src={draft.coverImage}
            alt={draft.name}
            className="size-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      )}

      <Field label="Name">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => patch('name', e.target.value)}
          className={inputCls}
        />
      </Field>

      {/* Only a name too long for a card asks for a shorter one (#295), or
          one that already has it, so it can be cleared. */}
      {(needsCardName(draft.name) || draft.cardName) && (
        <CardCopyField
          label="Card name"
          hint="A shorter name for cards and the map, shown whole."
          value={draft.cardName ?? ''}
          max={CARD_NAME_MAX}
          onChange={(v) => patch('cardName', v || undefined)}
          className={inputCls}
        />
      )}

      <Field label="Short description">
        {/* Wrapped, and as tall as it is, so all of it can be read: one line
            hid most of a drafted one. Still one paragraph: a line break
            reads as a space. */}
        <textarea
          value={draft.shortDescription}
          onChange={(e) => patch('shortDescription', e.target.value.replace(/\s*\n\s*/g, ' '))}
          rows={2}
          className={`${inputCls} field-sizing-content resize-none`}
        />
      </Field>

      <CardCopyField
        label="Card line"
        hint="What a phone's card says under the name, shown whole."
        value={draft.cardLine ?? ''}
        max={CARD_LINE_MAX}
        onChange={(v) => patch('cardLine', v || undefined)}
        className={inputCls}
      />

      <Field label="Long description">
        <textarea
          value={draft.longDescription ?? ''}
          onChange={(e) => patch('longDescription', e.target.value)}
          rows={4}
          className={inputCls}
        />
      </Field>

      {/* The credit belongs to the looked-up image: a hand-pasted URL
          replaces it, so the now-wrong attribution goes with it. */}
      <Field label="Cover image URL">
        <input
          type="url"
          value={draft.coverImage}
          onChange={(e) =>
            onChange({ ...draft, coverImage: e.target.value, coverCredit: undefined })
          }
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <Field label="Category">
          <select
            value={draft.category}
            onChange={(e) => patch('category', e.target.value as Category)}
            className={selectCls}
          >
            {!draft.category && (
              <option value="" disabled>
                Choose
              </option>
            )}
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {sentenceCase(c)}
              </option>
            ))}
          </select>
        </Field>
        <RegionPicker
          label="Region"
          value={draft.region}
          onChange={(region) => patch('region', region)}
          className={inputCls}
        />
        <Field label="Duration">
          <select
            value={draft.duration}
            onChange={(e) => patch('duration', e.target.value as Duration)}
            className={selectCls}
          >
            {!draft.duration && (
              <option value="" disabled>
                Choose
              </option>
            )}
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration detail">
          <input
            type="text"
            value={draft.durationDetail ?? ''}
            placeholder="e.g. ~1.5h drive each way; quick summit walk"
            onChange={(e) => patch('durationDetail', e.target.value || undefined)}
            className={inputCls}
          />
        </Field>
        <Field label="Difficulty">
          <select
            value={draft.difficulty ?? ''}
            onChange={(e) =>
              patch('difficulty', (e.target.value || undefined) as Difficulty | undefined)
            }
            className={selectCls}
          >
            <option value="">—</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {sentenceCase(d)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Park type (optional)">
          <select
            value={draft.parkType ?? ''}
            onChange={(e) =>
              patch('parkType', (e.target.value || undefined) as ParkType | undefined)
            }
            className={selectCls}
          >
            {/* The empty option is the sole "not in a park" representation;
                exclude the literal 'none' so there aren't two ways to say it. */}
            <option value="">— Not in a park —</option>
            {PARK_TYPES.filter((p) => p !== 'none').map((p) => (
              <option key={p} value={p}>
                {sentenceCase(p)}
              </option>
            ))}
          </select>
        </Field>
        {/* Which park it's part of (#269): the owners decide, so suggestions don't ask. */}
        {!suggest && (
          <Field label="Part of (optional)">
            <PartOfSelect
              activity={draft}
              className={selectCls}
              onChange={(parentId) => patch('parentId', parentId)}
            />
          </Field>
        )}
        <Field label="City">
          <input
            type="text"
            value={draft.location.city}
            onChange={(e) => patchLoc('city', e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Dog friendly">
          <select
            value={draft.dogFriendly ? 'yes' : 'no'}
            onChange={(e) => patch('dogFriendly', e.target.value === 'yes')}
            className={selectCls}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        {/* What it costs one person (#85); "—" leaves it unknown. */}
        <Field label="Cost per person">
          <select
            value={draft.costTier ?? ''}
            onChange={(e) =>
              patch('costTier', (e.target.value || undefined) as CostTier | undefined)
            }
            className={selectCls}
          >
            <option value="">—</option>
            {COST_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {costLabel(tier)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-xs">
        <Field label="AllTrails URL">
          <input
            type="url"
            value={draft.allTrailsUrl ?? ''}
            placeholder="https://www.alltrails.com/trail/…"
            onChange={(e) => patch('allTrailsUrl', e.target.value || undefined)}
            className={inputCls}
          />
        </Field>
        <TrailPicker url={draft.allTrailsUrl} options={trailOptions} onChoose={onChooseTrail} />
        {/* Rating, distance, and elevation are fetched from AllTrails on save
            when the URL changes — there are no manual inputs for them. A
            suggestion isn't saved, so there's no refresh to promise. */}
        {!suggest && (
          <p className="font-body-sm text-on-surface-variant">
            On save, rating, distance, and elevation will be refreshed from AllTrails when the URL
            changes.
          </p>
        )}
      </div>

      {/* Restaurant fields — only relevant for food spots (#76). Kept out of
          the way for every other category. All optional. */}
      {draft.category === 'food' && (
        <div className="space-y-md rounded-lg border border-outline-variant/40 p-md">
          <div className="font-label-caps text-label-caps text-on-surface-variant">
            RESTAURANT DETAILS
          </div>
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <Field label="Cuisine">
              <input
                type="text"
                value={draft.cuisine ?? ''}
                placeholder="e.g. Coastal Californian"
                onChange={(e) => patch('cuisine', e.target.value || undefined)}
                className={inputCls}
              />
            </Field>
            <Field label="Price range">
              <select
                value={draft.priceRange ?? ''}
                onChange={(e) =>
                  patch('priceRange', (e.target.value || undefined) as PriceRange | undefined)
                }
                className={selectCls}
              >
                <option value="">—</option>
                {PRICE_RANGES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Hours">
              <input
                type="text"
                value={draft.hours ?? ''}
                placeholder="e.g. Thu–Mon 11am–8pm"
                onChange={(e) => patch('hours', e.target.value || undefined)}
                className={inputCls}
              />
            </Field>
            <Field label="Dietary options (comma-separated)">
              <input
                type="text"
                value={draft.dietary?.join(', ') ?? ''}
                placeholder="e.g. vegetarian, vegan, gluten-free"
                onChange={(e) => {
                  const list = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  patch('dietary', list.length ? list : undefined);
                }}
                className={inputCls}
              />
            </Field>
            <Field label="Reservation URL">
              <input
                type="url"
                value={draft.reservationUrl ?? ''}
                placeholder="https://resy.com/…"
                onChange={(e) => patch('reservationUrl', e.target.value || undefined)}
                className={inputCls}
              />
            </Field>
            <Field label="Menu / website URL">
              <input
                type="url"
                value={draft.menuUrl ?? ''}
                placeholder="https://…"
                onChange={(e) => patch('menuUrl', e.target.value || undefined)}
                className={inputCls}
              />
            </Field>
          </div>
        </div>
      )}

      <Field label="Pin location (drag or tap to reposition)">
        <LocationPicker
          lat={draft.location.coords.lat}
          lng={draft.location.coords.lng}
          onChange={(lat, lng) => {
            onChange({
              ...draft,
              location: {
                ...draft.location,
                coords: { lat, lng },
              },
            });
          }}
        />
      </Field>

      <Field label="Where you found it (optional)">
        <input
          type="url"
          value={draft.sourceUrl ?? ''}
          placeholder="https://www.instagram.com/reel/…"
          onChange={(e) => patch('sourceUrl', e.target.value.trim() || undefined)}
          className={inputCls}
        />
      </Field>

      {/* Completion notes are owned by the completion log (#5) — don't let
          edits overwrite them. The original value still round-trips because
          we patch a copy of the existing activity. */}
      {mode === 'create' && (
        <Field label="Notes">
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => patch('notes', e.target.value)}
            rows={2}
            className={inputCls}
          />
        </Field>
      )}

      {!suggest && (
        <ContributorsField
          value={draft.contributors ?? []}
          users={users}
          onChange={(next) => patch('contributors', next)}
        />
      )}

      <DuplicateNotice
        matches={matches}
        onOpenActivity={onOpenActivity}
        onSaveAnyway={onSaveAnyway}
        saving={saving}
        anywayLabel={suggest ? 'Send anyway' : 'Save anyway'}
      />

      {error && <div className="font-body-md text-error">{error}</div>}

      {/* Pinned to the bottom of the dialog, so Save is in reach from
          anywhere in a long draft, above the iPhone's home indicator. */}
      <div className="sticky bottom-0 z-10 -mx-md -mb-md flex justify-between gap-sm border-t border-outline-variant/30 bg-surface-container-lowest px-md pt-sm pb-[calc(var(--spacing-sm)+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          // A text button: pulled out by its padding so its label, not its
          // hover fill, starts at the content's edge. Its focus ring is drawn
          // inside, since outside it would be clipped by the scrolling panel.
          className="-ml-md rounded-full px-md py-sm text-on-surface-variant transition-colors hover:bg-surface-variant focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-inset disabled:opacity-50"
        >
          {mode === 'edit' ? 'Cancel' : 'Back'}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          aria-busy={saving}
          className="grid rounded-full bg-primary px-md py-sm font-body-md text-on-primary hover:opacity-90 disabled:opacity-50"
        >
          {/* Stack both labels in the same grid cell so the button reserves
              the wider label's width and the swap doesn't shift layout or
              cross-fade. Only the active label is visible. */}
          <span
            aria-hidden={saving}
            className={`col-start-1 row-start-1 flex items-center justify-center gap-xs ${
              saving ? 'invisible' : ''
            }`}
          >
            {suggest ? 'Send suggestion' : 'Save activity'}
          </span>
          <span
            aria-hidden={!saving}
            className={`col-start-1 row-start-1 flex items-center justify-center gap-xs ${
              saving ? '' : 'invisible'
            }`}
          >
            <span
              className="size-4 animate-spin rounded-full border-2 border-on-primary border-t-transparent"
              aria-hidden="true"
            />
            {suggest ? 'Sending' : 'Saving'}
          </span>
        </button>
      </div>
    </div>
  );
}

const inputCls =
  'w-full bg-surface-container-low rounded-md px-sm py-sm border border-outline-variant focus:border-primary focus:outline-none';

// A select drawn like the text inputs beside it. The native control indents
// its text ~3.5px further and stands 2px shorter, and its arrow ignores the
// padding; so it's drawn without one, with the filter pills' caret instead.
const selectCls = `${inputCls} appearance-none pr-10 select-caret`;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-xs block font-body-sm text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}

const pickerIcon = L.divIcon({
  html: `<div style="
    width: 28px; height: 28px;
    background: #0ea5e9;
    border: 2px solid white;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    box-shadow: 0 2px 6px rgba(0,0,0,0.35);
  "></div>`,
  className: '',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function LocationPicker({
  lat,
  lng,
  onChange,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}) {
  // The dragged marker, read on dragend (Leaflet types the event's target any).
  const marker = useRef<L.Marker>(null);
  const valid = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  const center: [number, number] = valid ? [lat, lng] : [37.2872, -121.95];

  return (
    <div className="space-y-xs">
      {/* `isolate` traps Leaflet's pane z-indices (tiles at 200, controls at
          1000) inside the map, so the dialog's sticky title (z-10) stays on
          top when the map scrolls under it. */}
      <div
        className="relative isolate overflow-hidden rounded-md border border-outline-variant"
        style={{ height: '280px' }}
      >
        <MapContainer
          center={center}
          zoom={valid ? 11 : 8}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <RecenterOnChange lat={lat} lng={lng} />
          <ClickToPlace onPlace={onChange} />
          {valid && (
            <Marker
              ref={marker}
              position={[lat, lng]}
              icon={pickerIcon}
              draggable
              eventHandlers={{
                dragend: () => {
                  const p = marker.current?.getLatLng();
                  if (p) onChange(p.lat, p.lng);
                },
              }}
            />
          )}
        </MapContainer>
      </div>
      <div className="font-body-sm text-on-surface-variant">
        {valid
          ? `${lat.toFixed(5)}, ${lng.toFixed(5)} — drag the pin or tap the map to adjust.`
          : 'Tap the map to drop a pin.'}
      </div>
    </div>
  );
}

function RecenterOnChange({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const lastRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat === 0 && lng === 0) return;
    const last = lastRef.current;
    if (last && Math.abs(last.lat - lat) < 1e-6 && Math.abs(last.lng - lng) < 1e-6) {
      return;
    }
    const c = map.getCenter();
    if (Math.abs(c.lat - lat) > 0.5 || Math.abs(c.lng - lng) > 0.5) {
      map.setView([lat, lng], Math.max(map.getZoom(), 11));
    }
    lastRef.current = { lat, lng };
  }, [lat, lng, map]);
  return null;
}

function ClickToPlace({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}
