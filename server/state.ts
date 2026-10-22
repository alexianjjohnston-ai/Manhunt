import type {
  Boundary,
  CaptureRecord,
  ClockState,
  GameEvent,
  GameSettings,
  GameStatus,
  GpsState,
  PlayerStatus,
  RevealSnapshot,
  Team,
  Winner,
} from '@shared/types';

export interface PlayerState {
  id: string;
  name: string;
  tokenHash: string;
  team: Team | null;
  status: PlayerStatus;
  ready: boolean;
  safetyAck: boolean;
  joinedAt: number;
  lastSeenAt: number;
  capturedAt?: number;
  capturedBy?: string | null;
  tagCode: string;
  gps: GpsState;
}

export interface GameState {
  v: 1;
  id: string;
  code: string;
  createdAt: number;
  updatedAt: number;
  status: GameStatus;
  settings: GameSettings;
  boundary: Boundary | null;
  passwordHash: string | null;
  hostId: string;
  players: PlayerState[];
  clock: ClockState;
  lastPingElapsed: number | null;
  nextPingElapsed: number | null;
  /** nextPingElapsed value for which runners were already asked for a fresh fix. */
  pingRequestedFor: number | null;
  headstartAnnounced: boolean;
  reveals: RevealSnapshot[];
  captures: CaptureRecord[];
  events: GameEvent[];
  eventSeq: number;
  emergency: { byId: string; at: number } | null;
  winner: Winner | null;
  endReason: string | null;
  locationsPurged: boolean;
}

/** In-memory only: the latest GPS fix per player. Overwritten on every update, never persisted. */
export interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
  /** Server-time estimate of when the fix was measured. */
  fixAt: number;
  receivedAt: number;
  speed: number | null;
  simulated: boolean;
}
