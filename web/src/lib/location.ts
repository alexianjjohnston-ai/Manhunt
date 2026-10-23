import { create } from 'zustand';
import { destination } from '@shared/geo';
import type { LatLng } from '@shared/types';
import { usePrefs } from './prefs';

/**
 * Device location service.
 *
 * Honest constraints (see README "Mobile browser limitations"):
 * - Browsers only deliver GPS while the page is open and (generally) visible.
 *   iOS Safari stops entirely when the screen locks or the tab is backgrounded.
 * - We therefore never pretend: every fix carries its real timestamp + accuracy,
 *   and the UI shows how old the last fix is.
 */

export interface DeviceFix {
  lat: number;
  lng: number;
  accuracy: number;
  /** Device epoch ms when measured. */
  timestamp: number;
  speed: number | null;
  heading: number | null;
  simulated: boolean;
}

export type Permission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

interface LocState {
  permission: Permission;
  watching: boolean;
  /** User chose to stop sharing. */
  paused: boolean;
  fix: DeviceFix | null;
  error: string | null;
  simulated: boolean;
  start(): void;
  stop(): void;
  requestFresh(): Promise<DeviceFix | null>;
  setPaused(p: boolean): void;
  startSimulation(center: LatLng, speedMps: number): void;
  stopSimulation(): void;
  /** One-off permission prompt (onboarding). */
  requestPermission(): Promise<boolean>;
}

let watchId: number | null = null;
let refreshTimer: number | null = null;
let simTimer: number | null = null;
let simState: { pos: LatLng; bearing: number; speed: number; center: LatLng } | null = null;
const SIM_STEP_MS = 1500;

const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

/**
 * Convert a browser position. Some devices report bogus timestamps (hours off, or a
 * fixed value). The Geolocation spec guarantees a returned position is no older than
 * the requested maximumAge, so clamp the age to that bound and never into the future.
 */
function toFix(p: GeolocationPosition, maximumAge: number): DeviceFix {
  const now = Date.now();
  const ts = Math.min(Math.max(p.timestamp || now, now - maximumAge), now);
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy,
    timestamp: ts,
    speed: p.coords.speed != null && Number.isFinite(p.coords.speed) ? p.coords.speed : null,
    heading: p.coords.heading != null && Number.isFinite(p.coords.heading) ? p.coords.heading : null,
    simulated: false,
  };
}

function describeError(e: GeolocationPositionError): string {
  switch (e.code) {
    case e.PERMISSION_DENIED:
      return 'Location permission denied';
    case e.POSITION_UNAVAILABLE:
      return 'GPS signal unavailable';
    case e.TIMEOUT:
      return 'GPS is taking too long';
    default:
      return 'Location error';
  }
}

export const useLocation = create<LocState>((set, get) => {
  const onFix = (p: GeolocationPosition, maximumAge: number) => {
    if (get().simulated) return;
    set({ fix: toFix(p, maximumAge), error: null, permission: 'granted' });
  };
  const onError = (e: GeolocationPositionError) => {
    set({
      error: describeError(e),
      permission: e.code === e.PERMISSION_DENIED ? 'denied' : get().permission,
    });
  };

  /** (Re)create the position watch. */
  const openWatch = () => {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    const low = usePrefs.getState().lowBattery;
    const maximumAge = low ? 30_000 : 5_000;
    watchId = navigator.geolocation.watchPosition((p) => onFix(p, maximumAge), onError, {
      enableHighAccuracy: !low,
      maximumAge,
      timeout: 30_000,
    });
  };

  if (supported && navigator.permissions?.query) {
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        const apply = () => set({ permission: status.state as Permission });
        apply();
        status.addEventListener?.('change', apply);
      })
      .catch(() => {});
  }

  return {
    permission: supported ? 'unknown' : 'unsupported',
    watching: false,
    paused: false,
    fix: null,
    error: supported ? null : 'This browser does not support location',
    simulated: false,

    start() {
      if (get().simulated) {
        set({ watching: true });
        return;
      }
      if (!supported || watchId != null || get().paused) return;
      openWatch();
      // Phones (and some browsers) stop firing watchPosition while stationary, and
      // getCurrentPosition can stall while a watch is active. If no fix arrives for a
      // while, restart the watch: a new watch reports immediately.
      const low = usePrefs.getState().lowBattery;
      refreshTimer = window.setInterval(() => {
        const f = get().fix;
        if (!f || Date.now() - f.timestamp > (low ? 45_000 : 15_000)) openWatch();
      }, low ? 30_000 : 10_000);
      set({ watching: true });
    },

    stop() {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (refreshTimer != null) window.clearInterval(refreshTimer);
      watchId = null;
      refreshTimer = null;
      set({ watching: false });
    },

    requestFresh() {
      if (get().simulated) return Promise.resolve(get().fix);
      if (!supported || get().paused) return Promise.resolve(null);
      if (watchId != null) {
        // Restart the watch and wait for the next fix.
        const before = get().fix?.timestamp ?? 0;
        return new Promise((resolve) => {
          const timer = window.setTimeout(() => {
            unsub();
            resolve(get().fix);
          }, 15_000);
          const unsub = useLocation.subscribe((st) => {
            if (st.fix && st.fix.timestamp !== before) {
              window.clearTimeout(timer);
              unsub();
              resolve(st.fix);
            }
          });
          openWatch();
        });
      }
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            onFix(p, 0);
            resolve(get().fix);
          },
          (e) => {
            onError(e);
            resolve(null);
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
        );
      });
    },

    setPaused(p) {
      set({ paused: p });
      if (p) {
        get().stop();
        set({ fix: null });
      }
    },

    requestPermission() {
      if (!supported) return Promise.resolve(false);
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => {
            onFix(p, 10_000);
            set({ permission: 'granted' });
            resolve(true);
          },
          (e) => {
            onError(e);
            resolve(e.code !== e.PERMISSION_DENIED);
          },
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
        );
      });
    },

    /** DEV/TEST ONLY: random-walk around a point. Flagged as simulated end-to-end. */
    startSimulation(center, speedMps) {
      get().stop();
      simState = { pos: destination(center, Math.random() * 360, Math.random() * 300), bearing: Math.random() * 360, speed: speedMps, center };
      const step = () => {
        if (!simState) return;
        const dt = SIM_STEP_MS / 1000;
        simState.bearing += (Math.random() - 0.5) * 60;
        // Drift back toward centre if wandering too far.
        const back = Math.hypot(simState.pos.lat - simState.center.lat, simState.pos.lng - simState.center.lng) > 0.008;
        if (back) {
          const dy = simState.center.lat - simState.pos.lat;
          const dx = simState.center.lng - simState.pos.lng;
          simState.bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
        }
        simState.pos = destination(simState.pos, simState.bearing, simState.speed * dt);
        publish();
      };
      const publish = () => {
        if (!simState) return;
        set({
          fix: {
            lat: simState.pos.lat,
            lng: simState.pos.lng,
            accuracy: 6 + Math.random() * 8,
            timestamp: Date.now(),
            speed: simState.speed,
            heading: ((simState.bearing % 360) + 360) % 360,
            simulated: true,
          },
          error: null,
        });
      };
      step();
      simTimer = window.setInterval(step, SIM_STEP_MS);
      set({ simulated: true, watching: true, permission: 'granted' });
    },

    stopSimulation() {
      if (simTimer) window.clearInterval(simTimer);
      simTimer = null;
      simState = null;
      set({ simulated: false, fix: null, watching: false });
    },
  };
});

// When returning to the foreground, immediately grab a fresh fix (watchers may have stalled).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const s = useLocation.getState();
    if (document.visibilityState === 'visible' && s.watching && !s.paused) void s.requestFresh();
  });
}
