// One-step game night: installs what's missing, starts MANHUNT, and opens a free public
// HTTPS address (Cloudflare quick tunnel) that phones can use. Stop with Ctrl+C.
//   node scripts/play.mjs              (what the "Start MANHUNT" double-click files run)
//   node scripts/play.mjs --no-tunnel  (this computer / your own tunnel only)
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (existsSync('.env')) process.loadEnvFile('.env');
const port = process.env.PORT || '8787';
const noTunnel = process.argv.includes('--no-tunnel');
const isWin = process.platform === 'win32';
const say = (msg = '') => console.log(msg);

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

// 1. Dependencies (first run only).
if (!existsSync('node_modules/ws') || !existsSync('node_modules/zod')) {
  say('First run: installing MANHUNT (about a minute)...');
  const r = spawnSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { stdio: 'inherit', shell: isWin });
  if (r.status !== 0) fail('Installing failed. Check the internet connection and run this again.');
}

// 2. Cloudflared: use an installed one, else download Cloudflare's official build into ./bin.
const CF_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
function cloudflaredAsset() {
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'arm' ? 'arm' : process.arch === 'ia32' ? '386' : 'amd64';
  if (isWin) return { file: `cloudflared-windows-${arch === 'arm64' ? 'amd64' : arch}.exe`, archive: false };
  if (process.platform === 'darwin') return { file: `cloudflared-darwin-${arch === 'arm64' ? 'arm64' : 'amd64'}.tgz`, archive: true };
  return { file: `cloudflared-linux-${arch}`, archive: false };
}

async function findCloudflared() {
  const local = join(root, 'bin', isWin ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(local)) return local;
  if (spawnSync('cloudflared', ['--version'], { stdio: 'ignore', shell: isWin }).status === 0) return 'cloudflared';
  const { file, archive } = cloudflaredAsset();
  say(`Downloading Cloudflare's tunnel program (${file}, about 40 MB, once)...`);
  const res = await fetch(`${CF_BASE}/${file}`).catch((e) => fail(`Could not download cloudflared: ${e.message}`));
  if (!res.ok) fail(`Could not download cloudflared (HTTP ${res.status}). Install it yourself: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
  mkdirSync('bin', { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  if (archive) {
    const tgz = join('bin', file);
    writeFileSync(tgz, buf);
    const r = spawnSync('tar', ['-xzf', tgz, '-C', 'bin'], { stdio: 'inherit' });
    rmSync(tgz, { force: true });
    if (r.status !== 0 || !existsSync(local)) fail('Could not unpack cloudflared.');
  } else writeFileSync(local, buf);
  if (!isWin) chmodSync(local, 0o755);
  return local;
}

// 3. Start the server and wait until it answers.
const children = [];
function stopAll(code = 0) {
  for (const c of children) if (c.exitCode == null) c.kill();
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stopAll(0));

const server = spawn(process.execPath, ['scripts/serve.mjs'], { stdio: ['ignore', 'pipe', 'inherit'], env: process.env });
children.push(server);
server.stdout.on('data', (d) => process.stdout.write(d));
server.on('exit', (code) => {
  console.error(`\nThe MANHUNT server stopped (code ${code}). Is something else using port ${port}? Set PORT=8788 in .env to use another port.`);
  stopAll(1);
});

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  fail('The server did not start within 30 seconds.');
}
await waitForServer();

function banner(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  say('\n' + '='.repeat(width));
  for (const l of lines) say(`  ${l}`);
  say('='.repeat(width) + '\n');
}

if (noTunnel) {
  banner([`MANHUNT is running: http://localhost:${port}`, 'Phones need an HTTPS address for GPS; run without --no-tunnel to get one.']);
} else {
  // 4. Quick tunnel: a free random https://….trycloudflare.com address, no account needed.
  const cf = await findCloudflared();
  rmSync('game-address.txt', { force: true });
  let address = null;
  const startTunnel = (attempt) => {
    const tunnel = spawn(cf, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(tunnel);
    let log = '';
    const onData = (d) => {
      log = (log + d).slice(-4000);
      // The assigned name is random words joined by hyphens (never Cloudflare's own api. host).
      const m = String(d).match(/https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/);
      if (m && !address) {
        address = m[0];
        writeFileSync('game-address.txt', `${address}\n`);
        banner([
          'MANHUNT is ready. Open this address on your phone:',
          '',
          `    ${address}`,
          '',
          'Create a game there, then friends join with the code or QR in the lobby.',
          'Keep this window open and this computer awake during the game.',
          'The address changes each time you start; it is also saved in game-address.txt.',
          'Stop with Ctrl+C (or close this window).',
        ]);
      }
    };
    tunnel.stdout.on('data', onData);
    tunnel.stderr.on('data', onData);
    tunnel.on('exit', (code) => {
      const last = log.trim().split('\n').slice(-3).join('\n');
      if (!address && attempt < 3) {
        console.error(`\nCould not get a public address yet (attempt ${attempt} of 3). Trying again in 5 seconds...\n${last}`);
        setTimeout(() => startTunnel(attempt + 1), 5000);
        return;
      }
      console.error(`\nThe public address ${address ? 'stopped working' : 'could not be created'} (cloudflared exit code ${code}).\n${last}`);
      console.error(`Check this computer's internet connection, then close this window and start again.`);
      console.error(`MANHUNT itself is still running on http://localhost:${port}`);
    });
  };
  startTunnel(1);
  setTimeout(() => {
    if (!address) console.error('\nStill waiting for Cloudflare to give an address... (check the internet connection)');
  }, 30_000);
}
