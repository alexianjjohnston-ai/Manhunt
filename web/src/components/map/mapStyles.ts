import type { StyleSpecification } from 'maplibre-gl';
import { tileSession, tileUrl } from '@/lib/google';
import type { MapStyleKey } from '@/lib/prefs';

/**
 * Basemap styles. Defaults use OpenFreeMap (free OpenStreetMap vector tiles, no API key).
 * Operators can point these at any MapLibre-compatible style via env vars.
 */
const DARK = import.meta.env.VITE_MAP_STYLE_DARK || 'https://tiles.openfreemap.org/styles/dark';
const LIGHT = import.meta.env.VITE_MAP_STYLE_LIGHT || 'https://tiles.openfreemap.org/styles/liberty';
const SATELLITE_TILES =
  import.meta.env.VITE_SATELLITE_TILES ||
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_ATTRIBUTION =
  import.meta.env.VITE_SATELLITE_ATTRIBUTION || 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export function styleFor(key: MapStyleKey): string | StyleSpecification {
  // The demo page cannot reach any tile server, so skip straight to the plain style.
  if (__DEMO__) return fallbackStyle(key);
  if (key === 'satellite') {
    return {
      version: 8,
      sources: {
        sat: { type: 'raster', tiles: [SATELLITE_TILES], tileSize: 256, maxzoom: 19, attribution: SATELLITE_ATTRIBUTION },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0b0e12' } },
        { id: 'sat', type: 'raster', source: 'sat' },
      ],
    };
  }
  return key === 'daylight' ? LIGHT : DARK;
}

export interface Basemap {
  style: string | StyleSpecification;
  provider: 'google' | 'osm' | 'none';
  session?: string;
}

/**
 * Pick the basemap: Google Maps tiles when the server has a Google Maps key (falling back
 * to OpenStreetMap if Google refuses), otherwise OpenStreetMap via OpenFreeMap.
 */
export async function resolveBasemap(key: MapStyleKey, googleKey: string | null): Promise<Basemap> {
  if (__DEMO__) return { style: fallbackStyle(key), provider: 'none' };
  if (googleKey) {
    try {
      const { session } = await tileSession(googleKey, key);
      return {
        provider: 'google',
        session,
        style: {
          version: 8,
          sources: {
            google: { type: 'raster', tiles: [tileUrl(googleKey, session)], tileSize: 256, maxzoom: key === 'satellite' ? 20 : 22, attribution: 'Google' },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': key === 'daylight' ? '#e5e3df' : '#11161c' } },
            { id: 'google', type: 'raster', source: 'google' },
          ],
        },
      };
    } catch (err) {
      console.warn('Google Maps tiles unavailable, using OpenStreetMap', err);
    }
  }
  return { style: styleFor(key), provider: 'osm' };
}

/** Used when the tile server is unreachable: a plain background so markers & boundary still work. */
export function fallbackStyle(key: MapStyleKey): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': key === 'daylight' ? '#dfe4ea' : '#11161c' } }],
  };
}
