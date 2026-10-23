import type { CreateGameBody, JoinGameBody } from '@shared/protocol';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('network', 'No connection. Check your signal and try again.', 0);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(body.code ?? 'error'), String(body.error ?? 'Something went wrong'), res.status);
  return body as T;
}

export interface ServerConfigView {
  fastPingsAllowed: boolean;
  simulationAllowed: boolean;
  googleMapsApiKey: string | null;
}

export interface JoinResult {
  gameId: string;
  code: string;
  playerId: string;
  token: string;
}

export interface GamePreview {
  name: string;
  status: 'lobby' | 'running' | 'ended';
  hostName: string;
  players: number;
  maxPlayers: number;
  requiresPassword: boolean;
  allowSpectators: boolean;
  locked: boolean;
  durationMin: number;
  pingIntervalSec: number;
  hasBoundary: boolean;
}

export const api = {
  config: () => request<ServerConfigView>('/api/config'),
  create: (body: CreateGameBody) => request<JoinResult>('/api/games', { method: 'POST', body: JSON.stringify(body) }),
  preview: (code: string) => request<GamePreview>(`/api/games/${encodeURIComponent(code)}/preview`),
  join: (code: string, body: JoinGameBody) =>
    request<JoinResult>(`/api/games/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify(body) }),
};
