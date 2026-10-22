// Core domain types shared by the server and the web client.

export type Team = 'runner' | 'hunter' | 'spectator';
export type PlayerStatus = 'active' | 'captured' | 'left' | 'kicked';
export type GameStatus = 'lobby' | 'running' | 'ended';
export type Phase = 'lobby' | 'headstart' | 'hunting' | 'ended';
export type CaptureMethod = 'runner_confirm' | 'host_confirm';
export type TeamAssignment = 'auto' | 'manual';
export type Winner = 'runners' | 'hunters' | 'none';
export type GpsState = 'ok' | 'denied' | 'unavailable' | 'off' | 'unknown';

export interface LatLng {
  lat: number;
  lng: number;
}

export type Boundary =
  | { type: 'circle'; center: LatLng; radiusM: number }
  | { type: 'polygon'; points: LatLng[] };

export interface GameSettings {
  name: string;
  maxPlayers: number;
  durationMin: number;
  pingIntervalSec: number;
  headStartMin: number;
  /** Reveal runners the moment the head start ends (in addition to the regular cadence). */
  revealAtHeadStartEnd: boolean;
  teamAssignment: TeamAssignment;
  /** Team that receives the extra player when the count is odd. */
  extraPlayerTeam: 'runner' | 'hunter';
  captureMethod: CaptureMethod;
  /** Allow instant capture by entering/scanning the runner's secret tag code in person. */
  tagCodeEnabled: boolean;
  allowSpectators: boolean;
  hunterTeammatesVisible: boolean;
  runnerTeammatesVisible: boolean;
  lobbyLocked: boolean;
}

export interface ClockState {
  startedAt: number | null;
  pausedAt: number | null;
  pausedTotalMs: number;
  endedAt: number | null;
}

export type PingStatus = 'ok' | 'stale' | 'missed';

export interface RevealEntry {
  playerId: string;
  status: PingStatus;
  /** Present for ok/stale only. Never fabricated. */
  lat?: number;
  lng?: number;
  accuracyM?: number;
  /** Server-time estimate of when the GPS fix was actually measured. */
  fixAt?: number;
  /** Why the ping was missed (no fix, sharing off, permission denied…). */
  reason?: string;
}

export interface RevealSnapshot {
  seq: number;
  revealedAt: number;
  elapsedMs: number;
  entries: RevealEntry[];
  /** True once coordinates have been removed by the retention policy. */
  purged?: boolean;
}

export type CaptureStatus = 'pending' | 'confirmed' | 'disputed' | 'rejected' | 'expired' | 'cancelled';

export interface CaptureRecord {
  id: string;
  hunterId: string | null;
  runnerId: string;
  status: CaptureStatus;
  method: 'request' | 'tag_code' | 'host';
  createdAt: number;
  expiresAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  /** Hunter's position at capture time (shown to hunters, and to everyone after the game). */
  location?: LatLng;
}

export type EventVisibility = 'all' | 'hunter' | 'runner' | 'host';

export type GameEventType =
  | 'player_joined'
  | 'player_left'
  | 'player_kicked'
  | 'player_disconnected'
  | 'player_reconnected'
  | 'host_changed'
  | 'teams_changed'
  | 'game_started'
  | 'headstart_ended'
  | 'ping_incoming'
  | 'ping_revealed'
  | 'capture_requested'
  | 'capture_disputed'
  | 'capture_rejected'
  | 'runner_captured'
  | 'runner_released'
  | 'game_paused'
  | 'game_resumed'
  | 'emergency_stop'
  | 'settings_changed'
  | 'announcement'
  | 'warning'
  | 'game_ended';

export interface GameEvent {
  id: number;
  type: GameEventType;
  at: number;
  elapsedMs: number;
  text: string;
  visibility: EventVisibility;
  actorId?: string;
  targetId?: string;
}
