# TASKS

Legend: [x] done and tested · [~] partial / see notes · [ ] not done

Test counts at last update: **71 unit/integration** (Vitest) and **8 e2e scenarios × 2 device profiles = 16 runs** (Playwright: iPhone 14, Pixel 7).

## M1 Planning & scaffolding
- [x] PLAN.md (stack evaluation, architecture, milestones, acceptance criteria)
- [x] Single-repo layout: `shared/`, `server/`, `web/`, `scripts/`, `tests/`
- [x] Strict TypeScript, Vite build, esbuild server bundle
- [x] Vitest (unit + integration) and Playwright (mobile e2e) configured

## M2 Design system
- [x] Tokens: dark and high-contrast daylight themes via CSS variables
- [x] Self-hosted fonts: Space Grotesk / Inter / JetBrains Mono
- [x] UI kit: Button, HoldButton, Sheet, Toggle, Segmented, Slider, Stepper, Field, Pill, TeamBadge/TeamGlyph (shape + icon + colour), Toasts
- [x] Animated radar welcome screen (respects reduced motion)
- [x] Safe-area insets; no horizontal overflow at phone widths (e2e)

## M3 Server foundations
- [x] REST create / preview / join with zod validation (integration)
- [x] 256-bit player tokens stored hashed; scrypt game password (unit)
- [x] WebSocket auth bound to one (game, player); reconnect without duplicates (unit, integration, e2e)
- [x] SQLite persistence (`node:sqlite`), restart recovery, schema versioning (unit)
- [x] Per-IP REST rate limits, stricter limit for failed codes, per-socket message limits (integration)
- [x] Security headers: CSP, no-referrer, frame-ancestors, Permissions-Policy, HSTS in prod (integration)

## M4 Lobby & teams
- [x] Auto-balance on join; shuffle; host manual assignment; odd-player rule (unit, e2e)
- [x] Ready states, safety acknowledgement gate, start blockers, force start
- [x] Kick, host transfer, auto host transfer on leave, lobby lock, spectators (unit, e2e kick)
- [x] Invite: code, share sheet, copy link, QR

## M5 Clock & pings
- [x] Server-authoritative clock with pause/resume; client offset sync via ping/pong (unit)
- [x] Reveal schedule (head start + k·interval, optional reveal at release), interval change mid-game, downtime catch-up (unit)
- [x] Ping-incoming request → fresh device fix (unit + integration)
- [x] ok / stale / missed classification with reasons; last-known carry-forward (unit)
- [x] Hunters never receive live runner coordinates; runners never receive hunter coordinates (unit + e2e WebSocket frame inspection)

## M6 Map & HUD
- [x] MapLibre full-screen map, OpenFreeMap styles, satellite option, offline-tile fallback (e2e style switch)
- [x] Boundary mask + dashed edge, accuracy circles, custom markers, age labels, radar pulse on reveal
- [x] Boundary editor: circle and polygon
- [x] Runner HUD, hunter HUD, spectator/captured HUD, GPS/connection status chip, banners (stale GPS, sharing paused, out of bounds)

## M7 Captures & end
- [x] Request → runner confirm/dispute → host decides; expiry; duplicate/race protection (unit, e2e)
- [x] Instant tag codes (typed) with rate limit; QR display and camera scan (jsQR) [~ scanner not exercised in automated tests: needs a camera]
- [x] Host manual capture / release (unit)
- [x] Win conditions, results screen with replay map, timeline, rematch (unit, e2e)

## M8 Safety & privacy
- [x] Emergency stop by any player: pauses game, halts sharing for all (unit, e2e)
- [x] Hunter driving lock (manual + vehicle-speed detection; mutes alerts) [~ speed trigger not testable in emulation]
- [x] Pause sharing / leave at any time; stopSharing on capture, leave, end, kick (unit)
- [x] Retention: live fixes memory-only; reveal coordinates purged after 60 min; games after 24 h (unit)
- [x] Rules, privacy and browser-limitations screens

## M9 Polish & PWA
- [x] Manifest, PNG/SVG icons, app-shell service worker (never caches /api or /ws)
- [x] Wake lock, WebAudio sounds, vibration, reduced motion, larger text, units, presets [~ audio/haptics verified by code path only]
- [x] Code splitting (welcome/join ~141 KB gz; map loaded on demand)

## M10 Verification
- [x] Bot simulation (`npm run simulate`) played complete games end-to-end
- [x] Mobile viewport screenshot review (dark + daylight)
- [x] Security review (see "Review notes" below)
- [ ] Real-device field test (iOS Safari + Android Chrome over HTTPS). Must be done by a human outdoors. See the README checklist.

## M11 Deployment
- [x] Dockerfile (non-root, healthcheck), fly.toml, .env.example, README deployment guide
- [x] Production runtime verified with production-only deps (8.5 MB)
- [~] Docker image build not verified in this environment (no Docker daemon)

## Review notes / known limitations
- Browser GPS stops when phones lock (especially iOS). This is documented and surfaced in the UI as stale/missed pings; it is not "fixed".
- GPS can be spoofed; anti-cheat signals are host-only hints.
- Single-instance server by design (in-process timers). Horizontal scaling would need a shared store and a leader for ticks.
- Map tiles depend on a third-party host (OpenFreeMap by default); there is an offline fallback.

## M12 Readability, Google Maps, easier setup, more fun rules
- [x] axe WCAG 2 AA audit of 34 screens (dark + daylight): 0 violations after fixes; collision-aware map labels
- [x] Google Maps Platform: Map Tiles API basemaps (dark/light/satellite) in MapLibre + attribution; Places search for the play area; OSM fallback (e2e with mocked Google APIs)
- [x] Referrer-Policy `strict-origin` so referrer-restricted Google keys work without leaking invite paths
- [x] Setup wizard in 3 steps with presets, auto-proposed play area sized for the group, rules summary, advanced rules collapsed
- [x] Rules: infection mode, runner cloaks, hunter radar sweeps, final-phase pings, swap-team rematch, survival ranking (unit + e2e)
- [~] Real Google APIs not called from this environment (no key/network); requests follow Google's documented formats and are tested against mocks

## Evaluated and deferred
- **Team chat**: skipped for now. Players already have group chats, and in-app chat invites phone use while moving or driving.
- **Web Push for pings**: deferred. iOS only supports push for installed PWAs, it needs VAPID key management, and push does not fix background GPS.

## Possible next steps
- Team chat (quick messages), optional Web Push for pings (iOS requires an installed PWA)
- Game modes (e.g. "infection": captured runners become hunters)
- Per-player statistics across rematches
