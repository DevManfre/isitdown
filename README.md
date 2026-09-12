<p align="center">
  <img src="docs/img/social-preview.png" alt="IsItDown" width="880">
</p>

[![Release](https://img.shields.io/github/v/release/DevManfre/isitdown?style=flat-square)](https://github.com/DevManfre/isitdown/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/DevManfre/isitdown/ci.yml?branch=main&style=flat-square&label=CI)](.github/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-5FA04E?style=flat-square&logo=node.js&logoColor=white)](.nvmrc)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](tsconfig.json)
[![Dashboard](https://img.shields.io/badge/dashboard-react-61DAFB?style=flat-square&logo=react&logoColor=black)](#92-tech-stack)

[![Runtime dependencies](https://img.shields.io/badge/runtime%20deps-3-lightgrey?style=flat-square)](#92-tech-stack)
[![Docker](https://img.shields.io/badge/docker-light%20%7C%20ui-2496ED?style=flat-square&logo=docker&logoColor=white)](#4-docker)
[![i18n](https://img.shields.io/badge/i18n-en%20%7C%20it-orange?style=flat-square)](#82-localisation)

**English** · [Italiano](README.it.md)

Self-hosted, containerized monitoring for **other people's** status pages. It polls
the public status pages of the providers you depend on — GitHub, Cloudflare,
Anthropic, npm, anything running Atlassian Statuspage — and messages you when one
of them changes state.

It exists so a single developer or a small team gets early warning about upstream
trouble without keeping five status dashboards open. It notifies on *transitions*,
never on every poll, so a quiet week is a silent week.

Two editions from one codebase: **Light** (polling and notifications only, no
server) and **UI** (the same engine plus a local dashboard, configured at runtime).

## Contents

- [1. What it does](#1-what-it-does)
  - [Core principles](#core-principles)
  - [The two editions](#the-two-editions)
- [2. Quick start](#2-quick-start)
  - [2.1 With Docker](#21-with-docker)
  - [2.2 Without Docker](#22-without-docker)
- [3. Configuration](#3-configuration)
  - [3.1 Light edition — config.yml](#31-light-edition--configyml)
  - [3.2 UI edition — runtime settings](#32-ui-edition--runtime-settings)
  - [3.3 Environment variables](#33-environment-variables)
  - [3.4 How secrets are handled](#34-how-secrets-are-handled)
  - [3.5 Monitored providers](#35-monitored-providers)
  - [3.6 Notification channels](#36-notification-channels)
  - [3.7 Notification routing](#37-notification-routing)
  - [3.8 Delivery policy — quiet hours, digests, caps](#38-delivery-policy--quiet-hours-digests-caps)
  - [3.9 Validating a config.yml — the check command](#39-validating-a-configyml--the-check-command)
  - [3.10 Provider groups — my stack](#310-provider-groups--my-stack)
- [4. Docker](#4-docker)
  - [4.1 Images and build targets](#41-images-and-build-targets)
  - [4.2 Compose profiles](#42-compose-profiles)
  - [4.3 Volumes, healthchecks, users](#43-volumes-healthchecks-users)
- [5. Verifying a deployment](#5-verifying-a-deployment)
  - [5.1 Smoke checks](#51-smoke-checks)
  - [5.2 The dashboard](#52-the-dashboard)
  - [5.3 Configuration changes apply without a restart](#53-configuration-changes-apply-without-a-restart)
  - [5.4 End-to-end notification test](#54-end-to-end-notification-test)
  - [5.5 Testing Telegram](#55-testing-telegram)
  - [5.6 Troubleshooting](#56-troubleshooting)
- [6. HTTP API](#6-http-api)
- [7. How it works](#7-how-it-works)
  - [7.1 Data flow](#71-data-flow)
  - [7.2 Components](#72-components)
  - [7.3 When a notification fires](#73-when-a-notification-fires)
  - [7.4 Notification format](#74-notification-format)
  - [7.5 Resilience](#75-resilience)
- [8. Theming and localisation](#8-theming-and-localisation)
  - [8.1 Themes](#81-themes)
  - [8.2 Localisation](#82-localisation)
  - [8.3 Accessibility](#83-accessibility)
- [9. Development](#9-development)
  - [9.1 Repo structure](#91-repo-structure)
  - [9.2 Tech stack](#92-tech-stack)
  - [9.3 Live development](#93-live-development)
  - [9.4 Tests and checks](#94-tests-and-checks)
  - [9.5 Conventions](#95-conventions)
  - [9.6 Releasing](#96-releasing)
- [10. Roadmap](#10-roadmap)
- [11. Branch layout and merge policy](#11-branch-layout-and-merge-policy)
  - [Setup, once per clone](#setup-once-per-clone)
  - [Merging into main](#merging-into-main)
  - [What enforces it](#what-enforces-it)
  - [Consequences of keeping the filter off main](#consequences-of-keeping-the-filter-off-main)
  - [Rules of thumb](#rules-of-thumb)

---

## 1. What it does

Every few minutes IsItDown fetches each provider's status page, normalises the
answer, compares it with what it saw last time, and sends a message only if
something actually changed.

```
GitHub          operational    ████████████████████████████  99.98%
Cloudflare      degraded       ███████████████▁▁▁▁▁████████  99.61%   ← you get a message
Anthropic       operational    ████████████████████████████  99.93%
```

### Core principles

- **No external dependencies at runtime.** No database server, no message broker,
  no cloud account. A JSON file or an embedded SQLite file is enough at this scale.
- **Config-driven.** Adding a provider never means touching code — an entry in
  `config.yml` (Light) or a dialog in the dashboard (UI).
- **Idempotent notifications.** Only state *transitions* notify: operational →
  degraded, degraded → outage, outage → resolved. A restart notifies nothing.
- **Provider-agnostic.** Most providers run Atlassian Statuspage and need no code
  at all; anything else gets a small adapter.
- **Secrets from the environment only.** A token is read from an environment
  variable, never written to a config file, a database, an API response or a log
  line. The UI edition can save one to a `0600` file beside its database, still
  as a variable, so the dashboard can set a credential without a restart.

### The two editions

|  | Light | UI |
|---|---|---|
| Image | `ghcr.io/devmanfre/isitdown:light-latest` | `…:ui-latest` (built `FROM` light) |
| Poller · Adapters · Diff Engine · Notifiers | shared | shared |
| Configuration | `config.yml`, re-read every cycle | SQLite, edited in the dashboard |
| State store | JSON file, atomic writes | SQLite (also carries history) |
| HTTP server | none | Express on :3000 |
| Uptime history and charts | — | 7/30/90-day views, plus a year heat calendar per provider |
| Theme | — | light / dark / system |
| Localisation | notification text | notification text **and** the whole dashboard |
| Footprint | 264MB image, no listening socket | 267MB — the Light image plus one layer |

Both editions run the same core engine. They differ only in what gets injected
into it: where configuration comes from, and where state is kept.

---

## 2. Quick start

### 2.1 With Docker

**UI edition, without a clone** — one file, two commands. The images are
published to GHCR for `linux/amd64` and `linux/arm64`, so this is also the
Raspberry Pi, Unraid, Portainer and Synology path:

```bash
curl -O https://raw.githubusercontent.com/DevManfre/isitdown/main/docker-compose.yml
docker compose --profile ui up -d
# then visit http://localhost:3000
```

Everything the UI edition needs is configured in the dashboard, credentials
included: **Settings → a channel → Value → Salva** applies at once. Put them in a
`.env` next to the compose file instead if you would rather the container own
them — it is optional, and read if present:

```bash
printf 'TELEGRAM_BOT_TOKEN=...\nTELEGRAM_CHAT_ID=...\n' > .env
docker compose --profile ui up -d      # recreates the container with the tokens
```

**Light edition** — polling and notifications, nothing listening. This one needs
a `config.yml` to mount, so start from a clone:

```bash
git clone https://github.com/DevManfre/isitdown.git && cd isitdown
cp .env.example .env                # only fill in the channels you will enable
cp config.example.yml config.yml    # edit: providers, interval, channels
docker compose --profile light up -d
docker logs -f isitdown-light
```

Both can run at once; they use separate data volumes.

Contributors building from the source tree add `--build`, which overrides the
pull and builds the image locally instead:

```bash
docker compose --profile ui up -d --build
```

### 2.2 Without Docker

Requires **Node 24** for the build as well as the runtime — `.nvmrc` pins it and
`npm install` refuses anything older, because the runtime's own SQLite driver and
native TypeScript support are load-bearing at build time too. `build:ui`
additionally runs Vite to bundle the dashboard; `build:light` skips that step,
since Light ships no dashboard.

```bash
nvm use                             # or: nvm install 24
npm install
cp config.example.yml config.yml
cp .env.example .env

npm run build:light && node dist/light/index.js     # Light
npm run build:ui    && node dist/ui/server.js       # UI, then open :3000
```

Useful overrides when running locally: `CONFIG_PATH`, `DATA_PATH`, `DB_PATH`,
`PORT`, `LOG_LEVEL` (see [3.3](#33-environment-variables)).

---

## 3. Configuration

### 3.1 Light edition — `config.yml`

One file, mounted as a volume, **re-read at the start of every cycle** — editing
it applies on the next poll with no restart. `config.example.yml` is the tracked
template; `config.yml` itself is git-ignored, since it is your provider list.

```yaml
pollIntervalMinutes: 3      # how often to poll every provider
requestTimeoutSeconds: 8    # per-request timeout
maxRetries: 3               # attempts per provider per cycle, with backoff
failureThreshold: 5         # consecutive failures before a "monitoring degraded" warning
adaptivePolling: true       # while a provider has an open incident, poll it on the cadence below
adaptiveIntervalMinutes: 1  # that cadence; never slower than the provider's own interval
confirmSamples: 1           # consecutive polls that must agree before a change notifies
locale: en                  # language for notification messages: en | it

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
    secret: "${WEBHOOK_SECRET}"   # optional: signs the request, see 3.6
  discord:
    enabled: false
    webhookUrl: "${DISCORD_WEBHOOK_URL}"
  slack:
    enabled: false
    webhookUrl: "${SLACK_WEBHOOK_URL}"
```

| Key | Default | Notes |
|---|---|---|
| `pollIntervalMinutes` | `3` | 1–1440. The real delay carries ±10% jitter. |
| `requestTimeoutSeconds` | `8` | Per HTTP request, not per cycle. |
| `maxRetries` | `3` | Attempts per provider per cycle, exponential backoff plus jitter. |
| `failureThreshold` | `5` | Consecutive failed cycles before one "monitoring degraded" warning. |
| `adaptivePolling` | `true` | While a provider has an open incident — or any status worse than operational — poll it on `adaptiveIntervalMinutes` instead of its own cadence. `false` leaves every provider on the cadence it was configured with. |
| `adaptiveIntervalMinutes` | `1` | 1–1440. Taken as a *minimum* against the provider's own interval, so it can only ever watch a provider more closely. A provider that has never answered stays on its configured cadence: `unknown` is not an incident. |
| `confirmSamples` | `1` | 1–10. Flap damping: how many consecutive polls must agree on a reading before the change is announced. `1` notifies immediately; `2` ignores a page that disagrees with itself for one cycle, at the cost of one poll of delay. |
| `locale` | `en` | `en` or `it`; anything unknown falls back to `en`. |
| `services[].id` | — | Required. Lowercase slug; it keys the stored state. |
| `services[].adapter` | — | Required. `statuspage` covers every Atlassian-hosted page; `instatus` and `betterstack` cover those two hosted platforms; `rss` reads any RSS or Atom incident feed; `html` scrapes a page that publishes neither (see below); `slack`, `aws`, `gcp` and `azure` read those providers' own shapes. |
| `services[].enabled` | `true` | `false` keeps the entry but stops polling it. |
| `services[].intervalMinutes` | — | 1–1440. This provider's own cadence; omit to follow `pollIntervalMinutes`. A cycle runs at the shortest cadence anything asked for, and the slower providers sit the extra cycles out. |
| `services[].mutedUntil` | — | ISO 8601. While it is in the future the provider is polled and recorded as usual but notifies nothing — "I know, stop telling me, until then". In the UI edition this is what the dashboard's **Mute** control writes. |
| `services[].options` | — | Adapter-specific extras. Only the `html` adapter takes any today: `selector`, plus optional `operational` / `degraded` / `partial_outage` / `major_outage` word lists. |

#### The `html` adapter

For the pages that publish no JSON and no feed at all. Give it the page URL, a
CSS selector for the element whose text says how the provider is, and — when the
page uses unusual wording — the words that mean what:

```yaml
  - name: Sorry-hosted provider
    id: example
    adapter: html
    baseUrl: https://status.example.com/
    options:
      selector: ".status-banner"
      operational: "all systems operational, everything is fine"
      major_outage: "outage, down"
```

The selector supports tag, `#id`, `.class` and `[attr]` / `[attr="value"]`
compounds with the descendant and child (`>`) combinators. Anything past that —
a selector list, a pseudo-class, a sibling combinator — is refused rather than
silently matching nothing.

Reading markup is fragile by nature, so the failure modes are deliberate:

- a selector that matches nothing **throws**, so a page whose structure moved
  fails like an unreachable provider (retries, then the monitoring-degraded
  warning) instead of settling into a reading nobody ordered;
- text matching no configured word reads `unknown`, never `operational`;
- the most specific wording wins, so "partial outage on the API, everything else
  operational" reads as the partial outage;
- there are no incidents, components or maintenance windows — a page that needed
  scraping has no structure to read them out of.

Anything invalid stops the container at boot with the reason and the offending
path — a missing file, malformed YAML, a bad base URL, a duplicate service id, an
empty service list, or an enabled channel whose secret is unset. A container that
started with a half-understood configuration would look healthy while silently not
alerting, which is the one failure mode worth being loud about.

### 3.2 UI edition — runtime settings

The UI edition mounts **no** `config.yml`; one on disk would be ignored.
Everything lives in SQLite at `/app/data/isitdown.db` and is edited from
**Settings** in the dashboard (or through [`/config`](#6-http-api)):

- polling interval, request timeout, retries, flap damping
- the service list — add, edit, remove
- which notification channels are enabled, which environment variable carries
  each credential, and — write-only — the credential itself
- theme, dashboard language, notification language, time zone

**Settings → Data** also carries the one maintenance job a SQLite file needs
(roadmap 6.13): **Check and compact** runs `PRAGMA integrity_check` and then
`VACUUM`, and reports the bytes it returned beside what the database weighs now.
The order is deliberate — a file whose pages are already wrong is reported, not
rewritten — and nothing is ever deleted: the daily prune is what removes rows
past the retention window, and this is what gives their pages back.

Writes take effect on the **next poll cycle**, with no restart, because the
scheduler re-reads its configuration every pass. A fresh database is seeded with
GitHub, Cloudflare and Anthropic so the dashboard is useful immediately; your own
list is never overwritten afterwards.

### 3.3 Environment variables

| Variable | Editions | Default | Purpose |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | both | — | Telegram bot token. Required if the Telegram channel is enabled. |
| `TELEGRAM_CHAT_ID` | both | — | Target chat. Required with the above. |
| `WEBHOOK_URL` | both | — | Where the generic webhook POSTs. Required if that channel is enabled. |
| `DISCORD_WEBHOOK_URL` | both | — | Discord incoming webhook. Required if the Discord channel is enabled. |
| `SLACK_WEBHOOK_URL` | both | — | Slack incoming webhook. Required if the Slack channel is enabled. |
| `NTFY_TOPIC_URL` | both | — | ntfy topic URL, server included (`https://ntfy.sh/my-topic`). Required if the ntfy channel is enabled. |
| `NTFY_TOKEN` | both | — | Optional ntfy access token. Only a server with access control needs one. |
| `GOTIFY_URL` | both | — | Gotify server (`https://gotify.example.com`). Required if the Gotify channel is enabled. |
| `GOTIFY_TOKEN` | both | — | Gotify application token. Required with the above. |
| `WEBHOOK_SECRET` | both | — | Optional shared secret for the generic webhook. Set it and every request is signed (see [3.6](#36-notification-channels)); leave it unset and requests go out unsigned, exactly as before. |
| `LOG_LEVEL` | both | `info` | `debug` · `info` · `warn` · `error`. |
| `LOG_FILE` | both | — | Also append every log line to this file, rotated by size. Unset, logs go to stdout only. |
| `LOG_MAX_BYTES` | both | `5242880` | Size at which `LOG_FILE` rotates. |
| `LOG_MAX_FILES` | both | `5` | How many rotated generations (`.1` … `.5`) survive beside the live file. |
| `CONFIG_PATH` | Light | `/app/config/config.yml` | Where to read `config.yml`. |
| `DATA_PATH` | Light | `/app/data/state.json` | Where to keep the state file. |
| `DB_PATH` | UI | `/app/data/isitdown.db` | SQLite database. |
| `PORT` | UI | `3000` | HTTP port. |

Secrets arrive through `env_file` at runtime; nothing is baked into an image.
`docker history` on either image shows no `ENV` layer carrying a value.

### 3.4 How secrets are handled

The rule is the same in both editions — **the environment is the only place a
secret exists** — but the mechanics differ.

**Light.** `config.yml` holds `${VAR}` references, resolved at load. An enabled
channel whose variable is unset is a fatal startup error that names the variable:

```
config file /app/config/config.yml: the telegram channel is enabled
but TELEGRAM_BOT_TOKEN is not set in the environment
```

**UI.** The `channels` table stores the *name* of the variable
(`botTokenEnv: "TELEGRAM_BOT_TOKEN"`), never a value, and the name is resolved at
load. A value can be *set* from the dashboard, which writes it to
`secrets.env` beside the database — mode `0600`, in the data volume, one
`NAME=value` per line — and into the server's own environment, so the channel
starts working on the next request with nothing to restart. Consequences worth
knowing:

- Settings shows the variable name, whether it currently resolves, and a
  write-only value field. The field always renders empty and `Clear` forgets a
  saved value; nothing reads one back.
- `PATCH /config/channels/:id` still **refuses** a request carrying a literal
  secret: values go to `PUT /config/channels/:id/secrets`, and the database is
  never offered one.
- A saved value overrides the same variable coming from `env_file` — it is the
  later, explicit instruction — and every takeover is logged at boot.
- `DELETE /config/channels/:id/secrets/:field` only forgets what the file itself
  holds; a variable the container supplied answers `409` rather than pretending.
  Forgetting an entry that had overridden an `env_file` value falls back to that
  value rather than leaving the channel with nothing.
- No API response, DOM node, log line or error message contains a resolved secret.
  Tests assert this.
- A channel enabled in the database whose variable is unset is skipped for that
  cycle with a warning, rather than crashing the dashboard — unlike Light, there
  is a UI in which an operator can see and fix it.

The dashboard therefore accepts a credential, as the design prototype drew, but
only one way: in.

### 3.5 Monitored providers

If `https://<domain>/api/v2/summary.json` returns JSON with `status` and
`incidents`, the provider runs Atlassian Statuspage and needs **no code** — just an
entry with `adapter: statuspage`. Verified:

| Provider | `baseUrl` |
|---|---|
| GitHub | `https://www.githubstatus.com` |
| Cloudflare | `https://www.cloudflarestatus.com` |
| Anthropic / Claude | `https://status.claude.com` |

`status.anthropic.com` issues a 301 to `status.claude.com`. The adapter follows
redirects so either works; the canonical host avoids the extra hop.

The UI edition also ships a **bundled catalog** of well-known providers (roadmap
5.11): the add dialog opens on a menu of names, and one pick fills in the
adapter, the base URL and the id. Every entry in `src/adapters/catalog.ts` was
confirmed by running the detection against the page, so what the menu offers is
what an adapter actually reads. Providers whose status page refuses an automated
read (Stripe, GitLab, Zendesk, Okta) are deliberately absent rather than listed
and broken — for those, and for anything else the list does not have, paste the
URL and let detection (`POST /config/services/detect`) name the adapter. An entry already
watched stays in the menu, marked, rather than disappearing from it. Served as
`GET /config/catalog`.

The provider's own `status.indicator` maps onto the internal severity model:

| Statuspage indicator | IsItDown status |
|---|---|
| `none` | `operational` |
| `minor` | `degraded` |
| `major` | `partial_outage` |
| `critical` | `major_outage` |
| unrecognised | `major_outage` — never silently downgraded |
| absent | `unknown` |

An incident is *active* unless its status is `resolved` or `postmortem`.
`scheduled_maintenances` is read separately: a declared window is not a severity,
it silences the provider's alerts while it runs.

Note that a provider can report `degraded` with **zero** open incidents — Statuspage
derives the indicator from component state too. A degraded status grid alongside an
empty Incidents view is correct, not a bug.

#### Watching only part of a provider

A provider can expose hundreds of components: Cloudflare lists every data centre,
grouped by region (Africa, Asia, Europe, …). Select the components that matter and
tick **Report only the selected components** — `scopeToComponents: true` in the Light
edition's `config.yml` — to narrow the whole provider to that selection:

- an incident the provider attributes only to components outside the selection is
  dropped, so it neither notifies nor reaches the charts and the timeline;
- the provider's reported status becomes the worst status among the selected
  components instead of the page-wide `status.indicator`;
- an incident attached to no component at all is a page-wide notice and is always
  reported;
- with nothing selected the flag does nothing: scoping to an empty selection would
  mean silencing the provider.

Each group header in the picker carries its own checkbox, so a whole region is one
click.

#### The RSS / Atom adapter

A large tail of status pages publish a feed and nothing else. `adapter: rss`
reads any of them, with no code per provider:

```yaml
  - id: example
    name: Example
    adapter: rss
    baseUrl: https://status.example.com/history.rss
```

`baseUrl` **is the feed URL** — this adapter appends nothing to it.

A feed announces incidents; it never states an overall status, so the status is
derived, and the derivation is deliberately pessimistic — an entry that cannot be
dated or classified reads as trouble, never as recovery:

| Feed entry | Reading |
|---|---|
| Published in the last 24 hours, no closing word | An open incident |
| Says `resolved`, `completed`, `restored`, `closed` | Closed, whatever else it says |
| Older than 24 hours | No longer current |
| No date at all | Treated as current |
| No `guid`, `id` or `link` | Dropped: nothing stable to key the incident on |

Severity comes from the provider's own wording — `partial` → partial outage;
`outage`, `down`, `offline`, `unavailable`, `unreachable` → major outage;
anything else the provider bothered to announce → degraded.

Two consequences worth knowing before relying on it: the adapter offers no
component listing, because a feed has no components; and its incident history
never claims to be complete, because a feed is a window onto a history rather
than the history itself.

#### Slack adapter

Slack publishes its own small JSON API instead of running on Statuspage, so it
gets its own adapter:

```yaml
  - id: slack
    name: Slack
    adapter: slack
    baseUrl: https://slack-status.com
```

`baseUrl` is the host; the adapter appends `/api/v2.0.0/current` for what is
open now and `/api/v2.0.0/history` for the timeline. (`https://status.slack.com`
redirects there and works too.)

The payload carries no severity field — an incident is a title, a lifecycle word
and a list of affected service names — so severity is read from Slack's own
wording, exactly as the feed adapter does it. What that produces:

| Payload | Reading |
|---|---|
| `active_incidents` empty | Operational |
| An entry of `type: notice` | Listed as an incident, but does not move the provider's status on its own |
| Top-level `status: ok` with an entry still open | Trouble: the incident list is the dial, not the word |
| An entry with no `id` | Dropped: nothing stable to key the incident on |

Slack names the affected services on an incident but publishes no per-service
status list, so the adapter offers no component listing; and it exposes no
scheduled-maintenance data, so an entry announcing one stays an incident rather
than becoming a window that would silence the provider while it sat there.

#### AWS, Google Cloud and Azure

The three hyperscalers publish nothing Statuspage-shaped, and each is odd in its
own way, so each gets its own adapter:

```yaml
  - id: aws
    name: AWS
    adapter: aws
    baseUrl: https://health.aws.amazon.com
    options:
      region: eu-west-1        # optional; omit to watch every region

  - id: gcp
    name: Google Cloud
    adapter: gcp
    baseUrl: https://status.cloud.google.com

  - id: azure
    name: Azure
    adapter: azure
    baseUrl: https://azure.status.microsoft
    options:
      locale: en-us            # optional; the feed is published per locale
```

**AWS** — the adapter appends `/public/currentevents`, a document of the events
open right now. Two things follow from that. There is no history to backfill
from, because a resolved event drops out of the document rather than being
marked closed; and every event is scoped to one region, so `options.region`
narrows it to yours. A global event — one the feed publishes with no region at
all — is always reported, since narrowing must not hide the class of event that
hits everything. Severity is AWS's own numeric code, not a guess from wording:

| Code | Reading |
|---|---|
| `0` | Closed; drops out rather than keeping a recovered region red |
| `1` | Informational: listed as an incident, does not move the status |
| `2` | Degraded |
| `3` | Major outage |
| anything else | Major outage — never silently downgraded |

The document is served as UTF-16, which `fetch`'s own `text()` decodes as UTF-8
and mangles; IsItDown decodes by the charset the response declared.

**Google Cloud** — the adapter appends `/incidents.json`, one flat list that is
both the current state and the history: an incident with no `end` is open, and
the provider's status is whatever the open ones add up to. Severity comes from
`status_impact` (`SERVICE_INFORMATION` → an announcement that does not move the
status, `SERVICE_DISRUPTION` → partial outage, `SERVICE_OUTAGE` → major outage,
anything unrecognised → major outage) rather than from the `severity` word beside
it, which disagrees with it.

**Azure** — the machine-readable half of `azure.status.microsoft` is an RSS
feed, so this adapter reads the feed at `/<locale>/status/feed/` and adds the
two things the generic feed adapter gets wrong about Azure: it knows
"mitigated" ends an incident, and it knows the feed is *empty* while Azure is
healthy, so an empty feed is operational rather than unknown. Its incident
history reaches only as far as the feed does, which for a provider that
publishes open communications only is not far.

#### Instatus and Better Stack

The two most common Statuspage competitors, each with one unauthenticated JSON
endpoint of its own:

```yaml
  - id: gcore
    name: Gcore
    adapter: instatus
    baseUrl: https://status.gcore.com

  - id: betterstack
    name: Better Stack
    adapter: betterstack
    baseUrl: https://status.betterstack.com
```

**Instatus** — the adapter appends `/summary.json` for the page's own word plus
its open incidents and declared maintenance windows, and `/v3/components.json`
for the component list. The second request is only made when the provider has
components selected: a provider nobody picked components for must not pay two
requests a cycle for a list nothing reads.

| Payload | Reading |
|---|---|
| `page.status: UP`, nothing open | Operational |
| An incident's `impact` | `DEGRADEDPERFORMANCE` → degraded, `PARTIALOUTAGE` → partial outage, `MAJOROUTAGE` → major outage |
| `page.status: HASISSUES` with nothing listed | Degraded: a page that has not published the incident yet must not read as calm |
| `page.status: UNDERMAINTENANCE` | Unknown — it abstains rather than claiming to be up |
| An impact word we do not know | Major outage; never silently downgraded |
| `activeMaintenances[].duration` | Minutes, so the window's end is derived from it — Instatus publishes no end timestamp |

`summary.json` does not attribute an incident to the components it affects, so
`scopeToComponents` narrows the reported components and the status folded from
them, but never drops an incident. And Instatus publishes no JSON incident
history, so there is nothing to backfill from — a page's RSS feed can be added
as a second provider on the `rss` adapter if you want its timeline.

**Better Stack** — the adapter appends `/index.json`, and that one document is
the whole page: the aggregate state, every resource (their word for a
component) with its own status, every report — theirs for both incidents and
scheduled maintenance — and every update posted on those. So components,
component scoping *including* incident attribution, and the incident history all
come out of a single read.

| Payload | Reading |
|---|---|
| `aggregate_state` | `operational`, `degraded` → degraded, `downtime` → major outage |
| `maintenance` or `not_monitored` | Unknown — abstains rather than reading as a recovery |
| A report with `report_type: manual` not in state `resolved` | An open incident |
| A report with `report_type: maintenance` | A maintenance window, not an incident |
| A report's `ends_at` | Often null even once resolved — Better Stack closes one by state — so the newest update on the report is the closure time |

Sorry™, the third page in this family, publishes no unauthenticated JSON at all:
its public pages are HTML and its API needs a key, so it needs the generic
HTML-scrape adapter (roadmap 1.6) rather than a small parser of its own.

For a provider on none of these, add an adapter under `src/adapters/`.

#### Conditional requests

Every adapter reads through one HTTP helper that remembers the `ETag` (or
`Last-Modified`) a provider sent and offers it back on the next cycle. A page
that has not changed answers `304` with no body and the cached one is replayed,
which is most cycles: cheaper for the provider, and the difference between being
rate-limited and not on one with a tight budget. A `304` to a request that
carried no validator, a failed revalidation, or a page that stops sending
validators all drop the cache entry rather than pin a stale reading.

### 3.6 Notification channels

| Channel | Config key | Required variables |
|---|---|---|
| Telegram Bot API | `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Generic webhook | `webhook` | `WEBHOOK_URL` |
| Discord | `discord` | `DISCORD_WEBHOOK_URL` |
| Slack | `slack` | `SLACK_WEBHOOK_URL` |
| ntfy | `ntfy` | `NTFY_TOPIC_URL` (`NTFY_TOKEN` optional) |
| Gotify | `gotify` | `GOTIFY_URL`, `GOTIFY_TOKEN` |
| Desktop (Web Push) | `webpush` | none |

Desktop push needs nothing configured: the server generates its own VAPID key
pair the first time the channel is used and keeps it in the database, so
enabling the channel and pressing "enable on this browser" in Settings is the
whole setup. Each browser that is enabled appears in the card's device list and
can be removed from there.

The webhook POSTs `{ change, service, message }`, so a consumer can either display
the rendered text or route on the structured fields:

```json
{
  "change": {
    "kind": "status_change",
    "providerId": "cloudflare",
    "previousStatus": "operational",
    "currentStatus": "major_outage",
    "at": "2026-08-19T14:32:07.000Z"
  },
  "service": { "id": "cloudflare", "name": "Cloudflare", "statusUrl": "https://www.cloudflarestatus.com" },
  "message": "🔴 Cloudflare — MAJOR OUTAGE\n\nStatus changed from Operational to Major outage.\nUpdated: 2026-08-19 14:32 UTC\n\nhttps://www.cloudflarestatus.com"
}
```

**Signing.** Set `WEBHOOK_SECRET` (or `webhook.secret` in `config.yml`) and each
request carries two extra headers:

```
X-IsItDown-Timestamp: 2026-08-19T14:32:07.000Z
X-IsItDown-Signature: sha256=<hex>
```

The signature is HMAC-SHA256 over `` `${timestamp}.${body}` `` with the secret as
the key, computed on the exact bytes that were sent. Verify it by recomputing the
same string from the raw body — not from a re-serialised parse — and comparing in
constant time; the timestamp is inside the signed material so a receiver can also
reject a request that is too old to be genuine. With no secret set nothing is
added, so an existing receiver keeps working untouched.

Desktop (Web Push) is UI edition only, and the browser Push API refuses to
register a service worker unless the dashboard is served over localhost or HTTPS.
A toast carries the affected provider's own icon, so a stack of them is readable
at a glance.

Discord and Slack are both incoming webhooks: create one in the target
server/workspace, put its URL in `DISCORD_WEBHOOK_URL` or `SLACK_WEBHOOK_URL`,
and enable the channel. Both render the same words every other channel sends,
arranged natively — Discord as one embed whose title carries the severity and
links to the provider's status page, coloured by that severity; Slack as a
Block Kit section plus an "Open status page" button, with the heading repeated
as the notification preview text. Neither URL is ever logged or shown in the
dashboard: a rejected send reports the HTTP status and the service's own
reason.

**ntfy and Gotify** are the self-hosted push pair (roadmap 3.4). ntfy is one
POST: the topic URL carries the server, so `https://ntfy.sh/isitdown` and
`https://ntfy.example.com/isitdown` are the same setting, the heading becomes the
notification's title, the detail its body, and tapping it opens the provider's
status page. `NTFY_TOKEN` is only needed on a server with access control — a
public topic works without one. Gotify takes its server plus one application
token, posted to `/message` with the token in `X-Gotify-Key` rather than in the
URL, since a URL ends up in logs.

Both map the severity onto the channel's own priority scale, so what is allowed
to ring at night is a property of the reading rather than a rule rebuilt on every
phone: on ntfy's 1–5 scale a major outage is `5` and a recovery is `2`; on
Gotify's 0–10 scale, `9` and `3`. Neither credential is ever logged or shown in
the dashboard, and a rejected send reports the HTTP status with the server's own
reason.

### 3.7 Notification routing

An ordered table of rules decides which enabled channels hear about a given
change. Each rule has four parts:

```yaml
routing:
  - provider: "*"            # a service id, `group:<slug>` (§3.10), or "*" for every provider
    classes: [status, incident]  # any of: status, incident, maintenance, monitoring
    minSeverity: major_outage  # any | degraded | partial_outage | major_outage
    channels: [telegram]       # channel ids, or "*" for every enabled channel; [] mutes
```

Rules are evaluated top to bottom and the **first one that matches wins** —
later rules are never consulted for that change, so a narrow provider-specific
rule placed above a catch-all can mute or redirect it. A rule matches when the
change's provider, event class and severity all clear what it asks for; an
empty `channels: []` is a valid, deliberate way to silence a match rather than
an oversight. Severity is judged on the *worse* of where a change came from
and where it landed — a recovery from a major outage still carries the outage
floor, so a rule gating on `major_outage` still fires for the all-clear rather
than letting it slip through unrouted. An installation with no rules at all
behaves exactly as if one catch-all rule existed: every class, any severity,
every enabled channel — the behaviour both editions had before routing
existed, so upgrading never goes silent by accident.

The Light edition configures the table as the `routing` list in `config.yml`,
shown above; the UI edition edits it from **Settings**, where a routing rules
editor also offers a dry run — pick a provider and a canned event and it names
which rule would win and which ones were never reached, evaluated against the
rules you currently have saved, not a hypothetical set.

### 3.8 Delivery policy — quiet hours, digests, caps

The routing rules decide *who* hears about a change. Four further controls
decide *how much* of it actually goes out, and in how many messages. All four
are off by default, so an installation that configures none of them behaves
exactly as it did before they existed.

```yaml
delivery:
  quietHours:
    enabled: true
    start: "23:00"          # inclusive
    end: "07:00"            # exclusive; the window may wrap midnight
    timeZone: "Europe/Rome" # an IANA name, or "auto" for the container's zone
    minSeverity: major_outage
  digest:
    enabled: true
    windowMinutes: 15
    immediateFloor: major_outage
  cap:
    enabled: true
    maxPerHour: 6
  updateInPlace: true
```

**Quiet hours** are a routing *input*, not a filter bolted on after the rules:
inside the window, only changes clearing `minSeverity` reach anybody, and the
UI edition's dry run says when the hour — rather than a rule — is what decided.
A change held back is dropped, not deferred; deferring is the digest's job. The
window is read in `timeZone` and fails open on anything unusable (a malformed
time, an unknown zone, equal ends), because the one failure mode worth ruling
out here is a night of silence caused by a typo.

**Digest mode** collects everything *under* `immediateFloor` and sends it as one
message per window; anything at or above the floor still goes out the moment it
happens, so the window only ever delays what you said was not urgent. The batch
is flushed on the clock rather than when the next change arrives, which is why a
quiet window still ends in a message. Two honest limits: a channel switched off
while a window is open has its batch dropped (with a line in the log), and a
batch still collecting when the process stops is lost rather than arriving an
hour late.

**The cap** is a ceiling per provider per rolling hour, counted per *change*
rather than per channel — the operator reading them is one person however many
channels are enabled. What the cap holds back is counted, and the next message
that gets through carries a "further alerts were suppressed" line, so a cap can
never be mistaken for a channel that has stopped working. A digested change is
deliberately not charged against the cap: one batch is one message.

**`updateInPlace`** makes one incident one message that is rewritten as the
incident moves, on the channels that can edit what they sent — Telegram
(`editMessageText`) and Discord (a webhook message id). The id is remembered per
channel per incident, the message that closes an incident releases it, and an
edit the channel refuses (too old, deleted by hand) falls back to a fresh
message rather than losing the update. Slack's incoming webhook cannot edit at
all, so it keeps receiving a message per update.

The Light edition configures all four as the `delivery` block above; the UI
edition edits them under **Settings → Delivery**, where each row applies on its
own without a restart.

### 3.9 Validating a `config.yml` — the `check` command

Validating a file by starting the container and reading its logs tells you about
the first problem only, and costs a container to learn it. `check` reads the same
file through the same loader and prints *every* problem, then exits non-zero:

```bash
node dist/light/check.js ./config.yml
#   ./config.yml is valid — 4 services (3 enabled), channels: telegram, file only, no provider read

docker exec isitdown-light node dist/light/check.js; echo "exit=$?"
#   /app/config/config.yml is valid — 4 services (4 enabled), channels: telegram, ...
#   exit=0
```

With no path it reads `$CONFIG_PATH`, the way the container does. From a source
checkout, `npm run check:config -- ./config.yml` runs the same command without a
build.

What it reports, all in one pass:

| Finding | Level |
|---|---|
| File missing, unreadable, or not valid YAML | error |
| Anything the schema rejects (missing key, bad interval, malformed base url) | error |
| A `${VAR}` reference with no value in the environment — **every** one, named | error |
| The same service `id` declared twice | error |
| An enabled channel whose required setting is empty | error |
| A routing rule naming a provider or channel the file does not define | error |
| A service naming an `adapter` that does not exist, with the known ones listed | error |
| With `--probe`: a base url no adapter recognises | error |
| With `--probe`: a page that looks like a different adapter than the file names | warning |

Warnings are printed and do not fail the check — the `html` adapter is a
defensible choice for a page that also serves a Statuspage summary.

`--probe` reads each enabled provider's page (disabled ones are left alone, since
the file already says to) and asks which adapter recognises it, using the same
detection the UI edition's add-provider form uses. It is off by default: a check
that reaches the network is not something CI can depend on, and every other
finding above is answerable from the file alone.

Exit codes: `0` valid, `1` at least one error, `2` the command itself was called
wrong (unknown option, two paths). That makes it CI-able for the operator rather
than only for us:

```yaml
- run: docker run --rm -v ./config.yml:/app/config/config.yml:ro \
    ghcr.io/devmanfre/isitdown:light-latest node dist/light/check.js
```

### 3.10 Provider groups — "my stack"

A flat fleet answers "is GitHub healthy" and never "is my deploy path healthy",
which is the question an operator actually has: four providers they do not care
about individually, and one answer they do. A group is a slug a provider carries
(roadmap 2.6) — in `config.yml`:

```yaml
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
    group: deploy-path
  - name: Cloudflare
    id: cloudflare
    adapter: statuspage
    baseUrl: https://www.cloudflarestatus.com
    group: deploy-path
```

— and, in the UI edition, the **Group** field on a service, with the groups that
already exist offered as you type.

Two things follow from it:

- **A combined status.** The Overview grows a "My stack" band, one tile per
  group, in the group's own status: the worst member wins, and the tile names the
  members behind it. `unknown` is not a severity — the same rule the diff engine
  and the routing floors already follow — so one silent provider cannot hold a
  healthy stack at `unknown`, and only a group with nothing readable at all reads
  that way. A disabled provider leaves its group entirely: nobody is polling it,
  so it cannot make a stack unhealthy. The composite is derived by the server
  (`/status`'s `groups`), never recomputed in the browser, so the tile and the
  rows under it cannot disagree.
- **One routing rule for the whole stack.** A rule's `provider` accepts
  `group:deploy-path`, which covers every member — and keeps covering them when
  the stack gains a fifth provider, which four hard-coded ids never would. The
  dashboard's routing table offers the groups above the individual providers, and
  the dry run evaluates them with the picked provider's own group.

---

## 4. Docker

### 4.1 Images and build targets

One `Dockerfile`, four stages. `builder` compiles everything once; `light` and
`ui` are the two shipped runtime images; `dev` exists only for
[live development](#93-live-development) and is never built by
`docker compose --profile ui up`.

```
builder  node:24-alpine   npm ci (incl. devDependencies), tsc, vite build, copy non-TS assets into dist
light    node:24-alpine   prod deps + dist/{core,adapters,notifiers,light}
                          VOLUME /app/config /app/data · no EXPOSE · no server
dev      FROM builder     keeps devDependencies · vite build --watch + node --watch · tagged isitdown:dev only
ui       FROM light       + dist/ui (dashboard and locales) · EXPOSE 3000
```

`builder` now also copies `tsconfig.web.json`, `vite.config.ts` and
`components.json` alongside the server tsconfigs, and `npm run build` runs `tsc`,
then Vite, then the asset copy — one `RUN` layer that both runtime stages below
it share. `light` and `ui` are otherwise unchanged: the `ui` stage still begins
`FROM light`, so the UI image is the Light image plus a single thin layer — base
image, production dependencies and the whole core engine are shared on disk and
in a registry.

`dev`, the third stage, is `FROM builder` rather than `FROM light` — live
development needs the devDependencies (Vite, React, the test tooling) that
`light`'s production `npm ci --omit=dev` deliberately drops, so it cannot run from
either shipped image. It is tagged `isitdown:dev`, never `isitdown:ui`, and only
`docker-compose.dev.yml` builds it; a target-less `docker build .` or
`docker compose --profile ui up` never touches it.

```bash
docker build --target light -t isitdown:light .
docker build --target ui    -t isitdown:ui    .
```

Measured: 12 of the UI image's 14 layers are byte-identical to the Light image.

Tag releases per edition rather than with a bare `latest`, which would not say
which edition it is. `.github/workflows/release.yml` pushes four tags per
release to GHCR, each a multi-arch manifest covering `linux/amd64` and
`linux/arm64`:

```
ghcr.io/devmanfre/isitdown:light-v1.0.0   ghcr.io/devmanfre/isitdown:light-latest
ghcr.io/devmanfre/isitdown:ui-v1.0.0      ghcr.io/devmanfre/isitdown:ui-latest
```

Every pushed image carries an SBOM and SLSA provenance, and is signed keylessly
with `cosign`, so what built it is verifiable rather than merely asserted:

```bash
cosign verify ghcr.io/devmanfre/isitdown:ui-latest \
  --certificate-identity-regexp '^https://github.com/DevManfre/isitdown/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

See [9.6](#96-releasing) for how a release is cut.

### 4.2 Compose profiles

```bash
docker compose --profile light up -d           # mounts ./config.yml (ro) + a data volume
docker compose --profile ui    up -d           # data volume only, publishes :3000
docker compose --profile light --profile ui up -d      # both
docker compose --profile light --profile ui down       # stop; volumes survive
```

Both services declare a published `image:` and `pull_policy: missing`, so a
plain `up` pulls from GHCR and the file works with no source tree around it.
Adding `--build` builds the same target from this `Dockerfile` instead.

A third file, `docker-compose.dev.yml`, layers on top of the `ui` profile and runs
the edition straight from the source tree, rebuilding the dashboard bundle in the
background as files change rather than requiring a fresh image — see
[9.3](#93-live-development).

### 4.3 Volumes, healthchecks, users

| | Light | UI |
|---|---|---|
| Mounts | `./config.yml:/app/config/config.yml:ro`, volume on `/app/data` | volume on `/app/data` |
| Ports | none | `3000:3000` |
| Healthcheck | age of `state.json` — every cycle rewrites it, three intervals without a write is unhealthy | `GET /ready` |
| Start period | 40s | 60s |
| User | `node`, unprivileged | `node`, unprivileged |

The Light edition has no server to probe, which is why its liveness signal is the
freshness of the state file rather than an HTTP response.

The UI edition's probe is **readiness**, not liveness. `GET /health` answers as
long as the process is up, which is all a liveness probe may ever mean — a
restart is not the answer to someone else's outage — and it left the one failure
an operator actually wants surfaced reported by nothing: an instance whose poll
cycle had been failing all day still looked healthy. `GET /ready` is that
reading, on the same three-intervals-of-slack rule as the Light edition's state
file, and it is what the container asks. Both are still there, so an
orchestrator that wants the two probes apart can have them (`livenessProbe` on
`/health`, `readinessProbe` on `/ready`). The longer start period is the cost:
readiness stays 503 until the history backfill and the first cycle are done.

Both containers stop cleanly on `SIGTERM`: the scheduler stops, the in-flight cycle
is awaited, the store is closed, exit 0.

---

## 5. Verifying a deployment

Everything in this section has been run against the built containers. Expected
output is shown so a difference is obvious.

The examples pipe JSON through [`jq`](https://jqlang.github.io/jq/) for
readability. It is not required — drop the pipe to see the raw body, or use the
runtime you already have:

```bash
curl -s localhost:3000/status | jq '.providers[] | {id, overallStatus}'   # with jq
curl -s localhost:3000/status | node -e 'process.stdin.toArray().then(c => {
  for (const p of JSON.parse(Buffer.concat(c)).providers) console.log(p.id, p.overallStatus);
})'                                                                       # without
```

### 5.1 Smoke checks

```bash
docker ps --format "{{.Names}} {{.Status}}"
#   isitdown-light  Up 2 minutes (healthy)
#   isitdown-ui     Up 2 minutes (healthy)

docker exec isitdown-light node dist/light/healthcheck.js; echo "exit=$?"   # exit=0
docker exec isitdown-ui    node dist/ui/healthcheck.js;    echo "exit=$?"   # exit=0

docker logs -f isitdown-light
#   {"level":"info","msg":"isitdown light started",...}
#   {"level":"info","msg":"poll cycle finished","providers":3,"failed":0,"changes":0}
```

`changes:0` on the first cycle is correct: a first observation is a baseline, not
news.

Confirm the Light edition really runs no server:

```bash
docker ps --format "{{.Names}} ports={{.Ports}}" | grep light   # ports= is empty
docker exec isitdown-light sh -c "ps -o pid,args"            # only node dist/light/index.js
```

Confirm nothing secret was baked into an image:

```bash
docker history isitdown:ui --no-trunc --format "{{.CreatedBy}}" | grep -iE "TOKEN=|SECRET="
# no output
```

### 5.2 The dashboard

Open **http://localhost:3000** and walk the rail: Overview · Providers ·
Incidents · History · Delivery log · Settings. Then check the two runtime controls
in the header:

- the **theme** button cycles light → dark → system and survives a reload;
- the **EN / IT** switch changes every string with no page reload, including the
  time format (`7:36 PM` vs `19:36`) and decimal separator (`99.87%` vs `99,87%`).

The browser tab answers the same question without being looked at: while
something is wrong, the title counts the providers in trouble (`2 providers in
trouble · IsItDown`) and the favicon takes a dot in that severity's colour. A
calm fleet puts the page's own icon and title back, so a dot in the tab always
means there is something to open. A provider that has never been read
successfully is not "trouble" — a first cycle that has not landed yet must not
show a red tab — and a disabled provider is off the dashboard entirely.

Every view's toolbar follows one rule: a control that changes what is on screen
is a segmented tray — joined buttons in a tinted, bordered strip, with the
active one lifted out of it — and everything that takes the view away with you
sits behind a single **Download** menu. Before, a range toggle, two download
sentences and two format pairs were all ghost buttons of the same weight, and
nothing said which of them belonged together.

On **History**, clicking a provider's row opens its drawer: the three windows,
the daily bars with their colour key, and — roadmap 5.20 — a **year heat
calendar**, one cell per day coloured by that day's worst status. Retention can
run to 3650 days, while the widest chart stayed a 90-day bar row, so everything
older was stored and never shown; the calendar is that year. A day nobody
sampled is drawn muted rather than green, and hovering a cell says what the day
was and how much of it was up.

Above the list, **Compare** (roadmap 5.7) overlays two providers' daily uptime on
one pair of axes — the question a vendor decision actually asks, and the one the
worst-first ranking cannot answer because it never puts two rows on the same
scale. It opens on the two worst providers, either picker changes a side, and
picking the provider already on the other side swaps them. The two lines take
their own colours rather than status colours: the chart says which measured
better, not that one of them is operational and the other is not.

The same data over HTTP:

```bash
curl -s localhost:3000/history/calendar?provider=github | jq '.measuredDays, .uptime'
curl -s localhost:3000/status | jq '.providers[] | {id, overallStatus, uptime90}'
curl -s localhost:3000/history?days=7 | jq '{aggregateUptime, months}'
curl -s localhost:3000/config | jq '.channels'        # variable names only, never values
curl -s -X POST localhost:3000/poll                   # force a cycle now
```

Add a provider and confirm it is picked up on the next cycle without a restart:

```bash
curl -s -X POST localhost:3000/config/services -H 'content-type: application/json' \
  -d '{"id":"vercel","name":"Vercel","adapter":"statuspage","baseUrl":"https://www.vercel-status.com"}'

curl -s -X POST localhost:3000/config/services/vercel/test
#   {"ok":true,"overallStatus":"operational"}
```

A connection test reaches the provider but records nothing: no sample, no incident,
no notification. It is diagnostics, not history.

Removing a provider is undoable. The confirmation names what the removal will
eventually take (samples, incidents, maintenance windows, routing rules, and the
span of history behind them), then the provider leaves the dashboard while its
history waits out a restore window — `Settings → Recently removed` offers
**Restore** and **Remove now** until it closes:

```bash
curl -s -X DELETE localhost:3000/config/services/vercel
#   {"removed":"vercel","removedAt":"...","restoreUntil":"..."}
curl -s localhost:3000/config | jq '.removed[] | {id, restoreUntil}'
curl -s -X POST localhost:3000/config/services/vercel/restore    # undo
```

The **Delivery log** view is the other half of that honesty: every notification
that was attempted, failed ones first, each row expanding to the exact payload
sent and the channel's own error string. A credential that went stale shows up
there instead of as alerts that quietly stopped arriving.

A failed send is retried up to three times with exponential backoff and jitter,
so a rate limit or a restarting webhook receiver no longer loses an alert. One
row is written per *message*, not per attempt, and it carries how many attempts
it took: a send that landed on the second try reads as delivered, and one that
spent all three is badged **Dead letter** — the alert is gone, which is a
different statement from "failed". A delivery test from Settings is tried once
on purpose: the operator is waiting for the answer.

### 5.3 Configuration changes apply without a restart

**Light.** Edit `./config.yml` on the host — it is mounted read-only but re-read at
the start of every cycle. Add a provider and lower the interval:

```bash
docker logs -f isitdown-light
#   ..."poll cycle finished","providers":3      ← before
#   ..."poll cycle finished","providers":4      ← after, no restart
```

Measured: adding a fourth provider and changing `pollIntervalMinutes` from 3 to 1
took effect on the next cycle, and the following gap shrank to ~56s (one minute
minus jitter).

**UI.** Change the interval in Settings, or:

```bash
curl -s -X PATCH localhost:3000/config/settings \
  -H 'content-type: application/json' -d '{"intervalMinutes":10}'
curl -s localhost:3000/status | jq .pollIntervalMinutes    # 10
```

Confirm invalid configuration is refused loudly rather than half-applied:

```bash
docker run --rm isitdown:light
#   ..."isitdown light failed to start","error":"config file /app/config/config.yml
#      was not found — mount it or set CONFIG_PATH"   → exit 1

printf 'services: []\n' > /tmp/bad.yml
docker run --rm -v /tmp/bad.yml:/app/config/config.yml:ro isitdown:light
#   ..."error":"config file ... is invalid: services: at least one service is required"
```

### 5.4 End-to-end notification test

Waiting for a real outage is not a test. This gives you a provider whose status you
control, plus a sink that accepts the webhook — one throwaway container serves both.

```bash
mkdir -p /tmp/sw-test/html/api/v2
echo '{"status":{"indicator":"none"},"incidents":[]}' > /tmp/sw-test/html/api/v2/summary.json

cat > /tmp/sw-test/nginx.conf <<'CONF'
server {
  listen 80;
  location /api/v2/summary.json { root /usr/share/nginx/html; default_type application/json; }
  location /hook { access_log /dev/stdout; return 200 '{"received":true}'; }
}
CONF

docker run -d --name fake-provider --network isitdown_default \
  -v /tmp/sw-test/html:/usr/share/nginx/html:ro \
  -v /tmp/sw-test/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
```

Point the webhook channel at the sink. `WEBHOOK_URL` is read when the container
starts, so recreate it:

```bash
sed -i 's|^WEBHOOK_URL=.*|WEBHOOK_URL=http://fake-provider/hook|' .env
docker compose --profile ui up -d --force-recreate
```

Register the fake provider and enable the channel:

```bash
curl -s -X POST localhost:3000/config/services -H 'content-type: application/json' \
  -d '{"id":"fake","name":"Fake Provider","adapter":"statuspage","baseUrl":"http://fake-provider"}'
curl -s -X PATCH localhost:3000/config/channels/webhook \
  -H 'content-type: application/json' -d '{"enabled":true}'
```

Now drive the transitions:

```bash
# 1. baseline — must send nothing
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0}

# 2. break it
cat > /tmp/sw-test/html/api/v2/summary.json <<'JSON'
{"status":{"indicator":"critical"},
 "incidents":[{"id":"fake-1","name":"Everything is on fire","impact":"critical",
               "status":"investigating","updated_at":"2026-08-19T18:00:00.000Z"}]}
JSON
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 2}

# 3. poll again with nothing changed — must stay silent
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0}

curl -s localhost:3000/notifications | jq -r '.notifications[] | "\(.ok) \(.kind) \(.text | split("\n")[0])"'
#   true incident_opened 🔴 Fake Provider — MAJOR OUTAGE
#   true status_change   🔴 Fake Provider — MAJOR OUTAGE
```

The feed is newest first and persists in the data volume, so a database that has
seen earlier runs will show their entries below these two.


Recovery, and restart safety:

```bash
echo '{"status":{"indicator":"none"},"incidents":[]}' > /tmp/sw-test/html/api/v2/summary.json
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 2} → resolved + operational

docker compose --profile ui restart
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0} — nothing re-notified
curl -s 'localhost:3000/incidents?state=resolved' | jq '.page.items[] | {incidentId, startedAt, resolvedAt}'
```

The same flow works on the Light edition: add the fake provider to `config.yml`,
set `webhook.enabled: true`, and the log shows the sends:

```
..."poll cycle finished","providers":4,"failed":0,"changes":2
..."notification sent","channel":"webhook","providerId":"fake","kind":"status_change"
..."notification sent","channel":"webhook","providerId":"fake","kind":"incident_opened"
```

Clean up:

```bash
docker rm -f fake-provider
curl -s -X DELETE localhost:3000/config/services/fake
curl -s -X PATCH localhost:3000/config/channels/webhook \
  -H 'content-type: application/json' -d '{"enabled":false}'
sed -i 's|^WEBHOOK_URL=.*|WEBHOOK_URL=|' .env
rm -rf /tmp/sw-test
```

### 5.5 Testing Telegram

Telegram is the channel most people actually want, and the one worth confirming for
real. Create a bot with [@BotFather](https://t.me/botfather), send it a message,
then read your chat id from
`https://api.telegram.org/bot<TOKEN>/getUpdates`.

In the UI edition, both values can be saved from **Settings → Telegram**, or
through the API — either way no restart is involved:

```bash
curl -s -X PUT localhost:3000/config/channels/telegram/secrets \
  -H 'content-type: application/json' \
  -d '{"fields":{"botToken":"123456:AA...","chatId":"-1001234567890"}}'

curl -s -X PATCH localhost:3000/config/channels/telegram \
  -H 'content-type: application/json' -d '{"enabled":true}'
curl -s -X POST localhost:3000/config/channels/telegram/test    # {"ok":true}
```

Through `env_file` instead, the container has to be recreated for it to read them:

```bash
sed -i 's|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=123456:AA...|' .env
sed -i 's|^TELEGRAM_CHAT_ID=.*|TELEGRAM_CHAT_ID=-1001234567890|' .env
docker compose --profile ui up -d --force-recreate
```

A failure comes back as `{"ok":false,"error":"telegram notification failed: HTTP 400 (chat not found)"}` —
the status code and Telegram's own description, never the token.

For the Light edition, set the same two variables, `telegram.enabled: true` in
`config.yml`, and restart the container so it picks the secrets up.

### 5.6 Troubleshooting

| Symptom | Likely cause |
|---|---|
| Light container exits immediately, exit 1 | Configuration. `docker logs` names the file, the path and the reason. |
| `the telegram channel is enabled but TELEGRAM_BOT_TOKEN is not set` | `.env` is not being passed. Check `env_file` and recreate the container — env is read at start. |
| Container stuck `starting` forever | The healthcheck never passed. Light: `state.json` is not being written, so no cycle completed. UI: `/ready` is answering 503 — its `reason` field names which of the three failures it is, and `docker inspect` carries it in the health log. |
| Dashboard loads but the grid is empty | No cycle has run yet. `POST /poll`, or wait one interval. |
| A provider shows `unknown` | It has never been polled successfully. UI edition: **Settings → the provider's row → Diagnose** shows the last reads with their errors and reads the page on demand (`GET /debug/adapters`, `POST /debug/adapters/<id>/probe`). A page that reads but parses into nothing — a scrape whose selector no longer matches — is called out there. |
| No notifications during the night, or one message instead of several | The delivery policy is doing its job. Check **Settings → Delivery** (or the `delivery` block): quiet hours drop what is under their floor, and the digest holds it for its window. |
| One provider is polled and another is not | Either its own `intervalMinutes` has not elapsed, or it answered `Retry-After` and is being left alone until the window it stated passes — `docker logs` carries `provider asked to be left alone` with the deadline. |
| Provider shows `degraded` but Incidents is empty | Correct. Statuspage derives the indicator from component state too; there may be no incident record. |
| Uptime reads `0%` for a provider | It has exactly one sample and it was not operational. It rises with the next cycles. |
| A month column shows `—` | No samples in that month. Deliberately not `0%`, which would read as a month-long outage. |
| No notifications ever arrive | Is the channel `enabled`, and does its variable resolve? `GET /config` shows `isSet` per field. Then `POST /config/channels/<id>/test`. |
| Notifications arrive repeatedly for the same thing | Should be impossible — the diff engine is the only thing that decides. Capture `docker logs` and the `/notifications` feed. |
| Dashboard shows raw keys like `nav.overview` | A key with no catalog entry — should be impossible, the locale-guard tests catch every literal `t("...")` call before it ships. A dynamically built key (`t(prefix + suffix)`) is the one shape those tests cannot see; check the call site. |

Turn up the detail with `LOG_LEVEL=debug`, which logs every individual poll attempt
including retries.

Logs go to stdout, which is what a container wants and what a bare-metal install
does not: set `LOG_FILE=/var/log/isitdown/isitdown.log` and the same lines are
also appended there, rotated at `LOG_MAX_BYTES` into `LOG_MAX_FILES` numbered
generations. The file is additional — stdout keeps carrying everything, so
`docker logs` still works on a container that has both. A path that cannot be
written disables the file after saying so once on stdout; polling and
notifications are never held up by a full or read-only disk.

---

## 6. HTTP API

UI edition only. Every response is JSON, including errors
(`{ "error": { "message": "..." } }`) — a browser fetch that gets an HTML error page
back reports a parse failure instead of the real problem.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness, and only that: the process answers. `{ status, providers, lastCycleAt }`. Never fails because a provider is unreachable. |
| `GET` | `/ready` | Readiness: whether polling is working. `200` with `{ status: "ready", providers, failed, lastCycleAt, ageSeconds, staleAfterSeconds }`, or `503` with the same shape plus `reason` — no cycle has completed yet, the last one is more than three poll intervals old, or every provider failed in it. This is what the container's healthcheck asks. |
| `GET` | `/status` | Current status of every provider, plus last and next poll, plus `maintenance: { active, upcoming }` — windows running now and windows whose `startsAt` is still in the future; a window that has already ended but is still in the stored payload appears in neither list. A pure database read — safe to poll every 30s, which the dashboard does. Never reaches upstream. Also carries `groups` — one entry per provider group with its derived status, members and affected members (roadmap 2.6, §3.10). |
| `GET` | `/history/calendar?provider=` | A year of day cells for one provider — roadmap 5.20. `{ providerId, days, cells: [{ day, status, uptime }], uptime, measuredDays }`, oldest first, gap-filled: an unsampled day is `unknown` with `uptime: null`, never `0`. The window is fixed at 365 days and named in the answer, so it takes no `days`. `404` on an unknown provider. |
| `GET` | `/history?provider=&days=` | Pre-aggregated daily buckets, 7/30/90-day uptime, month columns. `days` accepts `7`, `30` or `90`; anything else is a 400 naming them. Without `provider`, a summary across all of them. |
| `GET` | `/incidents?provider=&state=&q=&days=&page=&pageSize=` | One page of the incident list: `{ active, page: { items, page, pageSize, total }, counts: { all, active, resolved } }`. `state` is `all` (default), `active` or `resolved`; `q` searches incident names, case-insensitively, and `days` keeps only incidents that started within that window (both narrow the page **and** the counts); `pageSize` defaults to 20 and is capped at 100. A nonsense `page`, `pageSize`, `state`, `q` or `days` falls back to the first page of everything rather than a 400. `counts` carries all three states whatever the filter, and `active` is the open list the dashboard's hero card shows on every page — outside the search, so a card cannot vanish while the operator types. |
| `GET` | `/incidents/:providerId/:incidentId` | Detail: the incident, the observed timeline, the action log of what was sent, the provider's other open incidents, and the last 24 polls. |
| `GET` | `/export/incidents.csv?provider=&state=&q=&days=` | The incident search's own result as a download — the same filters `/incidents` takes, without paging: `provider_id,incident_id,name,impact,status,started_at,updated_at,resolved_at`. RFC 4180, so a name carrying a comma, a quote or a newline stays one field. Capped at 20 000 rows; a capped export answers with `X-IsItDown-Truncated: true` rather than looking complete. |
| `GET` | `/export/incidents.json?provider=&state=&q=&days=` | The same rows as `{ generatedAt, filter, count, truncated, incidents }` — `filter` echoes what the export was taken with, so a file found later still says what it is. |
| `GET` | `/export/history.csv?provider=&days=` | Uptime history as one row per provider per day: `provider_id,day,worst_status,uptime_pct`. `days` accepts `7`, `30` or `90`, like `/history`; `provider` narrows to one (`404` on an unknown id), and without it, every enabled provider. |
| `GET` | `/export/history.json?provider=&days=` | The same window as `{ generatedAt, days, providers }`, each provider carrying the buckets, the daily series and the window's percentages the charts are drawn from. |
| `GET` | `/feeds/incidents.xml?provider=&state=&q=&days=` | The incident search's own result as an RSS 2.0 feed — roadmap 4.9. The same filters `/incidents` takes, newest 200, served inline so a reader subscribes instead of saving a file. Each item links back into the dashboard's own route for that incident, and its `guid` is the `provider/incident` pair rather than the link. |
| `GET` | `/feeds/incidents.ics?provider=&state=&q=&days=` | The same rows as an iCalendar file, one `VEVENT` per incident: it starts when the incident was first seen and ends when it resolved, or at the last update while it is still `TENTATIVE`. |
| `GET` | `/maintenances?provider=&days=` | Declared maintenance windows — running, upcoming and past — as `{ maintenances }`. `days` bounds how far back a closed window is still returned (default 90, max 365); `provider` narrows to one. Without `provider`, every enabled provider. |
| `GET` | `/notifications?limit=` | What was actually sent, newest first. Capped at 200. |
| `GET` | `/notifications/log?state=&channel=&page=&pageSize=` | One page of the delivery log: `{ page: { items, page, pageSize, total }, counts: { all, sent, failed } }`. `state` is `all` (default), `sent` or `failed`; `channel` narrows to one channel; `pageSize` defaults to 25 and is capped at 200. A nonsense `page`, `pageSize` or `state` falls back rather than 400s. `counts` carries every outcome whatever the filter. Each item carries `attempts`: a failed send with more than one is a dead letter. |
| `GET` | `/config` | Services, polling settings (`adaptivePolling` and `adaptiveIntervalMinutes` included), `retention`, `delivery` (quiet hours, digest, cap, `updateInPlace` — see [3.8](#38-delivery-policy--quiet-hours-digests-caps)), channels, routing, and `removed` — providers taken out but still restorable. Channel credentials appear as variable **names** with an `isSet` flag — never values. |
| `GET` | `/config/export` | The whole configuration as a Light edition `config.yml`, as a download (roadmap 4.3) — polling, delivery, services, routing and channels. Credentials leave as `${VAR}` references, never values, and `webpush` is skipped: a browser subscription has no meaning in an edition with no browser. The file starts the Light image as it stands. |
| `POST` | `/config/import` | The same file, read back. Takes the YAML as the request body (`text/yaml`) or as `{ yaml }`. Validated through the Light edition's own file schema before anything is written, so a bad file changes nothing; a literal credential is refused outright. A service the file does not mention is removed the way the dashboard removes one — soft, restorable, history intact — and an absent `routing` block leaves the rules alone. Answers `{ added, updated, removed, channels, routingRules, settings }`. |
| `GET` | `/config/catalog` | The bundled provider catalog (roadmap 5.11): `{ providers: [{ id, name, adapter, baseUrl, configured }] }`. Answered from memory — the list ships with the image, so there is no upstream to be down and nothing to keep in sync. `configured` marks an id already watched: the row stays in the menu saying so rather than disappearing from it. Detection stays the path for a page the list does not have. |
| `POST` | `/config/services` | Add a service. `201`, or `409` on a duplicate id, or `400` naming the invalid field. |
| `POST` | `/config/services/detect` | Which adapter reads the page at `{ url }`, and the base URL that adapter wants: `{ adapter, baseUrl, probes }`. Tries the shapes IsItDown already reads, in order (Statuspage's `/api/v2/summary.json`, Instatus's `/summary.json`, Better Stack's `/index.json`, then a feed), and recognises the four single-provider adapters by host with no request at all. A page nothing recognised is a `200` with `adapter: null` and the probes it tried — only an unusable URL is a `400`. Records nothing and notifies nothing. |
| `PATCH` `DELETE` | `/config/services/:id` | Edit, or remove. A removal is a **soft delete**: the provider leaves the dashboard and the poll cycle at once, and the response says how long it stays restorable (`{ removed, removedAt, restoreUntil }`). `404` on an id that is unknown or already removed. |
| `POST` | `/config/services/:id/restore` | Undo a removal inside its window. Nothing was taken, so nothing is rebuilt; the gap in history from the days it was removed is backfilled. `404` if it is not a removed service. |
| `DELETE` | `/config/services/:id/permanently` | The destructive half, on its own path so nothing reaches it by accident: cascades to that provider's samples, incidents, maintenances, state and routing rules. This also happens on its own once the restore window closes. |
| `PATCH` | `/config/settings` | Polling settings — including `adaptivePolling` and `adaptiveIntervalMinutes` (1–1440) — `retentionDays`, how long history is kept, 7 to 3650 days, and `delivery`, the policy of [3.8](#38-delivery-policy--quiet-hours-digests-caps). The delivery patch is partial at every level, so one field can be changed without writing back the rest. |
| `GET` | `/config/storage` | What retention costs: the database's size on disk, the sample count, measured bytes per sample (`measured: false` when the database is too small to measure and the server's own figure stands in), and samples a day at the current provider count and interval. |
| `POST` | `/config/storage/maintenance` | `PRAGMA integrity_check`, then `VACUUM` — roadmap 6.13. Answers `{ ok, integrity, bytesBefore, bytesAfter, reclaimed, durationMs }`. A failed check is `200` with `ok: false` and sqlite's own words: the file was checked, not rewritten. Deletes nothing. |
| `PATCH` | `/config/channels/:id` | Enable/disable, and set variable names. **Refuses** a literal secret. |
| `PUT` | `/config/channels/:id/secrets` | Save credential **values** — `{"fields":{"<field>":"<value>"}}`. Write-only: the value goes to `secrets.env` beside the database and into the process environment, effective immediately, and the response is the usual names-and-`isSet` shape. `400` for an unknown field or an unusable value. |
| `DELETE` | `/config/channels/:id/secrets/:field` | Forget a saved value. `409` if the variable came from the container's environment instead. |
| `POST` | `/config/services/:id/test` | One live fetch against that provider. Records nothing. |
| `POST` | `/config/channels/:id/test` | One test notification, through the dispatcher. |
| `GET` `PATCH` | `/api/preferences` | `{ theme, uiLocale, notificationLocale, mapView, timeZone }`. `timeZone` is `auto` — this browser's own — or an IANA name; anything the runtime cannot format a date in is refused. |
| `GET` | `/debug/adapters` | Adapter diagnostics: per provider, its adapter, base URL and options, and the last twenty read outcomes (duration, attempts, whether it was a `304`, and the error in full). In memory — diagnostics for the run in front of you, not history, so a restart empties it. |
| `POST` | `/debug/adapters/:id/probe` | One read of that provider's page, right now, reported in full: the whole parsed reading on success, the adapter's own error on failure (as `200` with `ok: false`, like the connection test). Records nothing and notifies nothing. `404` on an unknown id. |
| `POST` | `/poll` | Run a cycle now, through the scheduler. Returns the cycle summary. |
| `GET` | `/events` | Server-sent events, one long-lived response per open tab. `hello` on connect (`lastPollAt`, `nextPollAt`, `serverNow`), then `cycle` as each cycle finishes (`finishedAt`, `providers`, `failed`, `changedProviders` — no deadline: the scheduler re-arms after the event, so the fresh one comes with the re-read). The stream is a courier, not a source of truth: it says what changed, and the dashboard re-reads it. Not JSON — see [6.3](#63-live-updates). |
| `GET` | `/metrics` | Prometheus exposition. The one non-JSON endpoint — see [6.2](#62-prometheus-metrics). |
| `GET` | `/badge.svg` | An SVG badge for the whole fleet: the worst reading anything is showing. Not JSON — see [6.4](#64-badges-and-the-widget-summary). |
| `GET` | `/badge/:providerId.svg` | The same for one provider. `404` (still as a badge) when nothing knows that id. |
| `GET` | `/widget` | One flat summary object for a homelab dashboard's custom-API widget — see [6.4](#64-badges-and-the-widget-summary). |
| `GET` | `/` | The dashboard. |

### 6.1 History backfill

At startup — and whenever a provider is added from the dashboard — the UI
edition reconstructs up to 90 days of history from the provider's public
incident feed (`/api/v2/incidents.json` for Statuspage-based providers), so
the uptime bars are not empty on a fresh container.

Reconstructed history is derived, not measured: a day is marked degraded or
down only when a known incident overlapped it, and covered days without
incidents are assumed operational. The public feed returns at most its 50
most recent incidents, so coverage varies per provider; days older than the
feed's reach stay grey ("no data") and are excluded from the uptime
percentages. Backfill never triggers notifications and never overwrites
observed samples.

### 6.2 Prometheus metrics

`GET /metrics` answers in the Prometheus text exposition format
(`text/plain; version=0.0.4`), so any Prometheus can scrape IsItDown with no
adapter in between:

```yaml
scrape_configs:
  - job_name: isitdown
    static_configs:
      - targets: ["isitdown-ui:3000"]
```

Like `/status`, a scrape is a pure read of stored state and never reaches a
provider, so scraping every 15 seconds costs nothing upstream. Only enabled
providers are exported: a disabled one has rows in the database but no cycle
will ever refresh them, and an alert on a frozen gauge is worse than no series.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `isitdown_providers_total` | gauge | — | Providers currently being polled. |
| `isitdown_provider_up` | gauge | `provider`, `name` | `1` when the provider reports itself fully operational, `0` otherwise — including before its first poll. |
| `isitdown_provider_status` | gauge | `provider`, `status` | `1` on the current normalised status, `0` on the other four. Tells `degraded` apart from `major_outage`, which `_up` cannot. |
| `isitdown_provider_active_incidents` | gauge | `provider` | Open incidents on that provider's status page. |
| `isitdown_provider_failure_count` | gauge | `provider` | Consecutive failed poll cycles. Non-zero means *our own* view is degraded, not that the provider is down. |
| `isitdown_provider_last_fetch_timestamp_seconds` | gauge | `provider` | When its status was last read successfully. Absent until the first success. |
| `isitdown_poll_duration_seconds` | gauge | `provider` | How long its last poll took, retries included. |
| `isitdown_polls_total` | counter | `provider`, `outcome` | Polls attempted since start, `outcome` being `success` or `failure`. |
| `isitdown_notifications_total` | counter | `channel`, `outcome` | Delivery attempts since start, `outcome` being `sent` or `failed`. |
| `isitdown_last_cycle_timestamp_seconds` | gauge | — | When the last cycle finished. Absent until this process has run one. |

The counters are per process, not per database: they start at zero on restart —
which is what Prometheus expects of a counter — rather than being derived from
the `notifications` table, which is pruned with the rest of the history and
would make a counter go backwards.

Two alerts worth having, and neither is "provider is down":

```yaml
groups:
  - name: isitdown
    rules:
      # The provider says it is down, and has for ten minutes.
      - alert: ProviderDown
        expr: isitdown_provider_up == 0
        for: 10m
      # Our own monitoring is blind — no successful cycle in fifteen minutes.
      - alert: IsItDownStalled
        expr: time() - isitdown_last_cycle_timestamp_seconds > 900
```

A Grafana dashboard is committed alongside them (roadmap 4.14):
`docs/grafana/isitdown.json`. Import it with **Dashboards → New → Import →
Upload JSON**, then pick the Prometheus that scrapes IsItDown — the file carries
a datasource variable rather than a hardcoded uid, so nothing has to be edited
first. Three rows: the fleet (providers polled, providers not operational, open
incidents, time since the last cycle, providers we have gone blind on) over a
per-provider status timeline, polling (duration and failure rate per provider),
and notifications (deliveries per channel and outcome, and a day's failures per
channel). A test checks every query in the file against the metric names
`/metrics` actually exports, so a renamed series fails the build rather than
quietly emptying a panel.

There is no authentication: this is a local, single-operator dashboard. Do not
publish port 3000 to a network you do not trust.

---

### 6.3 Live updates

The dashboard is pushed to rather than polling: it opens `/events` once and
re-reads what an event names.

```bash
curl -N localhost:3000/events
#   event: hello
#   data: {"lastPollAt":"...","nextPollAt":"...","serverNow":"..."}
#   event: cycle
#   data: {"startedAt":"...","finishedAt":"...","providers":4,"failed":0,"changedProviders":["github"]}
```

Server-sent events, not a WebSocket: nothing the dashboard sends needs a socket
— every write it makes is already an HTTP request — and SSE rides plain HTTP
with reconnection handled by the browser, so it costs no new dependency.

A cycle event re-reads the cheap keys (status, incidents, notifications,
maintenance); the 90-day history and the map are re-read only when
`changedProviders` is non-empty, which for most cycles it is not. Polling does
not go away, it steps back: with the stream connected every query drops to a
two-minute safety interval, because a stream the browser still believes is open
but whose events stopped arriving — a proxy that dropped it, a suspended laptop
— would otherwise leave the dashboard frozen with no sign of it. When the
stream drops, the queries return to the 30-second rhythm until it reconnects,
and the header's next-poll label carries a **Live** badge whenever the push is
what is keeping the page fresh.

Behind a reverse proxy, the stream needs buffering off (the response sends
`X-Accel-Buffering: no` for nginx) and a read timeout longer than a heartbeat,
which is written every 20 seconds.

---

### 6.4 Badges and the widget summary

Two read-only endpoints aimed outward rather than at the dashboard.

`GET /badge/github.svg` renders a flat badge — the provider's name, its current
reading, and the colour that goes with it — for pasting into a README:

```markdown
![GitHub](http://localhost:3000/badge/github.svg)
```

`GET /badge.svg` does the same for the fleet, reporting the worst reading
anything is showing. Both are drawn here rather than fetched from shields.io, so
an instance with no outbound internet access still serves them, and both are
`Cache-Control: max-age=60` — long enough that a popular README is not a load
generator, short enough that a badge is not still green an hour into an outage.
A provider that has never been polled reads `unknown`, in grey: never green.

`GET /widget` answers the shape `homepage` and Dashy expect from a custom API
widget — counts and one word, no nested history:

```json
{
  "status": "major_outage",
  "providers": 4,
  "operational": 2,
  "degraded": 1,
  "down": 1,
  "unknown": 0,
  "muted": 1,
  "incidents": 2,
  "lastPollAt": "2026-08-19T14:32:07.000Z",
  "retentionDays": 120
}
```

Neither endpoint contacts a provider and neither records anything: both are
reads of stored state, which is what makes them safe to poll often.

## 7. How it works

### 7.1 Data flow

```
                 ┌──────────────┐
                 │  Scheduler   │  setTimeout re-armed after each cycle, ±10% jitter
                 └──────┬───────┘
                        │ every cycle, re-read from scratch
                        ▼
                 ┌──────────────┐         config.yml (Light)
                 │ ConfigSource │◀────────  or SQLite (UI)
                 └──────┬───────┘
                        ▼
   ┌────────────────────────────────────┐      ┌──────────────┐
   │              Poller                │─────▶│   Adapters   │──▶ provider status pages
   │  stagger · retry · isolate failures│      └──────────────┘
   └──────┬──────────────────────┬──────┘
          │ previous state       │ new state
          ▼                      ▼
   ┌──────────────┐       ┌──────────────┐
   │  StateStore  │       │ Diff Engine  │  the only thing that decides
   │ JSON │ SQLite│       └──────┬───────┘  whether anything notifies
   └──────────────┘              │ StatusChange[]  (usually empty)
                                 ▼
                        ┌────────────────┐
                        │   Dispatcher   │  the only caller of Notifier.send
                        └───────┬────────┘
                                ▼
                   Telegram · webhook · Discord · Slack

   UI edition only: an Express server in the same process serves the dashboard and
   the API from the same StateStore, and can ask the scheduler for a cycle now.
```

The core engine is edition-agnostic. `src/core`, `src/adapters` and `src/notifiers`
never import from `src/light` or `src/ui` — a test enforces it. Editions differ only
in the `ConfigSource` and `StateStore` they inject.

### 7.2 Components

1. **Scheduler** — runs a cycle immediately, then re-arms a `setTimeout` at the
   interval ±10% jitter, so a slow cycle delays the next rather than overlapping it
   and a fleet of instances never hits a provider in lockstep. It re-reads the
   configuration every cycle, which is what makes UI changes take effect with no
   restart. A cycle that throws is logged and the loop keeps running. The tick is
   the shortest cadence anything asked for: it takes the configuration's own
   shortest interval and then asks the poller, which may only ask for *sooner* —
   that is how an open incident tightens the loop without an interval change.

2. **Poller** — staggers providers 250ms apart, then runs them under
   `Promise.allSettled` so one provider's failure cannot affect another's result.
   Up to `maxRetries` attempts each, exponential backoff plus jitter, every request
   under its own timeout. On exhausted retries it records the failure and leaves the
   stored status untouched. It also decides who is *due*: a provider is polled when
   its own cadence has elapsed — its `intervalMinutes`, the global one when it names
   none, or `adaptiveIntervalMinutes` while it has an open incident — so a tick
   pulled down to a minute by one provider in trouble does not sweep the whole fleet
   along with it.

3. **Adapters** — turn a provider's raw response into the normalised shape:

   ```ts
   interface NormalizedStatus {
     provider: string;                 // "github"
     overallStatus: "operational" | "degraded" | "partial_outage" | "major_outage" | "unknown";
     activeIncidents: { id: string; name: string; impact: string; status: string; updatedAt: string }[];
     fetchedAt: string;                // ISO 8601, UTC
   }
   ```

   `statuspage.adapter.ts` is generic and configured by base URL alone, which covers
   every Atlassian-hosted page. It throws on a network error, a non-2xx or an
   unparseable body so the poller's retry can act, but degrades quietly on a missing
   individual field — an incident with no title becomes an empty string, not a crash.
   The payload is validated with `zod`; a login page or an error blob is rejected.

4. **State Store** — the last known `NormalizedStatus` per provider, the consecutive
   failure count, and whether the "monitoring degraded" warning has already been
   sent. Light writes a JSON file through a temporary file and a rename, so a crash
   mid-write cannot truncate it; UI uses the built-in `node:sqlite` and also records
   the history the charts read. Both pass the same contract suite, so they are
   provably interchangeable.

   A failed fetch never overwrites the stored status. Keeping the last known state is
   what stops the next successful poll from being reported as a recovery that never
   happened.

5. **Diff Engine** — pure, synchronous, and the single authority on whether anything
   notifies. See [7.3](#73-when-a-notification-fires).

6. **Dispatcher** — the only caller of `Notifier.send` in either edition. One payload
   per change per enabled channel, all under `Promise.allSettled`: a channel failure
   is recorded and logged but never blocks another channel or another change.
   Notifiers are rebuilt from the configuration every cycle, which is why enabling a
   channel needs no restart.

7. **Notifiers** — Telegram, generic webhook, Discord and Slack. Message assembly is shared
   (`src/notifiers/formatting.ts`), so channels cannot drift apart in what they
   report; only the transport differs. A channel with a structured native format
   asks for the same message in pieces (`renderParts`) rather than composing its
   own. Emoji, colour and layout live in the notifier, the words come from the
   shared catalogs.

### 7.3 When a notification fires

This table *is* the behaviour — it is the diff engine's test suite, and new edge
cases get added as rows rather than as one-off tests.

| Previous | New | Notifies |
|---|---|---|
| nothing yet (first poll) | anything | **no** — a baseline is not news, so a fresh container never bursts |
| operational | operational | no |
| operational | degraded | yes — `status_change` |
| degraded | major_outage | yes — escalation |
| major_outage | operational | yes — `status_change` plus `incident_resolved` |
| any | a new incident id appears | yes — `incident_opened` per incident |
| any | same incident, `status` or `impact` changed | yes — `incident_updated` |
| any | same incident, only `updatedAt` or the title changed | **no** — a provider bumping a timestamp is not an event |
| any | same incidents, different order | **no** — compared by id, so ordering cannot false-positive |
| `unknown` | anything | **no** `status_change` — there is no real baseline to compare |
| anything | `unknown` | **no** `status_change` — a transition *into* "we don't know" is not news |
| N consecutive failed cycles | | yes, **once** — `monitoring_degraded`, and not again until a success clears it |
| no window running | a declared window starts | yes — `maintenance_started` |
| a window running | the same window ends | yes — `maintenance_ended`, naming the status the provider came out in |
| a window running | anything else changes upstream (status, components, incidents) | **no** — suppressed until the window ends |
| a mute is running (`mutedUntil` in the future) | anything | **no** — the operator said they already know; polling and recording carry on |
| `confirmSamples: N` | a change seen fewer than N polls in a row | **no**, *yet* — the baseline is held, so the same change is announced once N polls agree |
| `confirmSamples: N` | a change that reverts before N polls agree | **no**, ever — a page disagreeing with itself was never news |

**Mute** is the same rule with the operator standing in for the provider: it is
an input to the diff engine rather than a filter on the way out, which is why a
muted provider shows a badge on the dashboard instead of just going quiet. A mute
also keeps the notification baseline current, so lifting it does not replay what
happened while it ran.

**Flap damping** (`confirmSamples`) moves the *notification baseline*
independently of the samples: readings keep being recorded every poll, so the
dashboard always says what the page says right now, while the baseline stays put
until a change has been seen the configured number of polls in a row. A real
outage therefore costs at most `confirmSamples - 1` polls of delay, and a
one-cycle disagreement costs nothing at all.

Everything in the table above is the diff engine deciding what is *news*. What
happens to a change after that is the delivery policy's business — quiet hours,
a digest window, an hourly cap, one message per incident — and that is
[3.8](#38-delivery-policy--quiet-hours-digests-caps). The order is deliberate
and never the other way round: the engine answers "did something change", the
rules answer "who covers it", and the policy answers "does it reach them now".

**Suppression rule**: while any maintenance window a provider declared is
running, nothing else about that provider is news — a status change, a new or
updated incident, a component flip, all of it stays quiet until the window
closes. The only exception is the window's own start and end. This means an
incident that opens *inside* a window and is still open when the window closes
never gets its own `incident_opened` message — the only announcement for it is
the open-incident count carried on `maintenance_ended`. If it is still open
once the window is long gone, nothing chases it further; check the dashboard.

Two things this does *not* change: maintenance rows are merged into the
dashboard's incident timeline, but only on the timeline's first page — older
maintenance history is available from `/maintenances`, not the timeline.
Uptime percentages are also unchanged — a sample taken while a window is
running counts exactly as it does today, maintenance or not.

A restart notifies nothing: state is reloaded from the store, and reloaded state
compares equal to what produced it. Both store implementations are tested for this.

### 7.4 Notification format

```
🔴 GitHub — MAJOR OUTAGE

Incident: API requests failing intermittently
Status: Investigating
Updated: 2026-08-19 14:32 UTC

https://www.githubstatus.com
```

```
🟢 GitHub — RESOLVED

Incident "API requests failing intermittently" has been resolved.
Updated: 2026-08-19 15:10 UTC

https://www.githubstatus.com
```

```
⚪ AWS — monitoring degraded

5 consecutive fetches failed. Last known status: Operational.
Updated: 2026-08-19 22:04 UTC
```

Emoji by severity: 🟢 operational · 🟡 degraded · 🟠 partial outage · 🔴 major
outage · ⚪ unknown. A monitoring warning is always ⚪ — it is about IsItDown's
own fetching, not the provider's state, so it never borrows the provider's colour.
Timestamps stay UTC with an explicit suffix in every language.

### 7.5 Resilience

- **Provider unreachable** — log it, keep the last known state, retry next cycle.
  After `failureThreshold` consecutive failed cycles, one "monitoring degraded"
  warning; never a silent forever.
- **Malformed response** — validated at the boundary. A missing optional field
  degrades; a fundamentally broken body throws so retry and failure accounting can
  act. One bad provider never crashes a cycle.
- **Duplicate notifications** — structurally prevented: the diff engine is the only
  thing that decides, and the dispatcher is the only thing that sends.
- **Restart** — state is reloaded from the store, so no false "everything changed"
  burst. Tested in both editions, including in the container.
- **Rate limiting** — each provider's request is offset by a hash of its id, bounded
  to a tenth of its cadence, and the interval itself carries jitter, so neither one
  instance nor a fleet hammers a provider on the same second; because the offset is
  anchored on the id, adding a provider does not move everyone else's request. A
  provider's stored validator turns most cycles into a `304` with no body, and a
  provider that publishes twice a year can be given its own slower cadence with
  `intervalMinutes`.
- **A provider that asks for room** — a `429`, or any answer carrying `Retry-After`,
  is honoured: that provider sits out the cycles until the window it stated has
  passed, instead of being retried inside it. A bare `503` stays an ordinary failure,
  a `429` with no header gets a one-minute default, and a stated window is capped at
  six hours so a provider cannot take itself off the dashboard for a week. A manual
  poll from the dashboard still asks — that is one request the operator chose.
- **Untrusted timestamps** — a provider's `updatedAt` ahead of our clock cannot start
  an incident in the future; the start time is pinned to the poll that first saw it,
  while the provider's own claim is still recorded.
- **Concurrent writes** — a cycle mutates state for every provider at once, so the
  file store serialises writes and gives each its own temporary file.

---

## 8. Theming and localisation

### 8.1 Themes

UI edition. Three states: **light / dark / system**, cycled from the header.

- **Tokens, not per-component colours.** Every colour is a CSS custom property.
  `css/tokens.css` is the only file in the dashboard allowed to contain a colour
  literal, and a test enforces that. The light palette sits on bare `:root`, the dark
  one overrides it in `:root[data-theme="dark"]`, and the same overrides are mirrored
  under `prefers-color-scheme: dark` guarded by `:root:not([data-theme="light"])` so
  "system" works in both directions. All three blocks declare an identical token set,
  which a test also checks — a token defined in one theme only would render wrong.
- **Shadcn's components read the same tokens.** `tokens.css` also maps the semantic
  variables shadcn's primitives expect — `--background`, `--foreground`,
  `--primary`, `--border`, `--ring` and the rest — onto this palette, so a stock
  shadcn component needs no per-component override to fit the design system.
  Tailwind's `dark:` variant is rebound, via `@custom-variant`, from shadcn's
  default `.dark` class to this repo's own `[data-theme="dark"]` attribute, so the
  existing theme toggle — which sets an attribute, not a class — still drives it.
  None of this touches the pre-paint script below, which still only ever sets
  `data-theme`.
- **Charts read the same tokens**, so they never need a separate dark palette.
- **System is the default.** With no explicit choice, the theme follows the OS and
  reacts to it changing live, with no reload.
- **Persisted twice**: in `localStorage`, so the inline `<head>` script can apply it
  *before first paint* and avoid a flash of the wrong theme; and in the settings
  table, so a fresh browser against the same instance starts where you left off.
- **Palette**: Nocturne, from the Claude Design prototype. The light mode reads the
  same tonal ramps from the other end — no colour was invented, including the five
  severity colours, which have their own value per theme.

### 8.2 Localisation

Two layers, `en` as the source and the fallback in both:

| Layer | Files | Used by |
|---|---|---|
| Notification text | `src/core/i18n/<lang>.json` | both editions |
| Dashboard text | `src/ui/web/locales/<lang>.json` | UI edition |

`src/core/i18n/` is untouched by the dashboard's stack; the server still resolves
notification strings itself, in both editions, exactly as before. The dashboard
now resolves its own strings through `react-i18next`, configured with
`keySeparator: false` and single-brace interpolation (`{name}`, not the default
`{{name}}`) — the same flat `area.subject.variant` keys and placeholder syntax the
catalogs already used. Plurals use i18next's `_one`/`_other` key suffixes, not a
dotted pair. The catalogs are **bundled, not fetched**: `src/ui/web/lib/i18n.ts`
imports both JSON files directly, so they ship inside the JS bundle and
`GET /locales/:lang.json` no longer exists as a route.

Rules that are enforced by tests, not just documented:

- **No user-facing literal in code.** Every string is a flat dotted key; the value
  lives in a catalog. Logger output, thrown `Error` messages, adapter ids and route
  paths are developer-facing and stay plain English.
- **Every catalog has exactly `en`'s key set**, and every translated value carries
  the same named placeholders as its source. A string cannot ship half-translated.
- **Every key the dashboard asks for exists** — a typo would otherwise render as the
  key itself in the browser.
- **Never assemble a sentence from translated fragments.** Word order differs per
  language, so one key holds the whole sentence. Plurals are separate `_one`/`_other`
  keys, not composed at the call site.
- **Dates, numbers, percentages and durations** go through `Intl.*` in the active
  locale. Notification timestamps are the deliberate exception: always UTC with an
  explicit suffix, so an operator reading alerts in two languages never has to guess.
- The dashboard language and the notification language are **separate settings** — an
  English UI can send Italian alerts.
- Adding a **notification** language is one JSON file under `src/core/i18n/` — no
  code change. Adding a **dashboard** language is one JSON file under
  `src/ui/web/locales/` plus one import line in `src/ui/web/lib/i18n.ts`, since the
  catalogs are bundled rather than discovered from disk at runtime.

Shipping: `en` and `it`. Locale resolution is the stored preference, then `en`.

> The Italian strings were written alongside the implementation and have not had a
> native review.

### 8.3 Accessibility

The dashboard is one operator's console, and that operator may be using a
keyboard, a screen reader, a high-contrast setting, or all three (roadmap 5.13).
What is guaranteed, and checked:

- **Contrast.** Every status colour used as *text* clears WCAG AA (4.5:1) against
  both the page and the card, in both themes — `src/ui/web/css/tokens.test.ts`
  computes the ratios from `tokens.css`, so a palette tweak that breaks one
  fails the suite rather than shipping. The audit found two real defects in the
  dark theme: a partial outage and a major one were the same colour, and the
  status *label* read from the near-background grey the unsampled uptime bars
  want (1.3:1 — no text at all). Both are fixed; the bars keep their grey as a
  separate `-fill` token.
- **Keyboard.** Every dialog rides Radix's contract — focus moves in on open,
  Tab stays trapped, Escape closes, focus returns to the trigger — and the
  dialogs that accumulated (service add/edit, remove, diagnose, routing rules)
  each have a test that shows it rather than assuming it. Hand-written
  clickables (a provider row, a ring tile) get a visible focus ring from
  `base.css` at zero specificity, under whatever ring a primitive already has.
- **Charts.** A run of coloured bars says nothing out loud, so the uptime bars,
  the component strip, the poll strip, the sparkline and the provider ring each
  carry a one-sentence summary ("Daily status over 90 days: 84 operational, 3
  with issues, 3 not measured"), in the active locale. A status dot is hidden
  from the accessibility tree wherever the status is written beside it, and
  carries the status in words wherever it is not.
- **Motion.** `prefers-reduced-motion: reduce` flattens every entry animation,
  hover travel and pulse in `motion.css`, and the views that animate in
  JavaScript check the same query.

---

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
[5.1](#51-smoke-checks) meaningful against it too. `docker-compose.dev.yml`
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

- **Diff engine** — the whole table in [7.3](#73-when-a-notification-fires), including
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

---

## 10. Roadmap

Delivered:

- **v1 — Light edition**: polling, the diff engine, Telegram and generic-webhook
  notifications, `config.yml` with environment-referenced secrets, a JSON state store
  with atomic writes, `ghcr.io/devmanfre/isitdown:light-latest`.
- **v1.1 — UI prototyping**: the dashboard explored in Claude Design and kept in
  `design/claude-design-prototypes/`. Option `3a`, the navigable console, is the
  implementation reference; the dark palette and the longer Italian label lengths were
  validated there rather than discovered later.
- **v1.2 — UI edition**: that design as an Express + vanilla-ES-module dashboard over
  SQLite, with configuration managed at runtime and applied on the next cycle without
  a restart. `ghcr.io/devmanfre/isitdown:ui-latest`, built `FROM` the Light image.
- **v1.3 — history**: per-provider uptime and incident history with status-page daily
  bars and 7/30/90-day views, aggregated server-side and served from `/history`.
- **v1.4 — dark mode and i18n**: token-based light/dark/system theming with a
  persisted preference, and a localised dashboard (`en`, `it`) on top of the localised
  notification messages both editions already share.

Since v1.4 (on `dev`): adapters for AWS, Google Cloud and Azure, conditional
requests so most cycles are a `304`, a per-provider poll cadence, the delivery log
view, a provider removal that can be undone inside a restore window, ntfy and
Gotify alongside the other channels, a year heat calendar per provider,
readiness split from liveness, an integrity check and vacuum on demand, and a
committed Grafana dashboard.

Still open:

- A native review of the Italian strings.
- Direct HTTP probes ("is *my* thing up") and a public read-only status page — the
  two items that change what IsItDown is, listed in `ROADMAP.md`.

Explicit non-goals: multi-user auth (this is a local, single-operator dashboard),
status pages behind a login, and a packaged mobile app.

---

## 11. Branch layout and merge policy

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
