# StatusWatch — Technical Specification

## 1. Overview

StatusWatch is a self-hosted, containerized service that continuously monitors the public status pages of third-party providers (e.g. GitHub, Anthropic/Claude, Cloudflare, AWS, npm, etc.) and notifies the operator when an incident, degradation, or outage is detected.

The goal is to give a single developer or small team early visibility into upstream issues that might affect their own services — without needing to manually check five different status dashboards.

### Core principles
- **Zero external dependencies at runtime** beyond the container itself (no mandatory external DB server — SQLite or a flat JSON file is enough for this scale).
- **Config-driven**: adding a new service to monitor should never require touching code, only a config file.
- **Idempotent notifications**: never spam — notify only on state *transitions* (operational → degraded, degraded → outage, outage → resolved), not on every poll.
- **Provider-agnostic**: most major providers use the Atlassian Statuspage platform, but the system should support pluggable "adapters" for providers with custom formats.

---

## Quick start

Requires **Node 24** (`.nvmrc` pins it; `npm install` refuses an older one).

Light edition — polling and notifications, no server:

```bash
npm install
cp config.example.yml config.yml    # edit it: add or remove providers
cp .env.example .env                # fill in only the channels you enable
npm run build:light && node dist/light/index.js
```

UI edition — the same engine plus the dashboard on :3000:

```bash
npm run build:ui && node dist/ui/server.js
# then open http://localhost:3000
```

In Docker:

```bash
docker compose --profile light up -d --build   # needs ./config.yml and .env
docker compose --profile ui    up -d --build   # no config.yml; open :3000
```

Tests and checks:

```bash
npm test                 # unit suite
npm run test:integration # end to end, against a fake provider
npm run typecheck        # server TypeScript and the dashboard JavaScript
```

---

## 2. Product Editions

StatusWatch ships as **two distinct editions**, sharing the same core engine (Poller, Adapters, State Store, Diff Engine, Notifier) but differing in how they're configured and consumed.

### 2.1 Light Edition
- **Target user**: developers who just want the service running in the background with minimal footprint.
- **Configuration**: code/file-only — a single `config.yml` (or `config.ts`), edited by hand and loaded at container startup. No runtime UI to change settings; any change requires editing the file and restarting/reloading the container.
- **Output**: notifications only (Telegram/Discord/Slack/webhook). No web server, no dashboard, no persistent history beyond what's needed for the Diff Engine to detect state changes.
- **Footprint**: smallest possible image, no HTTP server dependency at all, minimal memory/CPU usage — ideal for a small VPS or a Raspberry Pi.
- **Language**: notification messages are localized via a top-level `locale` key in `config.yml` (see section 2.5). No theme setting — there is no UI to theme.
- **Docker image tag**: `statuswatch:light`

### 2.2 UI Edition
- **Target user**: users who want visibility and control without touching config files — everything through a local web page.
- **Configuration**: fully manageable through the UI — add/remove monitored services, set the polling interval, timeout and retries, enable notification channels. Everything is persisted to SQLite instead of a static file, and the scheduler re-reads it every cycle, so **no restart is needed** and no `config.yml` is mounted at all.
- **Dashboard** (design `3a` in `design/claude-design-prototypes/`), five views plus an incident detail:
  - **Overview** — the headline state, a ring per provider with its 90-day uptime, and a daily uptime bar row per provider.
  - **Providers** — a table with status, an inline uptime strip, uptime, 90-day incident count, poll interval and adapter, with edit/remove and an add-service dialog.
  - **Incidents** — active incidents, the feed of notifications actually sent, and the closed list.
  - **Incident detail** — the status stepper, the timeline of what StatusWatch observed, the log of what it sent, the provider's other open incidents, and the last 24 polls.
  - **History** — aggregate uptime, four month columns, and per-provider 7/30/90-day figures with daily bars.
  - **Settings** — polling, the service list, and the notification channels.
  - A **theme toggle** (light / dark / system) and a **language switch** (EN / IT) in the header, both applied instantly with no page reload.
- **Docker image tag**: `statuswatch:ui`, built `FROM` the Light image so it is that image plus one thin layer.
- **Environment**: `PORT` (default 3000), `DB_PATH` (default `/app/data/statuswatch.db`), `LOG_LEVEL`, plus whichever channel secrets are in use.

#### Secrets in the dashboard

The design prototype draws editable credential fields. The implementation
deliberately does not, because secrets come from the environment only:

- The `channels` table stores the **name** of the environment variable carrying each credential (`botTokenEnv: "TELEGRAM_BOT_TOKEN"`), never a value.
- Settings shows that name, and whether it currently resolves — the name is editable, the value is not.
- `PATCH /config/channels/:id` **refuses** a request carrying a literal secret, so the database is never given the chance to hold one.
- No API response, DOM node, log line or thrown error contains a resolved secret. Tests assert this.

A channel enabled in the database whose variable is unset is skipped for that
cycle with a warning rather than crashing the dashboard — the Light edition
treats the same situation as a fatal startup error, because it has no UI in which
an operator could see and fix it.

### 2.3 Shared vs. edition-specific components

| Component | Light | UI |
|---|---|---|
| Poller / Adapters / Diff Engine | ✅ shared | ✅ shared |
| Notifier | ✅ shared | ✅ shared |
| State Store | flat JSON/YAML file | SQLite (needed for history + charts) |
| Configuration | static file, code-level | dynamic, via UI, persisted to DB |
| HTTP server | ❌ not included | ✅ required (API + dashboard) |
| Charts/history | ❌ not available | ✅ core feature |
| Dark mode | ❌ n/a (no UI) | ✅ toggle: light / dark / system |
| Localization (i18n) | ✅ notifications only, `locale` in `config.yml` | ✅ notifications + full dashboard, switchable at runtime |

### 2.4 UI prototyping approach

Before building the real dashboard in code, the plan is to **prototype the interface with Claude Design first** — exploring layout, status-grid styling, and chart types (uptime bars, incident timeline) as static mockups/interactive prototypes. Only once the UI direction is validated there does it get implemented as the actual Express/HTML (or lightweight frontend) dashboard described in section 2.2. This avoids committing to a dashboard implementation before the visual design and information hierarchy are settled. Both the dark palette and the localized string lengths (German/Italian labels are longer than English ones and break tight layouts) are part of what gets validated in the prototype, not an afterthought.

### 2.5 Dark mode toggle

UI edition only. The dashboard ships light and dark themes with an explicit three-state control: **light / dark / system**.

- **Tokens, not per-component colors**: every color is a CSS custom property defined once on `:root` (light) and overridden in a `:root[data-theme="dark"]` block. Components reference `var(--...)` only — no hardcoded hex outside the token block. The charts (uptime bars, timeline) read their colors from the same tokens, so they never need a separate dark palette.
- **System default**: with no explicit choice stored, the theme follows `prefers-color-scheme` and reacts live to OS changes.
- **Persistence**: the choice is stored client-side (`localStorage`) *and* in the SQLite settings table, so it survives both a browser reload and a fresh browser on the same instance.
- **No flash of wrong theme**: a tiny inline script in `<head>` sets `data-theme` on the root element before first paint — after the stylesheet, before the body renders.
- **Status colors stay legible**: green/yellow/red status cards get dark-mode variants that keep at least WCAG AA contrast against the dark surface, rather than reusing the light-mode hues at lower luminance.
- **API**: `GET /api/preferences` / `PATCH /api/preferences` (`{ theme: "light" | "dark" | "system" }`), served by `preferences.routes.ts`.

### 2.6 Multi-language support (i18n)

Localization spans **both editions**, split in two layers:

- **Notification messages (shared, both editions)**: message text lives in `src/core/i18n/`, edition-agnostic like the rest of core. Notifiers ask the i18n module for a translated, formatted string; the Diff Engine stays language-unaware and keeps passing structured payloads. Formatting (emoji, layout) still lives in the notifier — only the strings move.
- **Dashboard UI (UI edition only)**: flat JSON catalogs under `src/ui/public/locales/<lang>.json`, loaded on demand and applied client-side to `data-i18n` marked nodes. Switching language does not reload the page.

Rules:

- **`en` is the source locale** and the fallback for any missing key: a missing translation renders the English string, never an empty node or a raw key.
- **Catalogs are flat key/value JSON** (`"status.operational": "Operational"`) validated with `zod` at load time, like every other external input.
- **Locale resolution order**: stored user preference → `Accept-Language` / `navigator.language` → `en`.
- **Dates, numbers, percentages, and relative times** go through `Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.RelativeTimeFormat` with the active locale — never hand-built format strings. Timestamps in notifications stay UTC with an explicit `UTC` suffix regardless of locale, to avoid ambiguity.
- **Initial locales**: `en` (source) and `it`. Adding a language means adding one JSON file per layer plus an entry in the locale registry — no code changes.
- **Light edition config**: top-level `locale: en` in `config.yml` (see section 4). **UI edition**: a setting in the DB, changeable from the dashboard; the notification locale and the dashboard locale are separate fields, so an operator can read an English UI and receive Italian alerts.
- **API**: the same `preferences` endpoint carries `{ uiLocale, notificationLocale }`.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     StatusWatch Container                │
│                                                           │
│  ┌────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │  Scheduler │───▶│   Poller     │───▶│   Adapters   │ │
│  │ (cron-like)│    │ (fetch loop) │    │ (per-provider│ │
│  └────────────┘    └──────┬───────┘    │   parsers)   │ │
│                            │            └──────────────┘ │
│                            ▼                              │
│                    ┌───────────────┐                      │
│                    │  State Store  │  (SQLite/JSON file)  │
│                    │ last known    │                      │
│                    │ status/hash   │                      │
│                    └──────┬────────┘                       │
│                            │                              │
│                            ▼                              │
│                    ┌───────────────┐                      │
│                    │ Diff Engine   │  (compares new vs.  │
│                    │               │   stored state)      │
│                    └──────┬────────┘                       │
│                            │ (only on change)              │
│                            ▼                              │
│                    ┌───────────────┐                      │
│                    │   Notifier    │──▶ Telegram / Slack /│
│                    │  (dispatcher) │    Discord / Webhook  │
│                    └───────────────┘                      │
│                                                           │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Optional: lightweight HTTP API / dashboard          │ │
│  │  (health check + current status JSON + simple UI)   │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Components

1. **Scheduler**
   Triggers a polling cycle at a configurable interval (default: every 3 minutes). A `setTimeout` re-armed after each cycle, with up to 10% jitter either way, so a slow cycle delays the next one instead of overlapping it and a fleet of instances does not hit a provider in lockstep. The configuration is re-read on every cycle, which is what lets the UI edition change providers, intervals and channels without a restart.

2. **Poller**
   For each configured service, performs an HTTP GET against its status endpoint. Handles timeouts, retries (exponential backoff, max 3 attempts), and per-request error isolation (one failing provider must never block the others — use `Promise.allSettled`).

3. **Adapters**
   Each provider has an adapter responsible for turning a raw HTTP response into a normalized internal shape:
   ```ts
   interface NormalizedStatus {
     provider: string;          // "github"
     overallStatus: "operational" | "degraded" | "partial_outage" | "major_outage" | "unknown";
     activeIncidents: {
       id: string;
       name: string;
       impact: string;
       status: string;
       updatedAt: string;
     }[];
     fetchedAt: string;
   }
   ```
   - **StatuspageAdapter** (generic): works for any provider using Atlassian Statuspage (`/api/v2/summary.json`) — covers GitHub, Cloudflare, most likely Anthropic too. This should be the default adapter, configurable just by base URL.
   - **CustomAdapter**: fallback for providers with a non-standard API, implemented as needed (e.g. scraping an HTML page with a CSS selector, defined in config).

4. **State Store**
   Persists the last known `NormalizedStatus` per provider, plus a consecutive-failure count and whether the "monitoring degraded" warning has already been sent. The Light edition uses a JSON file, rewritten through a temporary file and a rename so a crash mid-write cannot truncate it; the UI edition uses SQLite through the built-in `node:sqlite`, which also carries the history the charts need. Both implementations pass the same contract suite, so they are interchangeable.

   A failed fetch never overwrites the stored status: keeping the last known state is what stops the next successful poll from being reported as a recovery that never happened.

5. **Diff Engine**
   Compares the freshly fetched status against the stored one. Triggers a notification only when:
   - `overallStatus` changes, OR
   - a new incident appears, OR
   - an existing incident's `status` field changes (e.g. "investigating" → "resolved").

6. **Notifier**
   Dispatches formatted messages to one or more configured channels. Each channel is a pluggable module implementing a common `send(message: NotificationPayload): Promise<void>` interface.
   - Telegram Bot API (primary, recommended — free, simple, push to phone)
   - Discord Webhook
   - Slack Webhook
   - Generic Webhook (POST JSON to any URL, for custom integrations)
   - Email (SMTP) — optional, lower priority

7. **HTTP API / Dashboard** (UI edition)
   An Express server in the same process as the scheduler:

   | Method | Path | Purpose |
   |---|---|---|
   | GET | `/health` | container liveness |
   | GET | `/status` | current status of every provider, last/next poll — a pure database read, safe to poll every 30s |
   | GET | `/history?provider=&days=` | pre-aggregated daily buckets, 7/30/90-day uptime, month columns (`days` accepts 7, 30 or 90) |
   | GET | `/incidents?provider=` | active and closed incidents |
   | GET | `/incidents/:providerId/:incidentId` | detail: timeline, action log, other open incidents, last 24 polls |
   | GET | `/notifications?limit=` | what was actually sent, newest first |
   | GET | `/config` | services, polling settings, channels (variable names only) |
   | POST | `/config/services` · PATCH/DELETE `/config/services/:id` | service CRUD, validated with the shared zod schema |
   | PATCH | `/config/settings` | polling settings |
   | PATCH | `/config/channels/:id` | channel enable/disable and variable names |
   | POST | `/config/services/:id/test` | one live fetch; records nothing |
   | POST | `/config/channels/:id/test` | one test notification, through the dispatcher |
   | GET, PATCH | `/api/preferences` | theme, UI locale, notification locale |
   | GET | `/locales/:lang.json` | dashboard catalog; 404 → the client falls back to `en` |
   | POST | `/poll` | run a cycle now, through the scheduler |
   | GET | `/` | the dashboard |

   Deleting a service cascades to its samples, incidents and stored state, so a
   removed provider leaves no orphaned history behind.

---

## 4. Configuration

Light edition only. All service definitions live in a single `config.yml`,
mounted as a volume so it can be edited without rebuilding the image; the loader
re-reads it every cycle, so an edit applies on the next poll. `config.example.yml`
in the repo is the tracked template — `config.yml` itself is git-ignored, since it
carries an operator's own provider list.

```yaml
pollIntervalMinutes: 3      # how often to poll every provider
requestTimeoutSeconds: 8    # per-request timeout
maxRetries: 3               # attempts per provider per cycle, with backoff
failureThreshold: 5         # consecutive failures before a "monitoring degraded" warning
locale: en                  # language for notification messages: en | it (falls back to en)

services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com

  - name: Cloudflare
    id: cloudflare
    adapter: statuspage
    baseUrl: https://www.cloudflarestatus.com

  - name: Anthropic
    id: anthropic
    adapter: statuspage
    baseUrl: https://status.claude.com

notifications:
  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
  webhook:
    enabled: false
    url: "${WEBHOOK_URL}"
```

Every field except `services` is optional and falls back to the value shown above.

**Secrets never appear in this file.** `${VAR}` references are resolved from the
environment (see `.env.example`); an enabled channel whose variable is unset is a
fatal startup error naming the variable, and a resolved secret is never written to
the state file or to a log line.

Anything invalid — a missing file, malformed YAML, a bad base URL, a duplicate
service id, an empty service list — stops the container at boot with the reason
and the offending path. A container that starts with a half-understood
configuration would look healthy while silently not alerting.

### Supported providers

Any provider running Atlassian Statuspage works with the generic `statuspage`
adapter and no code: if `<domain>/api/v2/summary.json` returns JSON with `status`
and `incidents`, just add an entry. Verified:

| Provider | `baseUrl` | Adapter |
|---|---|---|
| GitHub | `https://www.githubstatus.com` | `statuspage` (generic) |
| Cloudflare | `https://www.cloudflarestatus.com` | `statuspage` (generic) |
| Anthropic / Claude | `https://status.claude.com` | `statuspage` (generic) |

`status.anthropic.com` issues a 301 to `status.claude.com`. The adapter follows
redirects, so either host works; the canonical one avoids the extra hop.

The provider's own `status.indicator` maps onto the internal severity model as
`none → operational`, `minor → degraded`, `major → partial_outage`,
`critical → major_outage`. An indicator we have never seen maps to
`major_outage`, and a summary with no `status` object at all maps to `unknown` —
severity is never silently downgraded.

For a provider with a non-standard status page, add an adapter under
`src/adapters/` (see the `add-status-adapter` skill).

### Notification channels

| Channel | Config key | Required environment variables |
|---|---|---|
| Telegram Bot API | `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Generic webhook (POST JSON) | `webhook` | `WEBHOOK_URL` |

The webhook posts `{ change, service, message }`, so a consumer can either
display the rendered text or route on the structured fields. Discord and Slack
are webhook-shaped and are the natural next channels (see the
`add-notifier-channel` skill).

## 5. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24 (LTS) | required: the built-in SQLite driver and native TypeScript type stripping both need it |
| Language | TypeScript, strict | `erasableSyntaxOnly` + `rewriteRelativeImportExtensions`, so `tsc` emits real `.js` while `node --test` runs the `.ts` sources directly |
| HTTP client | global `fetch` | already in the runtime; no dependency needed |
| Scheduling | `setTimeout` re-armed after each cycle, with jitter | a slow cycle delays the next instead of overlapping it; no `node-cron` dependency |
| Storage | JSON file (Light) · built-in `node:sqlite` (UI) | no native module, so no compiler in any build stage |
| Config parsing | `yaml` + `zod` | zod validates every external input, including provider JSON |
| Notifications | native `fetch` to each channel's API | no SDKs |
| Test runner | built-in `node:test` | no test framework dependency |
| Container | Docker, one multi-stage Dockerfile | `--target light` / `--target ui`; `node:24-alpine` |
| Dashboard | Express + vanilla ES modules and plain CSS | no framework, no bundler, no chart library |
| Theming | CSS custom properties + `data-theme` attribute | one token file is the only place a hex colour appears |
| i18n | flat JSON catalogs + native `Intl.*` | no i18n framework needed at this size |

Runtime dependencies, exhaustively: `zod`, `yaml` (both editions) and `express`
(UI edition). Dev dependencies: `typescript`, `@types/node`.

## 6. Docker Setup

Both editions come from one source tree and **one** `Dockerfile` with named
stages. The `ui` stage begins `FROM light`, so the UI image is the Light image
plus a single thin layer — base image, production dependencies and the whole core
engine are shared on disk and in a registry.

```
builder  node:24-alpine   npm ci, tsc, copy non-TS assets into dist
light    node:24-alpine   production deps + dist/{core,adapters,notifiers,light}
                          VOLUME /app/config /app/data, no EXPOSE, no server
ui       FROM light       + dist/ui (dashboard and locales included), EXPOSE 3000
```

### Building

```bash
docker build --target light -t statuswatch:light .
docker build --target ui    -t statuswatch:ui    .
```

### Running

```bash
docker compose --profile light up -d --build   # needs ./config.yml and .env; no port
docker compose --profile ui    up -d --build   # exposes :3000; config lives in SQLite
```

`docker-compose.yml` defines both services, each building this one `Dockerfile`
with its own `target`. The Light service mounts `config.yml` read-only and a
named volume for its state file. The UI service mounts only a data volume: its
configuration lives in SQLite, managed from the dashboard.

Both images run as the unprivileged `node` user, carry a `HEALTHCHECK` with a
start period, and bake in no secret — those arrive at runtime through `env_file`.

The Light edition has no server to probe, so its healthcheck uses the state
file's age: every cycle rewrites it, and three intervals without a write is
unhealthy.

## 7. Notification Message Format (example)

```
🔴 GitHub — MAJOR OUTAGE

Incident: API requests failing intermittently
Status: investigating
Updated: 2026-08-19 14:32 UTC

https://www.githubstatus.com
```

```
🟢 GitHub — RESOLVED

Previous incident "API requests failing intermittently" has been resolved.
```

---

## 8. Resilience & Edge Cases

- **Provider API unreachable**: log the failure, keep the last known state, retry next cycle. After N consecutive failures (configurable, e.g. 5), send a single "monitoring degraded for X" warning — don't fail silently forever.
- **Adapter parsing errors**: wrap each adapter call in try/catch; a malformed response from one provider must not crash the whole poll cycle.
- **Duplicate notifications**: the Diff Engine is the single source of truth for "should I notify" — no notification logic should live elsewhere.
- **Container restart**: state must be reloaded from the persisted store on boot, so a restart doesn't cause a false "everything just changed" notification burst.
- **Rate limiting**: respect any provider rate limits; stagger requests slightly rather than firing all in parallel at the exact same millisecond.

---

## 9. Testing Strategy

`npm test` runs the unit suite (`test/**/*.test.ts`); `npm run test:integration`
runs the end-to-end suite (`test/**/*.itest.ts`). Both use the built-in
`node:test` runner. **No test ever touches a live provider.**

- **Diff engine** — one table covering every transition, including the ones that
  must *not* notify: a first poll, a reordered incident list, a timestamp bump,
  and `unknown` on either side. New edge cases are added as rows.
- **Adapters** — tested against payloads recorded from the live status pages and
  kept under `test/fixtures/<provider>/`, plus a malformed one and an unrecognised
  indicator. The HTTP behaviour (redirects, non-2xx, timeout, non-JSON body) runs
  against a local server.
- **State store** — `test/core/stateStore.contract.ts` is one suite that every
  implementation must pass, so the Light and UI stores are provably
  interchangeable. It includes the restart case: reload the store and assert the
  diff engine fires nothing.
- **Poller** — against a local stand-in provider: retry count and growing backoff,
  per-provider isolation, a hanging provider not blocking a healthy one, and the
  "monitoring degraded" warning firing once at the threshold and not repeating.
- **Scheduler** — with mocked timers and injected jitter: cadence, config re-read
  per cycle, a manual poll joining an in-flight cycle, and a failed cycle not
  killing the loop.
- **Notifiers** — outbound request shape per transition with `fetch` stubbed, plus
  the assertion that a failed Telegram send never puts the bot token in its error.
- **Locale parity** — every non-`en` catalog must have exactly `en`'s key set and
  the same placeholders in every value, so a string cannot ship half-translated.
- **End to end** — a fake provider and a webhook receiver: a transition delivers
  exactly one notification, an unchanged cycle delivers none, a restart delivers
  none, an unreachable provider keeps its last known state, and the entrypoint
  stays alive between cycles and exits 0 on `SIGTERM`.

## 10. Roadmap / Future Enhancements

Delivered:

- **v1 — Light edition**: polling, the diff engine, Telegram and generic-webhook notifications, `config.yml` with environment-referenced secrets, a JSON state store with atomic writes, `statuswatch:light`.
- **v1.1 — UI prototyping**: the dashboard explored in Claude Design and kept in `design/claude-design-prototypes/`; option `3a`, the navigable console, is the implementation reference.
- **v1.2 — UI edition**: the validated design as an Express + vanilla-ES-module dashboard over SQLite, with configuration managed at runtime and applied on the next cycle without a restart. `statuswatch:ui`, built `FROM` the Light image.
- **v1.3 — history**: per-provider uptime and incident history with the status-page daily bars and 7/30/90-day views, aggregated server-side and served from `/history`.
- **v1.4 — dark mode + i18n**: token-based light/dark/system theming with a persisted preference, and a localised dashboard (`en`, `it`) on top of the localised notification messages both editions already share.

Still open:

- More adapters for providers that are not on Atlassian Statuspage (the `statuspage` adapter already covers any that are).
- Discord and Slack channels with rich embeds — both are webhook-shaped, so they slot in behind the existing `Notifier` interface.
- Multi-recipient routing: different channels per provider or per severity.
- Scheduled-maintenance awareness. The adapter currently ignores Statuspage's `scheduled_maintenances`, and the severity model has no maintenance state.
- Component-level detail. The adapter normalises a provider's overall status and its incidents, not its individual components, so the incident view shows the provider's other open incidents where the prototype drew a components panel.

## 11. Repo Structure

The core engine is shared; each edition has its own thin entrypoint and
edition-specific configuration and storage layer.

```
statuswatch/
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
│   │   ├── diffEngine.ts               the sole authority on whether a notification fires
│   │   ├── notificationDispatcher.ts   the only caller of Notifier.send
│   │   ├── scheduler.ts                the loop; re-reads config every cycle
│   │   ├── logger.ts
│   │   └── i18n/                       notification strings, edition-agnostic
│   │       ├── index.ts                lookup + en fallback + UTC formatting
│   │       ├── en.json                 source locale
│   │       └── it.json
│   ├── adapters/                      (shared)
│   │   ├── statuspage.adapter.ts       generic Atlassian Statuspage adapter
│   │   └── index.ts                    registry keyed by adapter id
│   ├── notifiers/                     (shared)
│   │   ├── formatting.ts               emoji, severity labels, message assembly
│   │   ├── telegram.notifier.ts
│   │   ├── webhook.notifier.ts
│   │   └── index.ts                    registry keyed by channel id
│   ├── light/                         (Light edition only)
│   │   ├── index.ts                    entrypoint
│   │   ├── runtime.ts                  wiring, shared with the end-to-end test
│   │   ├── healthcheck.ts              state-file freshness
│   │   ├── fileStateStore.ts           JSON file, atomic writes
│   │   └── config/
│   │       ├── schema.ts               config.yml shape
│   │       └── loadConfig.ts           YAML + ${ENV} substitution + validation
│   └── ui/                            (UI edition only)
│       ├── server.ts                   entrypoint
│       ├── runtime.ts                  wiring, shared with the API tests
│       ├── app.ts                      Express app: routes, static dashboard, JSON errors
│       ├── healthcheck.ts              probes /health
│       ├── sqliteStateStore.ts         StateStore + history, one transaction per save
│       ├── historyStore.interface.ts   the history contract (UI is its only consumer)
│       ├── history.ts                  uptime and incident aggregation
│       ├── dbConfigSource.ts           config from SQLite; resolves secrets by variable name
│       ├── db/                         open.ts, migrate.ts, seed.ts
│       ├── routes/                     status, history, incidents, notifications, config, preferences
│       └── public/                     the dashboard: no framework, no bundler
│           ├── index.html              pre-paint theme script, rail, header, view container
│           ├── css/tokens.css          the only file with a colour literal
│           ├── css/nocturne.css        design-system component layer
│           ├── css/app.css             console layout
│           ├── js/                     app (router), api, i18n, theme, charts, components/, views/
│           └── locales/                en.json (source) + it.json
├── tools/
│   └── copy-assets.mjs                copies i18n catalogs and the dashboard into dist
├── test/
│   ├── core/                          diff engine, poller, scheduler, dispatcher, i18n, schemas
│   │   └── stateStore.contract.ts     one suite every StateStore implementation must pass
│   ├── adapters/
│   ├── notifiers/
│   ├── light/
│   ├── ui/                            store contract, aggregation, every API route, theme and locale guards
│   ├── fixtures/statuspage/           payloads recorded from the live pages, never fetched in a test
│   ├── helpers/
│   └── integration/                   *.itest.ts — fake provider and webhook receiver end to end
├── design/                            Claude Design prototypes for the UI dashboard
├── Dockerfile                         builder → light → ui (ui is FROM light)
├── docker-compose.yml                 both editions as profiles
├── config.example.yml                 tracked template; config.yml is git-ignored
└── .env.example                       secret variable names, never values
```

**Golden rule:** `src/core`, `src/adapters` and `src/notifiers` never import from
`src/light` or `src/ui`. Edition-specific behaviour is injected through the shared
interfaces instead.

## 12. Branch Layout & Merge Policy

The Claude Code tooling (`.claude/`, `CLAUDE.md`) and the merge filter itself
(`.mergeexclude`, `.githooks/`, `scripts/`) are tracked on **`dev` only**. On
`main` none of those paths exist — neither in the commit nor in the working tree.
Everything else (source, docs, config) flows normally from `dev` to `main`.

Because the filter is not readable from `main`, it is installed into this clone's
`.git` directory, which every branch shares.

### Setup, once per clone

```bash
git switch dev
scripts/setup-hooks.sh
```

It copies:

| From (`dev`) | To (shared by every branch) |
|---|---|
| `scripts/git-merge-clean` | `$GIT_DIR/merge-clean` |
| `.githooks/*` | `$GIT_DIR/hooks/*` |
| `.mergeexclude` | `$GIT_DIR/merge-exclude` |

and installs the `git mergeclean` alias. Re-run it after changing
`.mergeexclude` or `scripts/git-merge-clean`.

### Merging into `main`

```bash
git switch main
git mergeclean dev        # not `git merge dev`
```

`git mergeclean` merges the branch, drops the paths listed in the exclude list,
commits with the repo's `🔀` subject format, and removes those paths from the
working tree. It refuses to run on a dirty tree. Genuine conflicts outside the
excluded paths stop the run so you can resolve them and `git commit` as usual.

### What enforces it

| Piece | Role |
|---|---|
| `$GIT_DIR/merge-exclude` | the path list |
| `$GIT_DIR/merge-clean` | the merge wrapper (`--sync` purges, `--guard` checks) |
| `$GIT_DIR/hooks/post-checkout` | purges the excluded paths after a branch switch |
| `$GIT_DIR/hooks/pre-merge-commit`, `pre-commit` | abort any commit that would add an excluded path to a branch that does not track it |

A plain `git merge dev` on `main` is refused by the guard hooks — run
`git merge --abort` and use `git mergeclean` instead. `git commit --no-verify`
bypasses the guard if you ever genuinely need to.

### Consequences of keeping the filter off `main`

- **The setup is per clone and cannot be automatic.** Git never runs hooks taken
  from a clone, and a clone that only ever checks out `main` has nothing to
  install from. On a new machine, check out `dev` and run the setup before
  merging anything into `main`.
- **Until the setup is run, nothing is enforced.** A plain `git merge dev` on a
  fresh clone will pull `.claude/` and `CLAUDE.md` into `main` as soon as you
  resolve the conflicts it raises.

### Rules of thumb

- Edit `.claude/`, `CLAUDE.md`, `.mergeexclude`, `.githooks/` and `scripts/` only
  while on `dev` — on `main` they do not exist.
- The purge only deletes files that `dev` also has and that are byte-identical to
  it, so machine-local files (`.claude/settings.local.json`) and local edits are
  never touched.
