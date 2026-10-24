// Builds an installable release archive: release/manhunt-<version>.tar.gz
// It contains the built app, so the target computer only needs Node.js:
//   tar -xzf manhunt-<version>.tar.gz && cd manhunt-<version>
//   npm ci --omit=dev && npm start
// With --test it builds manhunt-<version>-test.tar.gz instead: a ready .env with the testing
// features on (fast pings, simulated GPS) and a slot for the Google Maps key.
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
for (const f of ['serve.mjs', 'play.mjs', 'check-google.mjs']) cpSync(join('scripts', f), join(out, 'scripts', f));
for (const f of ['Start MANHUNT (Windows).bat', 'Start MANHUNT (Mac).command']) cpSync(f, join(out, f));
chmodSync(join(out, 'Start MANHUNT (Mac).command'), 0o755);

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
      '6. Start it: double-click "Start MANHUNT (Windows).bat" or "Start MANHUNT (Mac).command"',
      '   (or run: npm run play). It prints the https address for phones.',
      '7. Open http://localhost:8787 -> Settings -> Maps -> "Check Google Maps".',
      '   It should say "Google Maps"; the welcome screen shows a "Test server" label.',
      '',
      'Solo test: Create game -> "Quick chase" preset -> Advanced -> ping every 30s. Join the game',
      'from a private/incognito window (or a second browser) so there are 2 players, start it,',
      'then in-game Menu -> "Simulate walking" moves the runner around the Google map.',
      '',
    ]
  : [
      `MANHUNT ${version} - START HERE`,
      '',
      'ONCE',
      '1. Install Node.js (the LTS version) from https://nodejs.org',
      '',
      'EVERY GAME NIGHT',
      '2. Double-click "Start MANHUNT (Windows).bat"  (Windows)',
      '            or "Start MANHUNT (Mac).command"   (Mac: right-click -> Open the first time)',
      '   The first start installs everything and downloads Cloudflare\'s free tunnel program.',
      '   If Windows says "Windows protected your PC": More info -> Run anyway.',
      '   If Windows asks whether Node.js may use the network: Allow (or Cancel; both work).',
      '3. A box appears with an address like https://some-random-words.trycloudflare.com',
      '   Open it on YOUR phone, tap "Create game", pick a preset and the play area.',
      '4. Friends join with the code, or scan the QR in the lobby. No app, no accounts.',
      '5. Keep the window open and the computer awake and online until the game ends.',
      '   (Windows: Settings -> System -> Power -> Screen and sleep -> Never while plugged in.)',
      '',
      'BEFORE YOU GO OUT',
      '- Everyone: allow location for the site, turn on "Keep screen awake", charge your phone.',
      '- Keep MANHUNT open on screen: phones stop sharing GPS when locked or in the background.',
      '- Hunters who drive: the driver never touches the phone. Obey traffic laws. Stay off private',
      '  property. Anyone can hit the emergency stop.',
      '',
      'Maps: free OpenStreetMap by default. For Google Maps put a key in .env (README, "Google Maps").',
      'Problems: README.md, section "Troubleshooting".',
      '',
    ];
writeFileSync(join(out, 'START HERE.txt'), install.join('\r\n'));

const archive = join('release', `${name}.tar.gz`);
rmSync(archive, { force: true });
execFileSync('tar', ['-czf', archive, '-C', 'release', name], { stdio: 'inherit' });
console.log(`Created ${archive}`);
// A .zip too: it opens with a double-click on Windows and macOS.
const zip = join('release', `${name}.zip`);
rmSync(zip, { force: true });
try {
  execFileSync('zip', ['-qr', '-X', `${name}.zip`, name], { cwd: 'release', stdio: 'inherit' });
  console.log(`Created ${zip}`);
} catch {
  console.log('(zip not installed: skipped the .zip)');
}
