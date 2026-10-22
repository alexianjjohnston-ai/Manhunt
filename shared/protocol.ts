import { z } from 'zod';
import type {
  Boundary,
  CaptureRecord,
  ClockState,
  GameEvent,
  GameSettings,
  GameStatus,
  GpsState,
  Phase,
  PingStatus,
  PlayerStatus,
  RevealSnapshot,
  Team,
  Winner,
} from './types';

export { LIMITS, DEFAULT_SETTINGS, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from './constants';
import { LIMITS, JOIN_CODE_LENGTH } from './constants';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const finite = z.number().finite();
export const latLngSchema = z.object({ lat: finite.min(-90).max(90), lng: finite.min(-180).max(180) });

export const boundarySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('circle'),
    center: latLngSchema,
    radiusM: finite.min(LIMITS.circleRadiusMin).max(LIMITS.circleRadiusMax),
  }),
  z.object({
    type: z.literal('polygon'),
    points: z.array(latLngSchema).min(3).max(LIMITS.polygonPointsMax),
  }),
]);

/** Display names: printable, trimmed, no control characters. */
export const displayNameSchema = z
  .string()
  .transform((s) => s.normalize('NFC').replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(LIMITS.nameMin, 'Enter a name').max(LIMITS.nameMax, `Max ${LIMITS.nameMax} characters`));

export const settingsSchema = z.object({
  name: z
    .string()
    .transform((s) => s.replace(/[\p{C}]/gu, '').replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1).max(LIMITS.gameNameMax)),
  maxPlayers: z.number().int().min(LIMITS.maxPlayersMin).max(LIMITS.maxPlayersMax),
  durationMin: z.number().int().min(LIMITS.durationMinMin).max(LIMITS.durationMinMax),
  pingIntervalSec: z.number().int().min(LIMITS.pingIntervalSecMin).max(LIMITS.pingIntervalSecMax),
  headStartMin: z.number().int().min(0).max(LIMITS.headStartMinMax),
  revealAtHeadStartEnd: z.boolean(),
  teamAssignment: z.enum(['auto', 'manual']),
  extraPlayerTeam: z.enum(['runner', 'hunter']),
  captureMethod: z.enum(['runner_confirm', 'host_confirm']),
  tagCodeEnabled: z.boolean(),
  allowSpectators: z.boolean(),
  hunterTeammatesVisible: z.boolean(),
  runnerTeammatesVisible: z.boolean(),
  lobbyLocked: z.boolean(),
});

export const joinCodeSchema = z
  .string()
  .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, ''))
  .pipe(z.string().length(JOIN_CODE_LENGTH));

export const createGameBody = z.object({
  hostName: displayNameSchema,
  settings: settingsSchema,
  boundary: boundarySchema.nullable(),
  password: z.string().max(LIMITS.passwordMax).optional(),
  hostTeam: z.enum(['player', 'spectator']).default('player'),
  safetyAck: z.literal(true, { error: 'You must accept the safety rules' }),
});
export type CreateGameBody = z.input<typeof createGameBody>;

export const joinGameBody = z.object({
  name: displayNameSchema,
  password: z.string().max(LIMITS.passwordMax).optional(),
  asSpectator: z.boolean().optional(),
});
export type JoinGameBody = z.input<typeof joinGameBody>;

const id = z.string().min(1).max(64);

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), gameId: id, token: z.string().min(16).max(128) }),
  z.object({ type: z.literal('ping'), t: finite }),
  z.object({ type: z.literal('setReady'), ready: z.boolean() }),
  z.object({ type: z.literal('ackSafety') }),
  z.object({
    type: z.literal('location'),
    lat: finite.min(-90).max(90),
    lng: finite.min(-180).max(180),
    accuracyM: finite.min(0).max(100_000),
    /** How old the fix was on the device when sent (device-relative, immune to clock skew). */
    ageMs: finite.min(0).max(3_600_000),
    speed: finite.min(0).max(200).nullable().optional(),
    simulated: z.boolean().optional(),
  }),
  z.object({ type: z.literal('gpsStatus'), state: z.enum(['ok', 'denied', 'unavailable', 'off']) }),
  z.object({ type: z.literal('captureRequest'), runnerId: id }),
  z.object({ type: z.literal('captureCancel'), captureId: id }),
  z.object({ type: z.literal('captureRespond'), captureId: id, accept: z.boolean() }),
  z.object({ type: z.literal('captureByCode'), code: z.string().regex(/^\d{4}$/) }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('emergencyStop') }),
  // ---- host only ----
  z.object({ type: z.literal('host.updateSettings'), settings: settingsSchema.partial(), boundary: boundarySchema.nullable().optional() }),
  z.object({ type: z.literal('host.setTeam'), playerId: id, team: z.enum(['runner', 'hunter', 'spectator']) }),
  z.object({ type: z.literal('host.balanceTeams') }),
  z.object({ type: z.literal('host.start'), force: z.boolean().optional() }),
  z.object({ type: z.literal('host.pause') }),
  z.object({ type: z.literal('host.resume') }),
  z.object({ type: z.literal('host.end'), winner: z.enum(['runners', 'hunters', 'none']).optional() }),
  z.object({ type: z.literal('host.kick'), playerId: id }),
  z.object({ type: z.literal('host.transferHost'), playerId: id }),
  z.object({ type: z.literal('host.resolveCapture'), captureId: id, confirm: z.boolean() }),
  z.object({ type: z.literal('host.setCaptured'), playerId: id, captured: z.boolean() }),
  z.object({
    type: z.literal('host.announce'),
    text: z
      .string()
      .transform((s) => s.replace(/[\p{C}]/gu, '').trim())
      .pipe(z.string().min(1).max(LIMITS.announcementMax)),
  }),
  z.object({ type: z.literal('host.rematch') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage['type'];

// ---------------------------------------------------------------------------
// Server → client view (the role-filtered projection)
// ---------------------------------------------------------------------------

export interface PlayerView {
  id: string;
  name: string;
  team: Team | null;
  status: PlayerStatus;
  isHost: boolean;
  ready: boolean;
  safetyAck: boolean;
  connected: boolean;
  capturedAt?: number;
  /** Host-only health info. Never includes coordinates. */
  health?: {
    gps: GpsState;
    lastFixAt: number | null;
    accuracyM: number | null;
    lastSeenAt: number;
    warnings: string[];
  };
}

export interface LiveMarker {
  playerId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  fixAt: number;
}

export interface RunnerMarker {
  playerId: string;
  seq: number;
  revealedAt: number;
  status: PingStatus;
  reason?: string;
  /** Coordinates of THIS reveal (ok/stale). */
  lat?: number;
  lng?: number;
  accuracyM?: number;
  fixAt?: number;
  /** When the latest ping missed: the last successful reveal, clearly labelled as old. */
  lastKnown?: { lat: number; lng: number; accuracyM: number; fixAt: number; revealedAt: number; seq: number };
}

export interface CaptureView extends CaptureRecord {}

export interface GameView {
  serverNow: number;
  game: {
    id: string;
    code: string;
    name: string;
    status: GameStatus;
    phase: Phase;
    settings: GameSettings;
    boundary: Boundary | null;
    hostId: string;
    hasPassword: boolean;
    clock: ClockState;
    lastPingElapsed: number | null;
    nextPingElapsed: number | null;
    pingCount: number;
    paused: boolean;
    emergency: { byId: string; at: number } | null;
    winner: Winner | null;
    endReason: string | null;
    createdAt: number;
    fastPingsAllowed: boolean;
    simulationAllowed: boolean;
    /** When reveal coordinates will be (or were) deleted. Null until the game ends. */
    locationsPurgeAt: number | null;
    locationsPurged: boolean;
  };
  me: {
    id: string;
    name: string;
    team: Team | null;
    status: PlayerStatus;
    isHost: boolean;
    ready: boolean;
    safetyAck: boolean;
    /** Whether the server wants this device to share location right now. */
    shareLocation: boolean;
    /** Secret tag code (active runners only, when enabled). */
    tagCode?: string;
    /** Server time of the latest fix the server holds for me (so players know their ping will land). */
    lastFixAt: number | null;
  };
  players: PlayerView[];
  live: LiveMarker[];
  runnerMarkers: RunnerMarker[];
  /** Full reveal history: only after the game has ended (results replay). */
  history: RevealSnapshot[];
  captures: CaptureView[];
  events: GameEvent[];
}

export type ServerMessage =
  | { type: 'welcome'; playerId: string; gameId: string; serverNow: number }
  | { type: 'state'; view: GameView }
  | { type: 'event'; event: GameEvent }
  | { type: 'pingRequest'; revealAt: number }
  | { type: 'pong'; t: number; serverNow: number }
  | { type: 'error'; code: string; message: string; ref?: string }
  | { type: 'kicked'; reason: string }
  | { type: 'stopSharing'; reason: string };
