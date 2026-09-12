[← README](../README.md)

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
| `GET` | `/incidents/:providerId/:incidentId` | Detail: the incident, the observed timeline, the action log of what was sent, the provider's other open incidents, the last 24 polls, and the operator's own notes on it (roadmap 5.3). |
| `POST` | `/incidents/:providerId/:incidentId/notes` | Writes one note, `{ body }`, 1 to 2000 characters. The incident has to exist, so a typo in a URL cannot quietly accumulate notes about nothing. Answers the stored note. |
| `DELETE` | `/incidents/:providerId/:incidentId/notes/:id` | Removes one. Scoped to the incident it was written on: the same id addressed through another incident is a `404`, not a match. |
| `GET` | `/export/incidents.csv?provider=&state=&q=&days=` | The incident search's own result as a download — the same filters `/incidents` takes, without paging: `provider_id,incident_id,name,impact,status,started_at,updated_at,resolved_at`. RFC 4180, so a name carrying a comma, a quote or a newline stays one field. Capped at 20 000 rows; a capped export answers with `X-IsItDown-Truncated: true` rather than looking complete. |
| `GET` | `/export/incidents.json?provider=&state=&q=&days=` | The same rows as `{ generatedAt, filter, count, truncated, incidents }` — `filter` echoes what the export was taken with, so a file found later still says what it is. |
| `GET` | `/export/history.csv?provider=&days=` | Uptime history as one row per provider per day: `provider_id,day,worst_status,uptime_pct`. `days` accepts `7`, `30` or `90`, like `/history`; `provider` narrows to one (`404` on an unknown id), and without it, every enabled provider. |
| `GET` | `/export/history.json?provider=&days=` | The same window as `{ generatedAt, days, providers }`, each provider carrying the buckets, the daily series and the window's percentages the charts are drawn from. |
| `GET` | `/feeds/incidents.xml?provider=&state=&q=&days=` | The incident search's own result as an RSS 2.0 feed — roadmap 4.9. The same filters `/incidents` takes, newest 200, served inline so a reader subscribes instead of saving a file. Each item links back into the dashboard's own route for that incident, and its `guid` is the `provider/incident` pair rather than the link. |
| `GET` | `/feeds/incidents.ics?provider=&state=&q=&days=` | The same rows as an iCalendar file, one `VEVENT` per incident: it starts when the incident was first seen and ends when it resolved, or at the last update while it is still `TENTATIVE`. |
| `GET` | `/maintenances?provider=&days=` | Declared maintenance windows — running, upcoming and past — as `{ maintenances }`. `days` bounds how far back a closed window is still returned (default 90, max 365); `provider` narrows to one. Without `provider`, every enabled provider. |
| `GET` | `/notifications?limit=` | What was actually sent, newest first. Capped at 200. |
| `GET` | `/notifications/log?state=&channel=&page=&pageSize=` | One page of the delivery log: `{ page: { items, page, pageSize, total }, counts: { all, sent, failed } }`. `state` is `all` (default), `sent` or `failed`; `channel` narrows to one channel; `pageSize` defaults to 25 and is capped at 200. A nonsense `page`, `pageSize` or `state` falls back rather than 400s. `counts` carries every outcome whatever the filter. Each item carries `attempts`: a failed send with more than one is a dead letter. |
| `GET` | `/config` | Services, polling settings (`adaptivePolling` and `adaptiveIntervalMinutes` included), `retention`, `delivery` (quiet hours, digest, cap, `updateInPlace` — see [3.8](configuration.md#38-delivery-policy--quiet-hours-digests-caps)), channels, routing, and `removed` — providers taken out but still restorable. Channel credentials appear as variable **names** with an `isSet` flag — never values. |
| `GET` | `/config/export` | The whole configuration as a Light edition `config.yml`, as a download (roadmap 4.3) — polling, delivery, services, routing and channels. Credentials leave as `${VAR}` references, never values, and `webpush` is skipped: a browser subscription has no meaning in an edition with no browser. The file starts the Light image as it stands. |
| `POST` | `/config/import` | The same file, read back. Takes the YAML as the request body (`text/yaml`) or as `{ yaml }`. Validated through the Light edition's own file schema before anything is written, so a bad file changes nothing; a literal credential is refused outright. A service the file does not mention is removed the way the dashboard removes one — soft, restorable, history intact — and an absent `routing` block leaves the rules alone. Answers `{ added, updated, removed, channels, routingRules, settings }`. |
| `GET` | `/config/backup` | The whole database as one file (roadmap 4.4), taken with `VACUUM INTO` so it is a consistent snapshot rather than a file being written to as it is read. Downloads as `isitdown-<date>.db`, and carries `X-IsItDown-Secrets: excluded`: the channel credentials live in `secrets.env` beside the database and stay there. |
| `POST` | `/config/restore` | That file, put back. Send the bytes as `application/octet-stream`. Checked before anything is deleted — the SQLite magic, the tables, and a schema version that may be older but never newer than this build reads — then brought up to the current schema as its own database and copied in table by table inside one transaction, so no restart is needed and a failure half way leaves the database as it was. Replaces every row this edition stores; `secrets.env` is untouched. Answers `{ tables, fromSchemaVersion, schemaVersion, secretsKept }`. |
| `GET` | `/config/catalog` | The bundled provider catalog (roadmap 5.11): `{ providers: [{ id, name, adapter, baseUrl, configured }] }`. Answered from memory — the list ships with the image, so there is no upstream to be down and nothing to keep in sync. `configured` marks an id already watched: the row stays in the menu saying so rather than disappearing from it. Detection stays the path for a page the list does not have. |
| `POST` | `/config/services` | Add a service. `201`, or `409` on a duplicate id, or `400` naming the invalid field. |
| `POST` | `/config/services/detect` | Which adapter reads the page at `{ url }`, and the base URL that adapter wants: `{ adapter, baseUrl, probes }`. Tries the shapes IsItDown already reads, in order (Statuspage's `/api/v2/summary.json`, Instatus's `/summary.json`, Better Stack's `/index.json`, Cachet's `/api/v1/components`, Uptime Kuma's `/api/status-page/default`, an Uptime.com page's `/ajax`, then a feed), and recognises the four single-provider adapters by host with no request at all. A page nothing recognised is a `200` with `adapter: null` and the probes it tried — only an unusable URL is a `400`. Records nothing and notifies nothing. |
| `PATCH` `DELETE` | `/config/services/:id` | Edit, or remove. A removal is a **soft delete**: the provider leaves the dashboard and the poll cycle at once, and the response says how long it stays restorable (`{ removed, removedAt, restoreUntil }`). `404` on an id that is unknown or already removed. |
| `POST` | `/config/services/:id/restore` | Undo a removal inside its window. Nothing was taken, so nothing is rebuilt; the gap in history from the days it was removed is backfilled. `404` if it is not a removed service. |
| `DELETE` | `/config/services/:id/permanently` | The destructive half, on its own path so nothing reaches it by accident: cascades to that provider's samples, incidents, maintenances, state and routing rules. This also happens on its own once the restore window closes. |
| `PATCH` | `/config/settings` | Polling settings — including `adaptivePolling` and `adaptiveIntervalMinutes` (1–1440) — `retentionDays`, how long history is kept, 7 to 3650 days, and `delivery`, the policy of [3.8](configuration.md#38-delivery-policy--quiet-hours-digests-caps). The delivery patch is partial at every level, so one field can be changed without writing back the rest. |
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
