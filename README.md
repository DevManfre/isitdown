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
- **Configuration**: fully manageable through the UI — add/remove monitored services, set polling interval, configure notification channels, all persisted to the State Store (SQLite) instead of a static file. No restart required to apply changes.
- **Dashboard**: local web page showing:
  - A status grid (green/yellow/red cards) for each monitored service, refreshed in near real time.
  - **Status-page-style charts** per service: uptime percentage over time (7/30/90-day view), an incident timeline/history, and current active incidents with details — visually similar to the status pages being monitored (e.g. Statuspage.io-style bar/heatmap of daily uptime).
  - A settings panel to manage services and notification integrations.
  - A **theme toggle** (light / dark / follow system) in the header, applied instantly with no page reload.
  - A **language selector** in the header, switching every dashboard string at runtime.
- **Docker image tag**: `statuswatch:ui`

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
   Triggers a polling cycle at a configurable interval (default: every 2–5 minutes). Implemented with `node-cron` or a simple `setInterval` loop with jitter to avoid thundering-herd requests.

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
   Persists the last known `NormalizedStatus` per provider. SQLite (via `better-sqlite3`) is recommended for durability across restarts; a flat JSON file is acceptable for v1 and easier to inspect/debug.

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

7. **HTTP API / Dashboard (optional, v2)**
   A minimal Express server exposing:
   - `GET /health` — container liveness check
   - `GET /status` — current normalized status of all providers (JSON)
   - `GET /` — simple static HTML dashboard (no framework needed, just fetch `/status` and render)
   - `GET /api/preferences` / `PATCH /api/preferences` — theme (`light`/`dark`/`system`), UI locale, notification locale
   - `GET /locales/:lang.json` — dashboard string catalog for the requested language (404 → client falls back to `en`)

---

## 4. Configuration

All service definitions live in a single `config.yml`, mounted as a volume so it can be edited without rebuilding the image:

```yaml
pollIntervalMinutes: 3
locale: en          # language for notification messages: en | it (falls back to en)

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
    baseUrl: https://status.anthropic.com

notifications:
  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
  discordWebhook:
    enabled: false
    url: "${DISCORD_WEBHOOK_URL}"
  genericWebhook:
    enabled: false
    url: ""
```

Secrets (`TELEGRAM_BOT_TOKEN`, etc.) are injected via environment variables / `.env` file — never committed to the repo.

---

## 5. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20 (LTS) | matches your existing stack |
| Language | TypeScript | type safety for adapters/config |
| HTTP client | `undici` or `axios` | undici is faster, native to Node |
| Scheduling | `node-cron` | simple cron syntax support |
| Storage | SQLite (`better-sqlite3`) or JSON file | start with JSON, migrate if needed |
| Config parsing | `yaml` + `zod` | zod for runtime schema validation |
| Notifications | native `fetch` calls to provider APIs | no heavy SDKs needed |
| Container | Docker, multi-stage build | small final image (`node:20-alpine`) |
| Optional dashboard | Express + plain HTML/CSS | no need for a frontend framework |
| Theming | CSS custom properties + `data-theme` attribute | no CSS framework, no runtime style lib |
| i18n | flat JSON catalogs + native `Intl.*` | no i18n framework (i18next etc.) needed at this size |

---

## 6. Docker Setup

Both editions are built from the same source tree via multi-stage Dockerfiles, differing mainly in the final runtime stage (whether the HTTP/dashboard layer is included) and in the entrypoint.

### Dockerfile — Light edition (`Dockerfile.light`)
```dockerfile
# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:light

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist/light ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
VOLUME ["/app/config", "/app/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node dist/healthcheck.js
CMD ["node", "dist/index.js"]
```
No `EXPOSE`, no HTTP server dependency — this build only runs the polling/notification loop.

### Dockerfile — UI edition (`Dockerfile.ui`)
```dockerfile
# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:ui

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist/ui ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node dist/healthcheck.js
CMD ["node", "dist/server.js"]
```
Note there's no `config.yml` volume here: in the UI edition, configuration lives in the SQLite database (managed entirely through the dashboard), not in a mounted file.

### docker-compose.yml (both services defined, run whichever you need)
```yaml
version: "3.9"
services:
  statuswatch-light:
    build:
      context: .
      dockerfile: Dockerfile.light
    container_name: statuswatch-light
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./config.yml:/app/config/config.yml:ro
      - statuswatch-light-data:/app/data
    profiles: ["light"]

  statuswatch-ui:
    build:
      context: .
      dockerfile: Dockerfile.ui
    container_name: statuswatch-ui
    restart: unless-stopped
    env_file: .env
    ports:
      - "3000:3000"
    volumes:
      - statuswatch-ui-data:/app/data
    profiles: ["ui"]

volumes:
  statuswatch-light-data:
  statuswatch-ui-data:
```
Run with `docker compose --profile light up -d` or `docker compose --profile ui up -d`, depending on which edition you want.

---

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

- **Unit tests** for each adapter, using recorded/fixture JSON responses (no live network calls in CI).
- **Unit tests** for the Diff Engine with table-driven cases (no change / status change / new incident / incident resolved).
- **Integration test**: spin up the container, mock the config with a fake local HTTP server standing in for a provider, assert a notification is sent on a simulated status change.
- **Locale catalog parity test**: every non-`en` catalog (notifications and dashboard) must have exactly the key set of `en` — the test fails on a missing or orphaned key, so a new string can't ship half-translated unnoticed.
- **Notifier localization test**: same status transition rendered in each locale, asserting the message differs, the timestamp stays UTC, and an unknown locale falls back to `en`.
- **Theme test**: the token block defines every `--color-*` variable in both light and dark, and no stylesheet outside it contains a raw hex color.

---

## 10. Roadmap / Future Enhancements

- **v1 — Light edition**: polling + Telegram notifications + file-based config + JSON/YAML state store + Docker image (`statuswatch:light`). This is the first thing to ship — it validates the core engine before any UI work starts.
- **v1.1 — UI prototyping**: design exploration in Claude Design for the dashboard — status grid, uptime charts, incident timeline, settings panel. No real backend yet, purely visual/interaction validation.
- **v1.2 — UI edition, first pass**: implement the validated design as a real Express + HTML/CSS dashboard, backed by SQLite; move configuration fully into the UI (add/edit/remove services and notification channels at runtime, no file editing). Ship as `statuswatch:ui`.
- **v1.3**: historical incident log + uptime percentage per provider with the status-page-style charts (daily uptime bars, 7/30/90-day views), served from `/history`.
- **v1.4 — dark mode + i18n**: CSS-token theming with the light/dark/system toggle and persisted preference; localized dashboard (`en`, `it`) plus localized notification messages shared by both editions (`locale` in `config.yml` for Light, DB setting for UI). Dark palette and translated label lengths validated in Claude Design before implementation.
- **v2**: pluggable adapter marketplace (community-contributed adapters for niche providers), Discord/Slack rich embeds, multi-recipient notification routing (different channels per provider severity) — available in both editions where applicable.

---

## 11. Suggested Repo Structure

The core engine is shared; each edition has its own thin entrypoint and edition-specific config/storage layer.

```
statuswatch/
├── src/
│   ├── core/                      (shared by both editions)
│   │   ├── poller.ts
│   │   ├── diffEngine.ts
│   │   ├── stateStore.interface.ts
│   │   └── i18n/                  (notification strings, edition-agnostic)
│   │       ├── index.ts           (lookup + `en` fallback + Intl formatting)
│   │       ├── en.json
│   │       └── it.json
│   ├── adapters/                  (shared)
│   │   ├── statuspage.adapter.ts
│   │   └── index.ts
│   ├── notifiers/                 (shared)
│   │   ├── telegram.notifier.ts
│   │   ├── webhook.notifier.ts
│   │   └── index.ts
│   ├── light/                     (Light edition only)
│   │   ├── config/
│   │   │   ├── schema.ts          (zod schema)
│   │   │   └── loadConfig.ts
│   │   ├── fileStateStore.ts      (JSON/YAML implementation)
│   │   ├── healthcheck.ts
│   │   └── index.ts
│   └── ui/                        (UI edition only)
│       ├── server.ts              (Express API)
│       ├── sqliteStateStore.ts    (SQLite implementation)
│       ├── routes/
│       │   ├── status.routes.ts
│       │   ├── config.routes.ts
│       │   ├── history.routes.ts
│       │   └── preferences.routes.ts  (theme + locale)
│       ├── public/                (dashboard: HTML/CSS/JS, or built frontend)
│       │   ├── css/
│       │   │   └── tokens.css     (light + dark color tokens, single source)
│       │   ├── js/
│       │   │   ├── theme.js       (toggle, persistence, pre-paint init)
│       │   │   └── i18n.js        (catalog loading, data-i18n application)
│       │   └── locales/
│       │       ├── en.json
│       │       └── it.json
│       └── healthcheck.ts
├── design/
│   └── claude-design-prototypes/  (exported mockups/prototypes from Claude Design)
├── config.example.yml             (Light edition only)
├── .env.example
├── Dockerfile.light
├── Dockerfile.ui
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── .mergeexclude                  (paths that must never reach `main` — see section 12)
├── .githooks/                     (versioned hooks, enabled by scripts/setup-hooks.sh)
├── scripts/
│   ├── git-merge-clean            (branch-aware merge wrapper)
│   └── setup-hooks.sh             (one-time setup after cloning)
└── README.md
```

---

## 12. Branch Layout & Merge Policy

The Claude Code tooling (`.claude/` and `CLAUDE.md`) is tracked on **`dev` only**.
On `main` those paths must not exist — neither in the commit nor in the working
tree. Everything else (source, docs, config) flows normally from `dev` to `main`.

### After cloning

Run this once per clone. Git never runs hooks straight from a clone, so it
cannot be automatic:

```bash
scripts/setup-hooks.sh
```

It sets `core.hooksPath` to `.githooks/`, points the purge reference at `dev`,
and installs the `git mergeclean` alias.

### Merging into `main`

```bash
git switch main
git mergeclean dev        # not `git merge dev`
```

`git mergeclean` merges the branch, drops the paths listed in `.mergeexclude`
from the merge, commits with the repo's `🔀` subject format, and removes those
paths from the working tree. It refuses to run on a dirty tree. Genuine
conflicts outside the excluded paths stop the run so you can resolve them and
`git commit` as usual.

### What enforces it

| Piece | Role |
|---|---|
| `.mergeexclude` | the path list |
| `scripts/git-merge-clean` | the merge wrapper (`--sync` purges, `--guard` checks) |
| `.githooks/post-checkout` | purges the excluded paths after a branch switch |
| `.githooks/pre-merge-commit`, `.githooks/pre-commit` | abort any commit that would add an excluded path to a branch that does not track it |

A plain `git merge dev` on `main` is refused by the guard hooks — run
`git merge --abort` and use `git mergeclean` instead. `git commit --no-verify`
bypasses the guard if you ever genuinely need to.

### Rules of thumb

- Edit `.claude/` and `CLAUDE.md` only while on `dev` — on `main` they do not exist.
- The purge only deletes files that `dev` also has and that are byte-identical to
  it, so machine-local files (`.claude/settings.local.json`) and local edits are
  never touched.
