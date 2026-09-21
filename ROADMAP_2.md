# ROADMAP 2

A second brainstorm, written after most of `docs/roadmap/ROADMAP.md` shipped. Same contract as
the first: **nothing here is committed**, the net is deliberately wide, and the
file exists to be pruned rather than executed.

Two things are different this time.

First, the numbering continues from `docs/roadmap/ROADMAP.md` — that file ends at section 8,
so this one starts at section 9. A row id is unique across both files, and a
note can point at `2.5` or `12.3` without qualifying which roadmap it means.

Second, the starting point is no longer an empty product. The first roadmap
asked *what could IsItDown do*; nearly every cheap answer has now been built.
The interesting questions left are of a different kind:

- **Is what the dashboard says actually true?** Uptime is computed from samples
  the poller took. When the poller was not running, there are no samples — and
  today nothing distinguishes "the provider was fine" from "nobody was looking".
  Every number on the History view inherits that ambiguity.
- **What is IsItDown now?** It began as a status-page aggregator. It has HTTP,
  TCP, DNS and TLS probes (1.8, 1.9), so it also monitors things that have no
  status page. Those are two products sharing one binary, and the roadmap has
  never said which one wins an argument.
- **Which non-goals still deserve to be non-goals?** `README.md` rules out
  multi-user auth, anything SaaS-shaped, and a mobile app. Those lines were
  drawn when the tool was one operator on one machine watching eight providers.
  Section 9 puts each of them back on the table with a concrete shape attached,
  because "no" is a much better answer once somebody has written down what "yes"
  would actually cost.

Legend (unchanged from `docs/roadmap/ROADMAP.md`):

- **S** — a day or less, fits the existing seams.
- **M** — a few days, may need a new table, route or interface method.
- **L** — a structural change: new subsystem, new concept in the data model, or a
  shift in what the product *is*.
- ⚠️ — collides with a declared non-goal or a core principle in `README.md` (or
  in the manual under `docs/`); needs a deliberate decision before it is planned,
  not just prioritised.
- 🔁 — carried over from `docs/roadmap/ROADMAP.md` unshipped, but re-framed here because the
  reason it did not ship has changed. The original row id is named in the note.
- ✅ — shipped. The commit is named in the note.
- ◐ — partly shipped: what landed and what did not are named in the note.

## What has shipped

Eleven rows, delivered together in one session. Each carries its state in its own
row; this is the list, because scrolling eight hundred lines to find out what is
left is not a way to read a file like this.

| Row | Commit |
| --- | --- |
| ✅ 9.1 — which source is the record, declared per provider | `0357705` |
| ✅ 10.1 — "not observed" told apart from "up" | `8452a09` |
| ✅ 10.2 — the definition of uptime, published and tested | `c7520ed` |
| ✅ 10.4 — samples marked with the parser that read them | `ee41266` |
| ✅ 10.7 — daily buckets in the operator's zone | `9b8f74f` |
| ✅ 11.1 — generic JSON adapter with a declared mapping | `864d565` |
| ✅ 12.1 — timeline annotations | `66c94e0` |
| ✅ 12.2 — MTTR, MTBF and a reliability ranking | `2ab9838` |
| ✅ 12.3 — incidents by hour and weekday | `2ab9838` |
| ◐ 13.1 — problems first and density; not virtualisation | `694d6c7` |
| ✅ 14.1 — the real message preview per channel | `2db60e7` |

Two of the three rows this file's closing section argued hardest for — **10.1**
and **12.1** — are through. The third, **15.1**, is not.

---

## 9. Identity decisions — the non-goals, reopened

Not a work queue. Each row is a question with a proposed answer, sized as if the
answer were yes. The output of this section is a decision written into
`README.md`, even when the decision is "still no" — a non-goal that has survived
a costed alternative is worth far more than one that was never challenged.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| ✅ 9.1 | **Aggregator or uptime monitor — pick one** | L ⚠️ | The probes (1.8, 1.9) made this ambiguous and nothing has resolved it. An aggregator's job is *relay what the provider admits*; a monitor's job is *decide for yourself*. They disagree on almost everything downstream: what uptime means, whether a provider's own "operational" can be overruled, whether latency is a first-class metric, what the Overview leads with. Proposal: IsItDown stays an aggregator, probes stay a supporting cast that can *contradict* a status page (1.10) but never replace it — and the manual says so in one paragraph, once. **✅ `0357705`.** Shipped, with a different answer from the proposal: **both, declared per provider** — `authority` is `declared` or `observed`, the default comes off the adapter (`kind: page | probe`) and is not stored. Written into `README.md` and `docs/how-it-works.md` §7.7. |
| 9.2 | **A sharable read-only view** | L ⚠️ | 5.1 in the first roadmap, still unshipped, still the single most asked-for thing a status aggregator can do. Three shapes, in rising cost: (a) a static export — `npm run export:public` writes a self-contained HTML file with the current fleet and 90 days of history, suitable for a bucket or Pages, no server, no new attack surface; (b) a second port serving a read-only subset of the existing routes; (c) full sharing with links and expiry. (a) honours every non-goal and answers most of the demand. Start there, and only there. |
| 9.3 | **One shared passphrase, not accounts** | M ⚠️ | The non-goal is *multi-tenant auth*, and it is a good one. But "no auth at all" only holds while the dashboard is on `127.0.0.1`, and the Tailscale / reverse-proxy crowd is most of the audience. A single passphrase in an env var, a signed cookie, no user table, no roles — this does not become multi-user, and it makes the honest deployment story stop being "put a proxy in front of it". Pairs with 4.15 (read-only API token). |
| 9.4 | **Who muted GitHub?** | S ⚠️ | If 9.3 lands, the natural next request is an audit trail, and the natural next one after that is accounts. Pre-empt it: record an actor string on every write (mute, rule change, credential set), taken from a configurable header and defaulting to `local`. An audit trail with no identity system. It also makes the delivery log and settings history explicable when two people share one instance without the product admitting they do. |
| 9.5 | **Mobile: PWA or nothing** | M ⚠️ | "No mobile app" is listed as a non-goal, but web push already reaches a phone and the dashboard is now the only part that does not work there. A PWA is not an app: a manifest, a service worker, a layout that survives 390px. It needs deciding once rather than drifting — 5.21 has been open since the first roadmap while the mobile navigation got built anyway. |
| 9.6 | **Federation for the multi-site homelab** | L ⚠️ | 8.6, reopened because the shape is clearer now: not a protocol, just one instance adding another instance's `/status` as a *provider* through the existing adapter interface. Site B appears on site A's Overview as one tile with a composite status, using groups (2.6) for the breakdown. No new subsystem, no new concept — an adapter and a decision. |
| 9.7 | **A public demo instance** | M ⚠️ | Not SaaS — one container, seeded with synthetic history, reset hourly, running the real image. Every self-hosted tool that grew adoption had one. The non-goal it brushes against is operational, not architectural: somebody has to run it forever. |
| 9.8 | **Say no, in writing** | S | Whatever 9.1–9.7 conclude, the non-goals section of `README.md` should carry the *reason* and the rejected alternative, not just the refusal. It is the cheapest row in this file and the one that saves the most future argument. |

---

## 10. Truth in the data

The most valuable section here, and the least visible. Everything the dashboard
asserts rests on samples; nothing currently defends the quality of those samples.
A wrong chart is worse than a missing one, because nobody checks a chart they
believe.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| ✅ 10.1 | **Distinguish "up" from "unobserved"** | M | The foundational bug of the whole history subsystem. If the container is down for six hours, those hours are not in `status_samples`, and every uptime figure silently treats them as fine — or as a gap, depending on which query you read. Fix: record poller liveness as its own track (one row per completed cycle), derive *coverage* per day, render uncovered spans as a distinct hatched state in every chart, and exclude them from the uptime denominator. Until this exists, every number in History has an asterisk nobody can see. **✅ `8452a09`.** A `poll_cycles` table, a silence longer than twice the cadence is an absence, coverage drawn as hatching. Days before the first recorded cycle answer `null`, not zero. |
| ✅ 10.2 | **Publish the uptime definition, and test it** | S | How does a `degraded` hour count — as down, as up, as half? What about `maintenance`, which the diff engine silences (2.1)? The code has an answer; the operator has none. Write it in `docs/how-it-works.md`, assert it with a table-driven test, and show the definition in a tooltip on the number itself. **✅ `c7520ed`.** `docs/how-it-works.md` §7.6, every row of the table asserted in `test/ui/uptimeDefinition.test.ts`, plus the tooltip on the number. |
| 10.3 | **Backfill history from the provider** | M | A fresh install shows an empty History view for 90 days, which is exactly when somebody decides whether the tool is worth keeping. Statuspage and most feed-based providers expose past incidents; import them once at provider creation, marked as *imported* rather than *observed* so 10.1's coverage track stays honest. Best first-run experience improvement available. |
| ✅ 10.4 | **Stamp samples with their parser** | S | A sample says what was read, never *how*. Change an adapter's severity mapping and the past silently re-renders. One `adapter_version` column, bumped by hand when a mapping changes, makes a history chart explicable and an adapter regression visible. Cheap insurance against the class of bug nobody notices for months. **✅ `ee41266`.** `Adapter.version` plus an `adapter_version` column on `status_samples` and `component_samples`. Null on earlier rows: unknown revision, not a claim. |
| 10.5 | **Detect an adapter that has quietly died** | M | The HTML-scrape adapter (1.6) shipped with a "this can break silently" warning and no mechanism behind it. A selector that stops matching returns *operational* forever. Detection: hash the normalised payload per provider; a hash that has not changed in N days on a provider that historically changed, or a parse that now yields fewer fields than its own fixture, raises a health flag on the provider tile. Applies to RSS and JSON shapes too. |
| 10.6 | **Downsample instead of delete** | M | Retention today drops old rows. A year-old daily summary costs almost nothing to keep and is the only thing that makes year-over-year (8.2) or SLA trending (4.13) possible. Roll samples older than the retention window into daily aggregates and keep those indefinitely; retention becomes a resolution policy rather than an amnesia policy. |
| ✅ 10.7 | **Daily buckets in the operator's timezone** | S | Timezone preference (5.9) shipped for display. Aggregation still buckets by UTC day, so a user in UTC+13 sees an incident land on the wrong bar, and "today" on the heat calendar (5.20) is not their today. Decide once whether buckets follow the preference, and fix the DST edges with a test that crosses one. **✅ `9b8f74f`.** The store takes segments of constant offset, cut at the minute of the DST transition; the aggregation stays in SQL. A split day is summed from both sides. |
| 10.8 | **Replay: why did I get that alert?** | M | Keep the raw payload for the N most recent reads per provider (the diagnostics panel, 5.18, already keeps outcomes) and add a replay that re-runs the diff engine over two stored payloads, printing the decision path — which rule matched, which floor applied, whether flap damping (2.5) or quiet hours (3.11) intervened. The routing `explain` proved this pattern is worth having; extend it from *what would happen* to *what did happen*. |
| 10.9 | **Open an old database in CI** | S | Commit a fixture database from the earliest supported schema; a CI step opens it with the current build, runs migrations, and asserts the views render. Nothing else protects an upgrade path for people who have been running this for a year. |
| 10.10 | **Survive an unclean shutdown** | S | A power cut mid-write is the homelab's most normal failure. Assert the WAL settings, add a corruption drill to the test suite (truncate the file, kill mid-transaction), and make the failure mode a readable message plus a pointer to the backup (4.4) rather than a stack trace at boot. |
| 10.11 | **IsItDown watches IsItDown** | M | Missed cycles, a poll duration trending up, an adapter error rate climbing, a notifier failing every send — all visible in `/metrics` (4.1) and therefore only to people running Prometheus. Make the fleet's own health a first-class tile with the same diff-engine-and-notifier path as any provider, so the tool can tell you it has stopped working. Must go through the diff engine, per the standing rule. |
| 10.12 | **A deterministic clock in tests** | S | Adaptive polling, flap damping, digests, quiet hours, caps and retries are all time-dependent, and their tests currently negotiate with the real clock. One injectable clock makes the awkward cases (a digest window that spans midnight, a quiet-hours boundary in a DST fold) testable rather than avoided. |

---

## 11. Coverage — more things worth watching

The first roadmap treated coverage as a list of adapters to write. Most of that
list shipped, and the lesson was that the *generic* adapters (1.5, 1.6) carried
far more providers than the bespoke ones. This section follows that lesson: the
rows that scale are the ones where a new provider costs configuration, not code.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| ✅ 11.1 | **Generic JSON adapter with a declared mapping** | M | The gap between Statuspage (covered) and HTML scraping (fragile): a status page that serves perfectly good JSON in a shape nobody standardised. A path expression per field plus a status-word map, validated with `zod` at configuration time rather than at read time, turns most of that tail into a dashboard form. Same leverage the RSS adapter (1.5) delivered. **✅ `864d565`.** A `json` adapter, validated on save rather than on read. A path is names, dots and `[n]` — not JSONPath. |
| 11.2 | **A catalog that updates without a new image** | M | The 42-provider catalog (1.14, 5.11) ships inside the build, so a moved status URL needs a release. Fetch a signed catalog JSON on a slow cadence, fall back to the built-in copy, never auto-apply a change to a configured provider — only offer it. Keeps the catalog useful between releases without turning the tool into a client of somebody's server. |
| 11.3 | **Region- and component-scoped subscriptions** | M | Component-level alerting exists (2.9), but the hyperscalers need the other axis: an AWS incident in `ap-south-1` is not an incident for a fleet in Frankfurt. Let a provider declare the regions it cares about and have the adapter filter before the diff engine sees anything. Turns AWS from a noise source into a signal. |
| 11.4 | **Domain and DNSSEC expiry** | S | TLS expiry shipped inside the HTTP probe (1.9). Domain expiry is the same class of quiet catastrophe with a longer fuse, and DNSSEC failures take a site down in a way no status page reports. Both ride checks the DNS adapter already makes. |
| 11.5 | **A provider dependency graph** | L | Half the fleet runs on the other half: Vercel on AWS, countless SaaS on Cloudflare. Declaring `dependsOn` per provider lets correlated-outage detection (2.7) say *why* instead of only *that*, collapses six alerts into one with a named root, and makes the Overview explain itself during a big outage. The most interesting unbuilt idea in this file, and the hardest to keep from becoming a research project — the edges must be operator-declared, never inferred. |
| 11.6 | **Suggest providers from what is installed** | M | Point the add dialog at a `docker-compose.yml`, a `package.json` or a `/etc/hosts`, and propose the providers that stack implies. Onboarding today asks the operator to remember their own dependencies; this asks the machine. |
| 11.7 | **Import from Uptime Kuma / Gatus / Statping** | S each | People arriving already have a list of things they watch, in someone else's YAML or database. An importer per tool is mechanical and removes the only real barrier to trying IsItDown. |
| 11.8 | **Probe from more than one place** | L ⚠️ | "The status page says fine and it is down *for me*" is only answerable from one vantage point today. Two instances trading probe results is federation (9.6) wearing a different hat; a hosted checker is a non-goal. Listed so the demand is on the record, not because it should be built. |
| 11.9 | **Plugin adapters, reconsidered** | L 🔁 | 1.13, unshipped because a dropped-in `.js` runs with full process privileges. The reframe: adapters are not code, they are *declarations* — 11.1's mapping, a URL, a status-word table — so the plugin directory can take JSON and never execute anything. Most of the demand for plugins was the demand for 11.1. |

---

## 12. Depth — earning more from data already collected

Everything here runs on rows that are already in the database. No new polling, no
new dependency: the cost is analysis and presentation, which is the best ratio
available in this codebase.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| ✅ 12.1 | **Annotate the timeline with my own changes** | S | `POST /annotations` accepting a timestamp, a label and a colour, drawn as a marker on every chart. Wire a deploy pipeline to it in one line and "did our release cause this, or did Cloudflare?" becomes a glance. Tiny to build, and the thing an operator wants most during an incident. **✅ `66c94e0`.** `POST /annotations`, colour as a token name, a marker that outlives the provider it names. |
| ✅ 12.2 | **MTTR, MTBF and a reliability ranking** | M | The incident table already holds start, end and severity. Per provider: mean time to resolution, mean time between incidents, longest outage, trend against the previous period. One table, sorted, is a procurement document — and it answers "which of our vendors is actually the problem" with evidence instead of memory. **✅ `2ab9838`.** `GET /reliability`. MTTR averages only resolved incidents; MTBF is null below two. |
| ✅ 12.3 | **Incidents by hour and weekday** | S | A heatmap over data already stored. Providers deploy on a schedule and break on one; seeing that a vendor's incidents cluster on Thursday evenings is genuinely actionable and costs one query. **✅ `2ab9838`.** Same endpoint, `byWeekdayHour`, counted on incident onset in the operator's zone. |
| 12.4 | **Error budget with a burn projection** | M 🔁 | 4.13, better positioned now that 10.6 would keep the long tail of history. A monthly target per provider, budget consumed, and — the part that matters — a projection of when it runs out at the current burn rate. |
| 12.5 | **The trust score, finally computable** | M 🔁 | 8.1 was speculative because nothing observed reality independently. The probes (1.8) do. Score the gap between a provider's self-declared status and what the probe saw: how often, for how long, in which direction. Nobody publishes this, which is precisely why it is interesting — and why it must be framed as *observed disagreement*, never as an accusation. |
| 12.6 | **Postmortem export** | S 🔁 | 8.7, cheap now that operator notes (5.3), the timeline and the charts all exist: assemble them into one Markdown file with the timeline as a table. Narrow, but it is the artefact somebody has to write by hand the morning after. |
| 12.7 | **What changed while I was away** | S | Opening the dashboard after a weekend gives the current state and no narrative. A dismissible summary of everything since the last visit — resolved, still open, newly broken — reading from data the Incidents view already has. |
| 12.8 | **Plain-language incident summary** | M ⚠️ 🔁 | 8.8. Twelve terse provider updates collapsed into one sentence. Unchanged objection: it wants a model call, and the project's pitch is that it needs nothing. The only version worth considering is strictly optional, off by default, and pointed at a local endpoint the operator already runs. |
| 12.9 | **What an outage costs** | S | Let the operator declare an hourly cost per provider — a number they already carry in their head — and every incident, every monthly report (4.7) and every reliability ranking (12.2) carries a figure beside the duration. It changes the audience of the export from the person who runs the tool to the person who signs the contract. One field, one multiplication, disproportionate effect. |
| 12.10 | **Which providers break together, empirically** | M | 11.5 asks the operator to declare dependencies. This derives the same graph from evidence: cluster incidents that overlap in time across the whole stored history and rank the pairs that co-occur far more often than chance. Not a causal claim — a shortlist to hand to 11.5, and a standalone answer to "is it them, or is it the thing underneath them". |
| 12.11 | **"This day last year"** | S 🔁 | 8.2, which was speculative because nobody had a year of data and a year of raw samples would not have been affordable anyway. 10.6 answers both: daily aggregates kept indefinitely make the year-ago window a single cheap read, and the same rollup the History view already wants. The open questions are not technical — whether the comparison is calendar date against calendar date or weekday against weekday (incidents follow release trains, not the calendar), whether the number shown is uptime, incident count or minutes degraded, and what the view says honestly when the year before does not exist yet. |

---

## 13. The operator's day

The dashboard is feature-complete and has never been optimised for the two
states that matter: a fleet of a hundred providers on a normal day, and an
operator holding a phone during an outage.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| ◐ 13.1 | **Survive a hundred providers** | M | Every view assumes a fleet you can see at once. At 100 the Overview is a scroll, the rules list is a haystack, and the compare card can only hold two. Needs: collapsible groups (2.6 gives the structure), a density toggle, virtualised rows, and a default sort that puts trouble first. The tool's own success case is currently its worst view. **◐ `694d6c7`.** In: problems-first ordering and a density toggle (a stored preference, past a dozen providers). Collapsible severity groups already existed in the Overview's dense shape. **Not in: virtualised rows** — table rows expand, carry FLIP measurements and an exit animation, so it needs a variable-height virtualiser with measurements of its own. |
| 13.2 | **Acknowledge from the notification** | M | Telegram inline buttons and Discord components can carry *Ack* and *Mute 2h*. That closes the loop the delivery log only observes, and it is the useful 20% of chatops (3.18) without a command parser, a session model or an auth story. Both must land as diff-engine inputs, like every mute before them. |
| 13.3 | **Wallboard mode** | M 🔁 | 5.8. Full-screen, oversized, auto-rotating, no chrome, no interaction. The components exist; what is missing is a route, a rotation timer and a theme that reads from across a room. Also the most screenshot-able thing this project could ship. |
| 13.4 | **Kill the desktop assumption** | M 🔁 | 5.21, with mobile navigation now in flight. The remainder: the charts, the tables and the settings reels at 390px, plus the PWA manifest and service worker if 9.5 says yes. |
| 13.5 | **Actions in the command palette** | S | ⌘K (5.4) navigates. It should also *do*: mute a provider, force a poll, open diagnostics, toggle theme, jump to the last incident. The palette is already the fastest surface in the app and it currently only moves you somewhere. |
| 13.6 | **Undo, generally** | M | Provider removal has a restore window and it is the best interaction in the product. Every other destructive settings write is permanent and immediate. One undo stack behind the toast stack, with the write deferred by a few seconds, would generalise it — and would make the settings surface feel safe enough to explore. |
| 13.7 | **Set up in sixty seconds** | M | First run today is an empty dashboard and a settings form. It should be a three-step wizard: pick providers from the catalog, configure one channel, send a real test notification, done — with the test send as the proof, because a monitoring tool that has never notified anybody is not yet installed. |
| 13.8 | **A screen-reader pass** | M | Contrast and keyboard access were audited (5.12). Nothing has checked what the charts, the live regions and the toast stack announce, and an SSE-driven page is exactly where a screen reader goes wrong. Add `axe` assertions to the existing visual harness so it cannot regress. |
| 13.9 | **A tab left open for a week** | S | SSE reconnects, but a long-disconnected tab can render stale state with full confidence. Show a banner when the stream has been down, and refetch on reconnect rather than resuming. |
| 13.10 | **Empty, loading and error states, audited** | S | Written once, mostly early, never reviewed as a set. One pass across every view — no provider, no incident, no history yet, backend unreachable — with a visual baseline each, since the harness (7.1) makes them nearly free to keep. |
| 13.11 | **More locales, and a native Italian review** | S each 🔁 | 5.14 and 5.15, still open, still mechanical, still the cheapest reach extension available. `es`, `fr`, `de`, `pt`. Gate it with 15.6 so a new catalog cannot ship half-translated. |
| 13.12 | **A dashboard the operator composes from widgets** | L | Today every view is a fixed layout decided here, and the fleets using this tool are not alike: one operator watches eight vendors and wants incidents first, another runs a hundred probes and wants a wall of tiles. Ship a catalog of pre-built widgets — fleet grid, single-provider tile, uptime sparkline, open-incident list, delivery health, latency chart, year heat calendar (5.20), group composite, error budget (12.4), annotations feed (12.1), a counter, a clock — and let Overview become a grid the operator arranges: add, remove, resize, reorder, each widget configured (which provider, which window, which group) and the layout persisted as JSON in the database. Rules that keep this from becoming a framework: every widget is an existing component with a declared props schema, never a new rendering path; the layout is data, not code; the stock arrangement is the current Overview, so an operator who never opens the editor sees no change. Prerequisite for 13.3 and 17.2, which are both "the same widgets, rendered somewhere else". |
| 13.13 | **More than one dashboard** | M | Once 13.12 exists, one grid is immediately too few: *my stack* and *vendors I pay for* want different pages, and an incident wants a page that is nothing but the providers involved. Named dashboards, switchable from the rail, one marked default — cheap on top of a persisted layout, and the thing that makes the editor worth opening twice. |
| 13.14 | **Every widget is a door** | S | A widget shows a number; the next question is always *which rows*. Clicking through should land on the matching view with its filters already applied — a latency widget opens History scoped to that provider and window, an incident count opens the search (5.19) with the same query. Without this the composed dashboard is a poster; with it, it is the front door. |
| 13.15 | **A guided tour on first open** | M 🔁 | 13.7 gets an operator configured; nothing then shows them what they configured. The first time the dashboard is opened, run a short product tour over the real UI — anchored coach marks on the rail, a provider tile, the incident timeline, the history window picker, the delivery log and the settings entry — each step one sentence saying what the surface answers, with *Skip* on every step and no modal that cannot be dismissed. Rules that keep it from rotting: the steps are data (an ordered list of `{ anchor, i18n key }`), every string is a catalog key like any other (never a literal, see the `i18n-strings` convention), the anchors are `data-tour` attributes on components that already exist rather than a parallel tour-only DOM, and a missing anchor skips its step instead of leaving a card pointing at nothing. "Seen" is a flag in the settings store, not `localStorage`, so it follows the instance rather than the browser, and **Settings → Replay the tour** makes it repeatable — which is also how it gets a visual baseline (7.1) instead of being the one surface no test can reach twice. Runs after 13.7, not instead of it: the wizard proves the tool notifies, the tour explains the screen it hands back.

---

## 14. Notifications that earn the interrupt

The delivery machinery is done: routing, quiet hours, digests, caps, retries,
dead letters, in-place edits. What is missing is everything around *confidence* —
knowing what a message will look like, that it arrived, and that somebody dealt
with it.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| ✅ 14.1 | **Preview every channel's actual message** | S | Settings can send a test, and the routing rules can explain themselves, but nothing shows the rendered text per channel for a synthetic change before it is real. Render all configured channels side by side from one fake transition. Removes the "configure it and wait for an outage to find out" loop, and pairs with 14.2. **✅ `2db60e7`.** `GET /notifications/preview`, from the same pure functions the notifiers use. A structured channel shows the parts, never a mock-up of its shape. |
| 14.2 | **Message templates** | L 🔁 | 3.15. The objection stands — a template language is a small programming language with an escaping problem. The narrow version: a per-channel subject and body built from a fixed, documented token set, validated at save time, with the default template visible and editable. Locked to tokens the notifier already has; no expressions, no conditionals. |
| 14.3 | **Per-channel locale** | S 🔁 | 3.20. The catalogs exist and the dashboard already switches; notifications are English-only. A field per channel, resolved through the core catalog. |
| 14.4 | **Escalate when nobody answers** | M | If a major change is unacknowledged after N minutes, send it again on a different channel. Depends on 13.2 for the acknowledgement, and belongs in the delivery policy beside quiet hours and caps rather than anywhere near the poller. |
| 14.5 | **Tell me when a channel is broken** | S | A webhook whose receiver has been 500ing for a week shows as a badge in the delivery log and nowhere else — the operator has to notice an absence. Feed channel health into 10.11's self-monitoring so silence gets announced. |
| 14.6 | **One human, two channels, one message** | M | Someone on both Telegram and Discord gets everything twice, so they mute one and lose the redundancy. A notion of a *recipient* spanning channels, with a preferred channel and the others as fallback, makes redundancy usable — and it is the one piece of structure the notification layer genuinely lacks. |
| 14.7 | **Subscribe to a single incident** | S | Watch one incident to resolution without changing any routing rule, from a button on the incident view. The in-place edit path (3.19) already tracks the message; this decides who else gets it. |
| 14.8 | **A notifier contract suite** | M | The adapter contract kit (1.11) made every adapter cheaper and safer; notifiers have no equivalent, and there are eighteen of them. One suite every notifier must pass: never throws on a well-formed payload, surfaces a typed error on non-2xx, truncates to the channel's limit, keeps the dedup key stable across a change's lifetime, renders both plain and rich bodies. Should be written before 14.2, which multiplies the surface. |
| 14.9 | **Tell me before the maintenance, not during** | S | Scheduled windows are read, shown and used to silence the diff engine (2.1), and the operator hears about them only when one starts. A single notification at a configurable lead time — "GitHub maintenance in two hours" — uses data already in the database and is the one alert that lets somebody act in advance rather than react. |
| 14.10 | **Say why this provider matters** | S | An alert names a provider; at 3am the useful sentence is *what breaks for us when this is down*. A free-text line and an owner per provider, carried into every channel's message and shown on the provider detail page (5.6). No logic, no schema beyond two columns, and it turns an alert into a handover note. |

---

## 15. Running it for years

Packaging shipped well: images, Helm, Unraid, a single binary, signed artefacts.
The unexamined part is time — upgrades, migrations, drift, and the day a status
page changes shape without telling anybody.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| 15.1 | **A nightly canary against the real world** | M | Tests never touch a live provider, correctly. But an adapter breaks when *someone else* changes their JSON, and nothing here would notice until a user did. A scheduled CI job that hits the real status pages, compares the shape against the committed fixtures and opens an issue on drift — outside the test suite, never gating a build. The single highest-value operational row in this file. |
| 15.2 | **Migrations with a way back** | M | The schema has grown across many releases. A numbered migration runner with a down path, a mandatory pre-upgrade backup, and a refusal to start on a database newer than the binary — which is what actually happens when somebody rolls back an image. Pairs with 10.9. |
| 15.3 | **Reconcile the UI edition from a file** | L | The two editions diverge on configuration: a file for Light, SQLite for UI. Homelabbers increasingly want their UI instance declared in Git. Watch an optional mounted `config.yml` and reconcile the database towards it, with file-managed rows read-only in the dashboard. The import path (4.3) already proved the shapes are compatible. |
| 15.4 | **Rootless, read-only, distroless** | S | The image runs as root on a writable filesystem with a full userland. A non-root user, a read-only root with one writable volume, and a smaller base — all standard, none of them touching application code, and together they close most of what a security-minded operator would ask about. |
| 15.5 | **Secrets from files, not just the environment** | S | Docker and Kubernetes secrets arrive as files; the credential store is env-var-and-dashboard. Accept `*_FILE` for every secret, which is the convention every adjacent tool already follows. |
| 15.6 | **A translation coverage gate** | S | `check:readme` guards the documentation; nothing guards the catalogs. Fail the build on a key present in `en` and missing elsewhere, and report keys no code references. Prerequisite for 13.11. |
| 15.7 | **Scheduled backups to a mounted path** | S | Backup exists as a download (4.4). The unattended version — a cron expression, a target directory, a retention count — is the one people actually need, and it is `VACUUM INTO` on a timer. |
| 15.8 | **A stated resource envelope** | S | The load test (7.4) proved 200 providers works; nothing states what to provision. Publish measured memory, database growth per provider per month, and CPU per cycle at 10 / 100 / 500 providers. Turns "will it run on my Pi" into a table. |
| 15.9 | **Proxy and air-gapped operation** | S | Corporate and homelab networks both route through proxies. Honour `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` everywhere (one HTTP helper, so one change), and document what degrades with no egress at all. |
| 15.10 | **systemd unit and a Homebrew formula** | S each | The single binary (6.7) has no packaging around it. A unit file and a formula are an afternoon each and reach the people who will never run Docker. |
| 15.11 | **Say when a newer version exists** | S ⚠️ | A self-hosted instance runs until somebody remembers to pull. A quiet check against the GHCR tag list, a badge in Settings, no auto-update and no telemetry going the other way — and off by default, because a tool that phones home uninvited contradicts the pitch even when the call is harmless. |

---

## 16. Quality machinery

The test estate is unusually good — contract suites, mutation testing, visual
baselines, coverage floors, a load test. These rows close the gaps that estate
does not yet cover.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| 16.1 | **Assert the API matches its spec** | M | The OpenAPI document (4.10) is hand-written, which guarantees it will drift. Drive a contract test from it: every documented route exists, answers the documented shape, and rejects what the schema says it rejects. Otherwise the spec is documentation that lies with authority. |
| 16.2 | **Property-based tests on the diff engine** | M | Mutation testing (7.3) proves the existing cases are meaningful; it cannot invent the case nobody thought of. Generate random status sequences and assert invariants instead: never notify twice for one transition, never notify inside a maintenance window, always close an incident it opened. The diff engine is the one component where a rare wrong answer is unacceptable. |
| 16.3 | **A performance budget on the API** | S | Bundle size has a budget (5.16); response time does not. The load test already builds a year of data — assert a p95 on `/history` and the incident search against it, so an unindexed query cannot ship quietly. |
| 16.4 | **Chaos on the store** | S | Kill the process mid-write, corrupt a page, fill the disk, then assert the next boot is a readable error and a working restore path. Complements 10.10; the homelab produces all three of these regularly. |
| 16.5 | **A CI time budget** | S | The pipeline runs unit, integration, coverage, visual, bundle, readme and mutation jobs. Left alone that becomes twenty minutes and then becomes something people skip. Measure it, publish the number in the verify job, and treat a regression as a defect. |
| 16.6 | **Quarantine flakes rather than retry them** | S | The visual and integration suites are the natural home of flakes, and the standing instinct is a retry. A quarantine list with an owner and an expiry keeps a known flake from becoming a permanently ignored failure. |
| 16.7 | **A dependency freshness policy** | S | The dependency count is deliberately small, which makes each one significant. An automated update PR with the full suite as the gate, plus a written stance on Node's own major versions — the project pins 24 and will have to answer 26 eventually. |
| 16.8 | **Snapshot the exact bytes of every channel's message** | S | Eighteen notifiers each build a payload, and nothing asserts what that payload looks like — a formatting change can quietly reshape a Slack block or an Adaptive Card and only an operator sees it. Golden files per channel for a fixed set of transitions, diffed in CI. The visual baselines do this for pixels; notifications deserve the same and are far cheaper to capture. |

---

## 17. Speculative

Same rules as section 8: interesting, not costed, listed so an idea is not
re-invented from scratch in a year. A row here is a conversation, not a plan.

| # | Item | Notes |
| --- | --- | --- |
| 17.1 | **An MCP server over the fleet** | Expose the fleet's state and incident history as tools an assistant can query: "was Cloudflare degraded when our error rate spiked". The API already exists; this is an adapter onto it. Cheap, on-trend, and completely optional — which is the only way it belongs in a project whose pitch is that it needs nothing. |
| 17.2 | **An e-ink endpoint** | A PNG of the fleet, sized for a cheap e-ink frame, refreshed on a cadence. Pure homelab charm, ~50 lines on top of the wallboard renderer (13.3). |
| 17.3 | **Anomaly detection on latency** | 8.3 was dismissed for want of data. Status-page fetch latency (2.8) has since been recorded on every sample, so the data now exists — and the objection becomes statistical rather than practical. Still probably a trap. |
| 17.4 | **Export to a neighbour's format** | Write the fleet out as Uptime Kuma or Gatus configuration. The inverse of 11.7, and a genuinely friendly thing to do — it says the project is not trying to trap anybody. |
| 17.5 | **A voice call for the one alert that matters** | Twilio, for the single provider whose outage means getting out of bed. PagerDuty (3.7) covers this for anybody who has PagerDuty; most of this audience does not. |
| 17.6 | **Watch a provider edit its own past** | 8.9, unchanged and still good: status pages quietly rewrite resolved incidents. Storing the first version read and diffing later ones would catch it. Blocked on nothing except appetite — and it becomes nearly free if 10.4 and 10.8 land, which is the argument for those rows. |
| 17.7 | **A terminal client** | 8.4. `isitdown watch` in a pane. The API supports it; the single binary (6.7) makes distribution trivial; nobody has asked. |
| 17.8 | **Shareable layouts** | A 13.12 dashboard is JSON, so it can be exported, pasted into an issue and imported by somebody else — "here is the layout I use for a 100-provider fleet". A community artefact with no server behind it, which is the only kind this project can afford. |
| 17.9 | **A widget that is somebody else's panel** | An iframe widget pointed at a Grafana panel, so the committed dashboard (4.14) can sit beside the native tiles. Tempting and slightly dangerous: it makes the widget grid a general-purpose canvas, and general-purpose canvases grow forever. |

---

## What to do with this file

If only three things here are ever built, the case is strongest for:

1. **10.1** — until "unobserved" is distinct from "up", every uptime number in
   the product is quietly wrong, and everything built on top of them inherits it.
2. **15.1** — the adapters are the product's contact with the outside world, and
   nothing currently notices when the outside world changes shape.
3. **12.1** — one route, one marker on a chart, and the timeline starts answering
   the question operators actually bring to it.

Section 9 is not on that list because it produces a decision rather than a
feature. It should still happen first: several rows above are sized on the
assumption that the answers are no, and a yes anywhere in 9 reshapes them.

The largest single bet in this file is **13.12**, the composable widget
dashboard. It is listed as L honestly — a layout engine is a subsystem, and the
failure mode is well known: it stops being a monitoring tool and becomes a
framework for building one. It earns the risk anyway, because three other rows
(13.3 wallboard, 13.13 multiple dashboards, 17.2 e-ink) are the same widgets
rendered elsewhere, and each of them is expensive on its own and nearly free
once a widget has a props schema and a layout is data.
