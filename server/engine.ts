import {
  pingWarningMs,
  durationMs,
  elapsedMs,
  freshThresholdMs,
  headStartMs,
  nextPingAfter,
  pingIntervalMs,
  phaseAt,
} from '@shared/clock';
import { boundaryStatus, distanceM } from '@shared/geo';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  type ClientMessage,
  type CreateGameBody,
  type JoinGameBody,
  type ServerMessage,
  createGameBody,
  joinGameBody,
  settingsSchema,
} from '@shared/protocol';
import { evaluateWinner } from '@shared/rules';
import { balanceTeams, teamTargets } from '@shared/teams';
import type {
  Boundary,
  CaptureRecord,
  EventVisibility,
  GameEvent,
  GameEventType,
  GameSettings,
  RevealEntry,
  Winner,
} from '@shared/types';
import type { ServerConfig } from './config';
import { RateLimiter } from './ratelimit';
import {
  hashPassword,
  hashToken,
  newId,
  newJoinCode,
  newTagCode,
  newToken,
  secureRandom,
  tokenMatches,
  verifyPassword,
} from './security';
import type { Fix, GameState, PlayerState } from './state';
import type { GameStore } from './store';

export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface EngineHooks {
  /** Game state changed: re-project and push to connected players. */
  changed(game: GameState): void;
  /** Notable event: deliver as a toast to players allowed to see it. */
  event(game: GameState, event: GameEvent): void;
  /** Direct message to one player's sockets. */
  send(gameId: string, playerId: string, msg: ServerMessage): void;
  /** Close a player's sockets (kicked / left). */
  disconnect(gameId: string, playerId: string): void;
  /** Whether the player has at least one live socket. */
  isConnected(gameId: string, playerId: string): boolean;
}

const MAX_EVENTS = 200;
const CAPTURE_TIMEOUT_MS = 90_000;
const MAX_TOTAL_PLAYERS = 60;
const DISCONNECT_GRACE_MS = 20_000;
const RUNNER_SPEED_WARN_MPS = 8; // ~29 km/h, well beyond sustained running pace

export class GameEngine {
  readonly games = new Map<string, GameState>();
  private byCode = new Map<string, string>();
  /** Latest fixes — memory only. gameId → playerId → fix. */
  readonly fixes = new Map<string, Map<string, Fix>>();
  /** Runtime-only bookkeeping (not persisted). */
  private disconnectAnnounced = new Set<string>();
  private outOfBounds = new Set<string>();
  private warnings = new Map<string, { text: string; at: number }[]>();
  private lastSpeedWarn = new Map<string, number>();
  private tagAttempts: RateLimiter;
  private announceLimiter: RateLimiter;
  private emergencyLimiter: RateLimiter;
  private captureLimiter: RateLimiter;
  hooks: EngineHooks = {
    changed() {},
    event() {},
    send() {},
    disconnect() {},
    isConnected: () => false,
  };

  constructor(
    private store: GameStore,
    private config: Pick<
      ServerConfig,
      'allowFastPings' | 'allowSimulation' | 'locationRetentionMinutes' | 'gameRetentionHours' | 'lobbyIdleHours'
    >,
    public now: () => number = Date.now,
    private rng: () => number = secureRandom,
  ) {
    this.tagAttempts = new RateLimiter(5, 5 / 60, () => this.now());
    this.announceLimiter = new RateLimiter(3, 1 / 5, () => this.now());
    this.emergencyLimiter = new RateLimiter(1, 1 / 120, () => this.now());
    this.captureLimiter = new RateLimiter(3, 1 / 15, () => this.now());
    for (const g of store.loadAll(this.now())) {
      g.settings = { ...DEFAULT_SETTINGS, ...g.settings };
      this.games.set(g.id, g);
      this.byCode.set(g.code, g.id);
    }
  }

  // -------------------------------------------------------------------------
  // Lookup & persistence
  // -------------------------------------------------------------------------

  getGame(id: string): GameState | undefined {
    return this.games.get(id);
  }

  findByCode(code: string): GameState | undefined {
    const id = this.byCode.get(code);
    return id ? this.games.get(id) : undefined;
  }

  fixesFor(gameId: string): Map<string, Fix> {
    let m = this.fixes.get(gameId);
    if (!m) this.fixes.set(gameId, (m = new Map()));
    return m;
  }

  warningsFor(gameId: string, playerId: string): string[] {
    const t = this.now();
    return (this.warnings.get(`${gameId}:${playerId}`) ?? []).filter((w) => t - w.at < 10 * 60_000).map((w) => w.text);
  }

  private expiresAt(g: GameState): number {
    const t = this.now();
    if (g.status === 'ended') return (g.clock.endedAt ?? t) + this.config.gameRetentionHours * 3600_000;
    return t + this.config.lobbyIdleHours * 3600_000;
  }

  private commit(g: GameState) {
    g.updatedAt = this.now();
    this.store.save(g, this.expiresAt(g));
    this.hooks.changed(g);
  }

  private emit(
    g: GameState,
    type: GameEventType,
    text: string,
    visibility: EventVisibility = 'all',
    extra: { actorId?: string; targetId?: string } = {},
  ): GameEvent {
    const ev: GameEvent = {
      id: ++g.eventSeq,
      type,
      at: this.now(),
      elapsedMs: elapsedMs(g.clock, this.now()),
      text,
      visibility,
      ...extra,
    };
    g.events.push(ev);
    if (g.events.length > MAX_EVENTS) g.events.splice(0, g.events.length - MAX_EVENTS);
    this.hooks.event(g, ev);
    return ev;
  }

  private player(g: GameState, id: string): PlayerState {
    const p = g.players.find((x) => x.id === id);
    if (!p) throw new GameError('not_found', 'Player not found');
    return p;
  }

  private present(g: GameState): PlayerState[] {
    return g.players.filter((p) => p.status !== 'left' && p.status !== 'kicked');
  }

  private competitors(g: GameState): PlayerState[] {
    return this.present(g).filter((p) => p.team !== 'spectator');
  }

  private validateSettings(s: GameSettings) {
    const min = this.config.allowFastPings ? LIMITS.pingIntervalSecMin : LIMITS.pingIntervalSecProdMin;
    if (s.pingIntervalSec < min) throw new GameError('invalid_settings', `Ping interval must be at least ${min} seconds`);
    if (s.headStartMin * 60_000 >= s.durationMin * 60_000) {
      throw new GameError('invalid_settings', 'Head start must be shorter than the game');
    }
  }

  // -------------------------------------------------------------------------
  // Create / preview / join / auth
  // -------------------------------------------------------------------------

  createGame(raw: unknown): { game: GameState; player: PlayerState; token: string } {
    const body = parse(createGameBody, raw);
    const settings = withDefaults(body.settings);
    this.validateSettings(settings);
    const t = this.now();
    let code = newJoinCode();
    while (this.byCode.has(code) || this.store.codeExists(code)) code = newJoinCode();
    const token = newToken();
    const host: PlayerState = {
      id: newId(9),
      name: body.hostName,
      tokenHash: hashToken(token),
      team: body.hostTeam === 'spectator' ? 'spectator' : null,
      status: 'active',
      ready: false,
      safetyAck: true,
      joinedAt: t,
      lastSeenAt: t,
      tagCode: newTagCode(new Set()),
      gps: 'unknown',
    };
    const game: GameState = {
      v: 1,
      id: newId(16),
      code,
      createdAt: t,
      updatedAt: t,
      status: 'lobby',
      settings,
      boundary: (body.boundary as Boundary | null) ?? null,
      passwordHash: body.password ? hashPassword(body.password) : null,
      hostId: host.id,
      players: [host],
      clock: { startedAt: null, pausedAt: null, pausedTotalMs: 0, endedAt: null },
      lastPingElapsed: null,
      nextPingElapsed: null,
      pingRequestedFor: null,
      headstartAnnounced: false,
      reveals: [],
      captures: [],
      events: [],
      eventSeq: 0,
      emergency: null,
      winner: null,
      endReason: null,
      locationsPurged: false,
    };
    if (host.team == null) this.autoAssign(game, host);
    this.games.set(game.id, game);
    this.byCode.set(code, game.id);
    this.emit(game, 'player_joined', `${host.name} created the game`, 'all', { actorId: host.id });
    this.commit(game);
    return { game, player: host, token };
  }

  preview(code: string) {
    const g = this.findByCode(code);
    if (!g || g.status === 'ended') throw new GameError('not_found', 'No active game with that code', 404);
    const host = g.players.find((p) => p.id === g.hostId);
    return {
      name: g.settings.name,
      status: g.status,
      hostName: host?.name ?? '',
      players: this.competitors(g).length,
      maxPlayers: g.settings.maxPlayers,
      requiresPassword: !!g.passwordHash,
      allowSpectators: g.settings.allowSpectators,
      locked: g.settings.lobbyLocked,
      durationMin: g.settings.durationMin,
      pingIntervalSec: g.settings.pingIntervalSec,
      hasBoundary: !!g.boundary,
    };
  }

  joinGame(code: string, raw: unknown): { game: GameState; player: PlayerState; token: string } {
    const body = parse(joinGameBody, raw);
    const g = this.findByCode(code);
    if (!g || g.status === 'ended') throw new GameError('not_found', 'No active game with that code', 404);
    if (g.passwordHash && !verifyPassword(body.password ?? '', g.passwordHash)) {
      throw new GameError('bad_password', 'Incorrect game password', 403);
    }
    const asSpectator = !!body.asSpectator || g.status !== 'lobby';
    if (asSpectator && !g.settings.allowSpectators) {
      throw new GameError(
        g.status === 'lobby' ? 'no_spectators' : 'in_progress',
        g.status === 'lobby' ? 'This game does not allow spectators' : 'This game has already started',
        403,
      );
    }
    if (g.status === 'lobby' && g.settings.lobbyLocked) throw new GameError('locked', 'The host has locked this lobby', 403);
    if (!asSpectator && this.competitors(g).length >= g.settings.maxPlayers) throw new GameError('full', 'This game is full', 403);
    if (this.present(g).length >= MAX_TOTAL_PLAYERS) throw new GameError('full', 'This game is full', 403);
    const lower = body.name.toLocaleLowerCase();
    if (this.present(g).some((p) => p.name.toLocaleLowerCase() === lower)) {
      throw new GameError('name_taken', 'That name is already taken in this game', 409);
    }
    const t = this.now();
    const token = newToken();
    const p: PlayerState = {
      id: newId(9),
      name: body.name,
      tokenHash: hashToken(token),
      team: asSpectator ? 'spectator' : null,
      status: 'active',
      ready: false,
      safetyAck: false,
      joinedAt: t,
      lastSeenAt: t,
      tagCode: newTagCode(new Set(g.players.map((x) => x.tagCode))),
      gps: 'unknown',
    };
    g.players.push(p);
    if (!asSpectator) this.autoAssign(g, p);
    this.emit(g, 'player_joined', `${p.name} joined${asSpectator ? ' as a spectator' : ''}`, 'all', { actorId: p.id });
    this.commit(g);
    return { game: g, player: p, token };
  }

  /** Assign a new player to the team that is short of its balanced target. */
  private autoAssign(g: GameState, p: PlayerState) {
    if (g.settings.teamAssignment === 'manual') {
      p.team = null;
      return;
    }
    const comps = this.competitors(g);
    const targets = teamTargets(comps.length, g.settings.extraPlayerTeam);
    const runners = comps.filter((x) => x.team === 'runner' && x !== p).length;
    p.team = runners < targets.runner ? 'runner' : 'hunter';
  }

  authenticate(gameId: string, token: string): { game: GameState; player: PlayerState } {
    const g = this.games.get(gameId);
    if (!g) throw new GameError('not_found', 'This game no longer exists', 404);
    const p = g.players.find((x) => tokenMatches(token, x.tokenHash));
    if (!p) throw new GameError('unauthorized', 'Session not recognised for this game', 401);
    if (p.status === 'kicked') throw new GameError('kicked', 'You were removed from this game by the host', 403);
    if (p.status === 'left') throw new GameError('left', 'You left this game', 403);
    return { game: g, player: p };
  }

  onConnect(g: GameState, p: PlayerState) {
    p.lastSeenAt = this.now();
    const key = `${g.id}:${p.id}`;
    if (this.disconnectAnnounced.delete(key)) {
      this.emit(g, 'player_reconnected', `${p.name} reconnected`, 'all', { actorId: p.id });
    }
    this.hooks.changed(g);
  }

  onDisconnect(g: GameState, p: PlayerState) {
    p.lastSeenAt = this.now();
    this.hooks.changed(g);
  }

  // -------------------------------------------------------------------------
  // Message dispatch (every privileged action is checked here)
  // -------------------------------------------------------------------------

  handle(gameId: string, playerId: string, msg: ClientMessage): void {
    const g = this.games.get(gameId);
    if (!g) throw new GameError('not_found', 'Game not found');
    const me = this.player(g, playerId);
    if (me.status === 'kicked' || me.status === 'left') throw new GameError('forbidden', 'You are no longer in this game');
    me.lastSeenAt = this.now();

    if (msg.type.startsWith('host.') && g.hostId !== me.id) {
      throw new GameError('forbidden', 'Only the host can do that', 403);
    }

    switch (msg.type) {
      case 'auth':
      case 'ping':
        return;
      case 'setReady':
        return this.setReady(g, me, msg.ready);
      case 'ackSafety':
        if (!me.safetyAck) {
          me.safetyAck = true;
          this.commit(g);
        }
        return;
      case 'location':
        return this.updateLocation(g, me, msg);
      case 'gpsStatus':
        if (me.gps !== msg.state) {
          me.gps = msg.state;
          if (msg.state !== 'ok') this.fixesFor(g.id).delete(me.id);
          this.hooks.changed(g);
        }
        return;
      case 'captureRequest':
        return this.captureRequest(g, me, msg.runnerId);
      case 'captureCancel':
        return this.captureCancel(g, me, msg.captureId);
      case 'captureRespond':
        return this.captureRespond(g, me, msg.captureId, msg.accept);
      case 'useCloak':
        return this.useCloak(g, me);
      case 'radarSweep':
        return this.radarSweep(g, me);
      case 'captureByCode':
        return this.captureByCode(g, me, msg.code);
      case 'leave':
        return this.leave(g, me);
      case 'emergencyStop':
        return this.emergencyStop(g, me);
      case 'host.updateSettings':
        return this.updateSettings(g, me, msg.settings, msg.boundary);
      case 'host.setTeam':
        return this.setTeam(g, msg.playerId, msg.team);
      case 'host.balanceTeams':
        return this.balance(g);
      case 'host.start':
        return this.start(g, !!msg.force);
      case 'host.pause':
        return this.pause(g, me);
      case 'host.resume':
        return this.resume(g);
      case 'host.end':
        return this.hostEnd(g, msg.winner);
      case 'host.kick':
        return this.kick(g, me, msg.playerId);
      case 'host.transferHost':
        return this.transferHost(g, msg.playerId);
      case 'host.resolveCapture':
        return this.resolveCapture(g, me, msg.captureId, msg.confirm);
      case 'host.setCaptured':
        return this.setCaptured(g, me, msg.playerId, msg.captured);
      case 'host.announce':
        if (!this.announceLimiter.take(g.id)) throw new GameError('rate_limited', 'Slow down — try again in a few seconds');
        this.emit(g, 'announcement', msg.text, 'all', { actorId: me.id });
        this.commit(g);
        return;
      case 'host.rematch':
        return this.rematch(g, !!msg.swapTeams);
    }
  }

  // -------------------------------------------------------------------------
  // Lobby
  // -------------------------------------------------------------------------

  private requireLobby(g: GameState) {
    if (g.status !== 'lobby') throw new GameError('wrong_state', 'Only possible in the lobby');
  }

  private requireRunning(g: GameState) {
    if (g.status !== 'running') throw new GameError('wrong_state', 'The game is not running');
  }

  private setReady(g: GameState, me: PlayerState, ready: boolean) {
    this.requireLobby(g);
    if (ready && !me.safetyAck) throw new GameError('safety_required', 'Accept the safety rules first');
    me.ready = ready;
    this.commit(g);
  }

  private updateSettings(g: GameState, me: PlayerState, patch: Partial<GameSettings>, boundary: Boundary | null | undefined) {
    if (g.status === 'ended') throw new GameError('wrong_state', 'The game has ended');
    const running = g.status === 'running';
    const runningEditable: (keyof GameSettings)[] = [
      'durationMin',
      'pingIntervalSec',
      'hunterTeammatesVisible',
      'runnerTeammatesVisible',
      'captureMethod',
      'tagCodeEnabled',
      'lobbyLocked',
      'allowSpectators',
      'finalPhaseMin',
    ];
    if (running) {
      for (const k of Object.keys(patch) as (keyof GameSettings)[]) {
        if (!runningEditable.includes(k) && patch[k] !== g.settings[k]) {
          throw new GameError('wrong_state', `"${k}" can only be changed in the lobby`);
        }
      }
    }
    const next = withDefaults(parse(settingsSchema, { ...g.settings, ...patch }));
    this.validateSettings(next);
    if (!running && next.maxPlayers < this.competitors(g).length) {
      throw new GameError('invalid_settings', 'Max players is below the current player count');
    }
    const now = this.now();
    if (running) {
      const el = elapsedMs(g.clock, now);
      if (next.durationMin * 60_000 < el + 60_000) {
        throw new GameError('invalid_settings', 'Duration must leave at least one more minute of play');
      }
      if (next.pingIntervalSec !== g.settings.pingIntervalSec && g.nextPingElapsed != null) {
        const base = g.lastPingElapsed ?? el;
        let nextPing = base + next.pingIntervalSec * 1000;
        if (nextPing < el + pingWarningMs(next)) nextPing = el + pingWarningMs(next);
        g.nextPingElapsed = nextPing;
        g.pingRequestedFor = null;
      }
    }
    const teamModeChanged = next.teamAssignment !== g.settings.teamAssignment || next.extraPlayerTeam !== g.settings.extraPlayerTeam;
    const changed = JSON.stringify(next) !== JSON.stringify(g.settings);
    g.settings = next;
    if (running && g.nextPingElapsed != null && g.nextPingElapsed >= durationMs(next)) g.nextPingElapsed = null;
    if (running && g.nextPingElapsed == null) {
      const n = nextPingAfter(g.lastPingElapsed, next);
      if (n < durationMs(next) && n > elapsedMs(g.clock, now)) g.nextPingElapsed = n;
    }
    let boundaryChanged = false;
    if (boundary !== undefined && JSON.stringify(boundary) !== JSON.stringify(g.boundary)) {
      g.boundary = boundary;
      boundaryChanged = true;
    }
    if (!running && teamModeChanged && next.teamAssignment === 'auto') this.balance(g, false);
    if (changed || boundaryChanged) {
      if (running) {
        this.emit(
          g,
          'settings_changed',
          boundaryChanged ? 'The host updated the play area' : 'The host updated the game settings',
          'all',
          { actorId: me.id },
        );
      }
      // Changing rules invalidates readiness in the lobby.
      if (!running) for (const p of g.players) if (p.id !== g.hostId) p.ready = false;
      this.commit(g);
    }
  }

  private setTeam(g: GameState, playerId: string, team: 'runner' | 'hunter' | 'spectator') {
    this.requireLobby(g);
    const p = this.player(g, playerId);
    if (p.status !== 'active') throw new GameError('invalid', 'Player is not in the lobby');
    if (team !== 'spectator' && p.team === 'spectator' && this.competitors(g).length >= g.settings.maxPlayers) {
      throw new GameError('full', 'The game is full');
    }
    p.team = team;
    p.ready = false;
    this.commit(g);
  }

  private balance(g: GameState, commit = true) {
    this.requireLobby(g);
    const comps = this.competitors(g);
    const assignment = balanceTeams(
      comps.map((p) => p.id),
      g.settings.extraPlayerTeam,
      this.rng,
    );
    for (const p of comps) p.team = assignment.get(p.id) ?? null;
    this.emit(g, 'teams_changed', 'Teams were shuffled', 'all');
    if (commit) this.commit(g);
  }

  /** Reasons the game cannot start yet (empty when ready). `force` skips ready-checks only. */
  startBlockers(g: GameState, force = false): string[] {
    const comps = this.competitors(g);
    const out: string[] = [];
    const runners = comps.filter((p) => p.team === 'runner').length;
    const hunters = comps.filter((p) => p.team === 'hunter').length;
    if (comps.some((p) => p.team == null)) out.push('Every player needs a team');
    if (runners < 1) out.push('At least one runner is required');
    if (hunters < 1) out.push('At least one hunter is required');
    const unsafe = this.present(g).filter((p) => !p.safetyAck);
    if (unsafe.length) out.push(`Waiting for safety acknowledgement: ${unsafe.map((p) => p.name).join(', ')}`);
    if (!force) {
      const notReady = comps.filter((p) => p.id !== g.hostId && !p.ready);
      if (notReady.length) out.push(`Not ready: ${notReady.map((p) => p.name).join(', ')}`);
    }
    return out;
  }

  private start(g: GameState, force: boolean) {
    this.requireLobby(g);
    if (g.settings.teamAssignment === 'auto') {
      const comps = this.competitors(g);
      const targets = teamTargets(comps.length, g.settings.extraPlayerTeam);
      const runners = comps.filter((p) => p.team === 'runner').length;
      if (runners !== targets.runner || comps.some((p) => p.team == null)) this.balance(g, false);
    }
    const blockers = this.startBlockers(g, force);
    if (blockers.length) throw new GameError('cannot_start', blockers.join('. '));
    const t = this.now();
    g.status = 'running';
    g.clock = { startedAt: t, pausedAt: null, pausedTotalMs: 0, endedAt: null };
    g.lastPingElapsed = null;
    g.nextPingElapsed = nextPingAfter(null, g.settings);
    if (g.nextPingElapsed >= durationMs(g.settings)) g.nextPingElapsed = null;
    g.pingRequestedFor = null;
    g.headstartAnnounced = g.settings.headStartMin === 0;
    g.sweepsLeft = g.settings.sweepsPerGame;
    g.finalPhaseAnnounced = g.settings.finalPhaseMin === 0;
    for (const p of g.players) {
      p.ready = false;
      p.startTeam = p.team;
      p.cloaksLeft = p.team === 'runner' ? g.settings.cloaksPerRunner : 0;
      p.cloakArmed = false;
    }
    const hs = g.settings.headStartMin;
    this.emit(
      g,
      'game_started',
      hs > 0 ? `Game on! Runners have a ${hs}-minute head start.` : 'Game on! Hunters are released.',
      'all',
    );
    this.commit(g);
  }

  // -------------------------------------------------------------------------
  // Clock control
  // -------------------------------------------------------------------------

  private pause(g: GameState, me: PlayerState, emergency = false) {
    this.requireRunning(g);
    const t = this.now();
    if (g.clock.pausedAt == null) g.clock.pausedAt = t;
    if (emergency) {
      g.emergency = { byId: me.id, at: t };
      // Immediately stop all gameplay location sharing.
      this.fixesFor(g.id).clear();
      for (const p of g.players) this.hooks.send(g.id, p.id, { type: 'stopSharing', reason: 'Emergency stop' });
      this.emit(g, 'emergency_stop', `EMERGENCY STOP called by ${me.name}. Location sharing is off. Check on each other.`, 'all', {
        actorId: me.id,
      });
    } else {
      this.emit(g, 'game_paused', 'The host paused the game', 'all', { actorId: me.id });
    }
    this.commit(g);
  }

  private resume(g: GameState) {
    this.requireRunning(g);
    if (g.clock.pausedAt == null) return;
    const t = this.now();
    g.clock.pausedTotalMs += t - g.clock.pausedAt;
    g.clock.pausedAt = null;
    g.emergency = null;
    // Pending captures should not expire because of a pause.
    for (const c of g.captures) if (c.status === 'pending' || c.status === 'disputed') c.expiresAt = Math.max(c.expiresAt, t + 30_000);
    this.emit(g, 'game_resumed', 'The game has resumed', 'all');
    this.commit(g);
  }

  private emergencyStop(g: GameState, me: PlayerState) {
    this.requireRunning(g);
    if (g.emergency) return;
    if (me.id !== g.hostId && !this.emergencyLimiter.take(`${g.id}:${me.id}`)) {
      throw new GameError('rate_limited', 'Emergency stop was used recently. Ask the host.');
    }
    this.pause(g, me, true);
  }

  private hostEnd(g: GameState, winner: Winner | undefined) {
    if (g.status === 'ended') return;
    if (g.status === 'lobby') return this.end(g, 'none', 'The host cancelled the game');
    this.end(g, winner ?? 'none', 'The host ended the game');
  }

  end(g: GameState, winner: Winner, reason: string) {
    if (g.status === 'ended') return;
    const t = this.now();
    if (g.clock.pausedAt != null) {
      g.clock.pausedTotalMs += t - g.clock.pausedAt;
      g.clock.pausedAt = null;
    }
    if (g.clock.startedAt == null) g.clock.startedAt = t;
    g.clock.endedAt = t;
    g.status = 'ended';
    g.winner = winner;
    g.endReason = reason;
    g.emergency = null;
    g.nextPingElapsed = null;
    for (const c of g.captures) {
      if (c.status === 'pending' || c.status === 'disputed') {
        c.status = 'cancelled';
        c.resolvedAt = t;
      }
    }
    this.fixes.delete(g.id);
    for (const p of g.players) this.hooks.send(g.id, p.id, { type: 'stopSharing', reason: 'Game over' });
    const label = winner === 'hunters' ? 'Hunters win!' : winner === 'runners' ? 'Runners win!' : 'Game over.';
    this.emit(g, 'game_ended', `${label} ${reason}.`, 'all');
    this.commit(g);
  }

  private rematch(g: GameState, swapTeams: boolean) {
    if (g.status !== 'ended') throw new GameError('wrong_state', 'The game has not ended yet');
    g.players = g.players.filter((p) => p.status !== 'left' && p.status !== 'kicked');
    const taken = new Set<string>();
    for (const p of g.players) {
      // Back to the teams players started with (infection converts runners), optionally swapped.
      const base = p.startTeam ?? p.team;
      p.team = swapTeams && (base === 'runner' || base === 'hunter') ? (base === 'runner' ? 'hunter' : 'runner') : base;
      p.startTeam = undefined;
      p.cloaksLeft = 0;
      p.cloakArmed = false;
      p.status = 'active';
      p.ready = false;
      p.capturedAt = undefined;
      p.capturedBy = undefined;
      p.tagCode = newTagCode(taken);
      taken.add(p.tagCode);
    }
    g.status = 'lobby';
    g.clock = { startedAt: null, pausedAt: null, pausedTotalMs: 0, endedAt: null };
    g.lastPingElapsed = null;
    g.nextPingElapsed = null;
    g.pingRequestedFor = null;
    g.headstartAnnounced = false;
    g.reveals = [];
    g.captures = [];
    g.events = [];
    g.emergency = null;
    g.winner = null;
    g.endReason = null;
    g.locationsPurged = false;
    this.fixes.delete(g.id);
    this.emit(g, 'teams_changed', swapTeams ? 'Rematch with teams swapped! Back to the lobby.' : 'Rematch! Back to the lobby.', 'all');
    this.commit(g);
  }

  // -------------------------------------------------------------------------
  // Players
  // -------------------------------------------------------------------------

  private leave(g: GameState, me: PlayerState) {
    me.status = 'left';
    me.ready = false;
    this.fixesFor(g.id).delete(me.id);
    this.hooks.send(g.id, me.id, { type: 'stopSharing', reason: 'You left the game' });
    for (const c of g.captures) {
      if ((c.status === 'pending' || c.status === 'disputed') && (c.runnerId === me.id || c.hunterId === me.id)) {
        c.status = 'cancelled';
        c.resolvedAt = this.now();
      }
    }
    this.emit(g, 'player_left', `${me.name} left the game`, 'all', { actorId: me.id });
    if (g.hostId === me.id) this.autoTransferHost(g);
    this.hooks.disconnect(g.id, me.id);
    if (!this.checkWin(g)) this.commit(g);
  }

  private kick(g: GameState, me: PlayerState, playerId: string) {
    if (playerId === me.id) throw new GameError('invalid', 'You cannot kick yourself');
    const p = this.player(g, playerId);
    if (p.status === 'kicked' || p.status === 'left') return;
    p.status = 'kicked';
    this.fixesFor(g.id).delete(p.id);
    for (const c of g.captures) {
      if ((c.status === 'pending' || c.status === 'disputed') && (c.runnerId === p.id || c.hunterId === p.id)) {
        c.status = 'cancelled';
        c.resolvedAt = this.now();
      }
    }
    this.hooks.send(g.id, p.id, { type: 'kicked', reason: 'The host removed you from the game' });
    this.hooks.disconnect(g.id, p.id);
    this.emit(g, 'player_kicked', `${p.name} was removed by the host`, 'all', { targetId: p.id });
    if (!this.checkWin(g)) this.commit(g);
  }

  private transferHost(g: GameState, playerId: string) {
    const p = this.player(g, playerId);
    if (p.status === 'left' || p.status === 'kicked') throw new GameError('invalid', 'That player is no longer in the game');
    if (p.id === g.hostId) return;
    g.hostId = p.id;
    this.emit(g, 'host_changed', `${p.name} is now the host`, 'all', { targetId: p.id });
    this.commit(g);
  }

  private autoTransferHost(g: GameState) {
    const candidates = this.present(g).sort(
      (a, b) =>
        Number(this.hooks.isConnected(g.id, b.id)) - Number(this.hooks.isConnected(g.id, a.id)) || a.joinedAt - b.joinedAt,
    );
    const next = candidates[0];
    if (!next) {
      if (g.status !== 'ended') this.end(g, 'none', 'Everyone left');
      return;
    }
    g.hostId = next.id;
    this.emit(g, 'host_changed', `${next.name} is now the host`, 'all', { targetId: next.id });
  }

  // -------------------------------------------------------------------------
  // Location
  // -------------------------------------------------------------------------

  /** Whether this player's device should currently be sharing gameplay location. */
  shouldShare(g: GameState, p: PlayerState): boolean {
    return g.status === 'running' && !g.emergency && p.status === 'active' && (p.team === 'runner' || p.team === 'hunter');
  }

  private updateLocation(
    g: GameState,
    me: PlayerState,
    msg: Extract<ClientMessage, { type: 'location' }>,
  ) {
    if (!this.shouldShare(g, me)) return; // silently ignore: not collecting right now
    if (msg.simulated && !this.config.allowSimulation) {
      throw new GameError('forbidden', 'Simulated GPS is disabled on this server');
    }
    const t = this.now();
    const fixes = this.fixesFor(g.id);
    const prev = fixes.get(me.id);
    const fix: Fix = {
      lat: msg.lat,
      lng: msg.lng,
      accuracyM: msg.accuracyM,
      fixAt: t - msg.ageMs,
      receivedAt: t,
      speed: msg.speed ?? null,
      simulated: !!msg.simulated,
    };
    if (prev && fix.fixAt < prev.fixAt) return; // out-of-order
    fixes.set(me.id, fix);
    me.gps = 'ok';

    // Anti-cheat signals: warnings for the host, never automatic penalties.
    if (me.team === 'runner' && prev) {
      const dt = (fix.fixAt - prev.fixAt) / 1000;
      if (dt >= 5 && fix.accuracyM < 50 && prev.accuracyM < 50) {
        const speed = distanceM(prev, fix) / dt;
        const key = `${g.id}:${me.id}`;
        if (speed > RUNNER_SPEED_WARN_MPS && t - (this.lastSpeedWarn.get(key) ?? 0) > 3 * 60_000) {
          this.lastSpeedWarn.set(key, t);
          this.warn(g, me, `${me.name} moved at ~${Math.round(speed * 3.6)} km/h (faster than on foot). Could be GPS error.`);
        }
      }
    }
    if (g.boundary) {
      const key = `${g.id}:${me.id}`;
      const out = boundaryStatus(fix, g.boundary) === 'outside' && fix.accuracyM < 100;
      if (out && !this.outOfBounds.has(key)) {
        this.outOfBounds.add(key);
        this.warn(g, me, `${me.name} appears to be outside the play area`);
      } else if (!out) {
        this.outOfBounds.delete(key);
      }
    }
    this.hooks.changed(g);
  }

  private warn(g: GameState, p: PlayerState, text: string) {
    const key = `${g.id}:${p.id}`;
    const list = this.warnings.get(key) ?? [];
    list.push({ text, at: this.now() });
    this.warnings.set(key, list.slice(-5));
    this.emit(g, 'warning', text, 'host', { targetId: p.id });
  }

  // -------------------------------------------------------------------------
  // Captures
  // -------------------------------------------------------------------------

  private requireHuntingPhase(g: GameState) {
    this.requireRunning(g);
    if (g.clock.pausedAt != null) throw new GameError('paused', 'The game is paused');
    if (phaseAt(g.status, g.clock, g.settings, this.now()) !== 'hunting') {
      throw new GameError('headstart', 'Hunters cannot capture during the head start');
    }
  }

  private captureRequest(g: GameState, me: PlayerState, runnerId: string) {
    this.requireHuntingPhase(g);
    if (me.team !== 'hunter' || me.status !== 'active') throw new GameError('forbidden', 'Only hunters can capture', 403);
    const runner = this.player(g, runnerId);
    if (runner.team !== 'runner' || runner.status !== 'active') throw new GameError('invalid', 'That runner is not in play');
    const open = (c: CaptureRecord) => c.status === 'pending' || c.status === 'disputed';
    if (g.captures.some((c) => open(c) && c.runnerId === runnerId)) {
      throw new GameError('duplicate', `A capture of ${runner.name} is already awaiting confirmation`);
    }
    if (g.captures.some((c) => open(c) && c.hunterId === me.id)) {
      throw new GameError('duplicate', 'You already have a capture awaiting confirmation');
    }
    if (!this.captureLimiter.take(`${g.id}:${me.id}`)) throw new GameError('rate_limited', 'Too many capture requests. Wait a moment.');
    const t = this.now();
    const c: CaptureRecord = {
      id: newId(8),
      hunterId: me.id,
      runnerId,
      status: 'pending',
      method: 'request',
      createdAt: t,
      expiresAt: t + CAPTURE_TIMEOUT_MS,
      location: this.hunterLocation(g, me.id),
    };
    g.captures.push(c);
    const who = g.settings.captureMethod === 'host_confirm' ? 'the host' : runner.name;
    this.emit(g, 'capture_requested', `${me.name} claims to have tagged ${runner.name}. Waiting for ${who} to confirm.`, 'hunter', {
      actorId: me.id,
      targetId: runner.id,
    });
    this.commit(g);
  }

  private hunterLocation(g: GameState, hunterId: string | null) {
    if (!hunterId) return undefined;
    const f = this.fixesFor(g.id).get(hunterId);
    if (!f || this.now() - f.fixAt > 60_000 || f.accuracyM > 100) return undefined;
    return { lat: f.lat, lng: f.lng };
  }

  private captureCancel(g: GameState, me: PlayerState, captureId: string) {
    const c = g.captures.find((x) => x.id === captureId);
    if (!c || c.hunterId !== me.id) throw new GameError('not_found', 'Capture not found');
    if (c.status !== 'pending') return;
    c.status = 'cancelled';
    c.resolvedAt = this.now();
    this.commit(g);
  }

  private captureRespond(g: GameState, me: PlayerState, captureId: string, accept: boolean) {
    const c = g.captures.find((x) => x.id === captureId);
    if (!c || c.runnerId !== me.id) throw new GameError('not_found', 'Capture not found');
    this.requireRunning(g);
    if (c.status !== 'pending' && !(c.status === 'disputed' && accept)) {
      throw new GameError('stale', 'This capture request is no longer open');
    }
    if (accept) {
      this.confirmCapture(g, c, me.id);
      return;
    }
    c.status = 'disputed';
    c.expiresAt = Number.MAX_SAFE_INTEGER; // waits for the host
    const hunter = g.players.find((p) => p.id === c.hunterId);
    this.emit(g, 'capture_disputed', `${me.name} disputes the capture by ${hunter?.name ?? 'a hunter'}. The host will decide.`, 'all', {
      actorId: me.id,
    });
    this.commit(g);
  }

  private captureByCode(g: GameState, me: PlayerState, code: string) {
    this.requireHuntingPhase(g);
    if (!g.settings.tagCodeEnabled) throw new GameError('disabled', 'Tag codes are disabled in this game');
    if (me.team !== 'hunter' || me.status !== 'active') throw new GameError('forbidden', 'Only hunters can capture', 403);
    if (!this.tagAttempts.take(`${g.id}:${me.id}`)) throw new GameError('rate_limited', 'Too many attempts. Wait a minute.');
    const runner = g.players.find((p) => p.team === 'runner' && p.status === 'active' && p.tagCode === code);
    if (!runner) throw new GameError('bad_code', 'That tag code does not match any runner still in play');
    const t = this.now();
    const c: CaptureRecord = {
      id: newId(8),
      hunterId: me.id,
      runnerId: runner.id,
      status: 'pending',
      method: 'tag_code',
      createdAt: t,
      expiresAt: t,
      location: this.hunterLocation(g, me.id),
    };
    g.captures.push(c);
    this.confirmCapture(g, c, me.id);
  }

  private resolveCapture(g: GameState, me: PlayerState, captureId: string, confirm: boolean) {
    this.requireRunning(g);
    const c = g.captures.find((x) => x.id === captureId);
    if (!c) throw new GameError('not_found', 'Capture not found');
    if (c.status !== 'pending' && c.status !== 'disputed') throw new GameError('stale', 'This capture is already resolved');
    if (confirm) return this.confirmCapture(g, c, me.id);
    c.status = 'rejected';
    c.resolvedAt = this.now();
    c.resolvedBy = me.id;
    const runner = g.players.find((p) => p.id === c.runnerId);
    this.emit(g, 'capture_rejected', `The host rejected the capture of ${runner?.name ?? 'a runner'}`, 'all');
    this.commit(g);
  }

  private setCaptured(g: GameState, me: PlayerState, playerId: string, captured: boolean) {
    this.requireRunning(g);
    const p = this.player(g, playerId);
    if ((p.startTeam ?? p.team) !== 'runner') throw new GameError('invalid', 'Only runners can be captured');
    if (captured) {
      if (p.status !== 'active' || p.team !== 'runner') throw new GameError('invalid', 'That runner is not in play');
      const t = this.now();
      const c: CaptureRecord = {
        id: newId(8),
        hunterId: null,
        runnerId: p.id,
        status: 'pending',
        method: 'host',
        createdAt: t,
        expiresAt: t,
      };
      g.captures.push(c);
      this.confirmCapture(g, c, me.id);
    } else {
      const converted = p.team === 'hunter' && p.startTeam === 'runner';
      if (p.status !== 'captured' && !converted) throw new GameError('invalid', 'That runner is not captured');
      p.status = 'active';
      p.team = 'runner';
      p.capturedAt = undefined;
      p.capturedBy = undefined;
      for (const c of g.captures) if (c.runnerId === p.id && c.status === 'confirmed') c.status = 'rejected';
      this.emit(g, 'runner_released', `The host released ${p.name} back into the game`, 'all', { targetId: p.id });
      this.commit(g);
    }
  }

  private confirmCapture(g: GameState, c: CaptureRecord, resolvedBy: string) {
    const runner = this.player(g, c.runnerId);
    if (runner.status !== 'active') {
      c.status = 'cancelled';
      c.resolvedAt = this.now();
      this.commit(g);
      throw new GameError('stale', `${runner.name} is no longer in play`);
    }
    const t = this.now();
    c.status = 'confirmed';
    c.resolvedAt = t;
    c.resolvedBy = resolvedBy;
    const infect = g.settings.mode === 'infection';
    runner.capturedAt = t;
    runner.capturedBy = c.hunterId;
    runner.cloakArmed = false;
    if (infect) {
      // Infection: the caught runner keeps playing as a hunter.
      runner.team = 'hunter';
      runner.status = 'active';
    } else {
      runner.status = 'captured';
    }
    // Cancel any other open requests for the same runner.
    for (const o of g.captures) {
      if (o !== c && o.runnerId === runner.id && (o.status === 'pending' || o.status === 'disputed')) {
        o.status = 'cancelled';
        o.resolvedAt = t;
      }
    }
    // Their runner fix is dropped immediately. In classic mode they stop sharing; in
    // infection mode they start sharing again as a hunter (only hunters can see that).
    this.fixesFor(g.id).delete(runner.id);
    if (!infect) this.hooks.send(g.id, runner.id, { type: 'stopSharing', reason: 'You were captured' });
    const hunter = g.players.find((p) => p.id === c.hunterId);
    const how = c.method === 'tag_code' ? ' with their tag code' : c.method === 'host' ? ' (confirmed by host)' : '';
    const tail = infect ? ' and joins the hunters!' : '';
    this.emit(g, 'runner_captured', `${runner.name} was captured${hunter ? ` by ${hunter.name}` : ''}${how}${tail}`, 'all', {
      actorId: hunter?.id,
      targetId: runner.id,
    });
    if (!this.checkWin(g)) this.commit(g);
  }

  /** Ends the game if a win condition is met. Returns true if the game ended. */
  private checkWin(g: GameState): boolean {
    if (g.status !== 'running') return false;
    const comps = this.present(g).filter((p) => p.team === 'runner' || p.team === 'hunter');
    // Judge by starting teams: a runner converted to a hunter (infection) counts as caught.
    const asRunners = g.players.map((p) => {
      const converted = p.startTeam === 'runner' && p.team === 'hunter';
      return { team: converted ? ('runner' as const) : p.team, status: converted ? ('captured' as const) : p.status };
    });
    const allRunners = asRunners.filter((p) => p.team === 'runner' && p.status !== 'kicked');
    if (allRunners.length === 0) {
      this.end(g, 'none', 'No runners remain in the game');
      return true;
    }
    if (!comps.some((p) => p.team === 'hunter')) {
      this.end(g, 'runners', 'All hunters left the game');
      return true;
    }
    const timeUp = elapsedMs(g.clock, this.now()) >= durationMs(g.settings);
    const w = evaluateWinner(asRunners, timeUp);
    if (w === 'hunters') {
      this.end(g, 'hunters', timeUp ? 'Time is up and no runners are free' : 'Every runner has been captured');
      return true;
    }
    if (w === 'runners') {
      const free = g.players.filter((p) => p.team === 'runner' && p.status === 'active').length;
      this.end(g, 'runners', `Time is up — ${free} runner${free === 1 ? '' : 's'} escaped`);
      return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Reveals
  // -------------------------------------------------------------------------

  /** Snapshot every active runner's latest consented fix and reveal to hunters simultaneously. */
  reveal(g: GameState, scheduledElapsed: number, kind: 'scheduled' | 'sweep' = 'scheduled') {
    const t = this.now();
    const fresh = freshThresholdMs(g.settings);
    const stale = Math.max(pingIntervalMs(g.settings), fresh);
    const fixes = this.fixesFor(g.id);
    const entries: RevealEntry[] = [];
    for (const p of g.players) {
      if (p.team !== 'runner' || p.status !== 'active') continue;
      if (p.cloakArmed) {
        // A cloak hides the runner from this one reveal. Hunters are told, never misled.
        p.cloakArmed = false;
        entries.push({ playerId: p.id, status: 'cloaked', reason: 'Used a cloak' });
        continue;
      }
      const f = fixes.get(p.id);
      if (!f) {
        const reason =
          p.gps === 'denied'
            ? 'Location permission denied'
            : p.gps === 'off'
              ? 'Location sharing paused on device'
              : p.gps === 'unavailable'
                ? 'GPS unavailable'
                : 'No GPS fix received';
        entries.push({ playerId: p.id, status: 'missed', reason });
        continue;
      }
      const age = t - f.fixAt;
      if (age > stale) {
        entries.push({ playerId: p.id, status: 'missed', reason: 'Last GPS fix too old' });
        continue;
      }
      entries.push({
        playerId: p.id,
        status: age <= fresh ? 'ok' : 'stale',
        lat: round6(f.lat),
        lng: round6(f.lng),
        accuracyM: Math.round(f.accuracyM),
        fixAt: f.fixAt,
      });
    }
    const seq = g.reveals.length + 1;
    g.reveals.push({ seq, revealedAt: t, elapsedMs: scheduledElapsed, entries, kind });
    if (kind === 'scheduled') g.lastPingElapsed = scheduledElapsed;
    const ok = entries.filter((e) => e.status === 'ok' || e.status === 'stale').length;
    const cloaked = entries.filter((e) => e.status === 'cloaked').length;
    const missed = entries.length - ok - cloaked;
    const parts = [`${ok} runner${ok === 1 ? '' : 's'} revealed`];
    if (cloaked) parts.push(`${cloaked} cloaked`);
    if (missed) parts.push(`${missed} missed`);
    this.emit(g, 'ping_revealed', `${kind === 'sweep' ? 'Radar sweep' : 'Ping'} #${seq}: ${parts.join(', ')}`, 'all');
  }

  // -------------------------------------------------------------------------
  // Tick: the authoritative scheduler. Called every second (and directly in tests).
  // -------------------------------------------------------------------------

  tick() {
    const t = this.now();
    for (const g of [...this.games.values()]) {
      try {
        this.tickGame(g, t);
      } catch (err) {
        console.error('tick error', g.id, err);
      }
    }
  }

  private tickGame(g: GameState, t: number) {
    if (g.status === 'ended') {
      const ended = g.clock.endedAt ?? g.updatedAt;
      if (!g.locationsPurged && t - ended >= this.config.locationRetentionMinutes * 60_000) {
        this.purgeLocations(g);
      }
      if (t - ended >= this.config.gameRetentionHours * 3600_000) this.deleteGame(g);
      return;
    }
    if (t - g.updatedAt > this.config.lobbyIdleHours * 3600_000 && !this.anyConnected(g)) {
      if (g.status === 'lobby') return this.deleteGame(g);
      this.end(g, 'none', 'Abandoned (no activity)');
      return;
    }

    // Disconnect notices (after a grace period so brief network blips stay quiet).
    for (const p of this.present(g)) {
      const key = `${g.id}:${p.id}`;
      if (!this.hooks.isConnected(g.id, p.id) && t - p.lastSeenAt > DISCONNECT_GRACE_MS && !this.disconnectAnnounced.has(key)) {
        this.disconnectAnnounced.add(key);
        this.emit(g, 'player_disconnected', `${p.name} lost connection`, 'all', { actorId: p.id });
        this.hooks.changed(g);
      }
    }

    if (g.status !== 'running') return;
    let dirty = false;

    // Pending capture requests expire.
    for (const c of g.captures) {
      if (c.status === 'pending' && c.expiresAt <= t && g.clock.pausedAt == null) {
        c.status = 'expired';
        c.resolvedAt = t;
        const runner = g.players.find((p) => p.id === c.runnerId);
        this.emit(g, 'capture_rejected', `Capture request for ${runner?.name ?? 'a runner'} expired without confirmation`, 'hunter');
        dirty = true;
      }
    }

    if (g.clock.pausedAt != null) {
      if (dirty) this.commit(g);
      return;
    }

    const el = elapsedMs(g.clock, t);
    const dur = durationMs(g.settings);

    if (!g.headstartAnnounced && el >= headStartMs(g.settings)) {
      g.headstartAnnounced = true;
      this.emit(g, 'headstart_ended', 'Head start is over. Hunters are released!', 'all');
      dirty = true;
    }

    // Final phase: pings come twice as often for the last N minutes.
    const finalStart = this.finalPhaseStart(g);
    if (!g.finalPhaseAnnounced && finalStart != null && el >= finalStart) {
      g.finalPhaseAnnounced = true;
      const fast = this.intervalAt(g, el);
      if (g.nextPingElapsed != null) {
        const pulled = Math.max((g.lastPingElapsed ?? el) + fast, el + pingWarningMs(g.settings));
        if (pulled < g.nextPingElapsed) {
          g.nextPingElapsed = pulled < dur ? pulled : null;
          g.pingRequestedFor = null;
        }
      }
      this.emit(g, 'final_phase', `Final ${g.settings.finalPhaseMin} minutes! Pings now every ${fmtInterval(fast)}.`, 'all');
      dirty = true;
    }

    if (g.nextPingElapsed != null && el < dur) {
      if (el >= g.nextPingElapsed - pingWarningMs(g.settings) && g.pingRequestedFor !== g.nextPingElapsed && el < g.nextPingElapsed) {
        g.pingRequestedFor = g.nextPingElapsed;
        const revealAt = t + (g.nextPingElapsed - el);
        for (const p of g.players) {
          if (p.team === 'runner' && p.status === 'active') this.hooks.send(g.id, p.id, { type: 'pingRequest', revealAt });
        }
        this.emit(g, 'ping_incoming', `Location ping in ${Math.round(pingWarningMs(g.settings) / 1000)} seconds`, 'all');
        dirty = true;
      }
      if (el >= g.nextPingElapsed) {
        const scheduled = g.nextPingElapsed;
        this.reveal(g, scheduled);
        // Skip any slots missed while the server was offline instead of bursting.
        let n = scheduled + this.intervalAt(g, scheduled);
        while (n <= el) n += this.intervalAt(g, n);
        g.nextPingElapsed = n < dur ? n : null;
        dirty = true;
      }
    }

    if (el >= dur) {
      this.checkWin(g);
      return;
    }
    if (dirty) this.commit(g);
  }

  /** Elapsed time at which the final phase begins, or null if disabled. */
  private finalPhaseStart(g: GameState): number | null {
    if (!g.settings.finalPhaseMin) return null;
    return Math.max(0, durationMs(g.settings) - g.settings.finalPhaseMin * 60_000);
  }

  /** Ping interval in effect at a given elapsed time (halved during the final phase). */
  intervalAt(g: GameState, el: number): number {
    const base = pingIntervalMs(g.settings);
    const start = this.finalPhaseStart(g);
    if (start == null || el < start) return base;
    const floor = (this.config.allowFastPings ? LIMITS.pingIntervalSecMin : LIMITS.pingIntervalSecProdMin) * 1000;
    return Math.max(floor, Math.min(base, Math.round(base / 2)));
  }

  private useCloak(g: GameState, me: PlayerState) {
    this.requireRunning(g);
    if (me.team !== 'runner' || me.status !== 'active') throw new GameError('forbidden', 'Only runners still in play can use a cloak', 403);
    if (me.cloakArmed) throw new GameError('duplicate', 'Your cloak is already active for the next ping');
    if (!me.cloaksLeft) throw new GameError('none_left', 'You have no cloaks left');
    me.cloaksLeft -= 1;
    me.cloakArmed = true;
    // The runner team hears about it; hunters only find out at the ping.
    this.emit(g, 'cloak_used', `${me.name} activated a cloak for the next ping`, 'runner', { actorId: me.id });
    this.commit(g);
  }

  private radarSweep(g: GameState, me: PlayerState) {
    this.requireHuntingPhase(g);
    if (me.team !== 'hunter' || me.status !== 'active') throw new GameError('forbidden', 'Only hunters can use a radar sweep', 403);
    if (!g.sweepsLeft) throw new GameError('none_left', 'Your team has no radar sweeps left');
    const el = elapsedMs(g.clock, this.now());
    if (g.nextPingElapsed != null && g.nextPingElapsed - el < 45_000) {
      throw new GameError('too_soon', `A ping is due in ${Math.ceil((g.nextPingElapsed - el) / 1000)}s. Save the sweep for later.`);
    }
    g.sweepsLeft -= 1;
    this.emit(g, 'radar_sweep', `${me.name} fired a radar sweep! Every runner is revealed now.`, 'all', { actorId: me.id });
    this.reveal(g, el, 'sweep');
    this.commit(g);
  }

  private anyConnected(g: GameState) {
    return g.players.some((p) => this.hooks.isConnected(g.id, p.id));
  }

  purgeLocations(g: GameState) {
    for (const r of g.reveals) {
      if (r.purged) continue;
      r.entries = r.entries.map(({ playerId, status, reason }) => ({ playerId, status, reason }));
      r.purged = true;
    }
    for (const c of g.captures) delete c.location;
    g.locationsPurged = true;
    this.commit(g);
  }

  private deleteGame(g: GameState) {
    this.games.delete(g.id);
    this.byCode.delete(g.code);
    this.fixes.delete(g.id);
    this.store.delete(g.id);
    for (const p of g.players) this.hooks.disconnect(g.id, p.id);
  }
}

/** Fill in rules added after a client or saved game was created. */
function withDefaults(s: Partial<GameSettings>): GameSettings {
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) } as GameSettings;
}

function fmtInterval(ms: number) {
  const s = Math.round(ms / 1000);
  return s % 60 === 0 ? `${s / 60} min` : s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

function parse<T extends import('zod').ZodType>(schema: T, raw: unknown): import('zod').output<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue?.path.join('.') || 'input';
    throw new GameError('invalid', `${issue?.message ?? 'Invalid input'} (${path})`);
  }
  return r.data;
}

export type { CreateGameBody, JoinGameBody };
