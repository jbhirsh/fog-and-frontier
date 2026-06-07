import { authedFetch } from './authedFetch';

export type AllTrailsLookup = {
  allTrailsRating?: number;
  hikeDistanceMiles?: number;
  hikeElevationFeet?: number;
};

// Fetches rating + distance + elevation for a given AllTrails URL via the
// Gemini-backed server endpoint. The endpoint is owner-gated; pass a token
// from useAuthState().getToken().
export async function lookupAllTrails(
  url: string,
  token: string | null,
): Promise<AllTrailsLookup> {
  const res = await authedFetch(
    '/api/alltrails-lookup',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    },
    token,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  return (await res.json()) as AllTrailsLookup;
}
