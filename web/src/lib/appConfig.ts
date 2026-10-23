import { create } from 'zustand';
import { api, type ServerConfigView } from './api';

/** How the map is being drawn: Google tiles, OpenStreetMap (no key), or OSM because Google refused. */
export type BasemapStatus = { provider: 'google' } | { provider: 'osm'; googleError: string | null };

/** Server-provided runtime config (feature flags, optional Google Maps key), loaded once. */
export const useAppConfig = create<{ config: ServerConfigView | null; loaded: boolean; basemap: BasemapStatus | null }>(() => ({
  config: null,
  loaded: false,
  basemap: null,
}));

let started = false;
export function loadAppConfig() {
  if (started) return;
  started = true;
  api
    .config()
    .then((config) => useAppConfig.setState({ config, loaded: true }))
    .catch(() => useAppConfig.setState({ config: null, loaded: true }));
}

/** True on servers started with testing features (fast pings / simulated GPS). */
export const isTestServer = (c: ServerConfigView | null) => !!c && (c.fastPingsAllowed || c.simulationAllowed);
