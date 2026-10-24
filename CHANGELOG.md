# Changelog

## 1.2.0 — one double-click game night

- **Start MANHUNT (Windows).bat** and **Start MANHUNT (Mac).command**: install on first run, start the server, open a free Cloudflare quick tunnel, and print the https address for phones (saved in `game-address.txt`). `npm run play` does the same from a terminal.
- `cloudflared` is downloaded automatically from Cloudflare's official GitHub releases when it isn't installed. A failed tunnel is retried three times and explained.
- The release is also a `.zip`, which opens with a double-click on Windows and macOS. `START HERE.txt` replaces `INSTALL.txt` and includes a pre-game checklist.

## 1.1.0 — Google Maps checks and a test build

- **Settings → Maps** shows where map data comes from (Google or OpenStreetMap), explains in plain words why Google refused a key (invalid key, website not allowed, API not enabled, billing, quota), and has a **Check Google Maps** button that tests the key from that device.
- `npm run check:google` tests the server's key against the Map Tiles API and Places API (New) from the command line, optionally as a given website (`--referer`).
- The server log says whether maps come from Google or OpenStreetMap.
- Servers with testing features on (fast pings or simulated GPS) show a **Test server** label on the welcome screen.
- `npm run package:test` builds a test package with a ready `.env` and step-by-step instructions for trying Google Maps on your own computer.

## 1.0.0 — first release

**Play**
- Private games by 6-character code, invite link or QR, with an optional password. No accounts, and no public game list.
- Three-step setup:
  1. Your name, plus a preset (Quick chase, Classic, Infection, Long game).
  2. The play area: search for a place, use your location, or draw a circle or custom shape.
  3. A plain-language rules summary and safety acknowledgement. Every detailed rule is under *Advanced*.
- Server-run clock and location pings (every 5 minutes by default), revealed to all hunters at once. Every ping shows its age and accuracy, and a missed ping is shown as missed: no position is ever made up.
- Rules:
  - Head start.
  - Final phase with faster pings.
  - A cloak for each runner, to hide from one ping (labelled, never faked).
  - Radar sweeps for the hunters.
  - Infection mode: caught runners join the hunters.
  - Captures confirmed by the runner or the host, plus instant tag codes and QR.
- Host dashboard: pause, end, announcements, kick, host transfer, capture decisions, live GPS health (without coordinates), event log.
- Results: winner, runners ranked by time survived, ping-by-ping replay, rematch with the same or swapped teams.

**Maps**
- MapLibre with OpenStreetMap tiles by default.
- Optional Google Maps (Map Tiles API and Places search) with an API key.
- Dark, daylight (high contrast) and satellite styles.

**Safety and privacy**
- Emergency stop for any player.
- Driving lock for hunters.
- Location is shared only during a running game. Only the latest position is kept, in memory, and ping coordinates are deleted 60 minutes after the game ends.

**Hosting**
- One Node.js process with SQLite.
- `npm start` on Windows, macOS or Linux, with settings in a `.env` file.
- HTTPS through Cloudflare Tunnel or Tailscale Funnel.
- Docker and Fly.io configuration included.
- `npm run package` builds an installable archive.
