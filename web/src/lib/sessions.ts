/**
 * Temporary identities. Each game gets its own random token issued by the server;
 * we keep it in localStorage so a refresh or app restart reconnects as the same player.
 */
export interface SavedSession {
  gameId: string;
  token: string;
  playerId: string;
  code: string;
  name: string;
  gameName?: string;
  savedAt: number;
}

const KEY = 'manhunt:sessions:v1';
const MAX_AGE = 48 * 3600_000;

function read(): Record<string, SavedSession> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, SavedSession>;
    const now = Date.now();
    for (const [k, v] of Object.entries(raw)) if (now - v.savedAt > MAX_AGE) delete raw[k];
    return raw;
  } catch {
    return {};
  }
}

function write(all: Record<string, SavedSession>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable (private mode) — session lasts until the tab closes */
  }
}

const memory: Record<string, SavedSession> = {};

export const sessions = {
  get(gameId: string): SavedSession | undefined {
    return read()[gameId] ?? memory[gameId];
  },
  save(s: Omit<SavedSession, 'savedAt'>) {
    const all = read();
    all[s.gameId] = { ...s, savedAt: Date.now() };
    memory[s.gameId] = all[s.gameId]!;
    write(all);
  },
  touch(gameId: string, patch: Partial<SavedSession> = {}) {
    const all = read();
    const s = all[gameId];
    if (!s) return;
    all[gameId] = { ...s, ...patch, savedAt: Date.now() };
    write(all);
  },
  remove(gameId: string) {
    const all = read();
    delete all[gameId];
    delete memory[gameId];
    write(all);
  },
  list(): SavedSession[] {
    return Object.values(read()).sort((a, b) => b.savedAt - a.savedAt);
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
