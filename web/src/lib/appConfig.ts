import { create } from 'zustand';
import { api, type ServerConfigView } from './api';

/** Server-provided runtime config (feature flags, optional Google Maps key), loaded once. */
export const useAppConfig = create<{ config: ServerConfigView | null; loaded: boolean }>(() => ({ config: null, loaded: false }));

let started = false;
export function loadAppConfig() {
  if (started) return;
  started = true;
  api
    .config()
    .then((config) => useAppConfig.setState({ config, loaded: true }))
    .catch(() => useAppConfig.setState({ config: null, loaded: true }));
}
