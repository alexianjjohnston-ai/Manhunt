// Production launcher for running MANHUNT on your own computer (Windows, macOS, Linux).
//   npm install && npm run build   (once, and after every update)
//   npm start
// Settings come from a `.env` file next to package.json (see .env.example); the
// defaults below suit a home PC behind an HTTPS tunnel such as Cloudflare Tunnel.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`MANHUNT needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the LTS from https://nodejs.org`);
  process.exit(1);
}

if (existsSync('.env')) process.loadEnvFile('.env');

const defaults = {
  NODE_ENV: 'production',
  PORT: '8787',
  HOST: '0.0.0.0',
  DATABASE_PATH: join(root, 'data', 'manhunt.db'),
  STATIC_DIR: join(root, 'dist', 'web'),
  // Tunnels (cloudflared, Tailscale, ngrok) connect from this machine and pass the
  // player's real address in a header, which rate limiting needs.
  TRUST_PROXY: 'true',
};
for (const [k, v] of Object.entries(defaults)) if (!process.env[k]) process.env[k] = v;

if (!existsSync('dist/server/main.js') || !existsSync('dist/web/index.html')) {
  console.error('No build found. Run `npm install` and `npm run build` first.');
  process.exit(1);
}

process.removeAllListeners('warning'); // hide Node's "SQLite is experimental" notice
await import(pathToFileURL(join(root, 'dist/server/main.js')).href);
console.log(`Open http://localhost:${process.env.PORT} on this computer. Phones need your HTTPS tunnel address (see README: "Host it on your own computer").`);
