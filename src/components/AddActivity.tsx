import { useEffect, useId, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  Activity,
  Category,
  CostTier,
  Difficulty,
  Duration,
  ParkType,
  PriceRange,
  Region,
} from '../data/types';
import { saveUserActivity } from '../lib/userActivities';
import { suggestUserActivity } from '../lib/suggestions';
import { checkDuplicates, unacknowledgedHigh, type DuplicateMatch } from '../lib/duplicates';
import { appCodeOf } from '../lib/gqlError';
import { COST_TIERS, costLabel } from '../lib/cost';
import { useOwner } from '../lib/useOwner';
import { fetchUsers } from '../lib/userTrips';
import { ContributorsField } from './ContributorsField';
import { DuplicateNotice } from './DuplicateNotice';
import { lookupAllTrails } from '../lib/alltrails';
import { REGION_LABELS, sentenceCase } from '../lib/activityLabels';
import {
  generateActivity,
  type GeneratedFields,
} from '../lib/generateActivity';

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
const REGIONS: Region[] = [
  'sf',
  'north-bay',
  'east-bay',
  'south-bay',
  'peninsula',
  'central-coast',
  'norcal',
  'socal',
  'oregon',
  'washington',
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
// non-empty triggers a lookup.
async function refreshTrailDetails(
  draft: Activity,
  previousUrl: string | undefined,
): Promise<Activity> {
  const next = (draft.allTrailsUrl ?? '').trim();
  const prev = (previousUrl ?? '').trim();
  if (next === prev) return draft;
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

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) ||
    `activity-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function AddActivity({
  onClose,
  editActivity,
  onSaved,
  onOpenActivity,
  suggest = false,
}: Props) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const mode: 'create' | 'edit' = editActivity ? 'edit' : 'create';
  const [step, setStep] = useState<'form' | 'generating' | 'review' | 'sent'>(
    editActivity ? 'review' : 'form',
  );
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Activity | null>(editActivity ?? null);
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
    setStep('generating');
    try {
      const g: GeneratedFields = await generateActivity(
        title.trim(),
        notes.trim(),
      );
      const activity: Activity = {
        id: slugify(g.name || title),
        name: g.name,
        shortDescription: g.shortDescription,
        longDescription: g.longDescription,
        category: g.category,
        region: g.region,
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
        notes: g.notes,
        // No match → no cover: CoverImage renders the category glyph. A stock
        // landscape stand-in reads as a wrong photo of the place (#36).
        coverImage: g.coverImage ?? '',
        coverCredit: g.coverCredit,
        // Whoever adds it is credited (#9), and can add the others who
        // suggested it in the review step.
        contributors: email && !suggest ? [email] : undefined,
      };
      setDraft(activity);
      setStep('review');
      void lookAlikes(activity);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate');
      setStep('form');
    }
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
      (next.name !== was.name ||
        next.location.coords.lat !== was.location.coords.lat ||
        next.location.coords.lng !== was.location.coords.lng)
    ) {
      clearTimeout(recheck.current);
      recheck.current = setTimeout(() => void lookAlikes(next), 400);
    }
  }
  function backToForm() {
    clearTimeout(recheck.current);
    checks.current += 1; // drop any answer still on its way
    setMatches([]);
    setStep('form');
  }

  async function save(acknowledged: readonly string[] = []) {
    if (!draft) return;
    setSaving(true);
    setError(null);
    let finalDraft = draft;
    try {
      if (!suggest) finalDraft = await refreshTrailDetails(draft, editActivity?.allTrailsUrl);
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
    <div className="fixed inset-0 z-[1000] flex items-end md:items-center justify-center p-0 md:p-md">
      <button
        type="button"
        aria-label="Cancel adding activity"
        onClick={onClose}
        className="absolute inset-0 bg-on-surface/60 backdrop-blur-sm cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'edit' ? 'Edit activity' : suggest ? 'Suggest activity' : 'Add activity'}
        className="relative bg-surface-container-lowest w-full max-w-2xl max-h-[95dvh] overflow-y-auto md:rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-md py-md border-b border-outline-variant/30 sticky top-0 bg-surface-container-lowest z-10">
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
            className="-mr-[14.5px] rounded-full w-11 h-11 flex items-center justify-center hover:bg-surface-variant transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-container"
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
            onSubmit={() => void generate()}
            onCancel={onClose}
            suggest={suggest}
          />
        )}

        {step === 'generating' && <GeneratingStep title={title} />}

        {step === 'review' && draft && (
          <ReviewStep
            draft={draft}
            error={error}
            saving={saving}
            mode={mode}
            suggest={suggest}
            users={users}
            onChange={changeDraft}
            onBack={mode === 'edit' ? onClose : backToForm}
            onSave={() => void save()}
            matches={matches}
            onOpenActivity={onOpenActivity}
            onSaveAnyway={() =>
              void save(unacknowledgedHigh(matches, []).map((m) => m.id))
            }
          />
        )}

        {step === 'sent' && <SentStep onDone={onClose} />}
      </div>
    </div>
  );
}

function SentStep({ onDone }: { onDone: () => void }) {
  // The review step's Send button is gone: keep focus in the dialog, on a
  // button that reads out what happened (a status rendered with its text
  // isn't reliably announced).
  const done = useRef<HTMLButtonElement>(null);
  const sentId = useId();
  useEffect(() => done.current?.focus(), []);
  return (
    <div className="px-md py-xl text-center space-y-md">
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
      <p id={`${sentId}-next`} className="font-body-md text-on-surface-variant max-w-[28rem] mx-auto">
        If they add it, it joins the catalog with you credited for it.
      </p>
      <button
        ref={done}
        type="button"
        onClick={onDone}
        aria-describedby={`${sentId} ${sentId}-next`}
        className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90"
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
  onCancel: () => void;
  suggest: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="px-md py-md space-y-md"
    >
      <p className="font-body-md text-on-surface-variant">
        {suggest
          ? "Give it a title and any notes or up to five links. Gemini will research the rest (up to five a day), and you'll review it before it goes to the owners."
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
          className="w-full bg-surface-container-low rounded-md px-sm py-sm border border-outline-variant focus:border-primary focus:outline-none"
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

      {error && <div className="text-error font-body-md">{error}</div>}

      <div className="flex justify-end gap-sm pt-sm">
        <button
          type="button"
          onClick={onCancel}
          className="px-md py-sm rounded-full text-on-surface-variant hover:bg-surface-variant transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 transition-opacity"
        >
          <span className="material-symbols-outlined text-icon-md">
            auto_awesome
          </span>
          Generate
        </button>
      </div>
    </form>
  );
}

function GeneratingStep({ title }: { title: string }) {
  return (
    <div className="px-md py-xl text-center space-y-md">
      <div className="w-12 h-12 mx-auto rounded-full border-4 border-primary border-t-transparent animate-spin" />
      <div className="font-body-lg text-on-surface">
        Researching <span className="font-bold">{title}</span>…
      </div>
      <p className="font-body-md text-on-surface-variant max-w-[28rem] mx-auto">
        Gemini is pulling together a description, location, duration, photo,
        and trail details. This usually takes a few seconds.
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
    <div className="px-md py-md space-y-md">
      {draft.coverImage && (
        <div className="rounded-lg overflow-hidden aspect-video bg-surface-variant">
          <img
            src={draft.coverImage}
            alt={draft.name}
            className="w-full h-full object-cover"
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

      <Field label="Short description">
        <input
          type="text"
          value={draft.shortDescription}
          onChange={(e) => patch('shortDescription', e.target.value)}
          className={inputCls}
        />
      </Field>

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
        <Field label="Category">
          <select
            value={draft.category}
            onChange={(e) => patch('category', e.target.value as Category)}
            className={selectCls}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {sentenceCase(c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Region">
          <select
            value={draft.region}
            onChange={(e) => patch('region', e.target.value as Region)}
            className={selectCls}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {REGION_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration">
          <select
            value={draft.duration}
            onChange={(e) => patch('duration', e.target.value as Duration)}
            className={selectCls}
          >
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
            onChange={(e) =>
              patch('durationDetail', e.target.value || undefined)
            }
            className={inputCls}
          />
        </Field>
        <Field label="Difficulty">
          <select
            value={draft.difficulty ?? ''}
            onChange={(e) =>
              patch(
                'difficulty',
                (e.target.value || undefined) as Difficulty | undefined,
              )
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
              patch(
                'parkType',
                (e.target.value || undefined) as ParkType | undefined,
              )
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
        {/* Rating, distance, and elevation are fetched from AllTrails on save
            when the URL changes — there are no manual inputs for them. A
            suggestion isn't saved, so there's no refresh to promise. */}
        {!suggest && (
          <p className="font-body-sm text-on-surface-variant">
            On save, rating, distance, and elevation will be refreshed from
            AllTrails when the URL changes.
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
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
                  patch(
                    'priceRange',
                    (e.target.value || undefined) as PriceRange | undefined,
                  )
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
                onChange={(e) =>
                  patch('reservationUrl', e.target.value || undefined)
                }
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

      {error && <div className="text-error font-body-md">{error}</div>}

      <div className="flex justify-between gap-sm pt-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          // A text button: pulled out by its padding so its label, not its
          // hover fill, starts at the content's edge. Its focus ring is drawn
          // inside, since outside it would be clipped by the scrolling panel.
          className="-ml-md px-md py-sm rounded-full text-on-surface-variant hover:bg-surface-variant transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-container"
        >
          {mode === 'edit' ? 'Cancel' : 'Back'}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          aria-busy={saving}
          className="grid bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 disabled:opacity-50"
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
              className="w-4 h-4 rounded-full border-2 border-on-primary border-t-transparent animate-spin"
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-body-sm text-on-surface-variant mb-xs">
        {label}
      </span>
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
  const valid =
    Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  const center: [number, number] = valid ? [lat, lng] : [37.2872, -121.95];

  return (
    <div className="space-y-xs">
      {/* `isolate` traps Leaflet's pane z-indices (tiles at 200, controls at
          1000) inside the map, so the dialog's sticky title (z-10) stays on
          top when the map scrolls under it. */}
      <div
        className="relative isolate rounded-md overflow-hidden border border-outline-variant"
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
              position={[lat, lng]}
              icon={pickerIcon}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const p = m.getLatLng();
                  onChange(p.lat, p.lng);
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

function ClickToPlace({
  onPlace,
}: {
  onPlace: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPlace(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}
