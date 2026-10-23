import { create } from 'zustand';
import type { ClientMessage, GameView, ServerMessage } from '@shared/protocol';
import type { GameEvent } from '@shared/types';
import { cue, type Cue } from './feedback';
import { sessions } from './sessions';

export type ConnStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'fatal';

export type ToastKind = 'info' | 'ping' | 'capture' | 'warn' | 'error' | 'success' | 'announce' | 'emergency';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  at: number;
}

interface GameStore {
  gameId: string | null;
  status: ConnStatus;
  fatal: { code: string; message: string } | null;
  view: GameView | null;
  /** serverTime ≈ Date.now() + offset */
  offset: number;
  rtt: number | null;
  toasts: Toast[];
  /** Server time at which the next reveal will happen, when the server asked for a fresh fix. */
  pingRequestAt: number | null;
  /** Incremented whenever hunters receive a fresh reveal (drives radar animation). */
  revealPulse: number;
  /** When true, toasts and sounds are muted (hunter driving mode). */
  quiet: boolean;
  connect(gameId: string): void;
  disconnect(): void;
  send(msg: ClientMessage): boolean;
  toast(t: Omit<Toast, 'id' | 'at'>): void;
  dismiss(id: number): void;
  setQuiet(q: boolean): void;
  reconnectNow(): void;
}

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: number | null = null;
let pingTimer: number | null = null;
let toastSeq = 0;
let rttSamples: { rtt: number; offset: number }[] = [];
let pendingLocation: ClientMessage | null = null;
let lastRevealCount = 0;

const FATAL = new Set(['kicked', 'left', 'unauthorized', 'not_found']);

export const useGame = create<GameStore>((set, get) => {
  function wsUrl() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  function clearTimers() {
    if (retryTimer) window.clearTimeout(retryTimer);
    if (pingTimer) window.clearInterval(pingTimer);
    retryTimer = pingTimer = null;
  }

  function scheduleReconnect() {
    if (get().status === 'fatal' || !get().gameId) return;
    set({ status: 'reconnecting' });
    const delay = Math.min(10_000, 500 * 2 ** retry) * (0.75 + Math.random() * 0.5);
    retry++;
    retryTimer = window.setTimeout(open, delay);
  }

  function sendPing() {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
  }

  function open() {
    const gameId = get().gameId;
    if (!gameId) return;
    const s = sessions.get(gameId);
    if (!s) {
      set({ status: 'fatal', fatal: { code: 'no_session', message: 'You have not joined this game on this device.' } });
      return;
    }
    clearTimers();
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    set({ status: get().view ? 'reconnecting' : 'connecting' });
    const sock = new WebSocket(wsUrl());
    ws = sock;
    sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', gameId, token: s.token }));
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data as string) as ServerMessage;
      } catch {
        return;
      }
      handle(msg);
    };
    sock.onclose = (e) => {
      if (ws !== sock) return;
      ws = null;
      if (pingTimer) window.clearInterval(pingTimer);
      if (e.code === 4000 || e.code === 4003) {
        if (get().status !== 'fatal') set({ status: 'fatal', fatal: get().fatal ?? { code: 'closed', message: 'Disconnected from game' } });
        return;
      }
      scheduleReconnect();
    };
    sock.onerror = () => {
      /* onclose follows */
    };
  }

  function handle(msg: ServerMessage) {
    switch (msg.type) {
      case 'welcome':
        retry = 0;
        rttSamples = [];
        set({ status: 'online', fatal: null, offset: msg.serverNow - Date.now() });
        sendPing();
        pingTimer = window.setInterval(sendPing, 10_000);
        if (pendingLocation) {
          ws?.send(JSON.stringify(pendingLocation));
          pendingLocation = null;
        }
        sessions.touch(msg.gameId);
        break;
      case 'pong': {
        const now = Date.now();
        const rtt = now - msg.t;
        rttSamples.push({ rtt, offset: msg.serverNow - (msg.t + rtt / 2) });
        rttSamples = rttSamples.slice(-6);
        const best = rttSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        set({ offset: best.offset, rtt });
        break;
      }
      case 'state': {
        const prev = get().view;
        const v = msg.view;
        // Detect a new reveal for the radar animation.
        const seq = v.runnerMarkers.reduce((m, r) => Math.max(m, r.seq), 0);
        const prevSeq = prev?.runnerMarkers.reduce((m, r) => Math.max(m, r.seq), 0) ?? 0;
        const pulse = prev && seq > prevSeq ? get().revealPulse + 1 : get().revealPulse;
        if (v.game.pingCount !== lastRevealCount) {
          lastRevealCount = v.game.pingCount;
          set({ pingRequestAt: null });
        }
        set({ view: v, revealPulse: pulse });
        if (v.game.status === 'ended' && prev?.game.status !== 'ended') cue('success', { silent: get().quiet });
        if (v.game.status === 'running' && prev?.game.status === 'lobby') cue('start', { silent: get().quiet });
        sessions.touch(v.game.id, { gameName: v.game.name, code: v.game.code });
        break;
      }
      case 'event':
        onEvent(msg.event);
        break;
      case 'pingRequest':
        set({ pingRequestAt: msg.revealAt });
        window.dispatchEvent(new CustomEvent('manhunt:pingRequest'));
        break;
      case 'stopSharing':
        window.dispatchEvent(new CustomEvent('manhunt:stopSharing', { detail: msg.reason }));
        break;
      case 'kicked':
        set({ status: 'fatal', fatal: { code: 'kicked', message: msg.reason } });
        window.dispatchEvent(new CustomEvent('manhunt:stopSharing', { detail: msg.reason }));
        break;
      case 'error':
        if (FATAL.has(msg.code) && get().status !== 'online') {
          set({ status: 'fatal', fatal: { code: msg.code, message: msg.message } });
          return;
        }
        if (msg.code === 'rate_limited' && msg.ref === 'location') return;
        get().toast({ kind: 'error', title: msg.message });
        break;
    }
  }

  function onEvent(e: GameEvent) {
    const map: Partial<Record<GameEvent['type'], [ToastKind, Cue | null]>> = {
      ping_revealed: ['ping', 'ping'],
      radar_sweep: ['ping', 'alert'],
      final_phase: ['warn', 'alert'],
      cloak_used: ['info', null],
      ping_incoming: ['info', 'incoming'],
      runner_captured: ['capture', 'capture'],
      capture_requested: ['capture', 'incoming'],
      capture_disputed: ['warn', 'alert'],
      capture_rejected: ['warn', null],
      emergency_stop: ['emergency', 'alert'],
      game_paused: ['warn', null],
      game_resumed: ['success', 'success'],
      headstart_ended: ['warn', 'alert'],
      game_started: ['success', null],
      announcement: ['announce', 'incoming'],
      warning: ['warn', null],
      player_joined: ['info', null],
      player_left: ['info', null],
      player_kicked: ['info', null],
      player_disconnected: ['info', null],
      player_reconnected: ['info', null],
      host_changed: ['info', null],
      settings_changed: ['info', null],
      runner_released: ['info', null],
      game_ended: ['success', null],
    };
    const [kind, sound] = map[e.type] ?? ['info', null];
    const quiet = get().quiet;
    // Driving mode: only emergencies get through.
    if (quiet && kind !== 'emergency') return;
    if (sound) cue(sound);
    get().toast({ kind, title: e.type === 'announcement' ? 'Host announcement' : e.text, body: e.type === 'announcement' ? e.text : undefined });
  }

  return {
    gameId: null,
    status: 'idle',
    fatal: null,
    view: null,
    offset: 0,
    rtt: null,
    toasts: [],
    pingRequestAt: null,
    revealPulse: 0,
    quiet: false,
    connect(gameId) {
      if (get().gameId === gameId && ws) return;
      lastRevealCount = 0;
      set({ gameId, status: 'connecting', fatal: null, view: null, toasts: [], pingRequestAt: null });
      retry = 0;
      open();
    },
    disconnect() {
      clearTimers();
      const s = ws;
      ws = null;
      s?.close();
      set({ gameId: null, status: 'idle', view: null, fatal: null, toasts: [] });
    },
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN && get().status === 'online') {
        ws.send(JSON.stringify(msg));
        return true;
      }
      if (msg.type === 'location') {
        pendingLocation = msg;
        return false;
      }
      get().toast({ kind: 'error', title: 'You are offline', body: 'Reconnecting… try again in a moment.' });
      return false;
    },
    toast(t) {
      const toast: Toast = { ...t, id: ++toastSeq, at: Date.now() };
      set({ toasts: [...get().toasts.slice(-3), toast] });
      const ttl = t.kind === 'emergency' ? 15_000 : t.kind === 'error' ? 5000 : t.kind === 'announce' ? 9000 : 4500;
      window.setTimeout(() => get().dismiss(toast.id), ttl);
    },
    dismiss(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    setQuiet(q) {
      set({ quiet: q });
    },
    reconnectNow() {
      if (!get().gameId || get().status === 'fatal') return;
      retry = 0;
      open();
    },
  };
});

// Reconnect promptly when the network or the tab comes back.
function kick() {
  const s = useGame.getState();
  if (s.gameId && s.status === 'reconnecting') s.reconnectNow();
}

window.addEventListener('online', kick);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') kick();
});

/** Current server time estimate. */
export function serverNow() {
  return Date.now() + useGame.getState().offset;
}
