# MatchCorePH

Match-organization and scoring platform for practical shooting competitions. Supports the **PPSA / IPSC** ruleset and **PSMOC** scoring (Points Factor + Time Scoring with Full/Minimum Load tables). Designed so a single laptop on a LAN can run a match day end-to-end: build the club, seed matches, score on phones, and export live standings.

- **Deterministic scoring engine** — pure, reproducible stage/match math (`packages/core`).
- **REST API + SQLite** — Fastify server with audit trail, RBAC, PIN-gated score submission (`apps/server`).
- **React PWA** — mobile-first score entry, live leaderboard, control center, exports (`apps/web`).
- **Runs on a phone-less router, or with the laptop as its own hotspot** — no internet required.

See [docs/FEATURES.md](docs/FEATURES.md) for the full feature inventory.

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | `@blinkscore/core` — domain model, enums, scoring engine, rules/parameters |
| `apps/server` | `@blinkscore/server` — Fastify API, SQLite, reports, seed data |
| `apps/web` | `@blinkscore/web` — React/Vite single-page app (built and served by the server) |
| `scripts/` | Ops helpers: `lan.mjs`, `matchday.mjs` |
| `data/` | SQLite database (`ppsa.db`) |

## Requirements

- Node.js >= 20 and npm (npm workspaces monorepo)

## Quick start (development)

```sh
npm install
npm run seed          # creates demo org, rulesets, 3 matches, admins, shooters
npm run dev:server    # API at http://localhost:4000  (tsx watch)
npm run dev:web       # web at http://localhost:5173  (proxies /api to backend)
```

### Demo accounts

| Role | Login | Password |
|---|---|---|
| Platform super admin | `rhenabeth` | `rhenabeth-admin` |
| SJEPSC org admin | `sjepsc.admin` | `sjepsc-admin` |

Seed also registers 8 shooters in each match with score PINs `1000–1007`.

## Production build & run

The server serves the built web app at `/` and the API at `/api` on the same origin, binding `0.0.0.0`.

```sh
npm run build                 # core + server -> apps/server/dist
npm run build -w @blinkscore/web   # web -> apps/web/dist
npm run start                 # production server on :4000, logs to stdout
PORT=3000 npm run start       # override the port (default 4000)
```

Smoke test:

```sh
curl http://localhost:4000/api/health
```

## Match-day LAN setup (no internet)

Three modes, from most flexible to most controlled. No rebuild is ever needed for a network change; the server listens on `0.0.0.0` and the app uses relative `/api` URLs, so it works on any IP.

### 1. Router mode (any modem that hands out DHCP, works even unactivated)

1. Laptop and phones join the same Wi-Fi (e.g. an unactivated Surf2Sawa's default SSID — unactivated modems still serve LAN; activation only affects internet).
2. On the laptop, print today's URLs:

```sh
npm run lan        # or the fuller sweep: npm run matchday
```

3. From a phone, open `http://<laptop-ip>:4000/` (the printed IP, or the `Beths-MacBook-Air.local` hostname).
4. **Keep mobile data OFF on scoring phones.** On a no-internet Wi-Fi, Android/iOS automatically fall back to cellular, so the phone can never reach the laptop — this is the most common "why doesn't it work" cause.

### 2. Hotspot mode (laptop is the network — no router at all)

1. macOS **System Settings → General → Sharing → Internet Sharing**: "Share your connection from: Ethernet (or any non-Wi-Fi interface)", "To computers using: Wi-Fi", pick an SSID (e.g. `MatchDay`) + WPA2 password, turn it ON.
2. The laptop leaves Wi-Fi and hosts its own network at the fixed address `192.168.2.1`.
3. Phones join the shared network (tap "use without internet") and open:

```
http://192.168.2.1:4000/
```

4. Keep the laptop awake and plugged in: `caffeinate -s`.

### 3. Command-center helper

```sh
npm run matchday
```

Prints the server status, the day's phone URL (hostname + IP), detects hotspot vs router mode, and lists the four match-day reminders.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Phone can't load the page | Phone fell back to cellular (no-internet Wi-Fi) | Turn mobile data OFF on the phone; on Android also turn off "auto-switch to mobile data" for that network |
| Wrong IP used after a router change | New router assigns a new subnet/IP | Re-run `npm run matchday` on the laptop and use the printed IP |
| `.local` hostname won't resolve | mDNS not forwarded by some modems/Android | Use the raw IP URL instead |
| Matching subnet, still no connection | Client/AP isolation or guest mode on the router | Disable isolation in the router admin, or switch to hotspot mode |
| Works via localhost, not from other devices | macOS firewall | System Settings → Network → Firewall → allow incoming for `node` |
| Laptop asleep/hotspot dropped | Mac slept or browser session ended | `caffeinate -s`, keep it plugged in |
| PWA "add to home screen" offline broken | Service workers require HTTPS (except localhost) | Expected over plain-HTTP LAN; the app still works in the browser |

## Commands (root `package.json`)

| Command | Purpose |
|---|---|
| `npm run build` | Build `@blinkscore/core` then `@blinkscore/server` |
| `npm run build -w @blinkscore/web` | Build the web app into `apps/web/dist` |
| `npm run start` | Run the production server (serves web + API) on `:4000` |
| `npm run dev:server` | API dev server (tsx watch) |
| `npm run dev:web` | Web dev server (Vite, proxies `/api`) |
| `npm run seed` | Seed org, rulesets, matches, users, shooters |
| `npm run test` | Core + server test suites |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run lan` | Print LAN access URLs + server status |
| `npm run matchday` | Match-day status: phone URLs, server check, reminders |

## Tests

```sh
npm run test        # packages/core (66) + apps/server (44)
```

The server suite includes an end-to-end PSMOC flow (`apps/server/test/psmoc-flow.test.ts`) covering Points Factor, Time Scoring, unlimited shots, rankings, and scorecard export.

## Data

SQLite lives in `data/ppsa.db` when run from the repo root. Set `PSA_DATA_DIR` to relocate; delete the file to reseed from scratch.