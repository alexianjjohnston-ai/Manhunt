// Checks that the Google Maps key in .env works for MANHUNT, and explains problems in plain words.
//   npm run check:google
//   npm run check:google -- --referer https://your-address.example/
// The referer must match what phones will use when the key is restricted by website.
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const refIdx = args.indexOf('--referer');
const referer = refIdx >= 0 ? args[refIdx + 1] : process.env.PUBLIC_ORIGIN?.split(',')[0]?.trim();
const key = (process.env.GOOGLE_MAPS_API_KEY ?? '').trim();
// Overridable for tests only.
const TILE = process.env.GOOGLE_TILE_BASE ?? 'https://tile.googleapis.com';
const PLACES = process.env.GOOGLE_PLACES_BASE ?? 'https://places.googleapis.com';

const ok = (msg) => console.log(`  OK    ${msg}`);
const bad = (msg, help) => {
  console.log(`  FAIL  ${msg}`);
  for (const line of help) console.log(`        ${line}`);
};

if (!key || key === 'paste-your-key-here') {
  console.log('No Google Maps key found.');
  console.log('Put it in the .env file next to package.json:  GOOGLE_MAPS_API_KEY=your-key');
  console.log('Without a key MANHUNT still works and uses OpenStreetMap maps.');
  process.exit(1);
}

console.log(`Checking Google Maps key ${key.slice(0, 6)}…${key.slice(-4)}${referer ? ` as site ${referer}` : ''}\n`);

const headers = (extra = {}) => ({ ...(referer ? { Referer: referer.endsWith('/') ? referer : `${referer}/` } : {}), ...extra });

/** Turn a Google error response into a short explanation and what to do about it. */
async function explain(res, apiName) {
  let body = {};
  try {
    body = await res.json();
  } catch {}
  const err = body.error ?? {};
  const text = `${err.status ?? ''} ${err.message ?? ''} ${JSON.stringify(err.details ?? [])}`;
  const has = (s) => text.includes(s);
  const link = 'https://console.cloud.google.com/google/maps-apis/credentials';
  if (has('API_KEY_INVALID') || has('API key not valid'))
    return ['The key is not valid. Check that you copied all of it, with no spaces.', link];
  if (has('REFERRER_BLOCKED') || has('referer'))
    return [
      'The key is restricted to other websites.',
      'In Google Cloud, under "Website restrictions", add the address phones use, e.g. https://your-address.example/*',
      referer ? `This check sent ${referer}` : 'Re-run with:  npm run check:google -- --referer https://your-address.example/',
      link,
    ];
  if (has('API_KEY_SERVICE_BLOCKED') || has('are blocked'))
    return [`The key is not allowed to use the ${apiName}. Add it under "API restrictions" for this key.`, link];
  if (has('SERVICE_DISABLED') || has('has not been used') || has('is disabled'))
    return [`The ${apiName} is not turned on for your Google Cloud project. Enable it here:`, 'https://console.cloud.google.com/google/maps-apis/api-list'];
  if (has('BILLING') || has('billing'))
    return ['Google requires a billing account on the project (there is a free monthly allowance).', 'https://console.cloud.google.com/billing'];
  if (res.status === 429 || has('RESOURCE_EXHAUSTED'))
    return ['Quota used up or too many requests. Wait a minute or raise the quota in Google Cloud.'];
  return [`Google answered ${res.status}: ${err.message ?? 'no details'}`];
}

let failures = 0;
async function step(name, apiName, fn) {
  try {
    const result = await fn();
    if (result.ok) ok(name);
    else {
      failures++;
      bad(name, result.help ?? (await explain(result.res, apiName)));
    }
    return result;
  } catch (e) {
    failures++;
    bad(name, ['Could not reach Google. Check this computer\'s internet connection.', String(e?.cause?.message ?? e?.message ?? e)]);
    return { ok: false };
  }
}

// 1. Map Tiles API: session, then one tile.
const session = await step('Map Tiles API: start a map session', 'Map Tiles API', async () => {
  const res = await fetch(`${TILE}/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'US' }),
  });
  if (!res.ok) return { ok: false, res };
  const json = await res.json();
  return json.session ? { ok: true, session: json.session } : { ok: false, help: ['Google answered without a session id.'] };
});

if (session.ok) {
  await step('Map Tiles API: download a map tile', 'Map Tiles API', async () => {
    const res = await fetch(`${TILE}/v1/2dtiles/0/0/0?session=${encodeURIComponent(session.session)}&key=${encodeURIComponent(key)}`, { headers: headers() });
    if (!res.ok) return { ok: false, res };
    const type = res.headers.get('content-type') ?? '';
    return type.startsWith('image/') ? { ok: true } : { ok: false, help: [`Expected an image, got ${type || 'nothing'}.`] };
  });
}

// 2. Places API (New): search for a place (used to pick the play area).
await step('Places API (New): search for a place', 'Places API (New)', async () => {
  const res = await fetch(`${PLACES}/v1/places:autocomplete`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', 'X-Goog-Api-Key': key }),
    body: JSON.stringify({ input: 'Central Park' }),
  });
  return res.ok ? { ok: true } : { ok: false, res };
});

console.log('');
if (failures === 0) {
  console.log('All good. Start MANHUNT and the maps will come from Google.');
} else {
  console.log(`${failures} check(s) failed. MANHUNT still runs; maps fall back to OpenStreetMap until this is fixed.`);
  console.log('Changes in Google Cloud can take a few minutes to apply.');
  process.exit(1);
}
