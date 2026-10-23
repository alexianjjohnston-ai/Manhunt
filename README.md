# MANHUNT

**Version 1.0.0**. See [CHANGELOG.md](CHANGELOG.md).

A private, real-world Manhunt game you play in your phone's browser. There's no App Store and no accounts.

- **Runners** travel on foot and try to stay free until the clock hits zero.
- **Hunters** may drive (passengers only on the phone) and must catch every runner.
- At every **ping**, 5 minutes by default, the server snapshots the location of every free runner. It reveals the snapshot to all hunters at the same moment. Between pings, hunters see nothing new.

Games are private: you need the 6-character join code or the invite link (plus an optional password). There's no public game list.

---

## Contents

1. [Features](#features)
2. [Quick start (local)](#quick-start-local)
3. [Playing on real phones during development](#playing-on-real-phones-during-development)
4. [Scripts](#scripts)
5. [Testing](#testing)
6. [Simulation mode](#simulation-mode)
7. [Architecture](#architecture)
8. [Configuration (environment variables)](#configuration)
9. [Deployment](#deployment)
10. [HTTPS & geolocation requirements](#https--geolocation-requirements)
11. [Mobile browser limitations (read this)](#mobile-browser-limitations)
12. [Privacy & data retention](#privacy--data-retention)
13. [Security model](#security-model)
14. [Costs](#costs)
15. [Troubleshooting](#troubleshooting)

---

## Features

| Area | What's included |
|---|---|
| Lobby | Create game wizard (name, max players, duration, ping interval, head start, play area, team mode, odd-player rule, capture method, tag codes, teammate visibility, spectators, password, safety acknowledgement). Join by code or invite link, with a game preview. Share via QR or link. Auto-balanced teams (50/50, extra player to the team you choose) or host-assigned teams. Ready states and lobby lock. |
| Pings | Server-authoritative schedule. Runners get a "ping incoming" request for a fresh fix. Each reveal is a simultaneous snapshot classed as **ok** (fresh), **stale** (old fix, clearly labelled) or **missed** (no fix; nothing invented). Every marker shows its age and accuracy. Markers never move between pings. |
| Map | Full-screen MapLibre map on OpenStreetMap tiles. Dark, daylight and satellite styles. Custom markers that use shape and icon as well as colour (diamond = runner, triangle = hunter). Accuracy circles, a darkened area outside the boundary, a radar pulse on reveals, edge and out-of-bounds warnings, and a recentre button. |
| Captures | The hunter requests and the runner confirms on their own phone, with a 90 s timeout. Disputes go to the host. Optional *instant tag code*: a secret 4-digit code or QR the runner shows in person. Host-confirm mode and manual capture/release are also available. GPS proximity never captures anyone. |
| Host dashboard | Pause/resume, end with or without a winner, announcements, in-game adjustments (duration, interval, visibility, capture mode, play area), kick, host transfer, capture decisions, per-player connection and GPS health (no coordinates), anti-cheat hints and an event log. |
| Safety | Mandatory safety acknowledgement. An emergency stop any player can trigger, which pauses play and turns off sharing for everyone. Driving lock for hunters: it triggers automatically at vehicle speed or manually, and mutes alerts. Hold-to-confirm on destructive actions. Rules and privacy screens. |
| Results | Winner, time played, pings, captures, escapees, ping-by-ping replay map, capture timeline, top hunter, and a rematch with the same players. |
| Reliability | Reconnecting sockets with backoff, fast resume when the tab or network comes back, the same identity after a refresh (no duplicate players), state persisted to SQLite (survives restarts), and recovery when GPS stalls. |
| PWA & UX | Installable manifest and app-shell service worker, wake lock, sounds and haptics, reduced motion, larger text, metric/imperial, and safe-area insets. |
| Testing | 71 unit and integration tests, 8 Playwright end-to-end scenarios on both iPhone 14 and Pixel 7 viewports (16 runs), and a bot simulation mode. |

## Game rules

The host picks a preset (**Quick chase**, **Classic**, **Infection** or **Long game**), and everything is adjustable under *Advanced rules*:

| Rule | What it does |
|---|---|
| Pings | Every interval, hunters see each free runner's last position, at the same moment for everyone. |
| Final phase | For the last N minutes, pings come twice as often (never below the server's minimum interval). |
| Cloak (runners) | Hold *Cloak* to hide from the next ping, whether scheduled or a sweep. Hunters see "Cloaked at #4" with the last real position. MANHUNT never shows a fake location. |
| Radar sweep (hunters) | The hunter team shares a few extra pings on demand. They aren't allowed during the head start or within 45 s of a scheduled ping. |
| Infection mode | Caught runners switch to the hunters and keep playing. Hunters win when nobody is left running. |
| Rematch | The host can start a rematch with the same teams or swapped. |
| Results | Runners are ranked by time survived; the top hunter is shown. |

## Quick start (local)

Requirements: **Node.js 22.13+** (the server uses the built-in `node:sqlite`) and npm.

```bash
npm install
npm run dev
```

This starts:
- the **game server** on <http://localhost:8787> (tsx watch);
- the **Vite dev server** on <http://localhost:5173>, which proxies `/api` and `/ws` to the game server.

Open <http://localhost:5173>. To try a game alone, open more browser profiles or private windows. Each needs its own player, because sessions are stored per browser.

Development defaults (`NODE_ENV` ≠ `production`) allow **fast pings** (15 s and up) and **simulated GPS**. In-game, open **Menu → Test mode: simulated GPS** to make a desktop browser "walk".

## Playing on real phones during development

Browsers only grant location on **HTTPS** (or `localhost`), so a phone can't use `http://192.168.x.x:5173`. Two simple options:

1. **Tunnel**: run `npm run build && npm start` and expose port 8787 with an HTTPS tunnel, such as `cloudflared tunnel --url http://localhost:8787` or `ngrok http 8787`. Open the HTTPS URL on your phones.
2. **Deploy a test instance** (see [Deployment](#deployment)). It takes about 5 minutes.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server and client with hot reload |
| `npm run build` | Builds the client into `dist/web` and bundles the server into `dist/server/main.js` |
| `npm start` | Runs the production build on this machine (Windows/macOS/Linux; reads `.env`) |
| `npm run typecheck` | TypeScript, strict, whole repo |
| `npm test` | Vitest unit and integration tests |
| `npm run test:e2e` | Playwright mobile end-to-end tests (builds and starts its own server on :8799) |
| `npm run package` | Builds `release/manhunt-<version>.tar.gz`: the built app, ready to install with `npm ci --omit=dev && npm start` |
| `npm run simulate` | Bot simulation against a running server (see below) |
| `npm run icons` | Re-renders PNG app icons from `web/public/icons/icon.svg` |

## Testing

```bash
npm run typecheck
npm test          # 71 tests
npm run test:e2e  # 8 scenarios × 2 devices (iPhone 14 + Pixel 7 emulation)
```

**Unit tests** (`tests/unit`) drive the engine with a fake clock. They cover:
- room creation and joining (codes, password, full, locked, duplicate names, spectators)
- team balancing and the odd-player rule
- reconnection without duplicates
- restart recovery from SQLite
- host-only permissions and host transfer
- server-authoritative timers, pause and resume
- the 5-minute reveal schedule
- ping-incoming requests and catch-up after downtime
- no premature or live runner coordinates for hunters
- no hunter coordinates for runners
- teammate visibility settings
- missing, stale and too-old GPS
- device-reported fix age
- opting out of location sharing
- anti-cheat warnings (host-only, never penalties)
- the capture flow, including authorization, disputes, duplicates and double-confirm races, expiry and tag codes
- win conditions
- termination, emergency stop and the retention purge
- rematch
- cross-game isolation

**Integration tests** (`tests/integration`) start the real HTTP and WebSocket server and play a full game over sockets. They also cover:
- unauthenticated and cross-game socket rejection
- security headers
- input validation
- join rate limiting

**End-to-end tests** (`tests/e2e`) run real browsers with emulated phones and GPS. They cover:
- the setup wizard
- a full three-player game with a timed reveal and capture
- inspection of raw WebSocket frames, proving that hunters receive runner coordinates only after a reveal and that runners never receive hunter coordinates
- reconnecting after a refresh
- kicking a player
- emergency stop pausing play and halting sharing for everyone until the host resumes
- a disputed capture resolved by the host
- map style switching with the offline fallback
- no horizontal overflow on any screen

Real-device testing is still recommended before a big game. Use [the tunnel](#playing-on-real-phones-during-development) and check:
- the GPS chip turns green;
- the ping countdown matches across phones;
- locking a runner's phone produces a "missed ping".

## Simulation mode

Simulation is for development and testing only. Bots and simulated GPS are rejected by servers where `ALLOW_SIMULATION` is off, which is the production default.

```bash
npm run dev:server                                   # terminal 1
npm run simulate -- --players 6 --interval 30        # terminal 2
# options: --url --players --interval --duration --wait --lat --lng --speedup
```

The script:
1. creates a game with a bot host and prints the join code (use `--wait 60` to join as a human);
2. lets bots balance into teams and start;
3. walks runners on foot while hunters head for the latest reveal;
4. tags runners when bots get within 15 m (mixing confirm requests and tag codes); runners sometimes dispute, and the host bot decides;
5. prints the event stream until the game ends.

## Architecture

The full plan is in [`PLAN.md`](PLAN.md) and progress is in [`TASKS.md`](TASKS.md).

```
shared/   types, zod protocol, pure rules (clock, geo, teams, win)
server/   app.ts (HTTP + static + upgrade), hub.ts (WebSocket), engine.ts (authoritative game),
          projection.ts (per-player view — the only path from state to clients), store.ts (SQLite)
web/src/  React app: screens/, components/ (ui kit, map), lib/ (socket, location, prefs…)
scripts/  simulate.ts, make-icons.ts
tests/    unit, integration, e2e
```

- **One Node process** holds authoritative state in memory. It writes each game to SQLite as a JSON row after every change, and a 1 s tick drives head starts, ping requests, reveals, capture expiry, game end and retention.
- **Clients render projections.** After every change, each connected player receives `project(game, playerId)`. This view is built from scratch for that player's team, status and host role. There's no generic "broadcast state" path that could leak coordinates.
- **Time** is a server-clock offset measured from WebSocket ping/pong. Every countdown derives from server timestamps, so changing a phone's clock does nothing.
- **Why not Vercel and Supabase?** The reveal scheduler and per-role location filtering need a long-lived, stateful process. Serverless functions can't hold WebSockets or timers, and doing the same thing with Postgres RLS and cron is more complex and harder to test. This stack runs entirely locally and deploys as one small container.

### Database & migrations

- SQLite (`node:sqlite`, no native build) with a single `games` table. The schema is created on boot.
- **Table changes:** bump `SCHEMA_VERSION` in `server/store.ts` and add a migration step. It is tracked with `PRAGMA user_version`.
- **Game-state JSON changes:** bump `GameState.v` and upgrade old rows in `GameStore.loadAll`.
- Backups are optional; the data is short-lived by design. If you want them, copy the `.db` file, or use `sqlite3 manhunt.db ".backup x.db"`.

## Configuration

All settings are optional. See [`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | — | `production` turns on HSTS and secure defaults, and turns off test features |
| `DATABASE_PATH` | `./data/manhunt.db` (prod: `/data/manhunt.db`) | SQLite file; use a persistent volume |
| `STATIC_DIR` | prod: `./dist/web` | Built client to serve |
| `TRUST_PROXY` | prod: `true` | Use `Fly-Client-IP` / `X-Forwarded-For` for rate limiting. Set `false` if not behind a proxy |
| `PUBLIC_ORIGIN` | — | Comma-separated allowed WebSocket `Origin`s, e.g. `https://manhunt.example.com` (recommended) |
| `LOCATION_RETENTION_MINUTES` | `60` | Reveal coordinates are wiped this long after a game ends |
| `GAME_RETENTION_HOURS` | `24` | Ended games are deleted after this |
| `LOBBY_IDLE_HOURS` | `12` | Idle lobbies are deleted, and idle running games are ended |
| `ALLOW_FAST_PINGS` | dev `true`, prod `false` | Allow ping intervals below 60 s |
| `ALLOW_SIMULATION` | dev `true`, prod `false` | Accept simulated GPS from devices or bots |
| `RATE_LIMIT_SCALE` | `1` | Multiplies REST rate limits (testing only) |
| `GOOGLE_MAPS_API_KEY` | — | Optional browser key for **Google Maps** tiles and place search (see below). Without it, OpenStreetMap tiles are used |
| `VITE_MAP_STYLE_DARK` / `VITE_MAP_STYLE_LIGHT` | OpenFreeMap `dark` / `liberty` | MapLibre style URLs (set at **build** time) |
| `VITE_SATELLITE_TILES` / `VITE_SATELLITE_ATTRIBUTION` | Esri World Imagery | Satellite raster template (build time) |

There are no secret keys. Player tokens are random values generated per game, and the server stores only their hashes.

## Host it on your own computer

A Windows, Mac or Linux PC is enough for games with friends. The PC runs the server, and a free tunnel gives it the HTTPS address that phones need for location. You don't need router port forwarding.

### 1. One-time setup

Install **Node.js 22 LTS** (22.13 or newer) from <https://nodejs.org>. On Windows, run the commands below in PowerShell. Then choose one of these:

**A. From a release archive** (no build tools needed). On a computer with the code, run `npm run package` to create `release/manhunt-<version>.tar.gz`. Copy it to the host PC, then:
```bash
tar -xzf manhunt-1.0.0.tar.gz
cd manhunt-1.0.0
npm ci --omit=dev
```

**B. From source:**

```bash
git clone https://github.com/alexianjjohnston-ai/Manhunt.git
cd Manhunt
npm install
npm run build
```

Optional: copy `.env.example` to `.env` and fill in what you need, for example `GOOGLE_MAPS_API_KEY=…`.

### 2. Start the server

```bash
npm start
```

Open <http://localhost:8787> on the PC to check it works. Games are stored in `data/manhunt.db`, so they survive a restart. Press Ctrl+C to stop.

### 3. Give phones an HTTPS address

Phones refuse to share location with plain `http://` addresses, including `http://192.168.x.x`. Pick one tunnel:

| Option | Address | How |
|---|---|---|
| **Cloudflare quick tunnel** (easiest) | random `https://….trycloudflare.com`, new each time | Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), then run `cloudflared tunnel --url http://localhost:8787` and share the printed address. |
| **Cloudflare named tunnel** | your own domain, e.g. `https://manhunt.example.com`, stays the same | Needs a domain on Cloudflare (free plan). Follow Cloudflare's "Create a tunnel" guide and point it at `http://localhost:8787`. |
| **Tailscale Funnel** | `https://your-pc.your-tailnet.ts.net`, stays the same | Install Tailscale, then run `tailscale funnel 8787`. |

Once you have a stable address:
- Add it to `.env` as `PUBLIC_ORIGIN=https://your-address` (this only allows the game connection from your own site).
- If you use Google Maps, restrict your key to that address.

A quick tunnel's address changes every run, so leave `PUBLIC_ORIGIN` unset and the Google key unrestricted while testing with one. Switch to a stable address for regular games.

### 4. During a game

- Keep the PC **awake and online** for the whole game. Turn off sleep while hosting (Windows: Settings → System → Power; macOS: System Settings → Energy, or run `caffeinate -i npm start`). Prefer a wired or strong Wi-Fi connection.
- If the PC or tunnel drops briefly, phones reconnect automatically and the game resumes.
- **To update:** run `git pull`, `npm install` and `npm run build`, then `npm start` again.

`npm start` defaults to production settings (fast test pings and simulated GPS are off) and trusts the tunnel's forwarded IP header for rate limiting. Every setting in the table below can go in `.env`.

## Deployment

You need one always-on container with **HTTPS**, **WebSockets** and a small **persistent volume**. Run exactly **one instance**, because game timers live in the process.

### Fly.io (recommended)

```bash
fly launch --copy-config --no-deploy      # choose a unique app name and region
fly volumes create manhunt_data --size 1 # same region as the app
fly secrets set PUBLIC_ORIGIN=https://<your-app>.fly.dev
fly deploy
```

`fly.toml` keeps one machine running (`auto_stop_machines = "off"`) and forces HTTPS. You get `https://<app>.fly.dev`; you can add a custom domain with `fly certs add`.

### Railway / Render / any Docker host

- Build with the included `Dockerfile` (Node 22, non-root user, healthcheck on `/api/health`).
- Mount a volume at `/data`.
- Expose port `8080`.
- Set `PUBLIC_ORIGIN` to your HTTPS URL.
- Make sure the platform supports WebSockets, and that it doesn't sleep the service or scale it to more than one instance.

### Plain VPS

Then put **Caddy** in front for automatic HTTPS:

```bash
npm ci && npm run build
NODE_ENV=production DATABASE_PATH=/var/lib/manhunt/manhunt.db PORT=8787 npm start
```

```
# Caddyfile
manhunt.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

Run it with systemd or pm2, and set `TRUST_PROXY=true` and `PUBLIC_ORIGIN=https://manhunt.example.com`.

### Google Maps (recommended for the best map data)

With `GOOGLE_MAPS_API_KEY` set, MANHUNT uses:
- **Map Tiles API** (2D tiles): Google's roadmap (shown in a dark, muted style during the game), light roadmap, and satellite imagery with labels. The tiles are rendered inside MapLibre, so all of MANHUNT's markers, the play-area boundary and the accuracy circles work unchanged. Google's name and the data copyright for the visible area are shown on the map, as the terms require.
- **Places API (New)**: the "Search a park, address or landmark" box when setting the play area. Picking a result centres the play area there and sizes it to the place.

If Google refuses a request (bad key, quota, billing), the map falls back to OpenStreetMap automatically.

Setup:
1. In Google Cloud, create a project, enable billing, and enable **Map Tiles API** and **Places API (New)**.
2. Create an API key. Restrict it:
   - **Application restriction:** websites (HTTP referrers), set to `https://your-domain/*`. MANHUNT sends only its origin as the referrer (`Referrer-Policy: strict-origin`), never the invite path.
   - **API restriction:** Map Tiles API and Places API (New) only.
3. Set `GOOGLE_MAPS_API_KEY` on the server, e.g. `fly secrets set GOOGLE_MAPS_API_KEY=…`, and restart. No rebuild is needed: the client reads the key from `/api/config`.

The key is a *browser* key. It appears in tile URLs by design, which is why the referrer and API restrictions matter. Google bills per tile and per search request, with a monthly free usage allowance per product; check Google's current pricing page and set a budget alert. Tile sessions are cached on each phone for up to two weeks to keep requests down.

### Map tiles in production

The default basemaps use [OpenFreeMap](https://openfreemap.org), which is free, needs no key, and uses OpenStreetMap data. Attribution is shown on the map. The satellite option defaults to Esri World Imagery, which is fine for light personal use; check Esri's terms or point `VITE_SATELLITE_TILES` at a provider you have access to (MapTiler, Mapbox and others). If tiles fail to load, the map falls back to a plain background, and markers, boundary and accuracy circles still render.

## HTTPS & geolocation requirements

- The Geolocation API, Wake Lock and the camera (for QR scanning) work only in a **secure context** (HTTPS or `localhost`).
- Each player grants location permission in their browser. The lobby walks them through it, and explains how to re-enable it if they denied it:
  - Safari: **aA › Website Settings**
  - Chrome: **lock icon › Permissions**
- The server sends `Permissions-Policy: geolocation=(self)`, so no embedded third-party frame can ask for location.

## Mobile browser limitations

These are real platform limits, and MANHUNT is designed around them honestly:

| Situation | What happens | What MANHUNT does |
|---|---|---|
| iOS Safari, screen locked or app switched | GPS stops entirely (also when "installed" to the home screen) | Tells players to keep the screen on. Optional **Keep screen awake** (Wake Lock, iOS 16.4+). The next ping shows **missed** with the reason, never an invented position. |
| Android Chrome in the background | Updates may be throttled or stop | Same as above; plus a fresh fix is forced when the tab returns |
| Phone stationary | Some browsers stop firing location updates | The watch is restarted automatically when no fix arrives for 15 s |
| GPS unavailable or inaccurate | No fix, or a large error | Accuracy circles; a "stale" label for old fixes; **missed** when there's nothing recent |
| Connection drops | — | Automatic reconnect with backoff; the same player identity; the last location is re-sent on reconnect |
| PWA install | Better full-screen UX | **Does not** enable background GPS. MANHUNT never claims otherwise. |

Every reveal carries the fix's **real measurement time** (device-relative, so phone clock errors don't matter) and its **accuracy**. Hunters always see "seen 2m ago · ±12 m", "stale fix", or "missed ping #4 · last seen 7m ago".

## Privacy & data retention

- Location is collected **only** while a game is running, only from players who joined it, and only after the browser permission is granted. Players can pause sharing (their ping then shows as missed) or leave at any time. Leaving, being captured, the game ending, or an emergency stop stops sharing immediately.
- **No location history.** The server keeps only each player's latest fix, in memory. Each update overwrites it, and it is never written to disk.
- Reveal snapshots (what hunters were shown) are stored with the game. Their coordinates are **deleted 60 minutes after the game ends**, and the whole game is deleted after 24 hours. Both periods are configurable.
- Coordinates are never exposed through public APIs. The invite link alone reveals only the game name, host name and player count. Locations need an authenticated player session in that game, and even then only what that player's role allows.
- There are no accounts, analytics, ads or third-party trackers. Fonts are self-hosted; map tiles are fetched from the tile provider.

## Security model

- **Private rooms:** 6-character codes from a 32-symbol alphabet (about 1 billion combinations). Per-IP rate limits on create, preview and join apply, with a stricter bucket for failed codes and passwords, so codes can't practically be enumerated. Optional scrypt-hashed password. The host can lock the lobby and kick players.
- **Identity:** each player gets a 256-bit random token, stored as a SHA-256 hash. The browser keeps it in `localStorage`, scoped per game, so refreshing reconnects the same player.
- **Authorization is server-side:** every `host.*` action checks `hostId`. Team changes, starts, the clock and captures can't be set by clients. Captures require the right role and phase, the targeted runner's own confirmation, or the host. Tag-code guesses are rate-limited (5 per minute).
- **Isolation:** a socket is bound to one (game, player) pair after auth. Views are built per player; tests check that no data crosses games.
- **Validation:** every REST body and socket message is validated with zod (types, ranges, sizes; names are stripped of control characters). Payload caps are 8 KB per WS message and 64 KB per HTTP body. Each socket also has a token-bucket message limiter.
- **Headers:** strict CSP (`script-src 'self'`), `frame-ancestors 'none'`, `Referrer-Policy: strict-origin` (only the site origin is ever sent, so invite codes in URLs never leak, while referrer-restricted Google API keys still work), `X-Content-Type-Options`, HSTS in production, and an optional WebSocket Origin allow-list.
- **GPS can be spoofed:** browser location can't be verified. MANHUNT shows implausible speed and out-of-bounds positions to the host as **hints only**, never as automatic penalties.

## Costs

| Item | Typical cost |
|---|---|
| Hosting (Fly.io shared-cpu-1x, 256 MB, 1 GB volume) | about $2–5/month (free allowances may cover it) |
| Map tiles (OpenFreeMap) | free (consider donating) |
| Database | included (SQLite on the volume) |
| Domain (optional) | about $10/year |

A game with 20 players uses very little bandwidth. That's about one small JSON update per player every few seconds, and it is only sent when the player's view actually changes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Location is blocked" | Re-enable location for the site in the browser settings, then reload. |
| Pings always "missed" for one runner | Their screen is locking or the app is in the background. Turn on **Keep screen awake** and keep MANHUNT in the foreground. |
| "Map tiles unavailable" | The tile host is unreachable on that network. Positions are still correct; check `VITE_MAP_STYLE_*`. |
| Sockets disconnect behind a proxy | Ensure WebSocket upgrades are allowed on `/ws`, and set `PUBLIC_ORIGIN` correctly. |
| `ExperimentalWarning: SQLite` | Harmless (Node's built-in SQLite). The start scripts suppress it. |

---

Built with Vite, React 19, TypeScript, Tailwind CSS v4, Motion, Lucide, MapLibre GL, OpenFreeMap/OpenStreetMap, zod and `ws`. The server runs on Node.js with `node:sqlite`.
