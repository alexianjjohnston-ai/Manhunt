import type { StyleSpecification } from 'maplibre-gl';
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

/** Used when the tile server is unreachable: a plain background so markers & boundary still work. */
export function fallbackStyle(key: MapStyleKey): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': key === 'daylight' ? '#dfe4ea' : '#11161c' } }],
  };
}
