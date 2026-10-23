export interface ServerConfig {
  port: number;
  host: string;
  production: boolean;
  databasePath: string;
  staticDir: string | null;
  trustProxy: boolean;
  /** Allow ping intervals below 60 s (testing / simulation only). */
  allowFastPings: boolean;
  /** Allow devices to send simulated GPS (clearly flagged in the UI). */
  allowSimulation: boolean;
  locationRetentionMinutes: number;
  gameRetentionHours: number;
  lobbyIdleHours: number;
  publicOrigin: string | null;
  /** Multiplies REST rate-limit capacities (raise only for automated testing). */
  rateLimitScale: number;
  /** Browser key for Google Maps Platform (Map Tiles API + Places API). Optional. */
  googleMapsApiKey: string | null;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === 'production';
  return {
    port: num(env.PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    production,
    databasePath: env.DATABASE_PATH ?? (production ? '/data/manhunt.db' : './data/manhunt.db'),
    staticDir: env.STATIC_DIR ?? (production ? './dist/web' : null),
    trustProxy: bool(env.TRUST_PROXY, production),
    allowFastPings: bool(env.ALLOW_FAST_PINGS, !production),
    allowSimulation: bool(env.ALLOW_SIMULATION, !production),
    locationRetentionMinutes: num(env.LOCATION_RETENTION_MINUTES, 60),
    gameRetentionHours: num(env.GAME_RETENTION_HOURS, 24),
    lobbyIdleHours: num(env.LOBBY_IDLE_HOURS, 12),
    publicOrigin: env.PUBLIC_ORIGIN ?? null,
    rateLimitScale: Math.max(1, num(env.RATE_LIMIT_SCALE, 1)),
    googleMapsApiKey: env.GOOGLE_MAPS_API_KEY?.trim() || null,
  };
}
