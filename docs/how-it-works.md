[← README](../README.md)

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
[3.8](configuration.md#38-delivery-policy--quiet-hours-digests-caps). The order is deliberate
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
