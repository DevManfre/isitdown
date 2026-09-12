[← README](../README.md)

## 9. Development

### 9.1 Repo structure

```
isitdown/
├── src/
│   ├── core/                          (shared by both editions)
│   │   ├── types.ts                   NormalizedStatus, Incident, StatusChange, NotificationPayload
│   │   ├── adapter.interface.ts        ServiceRef, FetchContext, Adapter
│   │   ├── notifier.interface.ts       Notifier
│   │   ├── stateStore.interface.ts     ProviderRuntimeState, StateStore
│   │   ├── configSource.interface.ts   RuntimeConfig, ServiceDefinition, ChannelConfig, ConfigSource
│   │   ├── config.schema.ts            zod schemas shared by the file loader and the UI's settings writes
│   │   ├── status.schema.ts            validation for a persisted NormalizedStatus
│   │   ├── poller.ts                   one cycle: stagger, retry, isolation, failure accounting
│   │   ├── groups.ts                   provider groups: the composite status a group reports (§3.10)
│   │   ├── diffEngine.ts               the sole authority on whether a notification fires
│   │   ├── notificationDispatcher.ts   the only caller of Notifier.send
│   │   ├── scheduler.ts                the loop; re-reads config every cycle
│   │   ├── logger.ts
│   │   └── i18n/                       notification strings, edition-agnostic
│   │       ├── index.ts                lookup + en fallback + UTC formatting
│   │       ├── en.json                 source locale
│   │       └── it.json
│   ├── adapters/                      (shared)
│   │   ├── catalog.ts                  bundled catalog of well-known providers
│   │   ├── statuspage.adapter.ts       generic Atlassian Statuspage adapter
│   │   ├── rss.adapter.ts              generic RSS / Atom incident-feed adapter
│   │   ├── slack.adapter.ts            Slack's own status API
│   │   ├── aws.adapter.ts              AWS Health's open-events feed, region-scoped
│   │   ├── gcp.adapter.ts              Google Cloud's incidents.json, current state and history in one
│   │   ├── azure.adapter.ts            Azure's status feed, with its own closure vocabulary
│   │   ├── severity.ts                 severity read from a provider's own wording
│   │   └── index.ts                    registry keyed by adapter id
│   ├── notifiers/                     (shared)
│   │   ├── formatting.ts               emoji, colours, severity labels, message assembly
│   │   ├── settings.ts                 shared validation for URL-only channel settings
│   │   ├── telegram.notifier.ts
│   │   ├── webhook.notifier.ts
│   │   ├── discord.notifier.ts         incoming webhook, one embed per change
│   │   ├── slack.notifier.ts           incoming webhook, Block Kit section + button
│   │   └── index.ts                    registry keyed by channel id
│   ├── light/                         (Light edition only)
│   │   ├── index.ts                    entrypoint
│   │   ├── runtime.ts                  wiring, shared with the end-to-end test
│   │   ├── healthcheck.ts              state-file freshness
│   │   ├── check.ts                    config.yml validation, CI-able (§3.9)
│   │   ├── fileStateStore.ts           JSON file, atomic writes
│   │   └── config/
│   │       ├── schema.ts               config.yml shape
│   │       ├── loadConfig.ts           YAML + ${ENV} substitution + validation
│   │       └── checkConfig.ts          every problem at once, not the first
│   └── ui/                            (UI edition only)
│       ├── server.ts                   entrypoint
│       ├── runtime.ts                  wiring, shared with the API tests
│       ├── app.ts                      Express app: routes, static dashboard, JSON errors
│       ├── routePaths.ts               the dashboard's route table, shared with the client router
│       ├── healthcheck.ts              probes /health
│       ├── sqliteStateStore.ts         StateStore + history, one transaction per save
│       ├── historyStore.interface.ts   the history contract (UI is its only consumer)
│       ├── history.ts                  uptime and incident aggregation
│       ├── backfill.ts                 reconstructs 90 days of history from a provider's incidents on first boot
│       ├── dbConfigSource.ts           config from SQLite; resolves secrets by variable name
│       ├── secretsFile.ts              credentials saved from the dashboard: 0600 file beside the database, applied to the environment
│       ├── metrics.ts                  the Prometheus scrape surface: gauges from the store, counters in memory
│       ├── liveEvents.ts               the push hub behind /events: subscribe, publish, nothing transport-specific
│       ├── configFile.ts             config.yml export / import (§4.3)
│       ├── mapLane.ts                  the map's own 15-minute poll cycle: component lists → located points, no notifications
│       ├── mapStore.ts                 map_points + map_geo_state persistence
│       ├── geo/                        resolveLocation.ts + the IATA/cloud-region lookup tables it resolves against
│       ├── db/                         open.ts, migrate.ts, seed.ts
│       ├── routes/                     status, events, history, incidents, exports, notifications, config, preferences, map, metrics
│       └── web/                        the dashboard: react, vite, shadcn/ui
│           ├── index.html              pre-paint theme script, fonts, #root
│           ├── main.tsx                provider tree: i18n, query, theme, router
│           ├── App.tsx                 console shell: rail, header, view container
│           ├── routes.tsx              hash routes
│           ├── components/ui/          shadcn primitives
│           ├── components/             rail, header, poll indicator, charts/
│           ├── views/                  overview, providers, incidents, incident,
│           │                           history, delivery log, settings
│           ├── hooks/                  queries, theme, rail, busy, live
│           ├── lib/                    api, types, chartConfig, format, i18n
│           ├── css/base.css            Tailwind entry point: imports tailwindcss, tokens, motion
│           ├── css/tokens.css          the only file with a colour literal
│           ├── css/motion.css          keyframes, entry animations, transitions
│           └── locales/                en.json (source) + it.json
├── tools/
│   ├── copy-assets.mjs                copies i18n and dashboard-locale catalogs into dist (the
│   │                                   dashboard bundle itself is Vite's own output, not this script's)
│   └── readme-parity.mjs              README.md against every README.<lang>.md (npm run check:readme)
├── test/
│   ├── core/                          diff engine, poller, scheduler, dispatcher, i18n, schemas
│   │   └── stateStore.contract.ts     one suite every StateStore implementation must pass
│   ├── adapters/
│   ├── notifiers/
│   ├── light/
│   ├── ui/                            store contract, aggregation, every API route, theme and locale guards
│   ├── fixtures/<provider>/            payloads recorded from the live pages, never fetched in a test
│   ├── helpers/
│   └── integration/                   *.itest.ts — fake provider and webhook receiver end to end
├── docs/grafana/isitdown.json         the committed Grafana dashboard for /metrics
├── design/                            Claude Design prototypes (git-ignored: on disk, not in a clone)
├── Dockerfile                         builder → light → dev → ui (dev is FROM builder; ui is FROM light)
├── docker-compose.yml                 both editions as profiles
├── docker-compose.dev.yml             dev override: UI edition live from src/, Vite watch-builds the bundle
├── config.example.yml                 tracked template; config.yml is git-ignored
├── .env.example                       secret variable names, never values
├── .nvmrc  .npmrc                     pins Node 24 and makes an older one fail loudly
├── tsconfig.json                      server TypeScript
├── tsconfig.light.json                the Light build: excludes src/ui
├── tsconfig.web.json                  the dashboard: DOM lib + react-jsx
├── vite.config.ts                     bundle, dev proxy, vitest config
└── components.json                    shadcn CLI config
```

Dashboard component and hook tests are colocated under `web/` as `*.test.tsx`,
next to what they cover, and picked up from there by Vitest — everywhere else in
the tree keeps to the `test/` convention above.

**Golden rule:** `src/core`, `src/adapters` and `src/notifiers` never import from
`src/light` or `src/ui`. Edition-specific behaviour is injected through the shared
interfaces instead. A test enforces this, including the edition-only dependencies.

### 9.2 Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 | Required: the built-in SQLite driver and native TypeScript type stripping both need it. |
| Language | TypeScript, strict | Plus `erasableSyntaxOnly` and `rewriteRelativeImportExtensions`, so `tsc` emits real `.js` while `node --test` runs the `.ts` sources directly. |
| HTTP client | global `fetch` | Already in the runtime. |
| Scheduling | `setTimeout`, re-armed with jitter | A slow cycle delays the next instead of overlapping. |
| Storage | JSON file (Light) · built-in `node:sqlite` (UI) | No native module, so no compiler in any build stage. |
| Validation | `zod` | Every external input: config files, provider payloads, database rows, catalogs. |
| Config parsing | `yaml` | |
| Test runner | built-in `node:test`, plus Vitest | `node:test` runs the server, core, adapters, notifiers and the fs-based guards straight from `.ts`; Vitest and React Testing Library cover `src/ui/web/`, because Node's type stripping does not transform JSX. |
| Dashboard | React 19 + Vite + Tailwind v4 + shadcn/ui | Bundled into `dist/ui/public`; Radix primitives themed entirely from `tokens.css`. |
| Charts | Recharts, via shadcn's `chart` wrapper | Data is still aggregated server-side; the client never re-derives a percentage. |
| Client routing | `react-router` 8, hash-based | Path-based routing was unavailable: `/incidents/:providerId/:incidentId` is already an API endpoint. |
| Client i18n | `react-i18next` | Flat catalogs, single-brace interpolation, bundled rather than fetched. |
| Server state | TanStack Query | 30-second `refetchInterval`, refetch on focus, held while a dialog or a field is in use. |
| Container | one multi-stage `Dockerfile` | `--target light` / `--target ui`, `node:24-alpine`. |

Runtime dependencies, exhaustively: `zod`, `yaml` (both editions) and `express`
(UI). Everything the dashboard uses — React, Vite, Tailwind, shadcn/ui's Radix
primitives, TanStack Query, react-i18next, Recharts and the rest — is a
devDependency compiled into static assets at build time, so the `ui` image gains
a bundle, not a dependency tree. Dev dependencies otherwise: `typescript`,
`@types/node`, `@types/express`, `@types/react`, `@types/react-dom`, Vite's own
plugins, Vitest and React Testing Library.

### 9.3 Live development

Two modes, for two different loops:

```bash
npm run dev:ui       # local: Express on :3000, Vite's dev server on :5173 with HMR
npm run dev:docker   # container: Vite watch-builds into dist/, Express serves :3000
```

`dev:ui` runs the server and Vite as two local processes together (`concurrently`).
The browser talks to Vite on **5173** — that is where HMR lives — and Vite's own
dev-server proxy forwards every API path (`/status`, `/config`, `/history`,
`/incidents`, `/notifications`, `/poll`, `/api`, `/health`, `/ready`) to the real Express
server on 3000. Visiting :3000 directly instead serves whatever is already sitting
in `dist/ui/public`, which is not live.

`dev:docker` is the faithful mode: one port, the same URL and port an operator
would use, nothing in between — which is what makes the smoke checks in
[5.1](verifying.md#51-smoke-checks) meaningful against it too. `docker-compose.dev.yml`
overrides the `isitdown-ui` service to build the `dev` target (tagged
`isitdown:dev`, never `isitdown:ui`), mounts `./src`, `vite.config.ts` and
`tsconfig.web.json` read-only, and runs `npx vite build --watch & exec node
--watch src/ui/server.ts` — Vite rewrites the bundle in `dist/ui/public` on every
source change, in the background, and the one Express process on :3000 always
serves whatever Vite last wrote there.

`WEB_DIR` has to be set explicitly in every dev mode, local or containerised: the
server's own default (in `app.ts`, `./public/` relative to itself) only resolves
correctly when the module runs from `dist/ui/`, where Vite's build actually lands.
Running the *source* module directly — which is exactly what dev mode does — makes
that same default resolve beside `src/ui/`, where nothing named `public/` exists
any more: the dashboard's source now lives under `src/ui/web/` instead. Both
`dev:ui`'s npm script and
`docker-compose.dev.yml` set `WEB_DIR` to the built `dist/ui/public` path
explicitly for this reason.

| Edit | `dev:ui` | `dev:docker` |
|---|---|---|
| `.tsx`, `.ts` or CSS under `web/` | HMR, no reload | rebuilds in about a second, then hard refresh |
| a locale JSON under `web/locales/` | HMR | rebuild, hard refresh |
| any server `.ts` | `node --watch` restarts | `node --watch` restarts |
| a dependency in `package.json` | `npm install` (then restart) | `npm run dev:docker -- --build` |
| the `Dockerfile` | no effect — `dev:ui` never touches Docker | `npm run dev:docker -- --build` |

A rebuild changes the bundle's filename, not just its content — asset names are
content-hashed — so "hard refresh" is enough in every case: the freshly written
`index.html` always points at the new hash, and there is no stale-cache case to
special-case around.

Two things dev mode does not do. It does not type-check — stripping types is not
compiling them, so `npm run typecheck` stays mandatory. And neither mode's `dist/`
is the one that ships: shipping still goes out the normal way,

```bash
docker compose --profile ui up -d --build   # back to the built image
```

To tell a running container's mode apart: `docker compose ps` shows
`ghcr.io/devmanfre/isitdown:ui-latest`
for the built image and `isitdown:dev` for dev mode; `docker inspect -f
'{{.Config.Cmd}}' isitdown-ui` shows `node dist/ui/server.js` for the built image,
and `sh -c "npx vite build --watch & exec node --watch src/ui/server.ts"` for dev
mode.

### 9.4 Tests and checks

```bash
npm test                 # node:test suites + vitest run
npm run coverage         # the same two suites under a coverage floor
npm run test:integration # end-to-end suite:  test/**/*.itest.ts
npm run test:visual      # visual baselines: every view, both themes, both locales
npm run check:bundle     # the built dashboard against its gzipped size budget
npm run check:readme     # this file against every README.<lang>.md
npm run typecheck        # server tsconfig + dashboard tsconfig (tsconfig.web.json)
npm run build:light      # tsc + copy assets, excluding src/ui
npm run build:ui         # tsc + vite build + copy assets
```

The bundle budget (roadmap 5.16) weighs what `build:ui` emitted, gzipped,
because that is what the browser downloads: `410 kB` of JavaScript and `20 kB` of
CSS, both a little over today's build. It is a ceiling rather than a target —
when it fails, the answer is to find what grew, not to raise the number.

The coverage floor (roadmap 7.2) is a floor, not a target to game. Two of them,
because the two suites cover different halves: the server and the engine must
stay at 95% of lines, 88% of branches and 93% of functions, and the dashboard at
85/75/80 — each a few points under where it stands today, so ordinary movement
passes and a new subsystem landing with no test of its own drags the total under
and fails CI. Raise a floor when the suite has genuinely climbed; never lower one
to make a red run green.

**No test ever touches a live provider.** Adapters are tested against payloads
recorded from the real status pages and kept under `test/fixtures/`; HTTP behaviour
runs against a local server.

Notable suites:

- **Diff engine** — the whole table in [7.3](how-it-works.md#73-when-a-notification-fires), including
  every case that must *not* notify.
- **State store contract** — one suite, run unchanged against both implementations, so
  they are provably interchangeable. It includes the restart case.
- **Poller** — retry count and growing backoff, per-provider isolation, a hanging
  provider not blocking a healthy one, and the monitoring warning firing once.
- **Scheduler** — mocked timers and injected jitter: cadence, config re-read per
  cycle, a manual poll joining an in-flight cycle, a failed cycle not killing the loop.
- **Notifiers** — outbound request shape per transition, and the assertion that a
  failed Telegram send never puts the token in its error.
- **API** — every route against a real server on a temp database, including the
  assertion that no response body contains a value from the environment.
- **Theme and locale guards** — no hex outside the token file (the scan also
  catches a hex smuggled into a Tailwind arbitrary value, e.g. `bg-[#1a1a2e]`), a
  semantic-token parity assertion that every shadcn variable resolves to a
  palette `var()` and is declared identically in all three theme blocks, catalog
  parity, every `t()` key resolving, and a scan for an English sentence typed
  straight into JSX — a heuristic, knowingly weaker than the exact text-node scan
  it replaced, since JSX gives no parse-free way to tell a translated expression
  from a literal.
- **Visual regression** — every view screenshotted in both themes and both
  locales against a fixed fleet and a frozen clock, then compared with the
  agreed baselines under `test/visual/baseline/`. The comparison runs on an 8×
  downscale of both frames, which is what lets one set of baselines hold on more
  than one machine: font rasterisation is not portable, and the same page on a CI
  runner differs from the same page locally on up to 1.5% of its pixels along the
  edges of text alone. Averaging that away leaves the two criteria that matter —
  how many cells moved (a layout change) and how many changed colour outright (a
  token change) — with limits measured against both the cross-machine noise and
  real regressions rather than guessed. Chromium comes from Playwright's own
  cache and is driven over the DevTools protocol, so nothing imports the package
  and it stays out of `package.json`. Run
  `node tools/visual-regression.mjs --update` to agree to an intended change, and
  `--only=<view>` while iterating on one.
- **README translation parity** — the numbered heading skeleton, the per-level
  heading, fence and table-row counts, and the identifiers (routes, shouted
  variable names, npm scripts) each file names, compared between `README.md` and
  every `README.<lang>.md`. Structure only, never meaning: an identifier is
  copied verbatim in a translation, so one that appears in a single file is
  either a section that was never ported or a flag someone translated. CI runs
  it, so an edit that landed in only one of the two cannot reach `main`.
- **End to end** — a fake provider and a webhook receiver: a transition delivers
  exactly one notification, an unchanged cycle none, a restart none, an unreachable
  provider keeps its last known state, and the entrypoint stays alive between cycles
  and exits 0 on `SIGTERM`.

The dashboard is real TypeScript now, checked by its own `tsconfig.web.json`
rather than a JSDoc-driven pass over plain JavaScript; its components and hooks
are tested with Vitest and React Testing Library, colocated as `*.test.tsx` next
to what they cover.

### 9.5 Conventions

- Validate every external input with `zod` at the boundary; trust internals.
- One adapter per file under `src/adapters/`, one notifier per file under
  `src/notifiers/`, each implementing the shared interface.
- Notification-sending logic lives only on the diff engine → dispatcher path.
- Any string a human reads is a catalog key, written in English first.
- Secrets from environment variables only — never a config file, never a database,
  never a log line. The UI edition's `secretsFile.ts` is the one writer, and it
  writes variables, not config.
- New dashboard surfaces get prototyped in `design/` before implementation.
- A shadcn component exists for most surfaces — use it, and `cn()` for conditional
  classes, rather than writing a new component class.
- Colours reach a chart only through `chartConfig`, never as a literal and never
  as a runtime-built token name.

### 9.6 Releasing

Two workflows, and the version lives in exactly one place.

`.github/workflows/ci.yml` runs on every pull request and on every push to `dev`
or `main`: Node from `.nvmrc`, `npm ci`, then the same four commands a
contributor runs locally — `typecheck`, `test`, `test:integration`, `build`.

A release is a tag. `package.json` stays `private` (nothing is published to
npm) but its `version` is the single source of truth:

```bash
npm version minor          # preversion runs typecheck + both test suites first,
                           # then the commit and the vX.Y.Z tag are created
git push --follow-tags
```

Pushing the tag runs `.github/workflows/release.yml`, which re-runs the checks
(a tag push does not trigger CI), refuses to continue if the tag and
`package.json` disagree, builds both targets for `linux/amd64` and
`linux/arm64`, pushes the four GHCR tags with an SBOM and provenance, signs both
digests with keyless `cosign`, and creates the GitHub release.

The release notes are generated from the log by `tools/release-notes.mjs`, which
leans on the commit convention: `<emoji> <TITLE> - <description>` parses, so the
changelog is grouped by surface (`POLLER`, `UI`, `DOCKER`, …) rather than being a
commit dump. Preview it for any range before tagging:

```bash
npm run release-notes -- v0.1.0 HEAD
```
- Commits: `<emoji> <TITLE> - <description>`, English, gitmoji.
