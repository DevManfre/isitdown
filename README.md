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
- **Docker image tag**: `statuswatch:light`

### 2.2 UI Edition
- **Target user**: users who want visibility and control without touching config files — everything through a local web page.
- **Configuration**: fully manageable through the UI — add/remove monitored services, set polling interval, configure notification channels, all persisted to the State Store (SQLite) instead of a static file. No restart required to apply changes.
- **Dashboard**: local web page showing:
  - A status grid (green/yellow/red cards) for each monitored service, refreshed in near real time.
  - **Status-page-style charts** per service: uptime percentage over time (7/30/90-day view), an incident timeline/history, and current active incidents with details — visually similar to the status pages being monitored (e.g. Statuspage.io-style bar/heatmap of daily uptime).
  - A settings panel to manage services and notification integrations.
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

### 2.4 UI prototyping approach

Before building the real dashboard in code, the plan is to **prototype the interface with Claude Design first** — exploring layout, status-grid styling, and chart types (uptime bars, incident timeline) as static mockups/interactive prototypes. Only once the UI direction is validated there does it get implemented as the actual Express/HTML (or lightweight frontend) dashboard described in section 2.2. This avoids committing to a dashboard implementation before the visual design and information hierarchy are settled.

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

---

## 4. Configuration

All service definitions live in a single `config.yml`, mounted as a volume so it can be edited without rebuilding the image:

```yaml
pollIntervalMinutes: 3

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

---

## 10. Roadmap / Future Enhancements

- **v1 — Light edition**: polling + Telegram notifications + file-based config + JSON/YAML state store + Docker image (`statuswatch:light`). This is the first thing to ship — it validates the core engine before any UI work starts.
- **v1.1 — UI prototyping**: design exploration in Claude Design for the dashboard — status grid, uptime charts, incident timeline, settings panel. No real backend yet, purely visual/interaction validation.
- **v1.2 — UI edition, first pass**: implement the validated design as a real Express + HTML/CSS dashboard, backed by SQLite; move configuration fully into the UI (add/edit/remove services and notification channels at runtime, no file editing). Ship as `statuswatch:ui`.
- **v1.3**: historical incident log + uptime percentage per provider with the status-page-style charts (daily uptime bars, 7/30/90-day views), served from `/history`.
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
│   │   └── stateStore.interface.ts
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
│       │   └── history.routes.ts
│       ├── public/                (dashboard: HTML/CSS/JS, or built frontend)
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
└── README.md
```
