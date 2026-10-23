// Builds an installable release archive: release/manhunt-<version>.tar.gz
// It contains the built app, so the target computer only needs Node.js:
//   tar -xzf manhunt-<version>.tar.gz && cd manhunt-<version>
//   npm ci --omit=dev && npm start
// With --test it builds manhunt-<version>-test.tar.gz instead: a ready .env with the testing
// features on (fast pings, simulated GPS) and a slot for the Google Maps key.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const test = process.argv.includes('--test');
const name = `manhunt-${version}${test ? '-test' : ''}`;
const out = join('release', name);

if (!existsSync('dist/server/main.js') || !existsSync('dist/web/index.html')) {
  console.error('Build first: npm run build');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'scripts'), { recursive: true });
for (const d of ['dist/server', 'dist/web']) cpSync(d, join(out, d), { recursive: true, filter: (src) => !src.endsWith('.map') });
for (const f of ['package.json', 'package-lock.json', '.env.example', 'README.md', 'CHANGELOG.md']) cpSync(f, join(out, f));
for (const f of ['serve.mjs', 'check-google.mjs']) cpSync(join('scripts', f), join(out, 'scripts', f));

if (test) {
  writeFileSync(
    join(out, '.env'),
    [
      '# MANHUNT test server settings. See .env.example for every option.',
      '',
      '# Paste your Google Maps Platform browser key here (Map Tiles API + Places API (New)).',
      '# Then run:  npm run check:google',
      'GOOGLE_MAPS_API_KEY=',
      '',
      '# Testing features: pings as often as every 30 s, and simulated GPS (in-game Menu -> Simulate walking).',
      '# Turn these off (false) for real games.',
      'ALLOW_FAST_PINGS=true',
      'ALLOW_SIMULATION=true',
      '',
      'PORT=8787',
      '',
    ].join('\n'),
  );
}

const install = test
  ? [
      `MANHUNT ${version} - TEST VERSION WITH GOOGLE MAPS`,
      '',
      '1. Install Node.js 22 LTS (22.13 or newer): https://nodejs.org',
      '2. In this folder run:   npm ci --omit=dev',
      '3. Get a Google Maps key (README, section "Google Maps"):',
      '   - Google Cloud console -> enable "Map Tiles API" and "Places API (New)"',
      '   - Create an API key; restrict it to those two APIs',
      '   - Website restriction: http://localhost:8787/* plus your tunnel address, e.g. https://xyz.trycloudflare.com/*',
      '4. Open the file .env in this folder and paste the key after GOOGLE_MAPS_API_KEY=',
      '5. Check the key:        npm run check:google',
      '   (with a website restriction add:  -- --referer http://localhost:8787/)',
      '6. Start the server:     npm start',
      '7. Open http://localhost:8787 -> Settings -> Maps -> "Check Google Maps".',
      '   It should say "Google Maps"; the welcome screen shows a "Test server" label.',
      '8. Phones need HTTPS:    cloudflared tunnel --url http://localhost:8787',
      '',
      'Solo test: Create game -> "Quick chase" preset -> Advanced -> ping every 30s. Join the game',
      'from a private/incognito window (or a second browser) so there are 2 players, start it,',
      'then in-game Menu -> "Simulate walking" moves the runner around the Google map.',
      '',
    ]
  : [
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
  ];
writeFileSync(join(out, 'INSTALL.txt'), install.join('\n'));

const archive = join('release', `${name}.tar.gz`);
rmSync(archive, { force: true });
execFileSync('tar', ['-czf', archive, '-C', 'release', name], { stdio: 'inherit' });
console.log(`Created ${archive}`);
