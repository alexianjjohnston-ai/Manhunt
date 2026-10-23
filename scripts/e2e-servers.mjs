// Starts the two e2e servers (main + Google-keyed) as children and stops them together.
import { spawn } from 'node:child_process';

const base = { ...process.env, NODE_ENV: 'production', DATABASE_PATH: ':memory:', ALLOW_FAST_PINGS: 'true', TRUST_PROXY: 'false', RATE_LIMIT_SCALE: '20' };
const servers = [
  { PORT: '8799', ALLOW_SIMULATION: 'true' },
  { PORT: '8798', GOOGLE_MAPS_API_KEY: 'test-google-key' },
].map((env) =>
  spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'dist/server/main.js'], { env: { ...base, ...env }, stdio: 'inherit' }),
);

const stop = () => {
  for (const s of servers) s.kill('SIGTERM');
  process.exit(0);
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, stop);
for (const s of servers) s.on('exit', (code) => code && stop());
