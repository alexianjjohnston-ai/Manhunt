import type { GameSettings } from './types';

// ---------------------------------------------------------------------------
// Limits & defaults
// ---------------------------------------------------------------------------

export const LIMITS = {
  nameMin: 1,
  nameMax: 20,
  gameNameMax: 40,
  passwordMax: 64,
  maxPlayersMin: 2,
  maxPlayersMax: 40,
  durationMinMin: 5,
  durationMinMax: 240,
  /** Absolute lower bound; production servers enforce 60 s unless fast pings are enabled for testing. */
  pingIntervalSecMin: 15,
  pingIntervalSecProdMin: 60,
  pingIntervalSecMax: 1800,
  headStartMinMax: 30,
  circleRadiusMin: 50,
  circleRadiusMax: 25_000,
  polygonPointsMax: 60,
  announcementMax: 140,
  cloaksMax: 3,
  sweepsMax: 3,
  finalPhaseMinMax: 60,
} as const;

export const DEFAULT_SETTINGS: GameSettings = {
  name: 'Manhunt',
  maxPlayers: 12,
  durationMin: 60,
  pingIntervalSec: 300,
  headStartMin: 5,
  revealAtHeadStartEnd: false,
  teamAssignment: 'auto',
  extraPlayerTeam: 'hunter',
  captureMethod: 'runner_confirm',
  tagCodeEnabled: true,
  allowSpectators: false,
  hunterTeammatesVisible: true,
  runnerTeammatesVisible: true,
  lobbyLocked: false,
  mode: 'classic',
  cloaksPerRunner: 1,
  sweepsPerGame: 1,
  finalPhaseMin: 10,
};

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 6;

