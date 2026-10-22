# MANHUNT: Implementation Plan

A private, mobile-first, real-world Manhunt game played in a phone browser.
Runners travel on foot. Hunters may drive, but only as passengers when they use the phone.
Every ping interval (5 minutes by default), the server reveals every active runner's last
location to the hunters at the same moment.

---

## 1. Technology evaluation and decisions

| Concern | Options evaluated | Decision | Why |
|---|---|---|---|
| Frontend framework | Next.js (App Router), Vite + React SPA | **Vite + React 19 + TypeScript** | The app is a fully client-rendered, real-time game behind private codes. SSR, SEO, and server components bring nothing here. Next.js on Vercel would also push us toward serverless functions, and those cannot hold WebSockets or game timers. A Vite SPA builds fast, ships small, and the game server can serve it from the same origin. |
| Styling / components | Tailwind + shadcn/ui, CSS modules | **Tailwind CSS v4 + in-house components in the shadcn style** (`cva` + `tailwind-merge`) | shadcn/ui is a copy-in pattern, not a dependency. We follow the same approach with a small, purpose-built component set tuned for a dark tactical HUD and large touch targets. |
| Animation | Framer Motion / Motion | **Motion** (`motion/react`) | Covers layout transitions, sheets, and the ping/radar effects. Honors `prefers-reduced-motion`. |
| Icons | Lucide | **lucide-react** plus a few custom SVG markers | |
| Backend | Supabase (Postgres + Realtime + RLS), Firebase, custom Node | **Custom Node.js game server (HTTP + WebSocket) with SQLite** | Server-authoritative timers and reveals need a long-lived process with a clock. Supabase would need pg_cron or edge functions for the 5-minute reveal and complex RLS for per-role location visibility. A single Node process holds authoritative state in memory, writes through to SQLite, and sends each player a role-filtered projection. A pure function decides what each player may see, and it is unit-tested. The whole stack runs and tests locally with no cloud account. |
| Database | Postgres, SQLite | **SQLite via Node's built-in `node:sqlite`** (no native build step) | Private games among friends fit easily on one instance. A single file on a persistent volume survives restarts. There are no extra services to pay for. |
| Realtime | Socket.IO, `ws`, Supabase Realtime | **`ws`** with a small typed protocol validated by **zod** | Minimal, fast, and we control reconnection and resume semantics. |
| Maps | Mapbox GL, MapLibre GL, Leaflet | **MapLibre GL JS + OpenFreeMap vector tiles** (OpenStreetMap data), with an optional satellite raster layer | Free with no API key, WebGL performance on phones, and a styleable dark map. Tile URLs are environment-configurable so the operator can swap providers. |
| Geolocation | Browser Geolocation API | `watchPosition` while visible, plus a forced `getCurrentPosition` on the "ping incoming" request | No App Store install is needed. The background limitations are documented honestly (section 6). |
| Hosting | Vercel + Supabase, Fly.io, Railway, Render | **Any Docker host with WebSockets and a volume** (Fly.io recommended; Railway or Render also work) | One container, HTTPS from the platform, about $0–5/month. |
| Testing | Vitest, Playwright | **Vitest** (unit + server integration over real sockets) and **Playwright** (mobile-viewport end-to-end runs with emulated geolocation) | |

## 2. Architecture

```
 Phone browser (PWA-capable SPA)                     Node game server (single process)
 ┌──────────────────────────────┐   HTTPS (REST)    ┌──────────────────────────────────────┐
 │ React UI  ── zustand store   │ ────────────────▶ │ /api/games (create, preview, join)    │
 │ MapLibre map                 │                   │  rate limit · zod validation · scrypt │
 │ Geolocation service ─────────┼── WSS /ws ──────▶ │ Socket hub (auth by player token)    │
 │ Clock sync (server offset)   │ ◀──── state ───── │ GameEngine (authoritative)            │
 └──────────────────────────────┘                   │  ├─ clock / phases / ping scheduler   │
                                                    │  ├─ capture state machine             │
                                                    │  ├─ projection(game, viewer)  ◀─ security core
                                                    │  └─ tick() every 1 s (injectable clock)
                                                    │ Store: SQLite (games table, JSON state)│
                                                    │ Latest GPS fixes: memory only          │
                                                    └──────────────────────────────────────┘
```

### Key principles

1. **The server is authoritative.** Game start, pauses, phases, ping times, captures, team assignments, and win conditions are all computed on the server from server timestamps. Clients only render.
2. **Visibility comes from projection.** The server never broadcasts raw state. Each socket receives `project(game, viewerId, now)`, which builds the view from scratch based on the viewer's team, status, and host flag. Runner coordinates reach hunters **only** inside reveal snapshots.
3. **No hidden location history.** Only the latest fix per player is kept, in memory, and each new fix overwrites it. Reveal snapshots are the only stored coordinates, and hunters were shown them anyway. Snapshots are purged after `LOCATION_RETENTION_MINUTES` (default 60) once the game ends. Whole games are purged after `GAME_RETENTION_HOURS` (default 24).
4. **Clock sync.** Clients estimate the server clock offset from ping/pong round trips. Countdowns derive from server timestamps, so changing a device clock has no effect.
5. **Deterministic engine.** `GameEngine` takes a `now()` function, so tests can drive whole games, including 5-minute pings, in milliseconds.

### Project structure

```
shared/          types, protocol schemas (zod), pure rules (teams, clock, geo, win)
server/          index.ts (HTTP + WS), engine.ts, projection.ts, store.ts,
                 http.ts, ratelimit.ts, security.ts, config.ts
web/             Vite React app
  src/app        routing, providers
  src/screens    Welcome, Create, Join, Lobby, Game (Runner/Hunter HUD), Results, Settings
  src/components ui kit, map, HUD widgets, sheets
  src/lib        api client, socket client, geolocation, clock, sounds, haptics, storage
  public/        manifest, icons, service worker
scripts/         simulate.ts (bot players), make-icons.ts
tests/           unit + integration (vitest), e2e (playwright)
```

### Data model (SQLite)

`games(id TEXT PK, code TEXT UNIQUE, status TEXT, state TEXT /*JSON*/, updated_at INT, expires_at INT)`

The game state JSON holds:
- settings
- boundary
- players (with scrypt-hashed tokens)
- the clock (`startedAt`, `pausedAt`, `pausedTotalMs`)
- the reveal list
- captures
- events

Latest GPS fixes are kept outside the JSON, in memory only.

### Protocol (WebSocket, JSON)

Client → server messages:

| Category | Messages |
|---|---|
| Session | `auth`, `ping` |
| Lobby | `setReady`, `ackSafety` |
| Location | `location`, `locationOff` |
| Captures | `captureRequest`, `captureRespond`, `captureByCode` |
| Players | `leave`, `emergencyStop` |
| Host | `host.updateSettings`, `host.setTeam`, `host.balanceTeams`, `host.start`, `host.pause`, `host.resume`, `host.end`, `host.kick`, `host.transferHost`, `host.resolveCapture`, `host.setCaptured`, `host.announce`, `host.rematch` |

Server → client messages:
- `welcome`
- `state` (the projection)
- `event` (toast-worthy)
- `pingRequest` (fresh fix wanted)
- `pong`
- `error`
- `kicked`
- `stopSharing`

Every host message is authorized server-side (`viewer.isHost`). The UI hiding a button is never the access check.

## 3. Game rules (default)

| Topic | Rule |
|---|---|
| Phases | `lobby → headstart → hunting → ended`. Pause and emergency stop overlay any running phase. |
| Duration | Counts from start and includes the head start. |
| Pings | At game-elapsed `headStart + k·interval` (k ≥ 1). An optional reveal fires at the end of the head start. |
| "Ping incoming" request | 30 s before each ping, runners are asked for a fresh fix. |
| Reveal snapshot (each active runner) | **ok**: fix age ≤ 90 s, revealed with coordinates, accuracy, and capture time. **stale**: fix age ≤ interval, revealed but clearly labelled with its age. **missed**: no fix, or sharing off, so no coordinates. The previous marker stays, greyed out and labelled with its age. |
| Captures | Default method: the hunter requests, the runner confirms on their own phone, and a dispute goes to the host. Alternative methods: host-confirm only, and tag code / QR (the runner shows a secret code, and the hunter types or scans it in person). GPS proximity never captures anyone. |
| Win: hunters | All runners are captured or have left before time runs out. |
| Win: runners | At least one runner is still free at time zero. |
| Host ending | The host can end the game manually (no winner, or a declared winner). |
| Captured runners | Become restricted spectators: timer, captures, and announcements only. No locations. |
| Teams | Balanced 50/50. When the count is odd, the extra player goes to the team the host picks (hunters by default), and the UI says so. |

## 4. Milestones and acceptance criteria

| # | Milestone | Acceptance criteria |
|---|---|---|
| M1 | Planning & scaffolding | PLAN/TASKS/README exist. Monorepo builds, lints, and typechecks. Vitest and Playwright are wired up. |
| M2 | Design system | Tokens, fonts, and a UI kit (Button, Card, Sheet, Toggle, Segmented, Slider, Badge, Toast). Animated welcome screen. Safe-area-aware layout. |
| M3 | Server foundations | Create/preview/join REST with validation, rate limits, and scrypt password. Token-authenticated WebSocket. SQLite persistence and restart recovery. Reconnects never duplicate players. |
| M4 | Lobby & teams | Ready states, safety acknowledgement, balancing (auto and manual), host-only start, kick, host transfer, settings edits, lock. |
| M5 | Clock & pings | Server clock with pause/resume. Ping scheduler, ping-incoming request, ok/stale/missed classification, simultaneous reveal. Projection tests prove hunters get no premature or live runner coordinates. |
| M6 | Map & HUD | MapLibre full-screen map with boundary, own position, accuracy circles, teammate markers, reveal markers with age labels, radar animation, recenter, style switch, boundary warnings. Runner and hunter HUDs. |
| M7 | Captures & end | Request/confirm/dispute/host override, tag-code + QR capture, win conditions, results screen with event summary and reveal map, rematch. |
| M8 | Safety & privacy | Emergency stop, driving/passenger mode, rules, privacy screen, stop sharing, leave, retention purge. |
| M9 | Polish & PWA | Manifest, icons, service worker for the app shell, wake lock, sounds/haptics, reduced motion, sunlight (high-contrast) mode, accessibility pass. |
| M10 | Verification | Unit, integration, and e2e tests green. Mobile viewport screenshots reviewed. Simulation mode runs a full game. Security review done. |
| M11 | Deployment | Dockerfile, fly.toml, environment docs, production build served by the Node server over HTTPS. |

## 5. Security checklist

- Join codes: 6 characters from a 31-symbol unambiguous alphabet (about 887M combinations). Preview and join are rate-limited per IP, with lockout on repeated misses. Games are never listed anywhere.
- Player tokens: 256-bit random values, stored hashed (SHA-256). They are sent only over HTTPS/WSS and kept in `localStorage`, scoped to the game.
- Optional game password: scrypt with a per-game salt, compared with `timingSafeEqual`.
- Every inbound message is zod-validated with size limits and a per-socket token bucket.
- Projection is the only path from state to clients. A cross-game leak is impossible by construction: a socket is bound to exactly one game, and tests cover it.
- Host actions are checked server-side. Team assignment, the clock, and captures cannot be set by clients.
- Spoofed GPS is possible. Anti-cheat signals (implausible on-foot speed for runners, out-of-bounds) are shown to the host as **warnings only**.
- Security headers: CSP, `Referrer-Policy: no-referrer` (the code lives in invite URLs), `Permissions-Policy: geolocation=(self)`, HSTS in production.

## 6. Mobile browser limitations (honest)

- **iOS Safari, including installed PWAs**, stops delivering geolocation when the screen locks or the tab is in the background. Web apps get no background location API.
- **Android Chrome** may throttle or stop `watchPosition` in background tabs. It is more lenient than iOS, but not guaranteed.

Our response:
- Clear onboarding that says "keep MANHUNT open with the screen on".
- An optional Screen Wake Lock.
- A live GPS-status chip with the last fix time.
- Stale/missed pings shown honestly.
- A reconnect-and-resume flow.
- A host view of each player's GPS health (without coordinates).

PWA installation improves the full-screen experience. It does **not** grant background GPS.

## 7. Priorities

Order: functional gameplay → secure ping mechanics → mobile compatibility → privacy & safety → visual polish → resilience → performance → maintainability.

Optional extras come only after the core is verified:
- QR capture
- Host announcements
- Rematch
- Presets
- Sounds and haptics
- Low-battery mode
