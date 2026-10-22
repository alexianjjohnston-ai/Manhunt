# TASKS

Legend: [x] done and tested · [~] in progress · [ ] todo

## M1 Planning & scaffolding
- [x] PLAN.md (architecture, stack evaluation, milestones)
- [x] Project scaffold (Vite + React + TS + Tailwind, Node server, shared rules)
- [x] Vitest configured (unit + integration)
- [ ] Playwright configured

## M2 Design system
- [ ] Tokens, fonts, UI kit
- [ ] Welcome screen with radar background

## M3 Server foundations
- [x] REST create / preview / join (tests: integration)
- [x] WebSocket auth and reconnection, no duplicate players (tests: engine + integration)
- [x] SQLite persistence and restart recovery (test: engine "survives a server restart")
- [x] Rate limiting and validation (tests: integration, shared)
- [x] Engine: lobby, teams, clock, pings, captures, win, host controls, emergency stop, retention (65 unit tests)

## M4 Lobby & teams
## M5 Clock & pings
## M6 Map & HUD
## M7 Captures & end
## M8 Safety & privacy
## M9 Polish & PWA
## M10 Verification
## M11 Deployment
