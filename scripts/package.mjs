// Builds an installable release archive: release/manhunt-<version>.tar.gz
// It contains the built app, so the target computer only needs Node.js:
//   tar -xzf manhunt-<version>.tar.gz && cd manhunt-<version>
//   npm ci --omit=dev && npm start
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const name = `manhunt-${version}`;
const out = join('release', name);

if (!existsSync('dist/server/main.js') || !existsSync('dist/web/index.html')) {
  console.error('Build first: npm run build');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'scripts'), { recursive: true });
for (const d of ['dist/server', 'dist/web']) cpSync(d, join(out, d), { recursive: true, filter: (src) => !src.endsWith('.map') });
for (const f of ['package.json', 'package-lock.json', '.env.example', 'README.md', 'CHANGELOG.md']) cpSync(f, join(out, f));
cpSync('scripts/serve.mjs', join(out, 'scripts/serve.mjs'));
writeFileSync(
  join(out, 'INSTALL.txt'),
  [
    `MANHUNT ${version}`,
    '',
    '1. Install Node.js 22 LTS (22.13 or newer): https://nodejs.org',
    '2. In this folder run:   npm ci --omit=dev',
    '3. Optional: copy .env.example to .env and edit it (Google Maps key, port, ...)',
    '4. Start the server:     npm start',
    '5. Give phones an HTTPS address, e.g.:  cloudflared tunnel --url http://localhost:8787',
    '',
    'Full guide: README.md, section "Host it on your own computer".',
    '',
  ].join('\n'),
);

const archive = join('release', `${name}.tar.gz`);
rmSync(archive, { force: true });
execFileSync('tar', ['-czf', archive, '-C', 'release', name], { stdio: 'inherit' });
console.log(`Created ${archive}`);
