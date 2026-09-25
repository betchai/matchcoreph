# MatchCorePH — Feature Documentation

MatchCorePH is a match-organization and scoring platform for practical shooting competitions. Beyond the PPSA / IPSC ruleset it supports **PSMOC** scoring — **Points Factor** (`PSMOC_POINTS_FACTOR`) and **Time Scoring** (`PSMOC_TIME`) — with per-ruleset Full Load / Minimum Load paper tables. It pairs a deterministic scoring engine, a JSON REST API with a SQLite database, and a React single-page app that lets clubs run a match from registration through live standings and exports.

This document inventories the features shipped so far. Each section notes the source module so you can navigate the code.

---

## 1. Technology overview

| Layer | Stack | Location |
|---|---|---|
| **Scoring engine + domain model** | TypeScript (ESM), zod | `packages/core` (`@blinkscore/core`) |
| **API server** | Fastify, better-sqlite3, bcryptjs | `apps/server` (`@blinkscore/server`) |
| **Web app** | React 18, Vite 5, Tailwind CSS v4, react-router v6, zustand, vite-plugin-pwa (Workbox) | `apps/web` (`@blinkscore/web`) |
| **Database** | SQLite (WAL, foreign keys ON), 30 tables, schema version 2 | `apps/server/src/db/schema.ts` |

Monorepo: npm workspaces `packages/*` + `apps/*`. Public domain entry point: `packages/core/src/index.ts`.

---

## 2. Core package — domain model & enums

`packages/core/src/domain/enums.ts` and `domain/types.ts` define the authoritative vocabulary used everywhere:

- **Matches**: types `CLUB_SHOOT | CUP | TOURNAMENT | CHAMPIONSHIP`; I–V match levels; sanctioning `CLUB → PPSA_SANCTIONED → IPSC_SANCTIONED`; lifecycle `DRAFT → CONFIGURED → PUBLISHED → ONGOING → COMPLETED`, plus `CANCELLED` / `ARCHIVED`.
- **Scoring methods**: `COMSTOCK | VIRGINIA_COUNT | FIXED_TIME | PSMOC_POINTS_FACTOR | PSMOC_TIME`.
- **Load types**: `FULL_LOAD | MINIMUM_LOAD` (PSMOC paper point tables; nullable on stages outside PSMOC).
- **Competitors**: statuses `REGISTERED → CHECKED_IN → ACTIVE → COMPLETED`, terminal `DNS / DNF / DQ / WITHDRAWN`.
- **Scores**: statuses `DRAFT → SUBMITTED → VERIFIED → LOCKED`, alternates `DISPUTED`, `CORRECTED`; sync status `SYNC_PENDING | SYNCED`.
- **Targets**: `PAPER | PAPER_NO_SHOOT | STEEL | POPPER | PLATE | CUSTOM`; scoring zones `A | C | D`.
- **Penalties**: `MISS | NO_SHOOT | PROCEDURAL | OTHER`.
- **Power factors**: `MINOR | MAJOR | NOT_APPLICABLE`.
- **Audit actions**: ~36 names covering auth, match/stage/shooter/score lifecycle, disputes, chrono, security (`PASSWORD_CHANGED`, `SCORE_PIN_RESET`, account lock), impersonation, and sync.
- **Roles**: 9 (`PLATFORM_SUPER_ADMIN`, `PLATFORM_ADMIN`, `ORGANIZATION_ADMIN`, `MATCH_DIRECTOR`, `RANGE_MASTER`, `RANGE_OFFICER`, `SCOREKEEPER`, `COMPETITOR`, `VIEWER`).
- **Tournaments**: aggregation `SUM_POINTS | SUM_PERCENT | CUSTOM_WEIGHTED`; tie-break `NONE | COUNT_STAGE_WINS | HIGHEST_STAGE_POINT | MOST_FIRSTS`.

---

## 3. Scoring engine

### 3.1 Core contract

`calculateStageScore()` (`packages/core/src/scoring/engine.ts:26`) is **pure and deterministic** — the same inputs always produce the same result, with no I/O or clock. Design contract documented at `engine.ts:14-18`:

```
netPoints  = rawPoints − penaltyPoints
hitFactor  = netPoints / effectiveTime
stagePoints = (hitFactor / stageWinnerHitFactor) × maximumStagePoints
```

PSMOC methods follow the same deterministic contract with their own formulas (see 3.8): Points Factor substitutes the load-type paper table; Time Scoring returns a penalty-adjusted `finalTimeSeconds` instead of an HF.

### 3.2 Target evaluation — `packages/core/src/scoring/target.ts`

- **Paper / CUSTOM**: scores the highest-value zones first (A → C → D) up to `requiredHits`. Points depend on power factor: Minor `A5/C3/D1`, Major `A5/C4/D2`.
- **Hard cap**: a paper target may record at most its stipulated hits. More hits → hard config error `TARGET_HITS_EXCEEDED` — the engine never auto-penalizes over-recorded paper targets (`target.ts:129-134`).
- **Miss derivation**: `misses = requiredHits − hitsRecorded` (unless Virginia Count with `missingShotsAsMiss = false`). Each miss → `MISS` penalty.
- **Steel / Popper / Plate**: always `requiredHits = 1`, `rawPoints = hits × steelPointValue` (default 5). The engine drives a binary hit/miss; >1 hit triggers `TARGET_POINTS_EXCEEDED`.
- **No-shoot targets (`PAPER_NO_SHOOT`)**: never score; each recorded hit → `NO_SHOOT` penalty.
- **Zone discipline**: hits in a zone the target doesn't declare are a config error (`ZONE_NOT_RECORDABLE`) — the engine "never guesses".

### 3.3 Stage-level rules — `engine.ts`

- Extra shots beyond `maximumRounds` → one procedural each for Comstock and Virginia Count (not Fixed Time); PSMOC penalizes only when the ruleset sets `scoring.psmoc.unlimitedShots = false` (default `true` → warning only).
- Raw points above the stage's declared maximum → `STAGE_POINTS_EXCEEDED`; a mismatch between declared and layout-computed maximum emits a warning.
- Fixed Time stages: time is forced to the configured fixed time (`FIXED_TIME_NOT_CONFIGURED` if unset).
- Time must be positive (unless `allowZeroTime`), rounded to `precision.time` (2 dp).

### 3.4 Error model — `scoring/errors.ts`

Config problems surface as explicit machine codes rather than silent choices: `ZONE_NOT_RECORDABLE`, `TARGET_HITS_EXCEEDED`, `TARGET_POINTS_EXCEEDED`, `EXTRA_HITS_UNCONFIGURED`, `STAGE_POINTS_EXCEEDED`, `FIXED_TIME_NOT_CONFIGURED`, `TIME_REQUIRED`, `INVALID_TIME`.

### 3.5 Rankings — `scoring/rankings.ts`

- `rankCompetitors` drops excluded competitors (DNS/DNF/DQ/WITHDRAWN), sorts by descending match total (float-tolerant compare), ties within the **same division** are disclosed and shown as `TIE` (standard `1, 1, 3` numbering). Ties across divisions are never disclosed.
- Stage points = `rankStage()`: winner's HF 1.0 → others proportional, all clamped ≥ 0 (`minZero` policy), rounded to 4 dp.
- Match total = sum of finite stage points.

### 3.6 Power factor — `scoring/powerFactor.ts`

`PF = (bulletWeightGrains × velocityFps) / 1000`. Classified against ruleset minimums (defaults: Minor ≥ 125, Major ≥ 160). Chrono velocity = mean of up to three shots.

### 3.7 Precision — `scoring/precision.ts`

Full IEEE-754 precision internally; rounding only at presentation boundaries via ruleset-declared precision (time 2 dp, HF 4 dp, stage points 4 dp), epsilon-guarded (`approxEqual`) so float drift never creates false score gaps.

### 3.8 PSMOC scoring — `scoring/engine.ts`, `scoring/target.ts`

PSMOC is a first-class ruleset **authority** (never assumed equal to PPSA/IPSC). Two configurable methods:

- **Points Factor (`PSMOC_POINTS_FACTOR`)**: `hitFactor = netPoints / time` like Comstock, but the **paper point table is chosen by the stage's load type** — `FULL_LOAD` (`A5/C4/D2`) or `MINIMUM_LOAD` (`A5/C3/D1`) — resolved through `resolveLoadTypeParams()` from the stage's `loadType` at score time and used for both target scoring and `stageLayoutMaxPoints`. Major/minor tables are ignored for these stages.
- **Time Scoring (`PSMOC_TIME`)**: no hit factor, no stage points. `finalTimeSeconds = rawTime + timeAdjustmentsSeconds`, where adjustments are per-zone (alpha `0` / charlie `+1` / delta `+3`) and per-penalty (miss / no-shoot / procedural / other, default `5` each). Lowest final time ranks first (`rankStageByFinalTime`). Time-scoring stages never contribute to aggregate match totals.
- **Unlimited shots**: by default extra shots beyond the maximum incur **no** procedural (only a disclosure warning); the ruleset parameter `scoring.psmoc.unlimitedShots` gates this, and `scoring.extraHitPolicy = IGNORE` drops surplus hits.
- Stage results persist `final_time_seconds` / `time_adjustments_seconds` alongside (or instead of) `hit_factor` in `stage_results`.

---

## 4. Rules configuration (rulesets / divisions / categories)

`packages/core/src/rules/parameterDefs.ts` is a self-describing registry of 30 scoring parameters across namespaces:

| Namespace | Parameters (defaults) |
|---|---|
| `scoring.paper` | minor `A5/C3/D1`, major `A5/C4/D2`, **full load** `A5/C4/D2`, **minimum load** `A5/C3/D1`, default required hits `2` |
| `scoring.steel` | point value `5` |
| `penalty` | miss `10`, no-shoot `10`, procedural `10`, other `10` |
| `scoring` | `extraHitPolicy` (default `TREAT_AS_MISS`, else `REQUIRE_CONFIG`/`IGNORE`), VC extra-shot & missing-shot policies, fixed-time stop policy, stage points `minZero`, tie-break, `allowZeroTime`, `psmoc.unlimitedShots` (default `true`) |
| `scoring.time` | PSMOC time adjustments alpha `0` / charlie `1` / delta `3`; time penalties miss / no-shoot / procedural / other `5` each |
| `powerFactor` / `precision` | Minor min `125`, Major min `160`; time `2`, HF `4`, stage points `4` |

- **Rulesets** (`RULESET_DEFAULTS`, `parameterDefs.ts:302`): 8 seeded families citing their authority's rules — `IPSC-HANDGUN-2026`, `PPSA-HANDGUN-2026` (Philippine classification params), **`PSMOC-HANDGUN-2026`** (Points Factor + Time Scoring methods, Full/Minimum load tables, unlimited shots), `IPSC-PCC-2026`, `IPSC-RIFLE-2026`, `IPSC-MINI-RIFLE-2026`, `IPSC-SHOTGUN-2026`, `IPSC-ACTION-AIR-2026`.
- **Disciplines** (`rules/disciplines.ts`): HANDGUN, PCC, RIFLE, MINI_RIFLE, SHOTGUN, ACTION_AIR — each with default ruleset and allowed methods/targets; HANDGUN additionally declares the PSMOC methods.
- **Divisions** (`rules/divisions.ts`): 24 defaults (Open, Standard, Production-family, Classic, Revolver; PCC/Rifle/Mini/SG/Action-Air sets). Production-family are Minor-only; Classic permits Major at 8 rounds loaded.
- **Categories** (`rules/categories.ts`): OVERALL, LADY, JUNIOR, SENIOR, SUPER_SENIOR with configurable age bands.

Divisions/categories are **data, not code** — created as ruleset-scoped rows, never hard-coded into scoring logic.

---

## 5. Server API

### 5.1 Authentication & sessions — `services/auth.ts`, `http/auth.routes.ts`

- **Login**: username-or-email + password (bcrypt, 12 rounds). Creates a session: the DB stores only a SHA-256 hash of the token; the client gets an HTTP-only `psa_session` cookie (30-day expiry, SameSite=Lax, Secure when HTTPS).
- **Logout** destroys the session row. **Me** returns the current profile + roles. **Change password** supports the forced `mustChangePassword` flow.
- Account lock flag blocks login; impersonation is supported at the session layer for platform super-admins.
- **RBAC**: 9 roles × ~40 fine-grained permissions in `packages/core/src/rbac/roles.ts`, enforced by guards `orgScope()/platformScope()/requireAnyPermission()` in `http/helpers.ts`. Platform admin roles act across all orgs; user grants are org-scoped.

### 5.2 Endpoint map

All endpoints are `/api/*`. Guards summarize permissions; see route files for details.

**Auth** (`auth.routes.ts`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Create session, set cookie |
| POST | `/api/auth/logout` | Destroy session |
| GET | `/api/auth/me` | Profile + roles |
| POST | `/api/auth/password` | Change own password |

**Platform / global** (`platform.routes.ts`)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/platform/stats` | Global counts |
| GET/POST | `/api/shooters`, `/api/shooters/import` | Shared shooter roster + CSV import |
| GET/PATCH | `/api/shooters/:id` | Shooter detail/edit |
| GET/POST | `/api/platform/orgs` | Org management (platform admins) |
| GET/PATCH | `/api/orgs/:orgId`, `/stats` | Org profile + dashboard stats |
| GET/POST | `/api/orgs/:orgId/users` · PATCH/DELETE `/…/users/:userId/…` | Org user management (role, lock) |
| GET | `/api/disciplines` | Reference data |
| GET/POST | `/api/rulesets` · `/…/duplicate`, `/…/parameters`, `/…/status` | Ruleset versioning & parameters |
| GET/PATCH | `/api/rulesets/:id/divisions`, `/categories` | Divisions/categories |
| GET | `/api/platform/audit` | Global audit log |

**Organizations → matches/stages/squads/registrations** (`org.routes.ts`)
| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/api/orgs/:orgId/matches` | Create / list matches |
| GET/PATCH | `/api/orgs/:orgId/matches/:matchId` · `/wizard` · `/control` | Match detail, wizard state, match-day stats |
| POST | `/…/disciplines` · `/ruleset` · `/divisions-categories` | Setup wizard steps |
| POST | `/…/publish` · `/status` · DELETE `…` | Publish, status transitions, delete draft |
| CRUD | `/…/stages[…]` · `/…/stages/:id/targets` | Stage & target configuration |
| CRUD | `/…/squads[…]`, `/…/squads/overview` | Squads + rotation |
| POST/GET | `/…/registrations`, `/bulk`, `/status-batch`, `/:reg/status` | Registrations + statuses + bulk |
| POST | `/…/checkin` · GET `/attendance` | Check-in + attendance |

**Scoring, results, tournaments, reports** (`scoring.routes.ts`)
| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/…/scores`, `/:scoreId`, `/submit` | Entry, drafts, PIN-gated submit |
| POST | `/…/scores/forgot-pin` | Staff reset of a shooter's forgotten PIN (audited) |
| POST | `/…/scores/sync` | Offline batch sync (token-idempotent) |
| PATCH | `/…/scores/:id/workflow` | VERIFY / LOCK / UNLOCK / REJECT |
| POST | `/…/scores/:id/correct` | Formal audited correction |
| POST/GET | `/…/disputes…` | Dispute lifecycle |
| POST/GET | `/…/chrono` | Chronograph sessions |
| GET | `/…/results`, `/division/:id`, `/stages`, `/stages/:id` | Standings & stage results |
| CRUD | `/…/components` · POST `/aggregate` · GET `/tournament` | Tournament composition & aggregation |
| GET | `/…/reports/results.csv|scorecards.csv|results.html|scorecards.html|certificates.html` | Exports |

### 5.3 Match lifecycle

- Creating a match **auto-seeds the appropriate ruleset snapshot** plus default divisions/categories for the chosen discipline, then audits `MATCH_CREATED`.
- A **setup-wizard state machine** (`matches.ts:321`) tracks the 8 steps (basics → type → disciplines → ruleset → divisions/categories → stages → squads → registrations). `publishMatch` refuses until all steps are complete, sets `PUBLISHED`, and audits `MATCH_PUBLISHED`.
- Status transitions are whitelisted; a completed match can only be archived. Deletion is allowed for DRAFT/CONFIGURED only. Ruleset swap validates discipline alignment (`RULESET_CHANGED`).

### 5.4 Stage configuration

Full CRUD with validation against target types, `requiredHits ≥ 1`, and declared scoring zones. Targets are bulk-replaceable via `PUT`. Soft-delete preserves any history: a scored stage is marked inactive rather than removed (`STAGE_REMOVED`). Stages on a PSMOC ruleset may set a **load type** (`FULL_LOAD` / `MINIMUM_LOAD`), validated by the ruleset's discipline, and surface it in match views and exports.

### 5.5 Registrations & score PINs — `services/registrations.ts`

- Registration validates: no duplicates, division/category enabled for the match, no Major PF in Minor-only divisions (`DIVISION_NO_MAJOR`).
- **Score PIN**: optional 4-digit PIN, stored as a bcrypt hash, set/changed only while status is `REGISTERED` (else `PIN_FROZEN`).
- **Forgotten PIN recovery** (`resetRegistrationPin` + `POST /scores/forgot-pin`, guarded by `score.submit`): staff set a fresh PIN; the old one can never be read. Audited as `SCORE_PIN_RESET`.
- Competitor status changes are audited; **DQ is immutable** once set; check-in records attendance and optionally assigns a squad.

### 5.6 Score entry, submit & workflow — `services/scores.ts`

- **Entry** is blocked for DQ/DNS/DNF/WITHDRAWN. Drafts are idempotent via `sync_token`; one score per (stage, registration).
- **Submit** requires the shooter's PIN: `SCORE_PIN_NOT_SET` when absent, `SCORE_PIN_MISMATCH` when wrong — PIN is verified against the hash.
- The engine result is validated (cap-class errors abort with 422 and **no save**), then raw/penalty/net/HF and JSON payloads persist with a **version bump on every save**. PSMOC scores additionally persist `final_time_seconds` / `time_adjustments_seconds` (time scoring) — the response returns whichever the stage's method produces (`hitFactor` xor `finalTimeSeconds`).
- **Workflow**: `SUBMITTED → VERIFIED (valid HF **or** final time required) → LOCKED`, with `UNLOCK`, `REJECT (→ DRAFT)`. Each transition audited.
- **Disputes**: open only when not LOCKED and no other open dispute; flips the score to `DISPUTED`; resolving returns it to SUBMITTED to proceed via correction or re-verification.
- **Corrections**: only for non-DRAFT scores, require a role-based authorization claim **and** platform authority, re-enter the score (status `CORRECTED`), and append a `score_corrections` row (field, previous, new, reason, authorized_by).
- **Offline sync**: batch accept partial success; each entry keyed by `sync_token`.

### 5.7 Results & standings — `services/results.ts`

- Recomputed on demand at every results/report fetch. Compete stage results per division: winner HF → stage points for point-scoring stages; time-scoring stages rank by **lowest final time** and award **no stage points** (so they never move the aggregate total). Match totals then rank overall + per division + per category with configurable tie-break.
- Unscored/un-rateable competitors appear at the bottom, marked unranked (`–`).

### 5.8 Chronograph — `services/chronograph.ts`

Records 3 velocity shots, computes PF, verifies against declared PF: Major declared but measured below → scored Minor; below Minor floor → Minor with warning; else verified as declared. Upserts per (match, registration, discipline). Audited `CHRONO_COMPLETED`.

### 5.9 Reports — `services/reports.ts`

Server-generated on demand, XSS-escaped:
- **CSV**: results (rank/shooter/division/category/PF/total/tie) and per-stage scorecards — PSMOC time-scoring stages carry Time / Raw / Penalties / Net / **Time Adjust** / **Final Time** columns (HF left blank) instead of HF.
- **HTML (print-ready)**: standings, per-stage scorecards (conditional Final/Adj columns for time-scoring stages), and top-5 **certificates**.

### 5.10 Tournaments — `services/tournaments.ts`

A `TOURNAMENT`/`CHAMPIONSHIP` match hosts component matches. Competitors are mapped **by name** across components and aggregated with `SUM_POINTS`, `SUM_PERCENT`, or `CUSTOM_WEIGHTED` (percent × weight), ranked with tie handling, persisted to `tournament_results`.

### 5.11 Audit trail

Comprehensive, multi-layer:
- `audit_logs` rows with action, actor snapshot, entity, and JSON old/new values, IP + user-agent — read via platform audit log, per-user, per-entity.
- `scores.version` increments every save; actor/timestamp columns (`entered_by`, `submitted_by`, `verified_by`, `last_modified_by`, `…_at`).
- `score_corrections` — the formal trail for finalized-score changes (field, previous, new, reason, authorizer).

### 5.12 Database

30 tables: platform (organizations, users, roles, sessions, audit, notifications), rules reference (rulesets, parameters, divisions, categories), shooters (shared roster), matches/stages/targets/squads, registrations, scores + corrections + disputes + attendance, chrono, persisted results (stage/match/tournament), match assignments.

---

## 6. Web application

### 6.1 Routing & shell

| Route | Page |
|---|---|
| `/login` | Sign in + forced password change + demo account fillers |
| `/` | Dashboard (member orgs or platform console with stats) |
| `/platform/shooters` · `/platform/audit` | Shared roster · global audit log |
| `/orgs/:orgId` | Matches list + create/archive/cancel |
| `/orgs/:orgId/users` · `/shooters` | Org users · shooters |
| `/orgs/:orgId/matches/:matchId` | Match overview (ruleset / discipline / scoring-method setup strip, stages, squads, registrations) |
| `…/stages` | Stage & target configuration |
| `…/configure` | Setup wizard |
| `…/scoring` | **Score entry** |
| `…/control` | Control center + exports |
| `…/results` | Live standings |

Shell = sidebar (desktop) + bottom tab bar (mobile). Permissions drive UI visibility throughout. The app is a **PWA**: Workbox precache + SPA navigation fallback (`index.html` cached offline; API calls still need network).

### 6.2 Score entry UX (`pages/ScoringPage.tsx`)

- Stage selector, competitor search, roster table with status/points/HF + state-driven row actions (Enter → Edit → Review & submit → Verify/Reject → Lock/Unlock → audited Override).
- **Per-target editors**:
  - **Paper/CUSTOM**: big A/C/D zone buttons — **tap adds a hit** (capped at required), **long-press resets** that target. Shows `N hits` and live `M` derivation.
  - **Steel/Popper/Plate**: binary **Hit / Miss** toggle.
  - **No-shoot**: stepper for hits.
- **Time field**: on blur, digits are interpreted as hundredths of a second — type `1255` → `12.55`; a value already containing `.` is padded to 2 dp (`12.5` → `12.50`). Hint text documents exact-seconds entry (`1300` = 13.00).
- **Time-scoring stages (PSMOC_TIME)**: the roster and confirm views use **Time / Adjust / Final** columns — per-sheet adjustments (`+X.XXs`) and the penalty-adjusted final time (`X.XXs`) instead of HF; the "Calculated stage score" panel shows Raw Time / Adjust / **Final Time** / Penalties tiles with the big number as final time.
- **Confirm screen**: score summary chips (**A/C/D**, **M** misses, **NS** no-shoots, **P** procedurals), a per-target score sheet, and a large **PIN pad** with 4-dot indicator. The shooter confirms by entering their PIN; mismatch/not-set errors keep the screen open with a clear message.
- **Forgot PIN?**: staff can set a fresh PIN inline (4 digits, guarded), which posts to the audited `forgot-pin` endpoint and tells the shooter to re-enter below.

### 6.3 Setup wizard (`pages/ConfigurePage.tsx`)

7-step guided setup with per-step completion checklist, auto-advance to first incomplete step, inline editable registrations (ComboBox shooter search, division/category/PF/squad), **"Verify PIN"** input at registration, status dropdown, publish gate, and a "PIN set" badge in the verify column.

### 6.4 Live results & control center

- **ResultsPage**: auto-refresh 10s, LIVE/PAUSED toggle, leaderboard with division + category filters, top-3 styling and TIE tags, stage progress, per-stage accordion results. Time-scoring stages show Time / Adjust / Final columns with the winner's final time in the stage summary (HF 4 dp used for point-scoring stages).
- **ControlPage**: 8 stat cards (competitors, checked-in, scored, verified, pending, disputes, stage completion, overall %), stage progress, standings, and direct download links to all five report exports.

### 6.5 Shared pieces

- `lib/api.ts`: cookie-authenticated fetch wrapper surfacing API error codes (used for PIN mismatch etc.).
- `lib/format.ts`: time/date/number/percent formatting.
- `components/ui.tsx`: Button, ComboBox (client + remote search), Input/Select/Field, Badge, Table, StatCard, PageHeader, notices/errors/empty states.

---

## 7. End-to-end workflows

### Match-day scoring loop
1. **Configure** the match in the wizard (disciplines → ruleset → divisions/categories → squads → registrations with 4-digit weather PINs) and **Publish**.
2. On match day, **check in** competitors; **chrono** verifies power factor.
3. For each shooter × stage, the scorekeeper **enters** the time (digits → `12.55`), taps zones/hits per target, and **Save & submit** — the shooter **confirms with their PIN**.
4. An RO/Range Master **verifies**; the Match Director **locks**; disputes/corrections alter only audited paths.
5. Standings recompute on demand; **Control center** monitors completion; **reports** export CSV/HTML/certificates.

### Score state machine

```
DRAFT → SUBMITTED → VERIFIED → LOCKED
          ↑  (REJECT: SUBMITTED → DRAFT)
          ├─ (dispute raised) → DISPUTED → (resolved) → SUBMITTED
          └─ (authorized correction) → CORRECTED
```

### PIN lifecycle
Set at registration (hashed) → used to confirm each submission → **never readable** → recovered only via audited staff reset (`forgot-pin`), which replaces rather than reveals.

---

## 8. Seed data & development

`npm run seed` (`apps/server/src/db/seed.ts`) creates, idempotently:
- Super admin `rhenabeth` / `rhenabeth-admin`; org "San Juan Elyu Practical Shooters, Inc." + org admin `sjepsc.admin` / `sjepsc-admin`.
- All 8 default rulesets with divisions/categories (including PSMOC-HANDGUN-2026 with the Points Factor / Time Scoring methods, load-type tables, and unlimited-shots parameter).
- Three published demo matches under org SJEPSC, each with 8 shooters (PINs `1000–1007`), squads, and 2 draft scores:
  - **San Juan Club Shoot** (PPSA ruleset) — 5 stages across Comstock/Virginia Count (short, medium, long, classifier).
  - **PPSA Short Course Shoot** (PPSA ruleset) — short courses only: 3 Comstock + 1 Virginia standards.
  - **PSMOC Short Course Shoot** (PSMOC ruleset) — short courses only: Full Load (`PSMOC_POINTS_FACTOR`), Minimum Load (`PSMOC_POINTS_FACTOR`), and `PSMOC_TIME`.
- The server suite additionally proves PSMOC end-to-end (`test/psmoc-flow.test.ts`): a seeded PSMOC-HANDGUN-2026 match with Full/Minimum-Load Points-Factor stages plus a Time-Scoring stage (unlimited shots, rankings by final time, no stage points for time stages, scorecard export).

Commands (root `package.json`): `npm run build` (core → server), `npm run test` (core + server suites), `npm run seed`, `npm run start` (production server), `npm run dev:server`, `npm run dev:web`, `npm run typecheck`, `npm run lan`, `npm run matchday`.

---

## 9. Deployment & match-day LAN

The production server **serves the built web app and API on the same origin** and binds `0.0.0.0` by default (`apps/server/src/index.ts`), so it is reachable from any device on a LAN with no rebuild: the web app uses relative `/api` URLs (`apps/web/src/env.ts`) and the session cookie is only `Secure` over HTTPS (`auth.routes.ts:13`), so plain-HTTP LAN auth works.

- **Build/run**: `npm run build && npm run build -w @blinkscore/web && npm run start` → listen `:4000` (override with `PORT`).
- **Router mode**: laptop + phones join any DHCP Wi-Fi (works even on an **unactivated** modem — activation only affects internet, not LAN). Print the day's URL with `npm run lan` / `npm run matchday`. The frequent failure mode is phones silently falling back to **cellular** on a no-internet Wi-Fi — keep mobile data off on scoring phones.
- **Hotspot mode**: macOS Internet Sharing ("from: Ethernet", "to: Wi-Fi") turns the laptop into the network at the fixed address `192.168.2.1`; phones open `http://192.168.2.1:4000/`. No router, no internet, no IP changes. Caveats: PWA service workers require HTTPS (non-localhost) so offline/install features do not apply over plain-HTTP LAN; keep the laptop awake (`caffeinate -s`).
- **Ops scripts** (`scripts/lan.mjs`, `scripts/matchday.mjs`): `.local` hostname + IP detection, server liveness check, hotspot-vs-router detection, and match-day reminders.

---

## 10. Known limitations / next steps

- **Tournament math**: `SUM_PERCENT` and `CUSTOM_WEIGHTED` are declared/validated but not yet computed in core; only `SUM_POINTS`/total aggregation runs today.
- **Tie-breaks**: `COUNT_STAGE_WINS`, `HIGHEST_STAGE_POINT`, and `MOST_FIRSTS` are enumerated but `NONE` vs. numbered tying is the only implemented behavior.
- **Notifications**: the `notifications` table and service helpers exist but are not yet wired to routes or events.
- **Offline**: the app shell and assets are cached (PWA), but there is no offline queue of API writes beyond the server-side `sync` batch endpoint.
- **Reports**: CSV and print-ready HTML only — no PDF generation.
- **Classifiers/shotgun pellet-count** policies are noted in the domain but not yet encoded as ruleset parameters.