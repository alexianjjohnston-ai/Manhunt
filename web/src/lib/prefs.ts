import { create } from 'zustand';

export type MapStyleKey = 'dark' | 'daylight' | 'satellite';

export interface Prefs {
  sound: boolean;
  haptics: boolean;
  keepAwake: boolean;
  /** High-contrast light UI + light map for bright sunlight. */
  daylight: boolean;
  reducedMotion: boolean;
  largeText: boolean;
  /** Fewer, lower-accuracy GPS updates. */
  lowBattery: boolean;
  units: 'metric' | 'imperial';
  mapStyle: MapStyleKey;
  onboarded: boolean;
  lastName: string;
}

const KEY = 'manhunt:prefs:v1';

const defaults: Prefs = {
  sound: true,
  haptics: true,
  keepAwake: true,
  daylight: false,
  reducedMotion: false,
  largeText: false,
  lowBattery: false,
  units: 'metric',
  mapStyle: 'dark',
  onboarded: false,
  lastName: '',
};

function load(): Prefs {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return defaults;
  }
}

export const usePrefs = create<Prefs & { set: (p: Partial<Prefs>) => void }>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p);
    const { set: _s, ...rest } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch {
      /* ignore */
    }
    applyDocumentPrefs();
  },
}));

export function applyDocumentPrefs() {
  const p = usePrefs.getState();
  const root = document.documentElement;
  root.dataset.theme = p.daylight ? 'daylight' : 'dark';
  root.dataset.reducedMotion = String(p.reducedMotion);
  root.dataset.largeText = String(p.largeText);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.daylight ? '#eef1f4' : '#0b0e12');
}

export function prefersReducedMotion() {
  return usePrefs.getState().reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
