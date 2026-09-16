# ROADMAP 3 — the competitive read

The first two roadmaps asked *what could IsItDown do* and *what is IsItDown
now*. This one asks a narrower, more uncomfortable question: **where does
IsItDown objectively lose against the tools it is compared to?**

Same contract as before: **nothing here is committed**, the net is wide, the
file exists to be pruned. Numbering continues — `ROADMAP_2.md` ends at section
17, so this file starts at 18, and a row id stays unique across all three.

## How this file was built

The method was deliberately restrictive, because the easy version of this
document is a feature list copied from a competitor's marketing page.

1. **Read the competitors as product categories, not as a list.** Four
   categories matter here, and IsItDown sits in the overlap of two of them.
2. **Compare capability, not packaging.** "They have 94 notification
   integrations" is not a gap when one of ours is an Apprise bridge.
3. **Exclude anything the first two roadmaps already answer.** A weakness with
   a row already written against it is not a competitive finding, it is a
   backlog item. Where a finding *touches* an existing row, the row is named
   and the note says what is genuinely new. Those are marked 🔁.
4. **Separate a gap from a business model.** SSO, RBAC and a global probe
   network are not defects in a single-operator self-hosted tool. They are in
   section 24, written down as refusals rather than omissions.

### The field

| Tool | Category | What it does that we are measured against |
|---|---|---|
| **StatusGator** | Hosted aggregator | 10,000+ status pages, unofficial/crowd signals, private authenticated status ingestion, SSO, MSP reporting |
| **IsDown** | Hosted aggregator | 6,000+ vendors, early detection, internal branded status pages, ~20 workflow integrations (Datadog, incident.io, ServiceNow), public API, MCP server |
| **Downdetector** | Crowd signal | Detection with no cooperation from the vendor at all |
| **Uptime Kuma** | Self-hosted prober | 31 monitor types, 94 notification providers, sub-second intervals, push (dead-man) monitors, login + 2FA, enormous community |
| **Gatus** | Self-hosted prober | Config-as-code, hot reload, a real condition language, one tiny Go binary |
| **Healthchecks** | Self-hosted passive | Cron/systemd schedules, job duration, exit codes, captured output |
| **Vigilant** | Self-hosted prober | Distributed "outposts": a failure is confirmed by two more locations before it counts |
| **Checkly / Better Stack** | Hosted synthetic | Multi-region consensus, browser checks, on-call |

### What is already competitive (stated so the rest is credible)

Channel breadth is a solved problem — Telegram, webhook, Discord, Slack, ntfy,
Gotify, email, Pushover, Matrix, PagerDuty, Opsgenie, Teams, web push, plus the
Apprise bridge that covers the long tail. Adapter breadth (Statuspage,
Instatus, Better Stack, Cachet, Uptime Kuma, Uptime.com, AWS, GCP, Azure,
Slack, RSS, HTML, HTTP, TCP, DNS) is wider than any other self-hosted
aggregator. Conditional requests, per-provider cadence, adaptive polling,
routing rules with a dry run, quiet hours, digests, retries with a dead-letter,
flap damping and maintenance suppression are ahead of Uptime Kuma's alerting.
Documentation, i18n, visual regression baselines, an OpenAPI document, a
Grafana dashboard, badges, a widget and a Home Assistant surface are all things
most competitors in the self-hosted category do not have at all.

The findings below are what remains after subtracting that.

Legend: **S** a day or less · **M** a few days · **L** a structural change ·
⚠️ collides with a declared non-goal · 🔁 overlaps a row in `ROADMAP.md` or
`ROADMAP_2.md`, with the new part named in the note.

---

## 18. Detection — how fast, and how sure

The single thing every hosted competitor sells is *latency to knowledge*. They
claim seconds; we poll on a cadence measured in minutes and have never measured
our own lag. This is the section where the product is objectively behind, and
where the numbers are not currently known.

| # | Item | Size | Notes |
|---|---|---|---|
| 18.1 | **Be a subscriber, not only a poller** | M | Statuspage, Better Stack and several others let *anyone* subscribe a webhook to a public page: they POST on every incident create/update and component change. That is the same data we poll for, delivered in seconds instead of on the next cycle, and it costs the provider nothing. Needs an inbound route, a per-provider subscription secret, a replay guard, and — the honest cost — a reachable URL, which a `127.0.0.1` dashboard does not have. Degrades to exactly today's behaviour when unreachable, so it is an accelerator, never a dependency. The identity argument is small: we already accept inbound HTTP in the UI edition. |
| 18.2 | **Measure our own detection lag** | S | Every Statuspage incident carries `created_at` and each update carries its own timestamp. We already store the incident; we have never stored the distance between *their* timestamp and *our* notification. One column and one number on the provider detail page turns the competitor's strongest marketing claim into something we can answer with evidence instead of a shrug. Also the only honest way to size 18.1 and 2.2 — nobody should tune a cadence they have not measured. |
| 18.3 | **A second vantage point** | L ⚠️ 🔁 | 1.8 declared it: "one vantage point stays one vantage point". Every serious prober has since disagreed — Vigilant confirms a failure from two more outposts before it counts, and the commercial tools require N regions to agree. It only bites the probe adapters (1.8, 1.9), never the status-page ones, because a status page says the same thing from anywhere. The narrow shape: an outpost is not a peer instance (that is 9.6) but a stateless worker that runs one check and returns a reading — a container on a cheap VPS, a `POST` back, no database, no dashboard. The diff engine then takes a consensus rather than a sample. Without it, every probe alert carries an unstated "…from the one network this container is on". |
| 18.4 | **A confidence tier below "the provider said so"** | M ⚠️ | StatusGator's Early Warning Signals and Downdetector's whole product exist because vendors post late or never. Our data model has one kind of truth: what the page said. A second tier — a reading that is *suspected* rather than declared — is the precondition for 18.5, for 1.10's silent-outage cross-check to be shown as a first-class state rather than an extra alert, and for anything crowd-shaped later. Deliberately not "add Downdetector scraping": it is the model change, without which every unofficial source has to lie about its own certainty. |
| 18.5 | **Read the vendor's mailing list and social feed** | M | A large tail of SaaS has no machine-readable status page and announces incidents by email to customers and by post on X/Mastodon. StatusGator ingests exactly this. The cheap, self-hosted-shaped version is IMAP: point IsItDown at a mailbox, match sender and subject patterns per provider, raise a suspected reading (18.4). Mastodon and any Bluesky/X account with an RSS bridge already work through 1.5 — what is missing is the confidence tier, not the adapter. Unlocks providers that no adapter can ever reach. |
| 18.6 | **Authenticated and private status sources** | M | `src/core/http.ts` sends no custom headers, so every status adapter can only read pages that are fully public. The `http` probe adapter grew `header.<Name>` with `${VAR}` expansion; the status adapters never did. That single limitation excludes the most important vendor in most fleets: Microsoft 365 publishes its real per-tenant service health through the Graph API behind OAuth, not on a public page. Cisco Meraki and Zendesk are the same shape, and StatusGator charges enterprise money for precisely this ("Private Status Ingestion"). Lift the header support into the shared helper, add a token/OAuth-client-credentials option, and a whole class of providers becomes reachable with no new adapter concepts. |
| 18.7 | **Sub-minute cadence for probes** | S | `intervalMinutes` has a one-minute floor everywhere. Correct for a status page — rude and pointless below that — and wrong for 1.8's HTTP probe, where Uptime Kuma's default is 60 seconds and its floor is one second. Any comparison table will record a loss here. Seconds-based cadence for probe adapters only, with the status-page floor left where it is. |

---

## 19. Coverage — what can be watched at all

Coverage is the number every aggregator leads with, and the one where the
distance is largest: 42 catalog entries against 6,000 and 10,000. The adapters
are not the constraint — the catalog is, and so is the assumption that the
operator already knows what they depend on.

| # | Item | Size | Notes |
|---|---|---|---|
| 19.1 | **A catalog two orders of magnitude bigger** | M 🔁 | 11.2 solves *delivery* (a catalog that updates without a new image); this is *content*. 42 hand-written entries versus thousands is the first thing anyone comparing notices, and it is not a hard problem: public datasets of status-page URLs exist (StatusGator's own open-source aggregator list, the awesome-status-pages lists), and 1.14's detection already identifies a shape from a domain. A generated catalog — scrape list, run detection over it in CI, commit the ones that answer, record the failures — turns a week of typing into a job. Without it, "add a provider" means the operator finds the URL themselves, which is the exact work an aggregator is supposed to remove. |
| 19.2 | **Discover what this machine depends on** | M | Hosted competitors discover vendors from SSO logs and SaaS spend. The self-hosted equivalent is sitting on disk: `docker-compose.yml` image registries, `package.json` registries and hostnames, `.env` endpoints, Terraform providers, `/etc/hosts`. `isitdown discover <path>` reads them, maps known domains to catalog entries and proposes a starting fleet. 13.7's sixty-second setup assumes the operator can list their dependencies from memory; this is the assumption that setup guide is quietly leaning on. |
| 19.3 | **A check that waits to be called** | M ⚠️ 🔁 | Healthchecks' whole product and Uptime Kuma's push monitor: a URL your cron calls, which alerts when the call does not arrive. It catches the failure class active probing structurally cannot — the backup that stopped running three weeks ago. Related to 10.11 (IsItDown watching itself) but inverted: this is other jobs reporting in. Cheap in this codebase (a route, a table, a scheduler comparison against an expected interval) and it inverts the poller's contract, so it wants 9.1's answer first. |
| 19.4 | **ICMP ping and container health** | S ⚠️ | Uptime Kuma ships 31 monitor types; we have five probe-shaped ones and no ping. ICMP needs a raw socket (a capability in the container, or a helper binary) and Docker health needs the socket mounted — both genuine costs, both table stakes in the homelab category we are downloaded into. Listed small and gated: a 9.1 answer of "aggregator" makes this a permanent, stated no, which is also a fine outcome. |
| 19.5 | **Import from a neighbour** | S 🔁 | 17.4 writes our fleet out as Uptime Kuma or Gatus config. The inverse is the one that grows the user base: read a Kuma backup JSON, a Gatus YAML or a StatusGator/IsDown export and propose a fleet. Somebody with 40 monitors in Kuma will not retype them to try us, and adoption of a self-hosted tool is decided in the first ten minutes. |

---

## 20. Trust — what a stranger checks before running your container

This section is the least glamorous and the most objectively behind. Nothing
here is a feature; all of it is what makes a project look maintained to somebody
who found it an hour ago, and what a security-minded operator looks for before
pulling an image that will hold their bot tokens.

| # | Item | Size | Notes |
|---|---|---|---|
| 20.1 | **A supply chain somebody can verify** | S | `ci.yml` runs typecheck, coverage, integration, docs parity, build, bundle budget and visual tests — and not one security step. `release.yml` builds and pushes two images with no SBOM, no signature, no provenance attestation and no pinned base digest. There is no dependency CVE scan, no CodeQL, no Dockerfile lint. Competitors of this size publish signed images with SBOMs because the whole pitch is "run this container next to your secrets". Cheap to add (`docker/build-push-action` already emits SBOM and provenance; `cosign` is one step; `npm audit` and Dependabot/Renovate are free) and it moves a "would not run this at work" to a "fine". |
| 20.2 | **Say where it is allowed to connect** | M 🔁 | 1.8 noted the hole and deferred it: any operator-supplied URL makes the container fetch it, including `169.254.169.254`, a router's admin page or anything else on the LAN, and the TCP/DNS probes turn it into a scanner. Today that is mitigated only by "it is your own dashboard on loopback" — and 9.3 (a passphrase) or 9.2 (a shared view) each make that mitigation weaker rather than stronger. An egress policy (deny link-local and RFC1918 by default, with an explicit allowlist for the homelab case that needs them) is a precondition for every row in section 9, not a follow-up to them. |
| 20.3 | **A security policy and a way to report** | S | No `SECURITY.md`, no disclosure address, no supported-version statement. A project that handles Telegram tokens, SMTP credentials and webhook secrets and gives a finder nowhere to send a report is making its own bad day more likely. |
| 20.4 | **The files that say "this project takes patches"** | S | No `CONTRIBUTING.md`, no issue or PR templates, no `CODE_OF_CONDUCT.md`, no `CHANGELOG.md` in the tree (release notes exist only as GitHub releases). Uptime Kuma's advantage over every technically-similar tool is its community, and a community starts with a stranger being able to tell where an adapter goes and what a commit message must look like — both of which exist here, in `CLAUDE.md` and the skills, on a branch `main` deliberately does not carry. Restating the contributor-facing half in a file `main` *does* carry costs a day and is the difference between "impressive solo project" and "project I can send a PR to". |
| 20.5 | **A written threat model** | S | One page: what the UI edition trusts (the local network, today, entirely), what it stores (credentials in a `0600` file beside the database), what an attacker on the LAN can currently do (read the delivery log, rewrite the config, change where notifications go), and what is deliberately out of scope. It costs a day, it makes 9.3's decision concrete instead of philosophical, and it is the document that the answer to "is this safe to expose?" points at. |

---

## 21. After the alert — where an outage is supposed to land

Every hosted competitor's integration list is really an answer to one question:
the alert fired, now what? We deliver a message to a human. Competitors deliver
an *event* to the systems that already hold the operator's attention.

| # | Item | Size | Notes |
|---|---|---|---|
| 21.1 | **Put the outage on the operator's own graphs** | M | IsDown markets its Datadog integration as unique, and the question it answers is the real one: "was Cloudflare degraded when our error rate spiked?" 17.1 answers it in a chat window through MCP; this answers it where the spike is actually being looked at. A Grafana annotation (HTTP API, one token) and a Datadog event (one POST) are both a notifier-shaped thing that happens to write to a graph rather than a person, so they fit the existing `Notifier` interface with no new concepts — and 4.14's committed Grafana dashboard means half the destination already ships with us. |
| 21.2 | **A calendar feed of upcoming maintenance** | S | Maintenance windows are already parsed, stored and shown (2.1). An iCal endpoint puts every upcoming vendor window into the operator's actual calendar, next to the deploy they were about to schedule on top of it. 14.9 notifies *before* a window; this is the surface where the window is seen while planning, which is the point at which it changes a decision. Tiny, given the data exists. |
| 21.3 | **A ticket, for the fleets that run on tickets** | S | ServiceNow, Jira Service Management and incident.io appear on every hosted competitor's integration page because in an MSP or a corporate IT team an outage that is not a ticket did not happen. The generic webhook plus HMAC (3.16) technically covers it; what is missing is a documented recipe per destination, which is a docs row rather than code. Low priority for the stated audience, cheap to answer honestly. |
| 21.4 | **Vendor SLA targets, and evidence for a claim** | M 🔁 | 12.4 projects an error budget; 12.9 estimates cost. Neither holds the number that makes those actionable: the SLA the vendor actually promised. A per-provider target (99.9%, 99.95%) turns the History view into "this vendor is 0.04% from owing you a credit", and an evidence export — windows, timestamps, incident references — is what a credit claim needs. This is the single most-sold feature of the hosted aggregators to anyone with vendor contracts, and it is a field plus a report on data we already have. |

---

## 22. Survivability — the watcher's own failure

A hosted competitor cannot go quiet without somebody noticing. We can. This is
the structural disadvantage of self-hosting, and it is answerable rather than
inherent.

| # | Item | Size | Notes |
|---|---|---|---|
| 22.1 | **A heartbeat out to somebody else** | S 🔁 | 10.11 has IsItDown watch itself, which cannot catch the case that matters: the host is off. The complement is one line of configuration — ping an external dead-man's switch (Healthchecks.io's free tier, an ntfy topic, any URL) on every successful cycle, so that a silent IsItDown produces an alarm from outside itself. Every self-hosting guide recommends this pairing; we should ship the hook rather than leave each operator to invent it. |
| 22.2 | **A standby that can take over** | L ⚠️ | Two instances, one polling and one following, with the follower promoting itself when the leader's heartbeat stops. It is the honest answer to "what does a hosted competitor give me that this cannot" — and it is also a distributed-systems subsystem inside a tool whose whole pitch is one container and no dependencies. Written down so the trade-off is explicit; 22.1 buys most of the value for a hundredth of the cost, and the expected answer here is no. |

---

## 23. Being found, and being compared

Self-hosted tools are chosen from a comparison article and a GitHub page. On
capability this project competes; on the surfaces where the comparison actually
happens, it does not appear at all.

| # | Item | Size | Notes |
|---|---|---|---|
| 23.1 | **A comparison the project writes itself** | S 🔁 | Every competitor publishes an honest-shaped "X vs Y" page, and those pages are what search returns. The manual explains what IsItDown does and never once says what it does instead of Uptime Kuma (it aggregates other people's status pages rather than probing yours), of Gatus (it has a dashboard you can configure from) or of StatusGator (it runs on your machine, holds your data and costs nothing). One page, factual, including where the competitor wins. Pairs with 9.7's demo instance: a comparison with nothing to click is half a page. |
| 23.2 | **Publish the detection benchmark** | S | Once 18.2 measures lag, publishing it — median and worst-case distance between the provider's timestamp and ours, per adapter, refreshed by the 15.1 canary — is a claim no self-hosted competitor makes and most hosted ones only assert. It is also self-policing: a regression in an adapter shows up as a number getting worse in public. |
| 23.3 | **Give the catalog away** | S | If 19.1 produces a machine-generated, tested catalog of status-page URLs and their shapes, publishing it as its own artifact (a JSON file, its own small repo) makes it useful to people who will never run IsItDown — including the neighbouring projects. It is the cheapest credibility a small project can buy, and it makes the catalog somebody else's problem to extend. |

---

## 24. Where we are deliberately not competing

Written down as refusals so that the absence is a decision, and so that section
18–23 is read as the whole of the gap rather than a sample of it. Each of these
is a genuine competitor capability and a genuine loss on a feature matrix.

| Capability | Who has it | Why not here |
|---|---|---|
| SSO/SAML, RBAC, per-user accounts, audit trails | StatusGator, IsDown enterprise tiers | Directly against the stated non-goal. 9.3 (one shared passphrase) and 9.4 (who muted this) are the deliberate small answers; anything beyond them is a different product. |
| Multi-tenant / MSP mode, per-client dashboards | IsDown ($200/mo tier), StatusGator | Needs tenancy through the entire data model. The single-operator premise is load-bearing, not incidental. |
| A crowd-sourced signal network | Downdetector, StatusGator | Requires users at a scale a self-hosted tool never has. 18.4 and 18.5 take the part that works for one operator; the network effect is not purchasable. |
| A global paid probe network | Checkly, Better Stack, UptimeRobot | 18.3's outposts are the self-hosted shape of the same idea, bounded by what the operator is willing to run. |
| Browser / multi-step synthetic checks, on-call scheduling | Checkly, Better Stack, PagerDuty | Adjacent products. 3.7 already hands the on-call problem to PagerDuty and Opsgenie, which is the correct amount of it to own. |
| Thousands of ready-made status pages, staffed | StatusGator, IsDown | 19.1 closes the order of magnitude with automation; the last mile of that coverage is a full-time job and stays theirs. |

---

## If only five of these happen

1. **20.1** — a scanned, signed, attested supply chain. Cheapest row in the file
   and the one blocking the most "no" answers from anyone evaluating seriously.
2. **18.2** — measure detection lag. Without it, every claim in section 18 is a
   guess, and 18.1's value cannot be argued for or against.
3. **19.1** — a catalog two orders of magnitude bigger. It is the number the
   category is judged on, and it is a CI job rather than a feature.
4. **18.6** — authenticated status sources. One change in the shared HTTP helper
   reaches Microsoft 365 and everything shaped like it, which no other
   self-hosted tool covers at all.
5. **20.4** — the contributor-facing files. The technical gap to Uptime Kuma is
   small; the community gap is enormous, and it starts with a stranger being
   able to tell where a patch goes.

Three of those five are days of work on things that are not features, which is
the honest summary of this file: **IsItDown's capability gap against its
competitors is narrower than its credibility gap.**
