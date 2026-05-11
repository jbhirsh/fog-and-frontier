import { useEffect, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  Activity,
  Category,
  Difficulty,
  Duration,
  Region,
} from '../data/types';
import { saveUserActivity } from '../lib/userActivities';
import { authedFetch } from '../lib/authedFetch';
import { useAuthState } from '../lib/authShim';

interface Props {
  onClose: () => void;
}

type GeneratedFields = {
  name: string;
  shortDescription: string;
  longDescription?: string;
  category: Category;
  region: Region;
  city: string;
  lat: number;
  lng: number;
  duration: Duration;
  durationDetail?: string;
  difficulty?: Difficulty;
  dogFriendly?: boolean;
  hikeDistanceMiles?: number;
  hikeElevationFeet?: number;
  allTrailsUrl?: string;
  notes?: string;
  coverImage?: string;
};

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=80';

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

export function AddActivity({ onClose }: Props) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { getToken } = useAuthState();
  const [step, setStep] = useState<'form' | 'generating' | 'review'>('form');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Activity | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    titleInputRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
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
      const token = await getToken();
      const res = await authedFetch(
        '/api/generate-activity',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), notes: notes.trim() }),
        },
        token,
      );
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }
      const g = (await res.json()) as GeneratedFields;
      const activity: Activity = {
        id: slugify(g.name || title),
        name: g.name,
        shortDescription: g.shortDescription,
        longDescription: g.longDescription,
        category: g.category,
        region: g.region,
        location: { city: g.city, coords: { lat: g.lat, lng: g.lng } },
        duration: g.duration,
        durationDetail: g.durationDetail,
        difficulty: g.difficulty,
        dogFriendly: g.dogFriendly,
        hikeDistanceMiles: g.hikeDistanceMiles,
        hikeElevationFeet: g.hikeElevationFeet,
        allTrailsUrl: g.allTrailsUrl,
        notes: g.notes,
        coverImage: g.coverImage || PLACEHOLDER_IMAGE,
      };
      setDraft(activity);
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate');
      setStep('form');
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const token = await getToken();
      await saveUserActivity(draft, token);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
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
        aria-label="Add activity"
        className="relative bg-surface-container-lowest w-full max-w-2xl max-h-[95vh] overflow-y-auto md:rounded-xl shadow-2xl"
      >
        <div className="flex items-center justify-between px-md py-md border-b border-outline-variant/30 sticky top-0 bg-surface-container-lowest z-10">
          <h2 className="font-display text-headline-md text-primary">
            {step === 'review' ? 'Review & save' : 'Add activity'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full w-9 h-9 flex items-center justify-center hover:bg-surface-variant transition-colors"
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
          />
        )}

        {step === 'generating' && <GeneratingStep title={title} />}

        {step === 'review' && draft && (
          <ReviewStep
            draft={draft}
            error={error}
            saving={saving}
            onChange={setDraft}
            onBack={() => setStep('form')}
            onSave={() => void save()}
          />
        )}
      </div>
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
}: {
  title: string;
  notes: string;
  error: string | null;
  titleInputRef: React.RefObject<HTMLInputElement | null>;
  onChangeTitle: (v: string) => void;
  onChangeNotes: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
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
        Give it a title and any notes or links you have. Gemini will research
        the rest — you'll get to review before saving.
      </p>

      <Field label="Title">
        <input
          type="text"
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
          rows={5}
          placeholder="Anything specific you know about it — links, who recommended it, what you want to do there."
          className="w-full bg-surface-container-low rounded-md px-sm py-sm border border-outline-variant focus:border-primary focus:outline-none font-mono text-body-sm"
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
          <span className="material-symbols-outlined text-body-md">
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
      <p className="font-body-md text-on-surface-variant max-w-md mx-auto">
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
  onChange,
  onBack,
  onSave,
}: {
  draft: Activity;
  error: string | null;
  saving: boolean;
  onChange: (a: Activity) => void;
  onBack: () => void;
  onSave: () => void;
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

      <Field label="Cover image URL">
        <input
          type="url"
          value={draft.coverImage}
          onChange={(e) => patch('coverImage', e.target.value)}
          className={inputCls}
        />
      </Field>

      <div className="grid grid-cols-2 gap-md">
        <Field label="Category">
          <select
            value={draft.category}
            onChange={(e) => patch('category', e.target.value as Category)}
            className={inputCls}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Region">
          <select
            value={draft.region}
            onChange={(e) => patch('region', e.target.value as Region)}
            className={inputCls}
          >
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Duration">
          <select
            value={draft.duration}
            onChange={(e) => patch('duration', e.target.value as Duration)}
            className={inputCls}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
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
            className={inputCls}
          >
            <option value="">—</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
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
            className={inputCls}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
      </div>

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

      <Field label="Notes">
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => patch('notes', e.target.value)}
          rows={2}
          className={inputCls}
        />
      </Field>

      {error && <div className="text-error font-body-md">{error}</div>}

      <div className="flex justify-between gap-sm pt-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="px-md py-sm rounded-full text-on-surface-variant hover:bg-surface-variant transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-xs bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save activity'}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  'w-full bg-surface-container-low rounded-md px-sm py-sm border border-outline-variant focus:border-primary focus:outline-none';

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
      <div
        className="rounded-md overflow-hidden border border-outline-variant"
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
