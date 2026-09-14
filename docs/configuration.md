[← README](../README.md)

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
| `services[].adapter` | — | Required. `statuspage` covers every Atlassian-hosted page; `instatus`, `betterstack`, `cachet`, `uptimekuma` and `uptimecom` cover those hosted and self-hosted platforms; `rss` reads any RSS or Atom incident feed; `html` scrapes a page that publishes neither (see below); `slack`, `aws`, `gcp` and `azure` read those providers' own shapes; `http` probes an endpoint of your own rather than a status page (see below). |
| `services[].enabled` | `true` | `false` keeps the entry but stops polling it. |
| `services[].intervalMinutes` | — | 1–1440. This provider's own cadence; omit to follow `pollIntervalMinutes`. A cycle runs at the shortest cadence anything asked for, and the slower providers sit the extra cycles out. |
| `services[].mutedUntil` | — | ISO 8601. While it is in the future the provider is polled and recorded as usual but notifies nothing — "I know, stop telling me, until then". In the UI edition this is what the dashboard's **Mute** control writes. |
| `services[].options` | — | Adapter-specific extras. Two adapters take any today: `html` (`selector`, plus optional `operational` / `degraded` / `partial_outage` / `major_outage` word lists) and `http` (see its own section below). |

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

#### The `http` adapter — probing your own endpoint

Every other adapter reads a page a provider publishes about itself. This one
reads the service directly: it makes the request, and the answer is the reading
(roadmap 1.8).

```yaml
  - name: My API
    id: my-api
    adapter: http
    baseUrl: https://app.example.com
    options:
      path: "/health"
      expectStatus: "200-299"
      expectBody: '"db":"up"'
      slowMs: "1500"
      header.Authorization: "Bearer ${API_TOKEN}"
```

| Option | Default | Meaning |
|---|---|---|
| `method` | `GET` | `GET` or `HEAD`. `POST` is refused: the poller retries a failed read, and a retried `POST` is not the same request twice. |
| `path` | — | Appended to `baseUrl` verbatim. Base URLs are stored without a trailing slash, so this is how an endpoint that needs one gets it — and how one host is probed at two paths from two services. |
| `expectStatus` | `200-299` | Single codes or inclusive ranges, comma-separated (`200-299,401`). Anything outside reads as an outage, so an API that is up and refusing us can still be healthy. |
| `expectBody` | — | Plain text that must appear anywhere in the response. |
| `absentBody` | — | Plain text that must **not** appear: how an error page served with a `200` is caught. |
| `slowMs` | — | An answer at or over this many milliseconds reads `degraded` instead of `operational`. |
| `followRedirects` | `yes` | `no` reads a `3xx` as itself, so a dead app redirecting to a login page is not read as healthy. |
| `tlsWarnDays` | — | A certificate expiring within this many days reads `degraded`. Off unless set: `fetch` exposes nothing about the connection it made, so the expiry costs a second handshake, and it is only asked for after a request that already succeeded. |
| `header.<Name>` | — | One request header per option. A `${VAR}` in the value is resolved from the environment at request time; an unset variable throws rather than sending the literal `${VAR}` and reporting your service down over a `401`. |

The readings this produces:

| What happened | Reading |
|---|---|
| Accepted status, body matches, under `slowMs` | `operational` |
| Accepted status and body, at or over `slowMs` | `degraded` |
| Accepted status and body, certificate inside `tlsWarnDays` | `degraded` |
| Status outside the set, missing/forbidden body text | `major_outage` |
| Refused, unresolvable, TLS rejected, or past the request timeout | `major_outage` |

Four things worth knowing before relying on it:

- a non-2xx and an unreachable host are **readings**, not failed reads. Every
  other adapter throws on those so the poller can retry, because a status page
  that will not answer has told us nothing; here it has told us everything.
- the reading is a severity and nothing more: no incidents, no components, no
  maintenance windows. There is no document to read them out of, and minting an
  incident per poll would open and resolve one every cycle. *When* it went down
  still comes from the status change and the history.
- it is one vantage point, this container. A local DNS or egress failure reads
  as every probed service being down at once. The poller says so when it can: a
  cycle in which *every* provider either failed or never answered logs a warning
  and adds "this looks like a failure on our side" to those reads in
  **Diagnose** — one status page answering normally is enough to rule it out. It
  changes no reading and silences no message, because from here those services
  really are unreachable; collapsing the burst into a single fleet-wide alert
  needs an event that is not about one provider (roadmap 2.7). `confirmSamples`
  is still the setting for "a single blip is not worth a message".
- a probe that is not operational says why: **Settings → the provider's row →
  Diagnose** carries the sentence the reading has nowhere to hold — `answered
  HTTP 503, outside the accepted 200-299`, `no answer from …: connect
  ECONNREFUSED`, `the TLS certificate expires in 9 day(s)`. "Down" and "down
  because the name no longer resolves" are the same severity and different
  problems.
- it will probe **anything this container can reach**, private addresses
  included, and it does so with no allowlist. That is deliberate for a
  single-operator dashboard bound to `127.0.0.1`; it is also the reason a
  read-only API token or a public read-only page (roadmap 4.15 and 5.1) would
  have to decide who may write a service definition before either ships.
- a wrong option (`expectStatus: 2xx`, a `${VAR}` with nothing behind it, an
  `expectBody` on a `HEAD`) throws every cycle and shows up as a failing
  provider, never as a service quietly reading down. `node dist/light/check.js
  --probe` catches it before the poller does.

Anything invalid stops the container at boot with the reason and the offending
path — a missing file, malformed YAML, a bad base URL, a duplicate service id, an
empty service list, or an enabled channel whose secret is unset. A container that
started with a half-understood configuration would look healthy while silently not
alerting, which is the one failure mode worth being loud about.

### 3.2 UI edition — runtime settings

The UI edition mounts **no** `config.yml`; one on disk would be ignored.
Everything lives in SQLite at `/app/data/isitdown.db` and is edited from
**Settings** in the dashboard (or through [`/config`](api.md#6-http-api)):

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

#### Cachet, Uptime Kuma and Uptime.com

Three more small JSON shapes, and the first two are the ones this project's own
audience self-hosts — a fleet can include the status page next door:

```yaml
  - id: neighbour
    name: The neighbour's Cachet
    adapter: cachet
    baseUrl: https://status.neighbour.example

  - id: homelab
    name: Homelab
    adapter: uptimekuma
    baseUrl: https://uptime.example.com/status/demo

  - id: uptimecom
    name: Uptime.com
    adapter: uptimecom
    baseUrl: https://status.uptime.com/statuspage/uptime-status
```

**Cachet** — three reads per cycle, because Cachet publishes the three halves of
a status page in three documents and none stands in for another:
`/api/v1/components`, `/api/v1/incidents` and `/api/v1/schedules`. They
revalidate with `ETag` like every other read here, so a quiet cycle is three
`304`s. Cachet has no aggregate word — `/api/v1/status` answers a three-way
`success`/`info`/`danger` that cannot tell a partial outage from a major one —
so the reading is folded from the components, which is also what a scoped
provider is folded from.

| Payload | Reading |
|---|---|
| A component's `status` | `1` operational, `2` → degraded, `3` → partial outage, `4` → major outage |
| A number we do not know | Major outage; never silently downgraded |
| `enabled: false` | Not part of the reading: a disabled component is not on the page |
| An incident's `is_resolved` | Open until it is true; a Cachet too old to publish it closes on a `Fixed` update instead |
| `component_id: 0` | A page-wide incident, which reaches a scoped provider too |
| A schedule | A maintenance window; `status: 2` (completed) is dropped |
| A timestamp | Written with no zone at all, so it is read as UTC — which is what a container install runs on |

Every list is asked for at the API's ceiling of 100 rows: an instance with more
than 100 components is read as its first hundred, rather than walking the
pagination on every cycle. The component picker resolves group names from
`/api/v1/components/groups`, which only the dashboard ever fetches.

**Uptime Kuma** — a prober rather than a page someone writes, so it publishes no
aggregate word either. Two reads per cycle, both needed: the status page document
names the monitors and never says how they are doing, and the heartbeat document
says how they are doing and never names them. Give the page URL as you see it in
the browser (`…/status/<slug>`) and the slug is read out of it; a bare host reads
Kuma's own `default` page, and `options.slug` overrides either.

| Payload | Reading |
|---|---|
| A monitor's newest beat | `1` operational, `0` → major outage, `2` (retrying) → degraded, `3` (maintenance) → unknown |
| Every monitor up | Operational |
| Some up, some down | Partial outage — Kuma's own header rule, not a worst-of, so one monitor down out of ten does not read as a major outage |
| Every monitor down | Major outage |
| No beat at all, or all abstaining | Unknown |
| The pinned incident (`incident`, or `incidents` on 2.x) | One open incident carrying Kuma's own `style` word |
| `maintenanceList[]` | A window, placed on the clock with the entry's own `timezoneOffset`; it does not say which monitors it covers |

There is no incident history to backfill from: a Kuma page publishes beats and
one pinned notice, and nothing that amounts to a closed incident with a start and
an end.

**Uptime.com** — the page is server-rendered and the payload it is rendered from
is served as JSON beside it: `<page>/ajax` for the current state, `<page>/history`
for the closed incidents. Both answer inside a `{ error, fields, data }`
envelope. The base URL is the status page itself rather than the host, because an
account can publish several at `/statuspage/<slug>` each.

| Payload | Reading |
|---|---|
| A component's `status` | `operational`, `degraded-performance` → degraded, `partial-outage`, `major-outage`; punctuation and case are ignored |
| `under-maintenance` | Unknown — abstains rather than claiming to be up |
| A group | Read through its subcomponents, never twice: a group's status is a summary of exactly those |
| `global_is_operational: false` | Raises an otherwise operational reading to degraded — a page can carry an incident that has moved no component — but never lowers one |
| `incident_type: INCIDENT` | An open incident |
| `incident_type: SCHEDULED_MAINTENANCE`, or `upcoming_maintenance[]` | A maintenance window, not an incident |
| An incident's state | `latest_update_incident_state`, or the newest update's own state — the two endpoints fill in different ones |

Freshstatus, the fourth page considered for this family, is not readable without
credentials: its pages render client-side and its public API answers `403` to
anything but its own front end, so it needs the HTML-scrape adapter rather than a
parser of its own.

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
| Email (SMTP) | `email` | `SMTP_HOST`, `SMTP_FROM`, `SMTP_TO` (`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_ALLOW_INSECURE_AUTH`, `SMTP_ALLOW_SELF_SIGNED` optional) |
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

**Email** is SMTP submission, and it is written here rather than taken from a
library (roadmap 3.3): what a notification needs is one submission conversation
— greeting, `EHLO`, `STARTTLS`, `AUTH`, envelope, `DATA` — and that is
`src/notifiers/smtp.ts`, so the project still has the three runtime dependencies
it advertises. What a mail library would add on top of it — address parsing,
attachments, connection pooling, a dozen transports — a status alert has no use
for.

The subject is the heading every other channel puts first (`🔴 GitHub — MAJOR
OUTAGE`), so a lock screen shows the same sentence Telegram would; the body is
the detail and the provider's own status page, since a mail client has no
affordance to hang a link on. `SMTP_TO` takes one address or several separated
by commas, and one message goes out with one envelope recipient each.

Defaults are the ones a submission server expects: port 587 with `STARTTLS`
whenever the server offers it, and port 465 treated as implicit TLS whether or
not `SMTP_SECURE` says so. Two settings exist for the server on your own
machine, and both are off unless set: `SMTP_ALLOW_INSECURE_AUTH` is what it
takes to send credentials over a connection that was never encrypted — without
it the send fails rather than putting a password on a cleartext socket — and
`SMTP_ALLOW_SELF_SIGNED` accepts a certificate no public CA signed. A relay that
trusts this network needs no credentials at all, which is why both are optional.
A refused message reports the server's own reply (`550 5.7.1 relay denied`) into
the delivery log.

### 3.7 Notification routing

An ordered table of rules decides which enabled channels hear about a given
change. Each rule has four parts:

```yaml
routing:
  - provider: "*"            # a service id, `group:<slug>` (§3.10), `<id>#<component>`, or "*" 
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

A rule can also name **one component of one provider**, as `<id>#<component>`
— `github#8l4ygp009s5s`. A component's transition already carries the
component's own severity rather than the provider's, so this is all that was
needed to route one independently: put `github#api` above `github` and that one
component goes to a phone while everything else on the page goes to Slack, or
give it `channels: []` and mute one noisy component without going quiet about
the provider. A component target matches only that component's own transitions,
so a provider-level status change never matches one. The component id is the
provider's own — the same id the component picker stores — and removing a
provider deletes its components' rules along with its own.

The Light edition configures the table as the `routing` list in `config.yml`,
shown above; the UI edition edits it from **Settings**, where the provider
column lists each provider's selected components beneath it and a routing rules
editor also offers a dry run — pick a provider (and, where one is selected, a
component) plus a canned event, and it names which rule would win and which ones
were never reached, evaluated against the rules you currently have saved, not a
hypothetical set.

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
| An `http` service whose probe options cannot be read (bad `expectStatus`, a `${VAR}` with nothing behind it, an `expectBody` on a `HEAD`) — offline, so it is caught without `--probe` | error |
| With `--probe`: a base url no adapter recognises. `http` services are skipped here: a probe's target is not a status page and is not meant to look like one | error |
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
