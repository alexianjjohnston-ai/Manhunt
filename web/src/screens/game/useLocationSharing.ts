import { useEffect, useRef } from 'react';
import type { GameView } from '@shared/protocol';
import { useGame } from '@/lib/game';
import { useLocation, type DeviceFix } from '@/lib/location';
import { usePrefs } from '@/lib/prefs';
import { setWakeLock } from '@/lib/wakelock';

/**
 * Bridges the device location service and the server:
 * - watches GPS only while the server says this player should share (consented, game running);
 * - sends throttled updates, plus an immediate fresh fix when a ping is about to happen;
 * - reports permission / availability changes so missed pings carry an honest reason;
 * - stops instantly on stopSharing (capture, leave, end, emergency).
 */
export function useLocationSharing(view: GameView | null) {
  const share = !!view?.me.shareLocation;
  const send = useGame((s) => s.send);
  const lowBattery = usePrefs((s) => s.lowBattery);
  const keepAwake = usePrefs((s) => s.keepAwake);
  const loc = useLocation();
  const lastSent = useRef<{ at: number; fix: DeviceFix | null }>({ at: 0, fix: null });
  const lastStatus = useRef<string | null>(null);
  const sim = view?.game.simulationAllowed && loc.simulated;
  const conn = useGame((s) => s.status);

  // After (re)connecting, re-announce device status and send the next fix immediately.
  useEffect(() => {
    if (conn === 'online') {
      lastStatus.current = null;
      lastSent.current = { at: 0, fix: null };
    }
  }, [conn]);

  // Start / stop the GPS watch.
  useEffect(() => {
    if (share && !loc.paused) loc.start();
    else if (!share) loc.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, loc.paused, lowBattery]);

  useEffect(() => () => useLocation.getState().stop(), []);

  // Keep the screen on while playing.
  useEffect(() => {
    setWakeLock(keepAwake && view?.game.status === 'running' && view.me.status === 'active');
    return () => setWakeLock(false);
  }, [keepAwake, view?.game.status, view?.me.status]);

  // Report device status changes to the server.
  useEffect(() => {
    if (!view || view.game.status !== 'running') return;
    const state = loc.paused
      ? 'off'
      : loc.permission === 'denied'
        ? 'denied'
        : loc.permission === 'unsupported'
          ? 'unavailable'
          : loc.error && !loc.fix
            ? 'unavailable'
            : loc.fix
              ? 'ok'
              : null;
    if (state && state !== lastStatus.current && (share || state === 'off')) {
      lastStatus.current = state;
      send({ type: 'gpsStatus', state });
    }
  }, [view, loc.paused, loc.permission, loc.error, loc.fix, share, send, conn]);

  // Send fixes (throttled). `force` bypasses the throttle (fresh fix before a reveal).
  const sendFix = useRef((_f: DeviceFix, _force: boolean) => {});
  sendFix.current = (f, force) => {
    const now = Date.now();
    const minGap = lowBattery ? 15_000 : 5_000;
    const prev = lastSent.current;
    const moved = prev.fix ? Math.hypot(prev.fix.lat - f.lat, (prev.fix.lng - f.lng) * Math.cos((f.lat * Math.PI) / 180)) * 111_000 : Infinity;
    if (!force) {
      if (prev.fix?.timestamp === f.timestamp) return;
      if (now - prev.at < minGap && moved < 25) return;
    }
    lastSent.current = { at: now, fix: f };
    send({
      type: 'location',
      lat: f.lat,
      lng: f.lng,
      accuracyM: Math.min(f.accuracy, 100_000),
      ageMs: Math.max(0, Math.min(now - f.timestamp, 3_600_000)),
      speed: f.speed != null ? Math.min(f.speed, 200) : null,
      simulated: f.simulated || undefined,
    });
  };

  useEffect(() => {
    if (share && loc.fix && !loc.paused) sendFix.current(loc.fix, false);
  }, [loc.fix, share, loc.paused, sim, conn]);

  // Fresh fix right before a reveal; stop on server request.
  useEffect(() => {
    const onPing = async () => {
      const s = useLocation.getState();
      if (!share || s.paused) return;
      const f = (await s.requestFresh()) ?? s.fix;
      if (f) sendFix.current(f, true);
    };
    const onStop = () => useLocation.getState().stop();
    window.addEventListener('manhunt:pingRequest', onPing);
    window.addEventListener('manhunt:stopSharing', onStop);
    return () => {
      window.removeEventListener('manhunt:pingRequest', onPing);
      window.removeEventListener('manhunt:stopSharing', onStop);
    };
  }, [share]);
}
