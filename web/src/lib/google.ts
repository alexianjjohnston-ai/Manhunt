/**
 * Google Maps Platform integration (optional; enabled when the server is configured
 * with GOOGLE_MAPS_API_KEY):
 * - Map Tiles API: Google roadmap / satellite raster tiles rendered by MapLibre, so all
 *   game markers, the boundary and accuracy circles stay ours.
 * - Places API (New): search for a park, address or landmark when setting the play area.
 *
 * Attribution: Google's logo text and the data copyright for the visible area are shown
 * on the map (required by the Map Tiles API terms).
 */
import type { LatLng } from '@shared/types';

const TILE_HOST = 'https://tile.googleapis.com';
const PLACES_HOST = 'https://places.googleapis.com';

export type GoogleMapType = 'dark' | 'daylight' | 'satellite';

/** A muted dark roadmap so markers and HUD stay readable. */
const DARK_STYLES = [
  { stylers: [{ saturation: -80 }] },
  { elementType: 'geometry', stylers: [{ color: '#141a21' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9aa7b6' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0e12' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a333e' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3b4653' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c2233' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#132a1d' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'simplified' }] },
];

interface Session {
  session: string;
  expiry: number; // epoch seconds
}

const sessions = new Map<GoogleMapType, Promise<Session>>();

function sessionBody(type: GoogleMapType) {
  const language = navigator.language || 'en-US';
  const region = language.split('-')[1] ?? 'US';
  if (type === 'satellite') return { mapType: 'satellite', language, region, layerTypes: ['layerRoadmap'] };
  return {
    mapType: 'roadmap',
    language,
    region,
    scale: 'scaleFactor2x',
    highDpi: true,
    ...(type === 'dark' ? { styles: DARK_STYLES } : {}),
  };
}

const storageKey = (type: GoogleMapType) => `manhunt:gtiles:${type}:v1`;

/** Create (or reuse) a Map Tiles API session for a map type. Sessions last about two weeks. */
export function tileSession(key: string, type: GoogleMapType): Promise<Session> {
  const existing = sessions.get(type);
  if (existing) return existing;
  const p = (async () => {
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey(type)) ?? 'null') as (Session & { key: string }) | null;
      if (cached && cached.key === key && cached.expiry * 1000 > Date.now() + 3600_000) return cached;
    } catch {
      /* storage unavailable */
    }
    const res = await fetch(`${TILE_HOST}/v1/createSession?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionBody(type)),
    });
    if (!res.ok) throw new GoogleApiError('Map Tiles API', res.status, await explainGoogleError(res, 'Map Tiles API'));
    const body = (await res.json()) as { session: string; expiry: string | number };
    const s: Session = { session: body.session, expiry: Number(body.expiry) };
    try {
      localStorage.setItem(storageKey(type), JSON.stringify({ ...s, key }));
    } catch {
      /* ignore */
    }
    return s;
  })();
  sessions.set(type, p);
  p.catch(() => sessions.delete(type));
  return p;
}

/** A Google API refusal with a plain-language reason the host can act on. */
export class GoogleApiError extends Error {
  constructor(
    readonly api: string,
    readonly status: number,
    readonly reason: string,
  ) {
    super(`${api} failed (${status}): ${reason}`);
  }
}

/** Turn Google's error JSON into one sentence saying what to fix in Google Cloud. */
export async function explainGoogleError(res: Response, api: string): Promise<string> {
  let text = '';
  try {
    const body = (await res.json()) as { error?: { status?: string; message?: string; details?: unknown } };
    text = `${body.error?.status ?? ''} ${body.error?.message ?? ''} ${JSON.stringify(body.error?.details ?? [])}`;
  } catch {
    /* not JSON */
  }
  const has = (s: string) => text.includes(s);
  if (has('API_KEY_INVALID') || has('API key not valid')) return 'The key is not valid. Check it was copied completely.';
  if (has('REFERRER_BLOCKED') || has('referer')) return `The key does not allow this website (${location.origin}). Add it under Website restrictions.`;
  if (has('API_KEY_SERVICE_BLOCKED') || has('are blocked')) return `The key is not allowed to use the ${api}. Add it under API restrictions.`;
  if (has('SERVICE_DISABLED') || has('has not been used') || has('is disabled')) return `The ${api} is not enabled in your Google Cloud project.`;
  if (has('BILLING') || has('billing')) return 'The Google Cloud project needs a billing account.';
  if (res.status === 429 || has('RESOURCE_EXHAUSTED')) return 'Quota used up or too many requests. Try again later.';
  return `Google answered ${res.status}.`;
}

export interface GoogleCheck {
  tiles: string | null;
  places: string | null;
}

/** Live check of both APIs from this browser (so referrer restrictions are tested too). Null = working. */
export async function checkGoogle(key: string): Promise<GoogleCheck> {
  const run = async (api: string, fn: () => Promise<Response>) => {
    try {
      const res = await fn();
      return res.ok ? null : await explainGoogleError(res, api);
    } catch {
      return 'Could not reach Google from this device.';
    }
  };
  const [tiles, places] = await Promise.all([
    run('Map Tiles API', () =>
      fetch(`${TILE_HOST}/v1/createSession?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionBody('daylight')),
      }),
    ),
    run('Places API (New)', () =>
      fetch(`${PLACES_HOST}/v1/places:autocomplete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
        body: JSON.stringify({ input: 'park' }),
      }),
    ),
  ]);
  return { tiles, places };
}

export function tileUrl(key: string, session: string) {
  return `${TILE_HOST}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`;
}

/** Copyright text for the visible area (Map Tiles API viewport endpoint). */
export async function viewportCopyright(
  key: string,
  session: string,
  zoom: number,
  b: { north: number; south: number; east: number; west: number },
): Promise<string | null> {
  const q = new URLSearchParams({
    session,
    key,
    zoom: String(Math.max(0, Math.min(22, Math.round(zoom)))),
    north: b.north.toFixed(5),
    south: b.south.toFixed(5),
    east: b.east.toFixed(5),
    west: b.west.toFixed(5),
  });
  try {
    const res = await fetch(`${TILE_HOST}/tile/v1/viewport?${q}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { copyright?: string };
    return body.copyright ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Places search
// ---------------------------------------------------------------------------

export interface PlaceSuggestion {
  placeId: string;
  main: string;
  secondary: string;
}

/** A Places session token groups an autocomplete sequence and its details lookup. */
export function newPlacesSession() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function autocomplete(key: string, input: string, near: LatLng | null, sessionToken: string): Promise<PlaceSuggestion[]> {
  const body: Record<string, unknown> = { input, sessionToken };
  if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 30_000 } };
  const res = await fetch(`${PLACES_HOST}/v1/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const json = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId: string; text?: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[];
  };
  return (json.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .map((p) => ({
      placeId: p.placeId,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }));
}

export interface PlaceDetails {
  name: string;
  location: LatLng;
  /** Approximate radius (m) that covers the place, from its viewport. */
  sizeM: number | null;
}

export async function placeDetails(key: string, placeId: string, sessionToken: string): Promise<PlaceDetails> {
  const res = await fetch(`${PLACES_HOST}/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'displayName,location,viewport' },
  });
  if (!res.ok) throw new Error(`Place lookup failed (${res.status})`);
  const p = (await res.json()) as {
    displayName?: { text: string };
    location: { latitude: number; longitude: number };
    viewport?: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } };
  };
  let sizeM: number | null = null;
  if (p.viewport) {
    const dLat = (p.viewport.high.latitude - p.viewport.low.latitude) * 111_320;
    const dLng = (p.viewport.high.longitude - p.viewport.low.longitude) * 111_320 * Math.cos((p.location.latitude * Math.PI) / 180);
    sizeM = Math.round(Math.min(Math.abs(dLat), Math.abs(dLng)) / 2);
  }
  return { name: p.displayName?.text ?? '', location: { lat: p.location.latitude, lng: p.location.longitude }, sizeM };
}
