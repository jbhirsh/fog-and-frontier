import { useId, useState } from 'react';
import { suggestTripActivities, type TripIdea } from '../lib/tripIdeas';

interface Props {
  /** Activities the trip already starts with; never suggested again. */
  seeded: readonly string[];
  /** The ideas picked so far, in order. */
  picked: readonly string[];
  onChange: (picked: string[]) => void;
  /** How many activities a new trip can start with in all (the server's cap). */
  max: number;
}

// AI trip ideas on the New Trip form (#78): describe what you're in the mood
// for, and Gemini picks matching activities from the catalog, each with a
// reason. Nothing is added until it's ticked; ticked ones join the trip's
// starting activities. Asking again keeps what's ticked and never suggests
// it, or anything the trip already has, a second time.
export function TripIdeas({ seeded, picked, onChange, max }: Props) {
  const promptId = useId();
  const [prompt, setPrompt] = useState('');
  const [ideas, setIdeas] = useState<TripIdea[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Set when asking again found nothing new beyond what's ticked.
  const [nothingNew, setNothingNew] = useState(false);
  const full = seeded.length + picked.length >= max;
  // Brought in at the cap already: nothing an idea could join, so no call.
  const startsFull = seeded.length >= max;

  async function suggest() {
    setLoading(true);
    setError(false);
    setNothingNew(false);
    try {
      // Ticks are locked while this runs, so `picked` is still current.
      const fresh = await suggestTripActivities(prompt.trim(), [...seeded, ...picked]);
      const kept = (ideas ?? []).filter((i) => picked.includes(i.activityId));
      setIdeas([...kept, ...fresh]);
      setNothingNew(kept.length > 0 && fresh.length === 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  }

  return (
    <fieldset className="space-y-sm rounded-xl border border-outline-variant/40 p-md">
      <legend className="px-xs font-body-md text-on-surface-variant">Trip ideas</legend>
      <label htmlFor={promptId} className="block font-body-sm text-on-surface-variant">
        What are you in the mood for?
      </label>
      <textarea
        id={promptId}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="e.g. a chill dog-friendly weekend near the coast, with a couple of good food stops"
        className="w-full rounded-md border border-outline-variant bg-surface-container-low px-sm py-sm"
      />
      <button
        type="button"
        onClick={() => void suggest()}
        disabled={!prompt.trim() || loading || startsFull}
        className="rounded-full border border-primary px-md py-sm font-body-md text-primary disabled:opacity-50"
      >
        {loading ? 'Finding ideas…' : 'Suggest activities'}
      </button>
      {startsFull && (
        <p className="font-body-sm text-on-surface-variant">
          This trip already starts with {max} activities, the most it can.
        </p>
      )}
      {error && (
        <p role="alert" className="font-body-sm text-error">
          Couldn&apos;t get ideas. Try again in a moment.
        </p>
      )}
      <div role="status" aria-live="polite" aria-busy={loading}>
        {ideas?.length === 0 && (
          <p className="font-body-sm text-on-surface-variant">No close matches. Try rephrasing.</p>
        )}
        {nothingNew && (
          <p className="font-body-sm text-on-surface-variant">
            No new ideas beyond the ones ticked. Try rephrasing.
          </p>
        )}
        {ideas && ideas.length > 0 && (
          <p className="sr-only">{ideas.length} ideas</p>
        )}
      </div>
      {ideas && (
        <ul className="space-y-xs" aria-busy={loading}>
          {ideas.map((idea) => {
            const checked = picked.includes(idea.activityId);
            return (
              <li
                key={idea.activityId}
                className="flex items-start gap-sm rounded-md p-xs hover:bg-surface-container-low"
              >
                <input
                  id={`${promptId}-${idea.activityId}`}
                  type="checkbox"
                  checked={checked}
                  disabled={loading || (!checked && full)}
                  aria-describedby={`${promptId}-${idea.activityId}-why`}
                  onChange={() => toggle(idea.activityId)}
                  className="mt-1"
                />
                <div>
                  <label htmlFor={`${promptId}-${idea.activityId}`}>
                    <span className="font-body-md text-on-surface">{idea.name}</span>{' '}
                    <span className="font-body-sm text-on-surface-variant">
                      {`· ${idea.city} · `}
                      <span className="capitalize">{idea.category}</span>
                    </span>
                  </label>
                  <p
                    id={`${promptId}-${idea.activityId}-why`}
                    className="font-body-sm text-on-surface-variant"
                  >
                    {idea.reason}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {full && (
        <p className="font-body-sm text-on-surface-variant">
          A new trip can start with {max} activities; untick one to pick another.
        </p>
      )}
    </fieldset>
  );
}
