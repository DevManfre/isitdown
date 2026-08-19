---
name: core-engine-testing
description: Write correct unit and integration tests for IsItDown's core engine — poller, diff engine, adapters, and state store. Use whenever adding a test for a new adapter, diff-engine transition case, or the polling loop, or when asked to increase coverage or verify notification-triggering logic.
---

# Core Engine Testing

Testing conventions specific to IsItDown's core engine. General testing philosophy aside, this project has a few non-obvious correctness requirements that tests must actually verify, not just exercise.

## What must be tested for every change

### Diff Engine (the most important thing to get right)

The Diff Engine is the sole authority on "should a notification fire". Every test suite change here should be table-driven, covering at minimum:

| Previous state | New state | Expect notification? |
|---|---|---|
| operational | operational | No |
| operational | degraded | Yes (new incident) |
| degraded | major_outage | Yes (severity escalation) |
| major_outage | major_outage (same incident, status field changed e.g. investigating→monitoring) | Yes (incident update) |
| major_outage | operational | Yes (resolved) |
| unknown (fetch failed) | operational | No spurious "resolved" notification — `unknown` must never be diffed as if it were a real prior state |
| operational | operational (but incident list reordered, same content) | No (must not false-positive on ordering, only on actual content changes) |

Add new rows to this table as new edge cases are discovered — don't just add isolated one-off tests elsewhere.

### Adapters

- Test against **recorded fixture files**, never live network calls. Fixtures live in `test/fixtures/<provider>/`.
- Every adapter needs at least: operational fixture, active-incident fixture, resolved-incident fixture.
- Test that a malformed/partial fixture (missing optional fields) doesn't throw — but a fixture simulating a non-2xx response or invalid JSON *should* throw, since the Poller depends on that to trigger retry/backoff.

### Poller

- Test isolation: one adapter throwing must not prevent others from completing (use `Promise.allSettled` semantics in the test, assert all other providers still got a result).
- Test retry/backoff: simulate N consecutive failures for one provider and assert the "monitoring degraded" warning fires only after the configured threshold, not on the first failure.

### State Store

- Both the file-based (Light) and SQLite (UI) implementations must pass the same shared test suite against the `StateStore` interface — write the tests against the interface, then run them against both implementations, to guarantee they're actually interchangeable.
- Test restart safety explicitly: write state, simulate a reload (re-instantiate the store from the same file/DB), and assert the Diff Engine does *not* fire spurious notifications for state that hasn't actually changed since before the "restart".

## Running

```bash
npm test                    # unit: adapters + diff engine + state store
npm run test:integration    # spins up a fake local HTTP server as a stand-in provider, asserts an end-to-end notification fires on a simulated status change
```

## Anti-patterns to avoid

- Don't mock the Diff Engine itself when testing the Poller or Notifier — test them against the real Diff Engine with fixture inputs, since the interaction between components is exactly where notification bugs (missed or duplicate alerts) tend to hide.
- Don't assert on exact message string content in Notifier tests unless that's specifically what's being tested — assert on the structured `NotificationPayload` shape instead, so formatting changes don't break unrelated tests.
