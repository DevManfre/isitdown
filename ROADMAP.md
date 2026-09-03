# ROADMAP

Brainstorm of possible future work for IsItDown. **Nothing here is committed** —
it is a wide net, deliberately over-inclusive, meant to be pruned. Items are
grouped by theme, each with a rough size (S / M / L) and a note on why it might
matter or why it might not.

Legend:

- **S** — a day or less, fits the existing seams.
- **M** — a few days, may need a new table, route or interface method.
- **L** — a structural change: new subsystem, new concept in the data model, or a
  shift in what the product *is*.
- ⚠️ — collides with a declared non-goal or a core principle in `README.md`;
  needs a deliberate decision before it is planned, not just prioritised.
- ✅ — shipped; kept listed so the phase reads as a whole.

Current state for reference (v1.2.0): Statuspage and generic RSS/Atom adapters, both
covered by the shared adapter contract suite; Telegram, webhook, Discord, Slack and web
push channels; scheduled-maintenance awareness (windows silence the diff engine and
show on the dashboard and timeline); Prometheus `/metrics`; UI edition with overview,
providers, incidents, history, settings, geographic map/globe; channel credentials
settable from the dashboard (write-only, kept in a `0600` file beside the database and
applied with no restart); SQLite history with 120-day retention; `en` + `it`.

---

## 1. Adapters — what can be monitored

The single biggest lever: today one adapter covers everything, and everything it
does not cover is invisible.

| # | Item | Size | Notes |
|---|---|---|---|
| 1.1 | **AWS Health adapter** | M | Not Statuspage. Public health feed is its own JSON shape, region-scoped. Most-requested provider by far in this category. |
| 1.2 | **Google Cloud adapter** | M | `status.cloud.google.com/incidents.json` — flat incident list, no overall status field, so severity has to be derived. |
| 1.3 | **Azure Status adapter** | M | RSS/Atom plus an HTML page; the messiest of the three hyperscalers. |
| 1.4 | **Slack adapter** | S | `status.slack.com/api/v2.0.0/current` — small, well-shaped, good first non-Statuspage adapter to prove the interface holds. |
| 1.5 ✅ | **Generic RSS/Atom adapter** | M | A large tail of status pages publish a feed and nothing else. One adapter, configured by feed URL, unlocks dozens of providers with no new code per provider. High leverage. |
| 1.6 | **Generic HTML-scrape adapter** | M | CSS selector + a status-word mapping in `options`. Fragile by nature; would need an explicit "this can break silently" warning in the UI. |
| 1.7 | **Instatus / Better Stack / Sorry™ adapters** | S each | The three most common Statuspage competitors. Each is a small, stable JSON shape. |
| 1.8 | **Direct HTTP probe** ("is *my* thing up") | L ⚠️ | GET a URL, expect a status code / body match, record latency. Turns IsItDown from a status-page aggregator into an uptime monitor. Huge scope expansion, and it makes the tool useful to people who monitor nothing third-party at all. Decide the product identity before building. |
| 1.9 | **TCP / DNS / TLS-expiry probes** | M ⚠️ | Only meaningful if 1.8 lands. Cert-expiry in particular is a cheap, high-value alert. |
| 1.10 | **Silent-outage cross-check** | M ⚠️ | Needs 1.8. Provider's page says operational, our own probe of their API fails → flag it. Genuinely novel: it monitors the *status page's honesty*, which nothing else in this category does. |
| 1.11 ✅ | **Adapter contract test kit** | S | Mirror `test/core/stateStore.contract.ts`: one suite every adapter must pass (throws on non-2xx, degrades on missing optional field, never returns an unvalidated shape). Makes every item above cheaper and safer. Should land *before* 1.1. |
| 1.12 ✅ | **Fixture recorder script** | S | `node tools/record-fixture.mjs <url> <provider>` — fetch once, save under `test/fixtures/`. Removes the main friction in adding an adapter. |
| 1.13 | **Plugin adapters from a directory** | L | Drop a `.js` into `/plugins` and it registers itself. Lets people add a provider without forking. Security and validation implications: a plugin runs with full process privileges. |

## 2. Polling and the diff engine

| # | Item | Size | Notes |
|---|---|---|---|
| 2.1 ✅ | **Scheduled-maintenance awareness** | M | Already on the README's open list. Statuspage exposes `scheduled_maintenances`; today it is dropped. Add a `maintenance` state, show it on the timeline, and *suppress* incident alerts inside a declared window — a planned outage waking someone at 03:00 is the classic false positive. |
| 2.2 | **Per-provider poll interval** | S | `intervalMinutes` is global. A provider that publishes every 5 minutes and one that updates twice a year do not deserve the same cadence. Small change to `ServiceDefinition` + poller. |
| 2.3 | **Adaptive polling** | M | Poll every minute while an incident is open on that provider, back off to the configured interval when clear. Better signal, less traffic — the two usually trade off, here they do not. |
| 2.4 | **Conditional requests (ETag / If-Modified-Since)** | S | Store the ETag per provider, send it back. Most cycles become a 304. Cheap, polite, and reduces the chance of being rate-limited. |
| 2.5 | **Flap damping** | M | Require N consecutive samples agreeing before a transition notifies. Protects against a provider's page briefly disagreeing with itself. Must be expressible as diff-engine table rows, not a special case elsewhere. |
| 2.6 | **Provider groups / "my stack"** | M | Group providers, derive a composite status per group, alert on the group. Answers "is my deploy path healthy" rather than "is GitHub healthy". |
| 2.7 | **Correlated-outage detection** | L | Three providers degrade within the same window → one "likely shared upstream" meta-event instead of three alerts. Needs a correlation window and a suppression rule; genuinely useful during a Cloudflare/AWS day, and rare enough to be hard to test. Would need synthetic history in tests. |
| 2.8 | **Record fetch latency of the status page itself** | S | One extra column on `status_samples`. Free signal: a status page slowing down is often the first sign of trouble, and it makes a nice chart. |
| 2.9 | **Component-level alerting** | M | `scopeToComponents` already narrows what is *reported*; extend it so a specific component's transition can notify independently, with its own severity. |

## 3. Notification channels

The `Notifier` interface is the cleanest seam in the codebase — every item below
is additive and independently shippable.

| # | Item | Size | Notes |
|---|---|---|---|
| 3.1 ✅ | **Discord** | S | Webhook-shaped, rich embeds. On the README's open list. |
| 3.2 ✅ | **Slack** | S | Incoming webhook + Block Kit. Same. |
| 3.3 | **Email (SMTP)** | M | The most-asked-for channel in self-hosted tools, and the only one that adds a real runtime dependency (an SMTP client) to a project that currently has three. Weigh that against the principle. |
| 3.4 | **ntfy / Gotify** | S each | Self-hosted push, exactly this project's audience. ntfy in particular is a single POST. |
| 3.5 | **Pushover** | S | Paid but trivially simple; popular. |
| 3.6 | **Matrix** | M | Homeserver + room id + access token. |
| 3.7 | **PagerDuty / Opsgenie Events API** | M | Moves IsItDown from "notifier" to "part of an on-call chain". Needs dedupe keys and a resolve event, which maps cleanly onto the existing incident lifecycle. |
| 3.8 | **Microsoft Teams** | S | Webhook. Boring, widely needed. |
| 3.9 | **Apprise bridge** | S | One notifier that speaks Apprise gets ~80 channels at once. Pragmatic shortcut — at the cost of an external binary or service. |
| 3.10 | **Per-provider / per-severity routing** | M | On the README's open list. A channel matrix: "major outages of anything → phone; everything else → Slack". Probably the single highest-value notification feature. |
| 3.11 | **Quiet hours** | M | Suppress below a severity floor between configured hours, with an override for major outages. Needs a timezone preference (5.9). |
| 3.12 | **Digest mode** | M | Batch changes into one message every N minutes. During a big multi-provider incident the current one-message-per-change behaviour is a flood. |
| 3.13 | **Per-provider alert cap** | S | Hard ceiling of N messages/hour/provider, with a "suppressed X more" note. Cheap insurance against a pathological provider. |
| 3.14 | **Notification retry + dead-letter** | M | A failed send is logged and dropped today. Retry with backoff, and surface permanently-failed sends in the dashboard. |
| 3.15 | **Customisable message templates** | L | Per-channel template with a small, safe token set. Powerful and much requested for webhooks; a real design problem to keep it from becoming a templating language, and it fights the "formatting lives in the notifier" convention. |
| 3.16 | **HMAC signing for the generic webhook** | S | A shared secret and an `X-IsItDown-Signature` header. Lets a receiver verify the payload actually came from here. |
| 3.17 | **Delivery log in the dashboard** | S | The `notifications` table already records what was sent; there is no view for it. Show sent/failed per channel with the payload. |
| 3.18 | **Inbound chatops (Telegram bot commands)** | L | `/status`, `/mute github 2h`, `/history cloudflare`. Turns a one-way channel two-way. Needs a long-poll or webhook receiver and an auth model for "who may command this bot" — the first place where the no-auth stance actually pinches. |

## 4. Data, API and integrations

| # | Item | Size | Notes |
|---|---|---|---|
| 4.1 ✅ | **Prometheus `/metrics`** | S | `isitdown_provider_up`, `isitdown_poll_duration_seconds`, `isitdown_notifications_total`. Tiny to build, and it plugs IsItDown into every self-hosted Grafana on the planet. Best effort-to-reach ratio in this document. |
| 4.2 | **SSE or WebSocket live updates** | M | Replaces the dashboard's 30-second poll with a push. Instant reaction on a manual `/poll`, less idle work, and it makes the poll indicator honest. |
| 4.3 | **Config export / import** | M | `GET /config/export` → a `config.yml` the Light edition can eat, and the reverse for seeding UI from a file. Makes the two editions genuinely interchangeable, which today they only are in principle. |
| 4.4 | **Backup / restore of the SQLite file from the UI** | S | Download the DB, upload to restore. Nearly all state is one file — `secrets.env` (5.17) is the exception, and a backup that silently omits the credentials is worse than none, so the flow has to say which of the two it covers. |
| 4.5 | **Configurable retention** | S | 120 days is hardcoded in `src/ui/runtime.ts`. Should be a setting, with the storage cost shown next to it. |
| 4.6 | **CSV / JSON export of history and incidents** | S | Per provider, per window. Asked for by anyone who has to report uptime to someone else. |
| 4.7 | **Monthly uptime report** | M | Generated Markdown (or print-styled HTML) summarising the month: uptime per provider, incident count, worst day. Pairs with 4.6. |
| 4.8 | **Shields.io-compatible badge endpoint** | S | `/badge/github.svg` → a green/red badge for a README. Fun, viral, ~40 lines. |
| 4.9 | **RSS / iCal feed of incidents** | S | Lets people consume IsItDown with tools it will never integrate with directly. |
| 4.10 | **OpenAPI spec** | M | The API is documented in prose in `README.md` and nowhere machine-readable. A spec enables generated clients and keeps the docs honest. |
| 4.11 | **`homepage` / Dashy widget endpoint** | S | A single summary JSON in the shape those dashboards expect. Trivial, and it puts IsItDown on a lot of homelab home pages. |
| 4.12 | **Home Assistant integration** | M | Expose providers as binary sensors (MQTT or REST). Same audience, deeper hook. |

## 5. Dashboard

| # | Item | Size | Notes |
|---|---|---|---|
| 5.1 | **Public read-only status page** | L ⚠️ | Publish a shareable view built from the monitored fleet — "here's the health of everything we depend on". Read-only so it does not strictly break the no-multi-user stance, but it does mean exposing a port to people who are not the operator. Big product decision, and probably the most differentiating item in this file. |
| 5.2 | **Mute / acknowledge a provider or incident** | M | "I know, stop telling me, for 2 hours." Currently the only options are notified or deleted. Needs to be a diff-engine input, not a notifier filter, so the state is visible in the UI too. |
| 5.3 | **Operator notes on an incident** | M | A free-text note attached to an incident — "this is why our deploy failed on Tuesday". Turns the incident log into a small institutional memory. |
| 5.4 | **Command palette (⌘K)** | M | Jump to provider, switch view, run a poll, toggle theme. The console shell is already built for it. |
| 5.5 | **Arbitrary date range on history** | M | 7/30/90 are fixed. A range picker plus zoom on the charts. |
| 5.6 | **Provider detail page** | M | The drawer works, but a linkable full page per provider (uptime, incidents, components, map) is a natural home for everything currently scattered. |
| 5.7 | **Compare two providers** | S | Overlay two uptime series. Useful when deciding between vendors. |
| 5.8 | **Wallboard / kiosk mode** | M | Full-screen, oversized, auto-rotating, no chrome. Aimed at an office screen. Cheap given the components already exist. |
| 5.9 | **Timezone preference** | S | Everything is UTC. Correct, defensible, and mildly annoying every single day. |
| 5.10 | **Favicon and title reflect worst status** | S | A red dot in the tab when something is down. Small, delightful, genuinely useful. |
| 5.11 | **Provider catalog / onboarding wizard** | M | Pick "GitHub" from a bundled list instead of typing an id, a name and a base URL. First-run experience is currently a form; it should be a menu. |
| 5.12 | **Undo for destructive actions** | S | Deleting a service cascades away its samples, incidents and state. There is no way back. At minimum a confirmation naming what will be lost; better, a soft delete with a grace period. |
| 5.13 | **Accessibility pass** | M | Keyboard traversal of every view, visible focus, `prefers-reduced-motion` honoured throughout (the UI leans hard on motion), colour contrast audit in both themes, screen-reader labels on charts. |
| 5.14 | **More locales** | S each | `es`, `fr`, `de`, `pt`. The i18n plumbing exists and is enforced; adding a catalog is mechanical. |
| 5.15 | **Native review of the Italian catalog** | S | On the README's open list already. |
| 5.16 | **Bundle-size budget** | S | The dashboard has grown Recharts, motion, cobe, dotted-map. A CI check that fails on regression keeps it from quietly becoming a megabyte. |
| 5.17 ✅ | **Set a channel credential from the dashboard** | M | Settings took only the *name* of the environment variable, so configuring a channel meant editing `.env` and recreating the container. A value now goes to `secrets.env` beside the database (`0600`, in the data volume) and into the process environment, live on the next request; the database still stores only the variable name and no route reads a value back. |

## 6. Operations and packaging

| # | Item | Size | Notes |
|---|---|---|---|
| 6.1 ✅ | **CI: typecheck, tests, build on every push** | S | The conventions here are strict and currently enforced only by discipline. This is the highest-value item in the section. |
| 6.2 ✅ | **Multi-arch images (arm64)** | S | The target audience runs Raspberry Pis and ARM VPSs. `docker buildx` in CI. |
| 6.3 ✅ | **Publish to GHCR with semver tags** | S | Images published as `ghcr.io/devmanfre/isitdown:{light,ui}-latest` and `-vX.Y.Z` on a `v*` tag. |
| 6.4 ✅ | **Release automation + changelog** | M | Tag → build → publish → release notes from commit messages. The commit format is machine-parseable already, which makes generated notes actually good. |
| 6.5 | **Helm chart / k8s manifests** | M | Both editions, with a PVC for the SQLite file. |
| 6.6 | **Unraid template / Home Assistant add-on** | S each | Distribution, not features. Reaches the exact audience. |
| 6.7 | **Single-binary build (Node SEA)** | M | For people who want neither Docker nor a Node install. Light edition only, realistically. |
| 6.8 ✅ | **SBOM + signed images** | S | `cosign` keyless signing plus SBOM/provenance on the release build. |
| 6.9 | **Split readiness and liveness probes** | S | The current healthcheck conflates "the process is alive" with "polling is working". |
| 6.10 | **OpenTelemetry traces** | M ⚠️ | Useful for debugging a slow cycle, but it adds a runtime dependency to a project whose whole pitch is three of them. Probably a no. |
| 6.11 | **Log to file with rotation** | S | Today logs go to stdout only, which is right for Docker and wrong for a bare-metal install. |

## 7. Internal quality

| # | Item | Size | Notes |
|---|---|---|---|
| 7.1 | **Visual regression tests** | M | Playwright screenshots per view, both themes, both locales. The dashboard is now large enough that a CSS token change can quietly wreck a view nobody opened. |
| 7.2 | **Coverage reporting with a floor** | S | Not a target to game — just a floor that fails when a new subsystem lands untested. |
| 7.3 | **Mutation testing on the diff engine** | M | The diff engine is the one place where a passing test suite that does not actually constrain behaviour would be dangerous. It is small enough that mutation testing is affordable exactly there. |
| 7.4 | **Load / soak test** | M | 200 providers, a week of simulated history. Finds the point where the SQLite reads or the overview render fall over. |
| 7.5 | **Docs split** | S | `README.md` is ~69k and has to be both a landing page and a manual. Splitting into `docs/` with a short README would make both jobs easier — at the cost of the current "everything is in one file" property, which is genuinely nice. |
| 7.6 | **Keep `README.it.md` in sync automatically** | S | Two 70k documents drift. At minimum a CI check that flags when one moves without the other. |

## 8. Speculative

Ideas worth writing down and probably not worth building — kept here so they are
not re-invented from scratch later.

| # | Item | Notes |
|---|---|---|
| 8.1 | **Provider trust score** | Compare a provider's self-declared status against observed reality (needs 1.8/1.10) and score how honest their status page is. Nobody publishes this. It would be genuinely interesting and slightly inflammatory. |
| 8.2 | **"This day last year"** | Seasonal comparison on the history view. Requires more than a year of data before it says anything, and 120-day retention means it never will without 4.5. |
| 8.3 | **Anomaly detection on uptime patterns** | Statistically dubious at this data volume. Listed to be explicitly dismissed. |
| 8.4 | **Terminal client / TUI** | `isitdown watch` in a pane. Fun, and the API already supports it. |
| 8.5 | **Browser extension** | Fleet status in the toolbar. Mostly redundant with web push, which already exists. |
| 8.6 | **Federation between instances** | One instance aggregates several others read-only. Interesting for multi-site setups, hard to justify for a single-operator tool. |
| 8.7 | **Incident postmortem export** | Generate a Markdown postmortem skeleton from an incident's timeline plus operator notes (5.3). Cute, narrow. |

---

## Suggested first slice

If the list has to collapse to one quarter's worth, the highest ratio of value to
effort is roughly:

1. ✅ **1.11 + 1.12 adapter contract kit and fixture recorder** — makes section 1 cheap.
2. ✅ **1.5 RSS adapter** — proves the adapter seam on something that is not Statuspage. (1.4 Slack still open.)
3. ✅ **4.1 Prometheus `/metrics`** — a day of work, a large audience.
4. ✅ **2.1 scheduled maintenance** — removes the most annoying class of false alert.
5. ✅ **3.1 + 3.2 Discord and Slack channels** — both nearly free behind the existing interface.
6. **3.10 routing rules** — the notification feature people actually hit the ceiling on.
7. **5.12 undo / safer delete** — a data-loss footgun that exists today.

The two items that most change *what IsItDown is*, and therefore deserve a
decision rather than a slot in a queue, are **1.8 direct HTTP probes** and
**5.1 the public status page**.
