---
name: testing-discipline
description: Use when writing, fixing, or reviewing tests, when adding behaviour that needs coverage, or when a test fails — enforces red-green (see the test fail first), testing behaviour not implementation, no mocking the system under test, and never weakening a test to make it pass.
---

# Testing Discipline

General testing discipline for this repo. For IsItDown-specific requirements — the diff-engine
transition table, adapter fixtures, `StateStore` interchangeability, restart safety — use the
`core-engine-testing` skill as well; it wins where the two overlap.

A test exists to fail when the code is wrong. A test that cannot fail is worse than no test: it costs runtime and buys false confidence.

## The core loop: red → green → clean

1. **Red** — write the test, run it, **watch it fail**, and check the failure message is the one you expect.
2. **Green** — write the minimum code to make it pass.
3. **Clean** — tidy the implementation with the test as your safety net.

<EXTREMELY-IMPORTANT>
Never write a test and an implementation in the same breath without seeing the test fail in between.
A test that has never failed has never been verified to test anything.
If a new test passes immediately, it is broken until proven otherwise — find out why before moving on.
</EXTREMELY-IMPORTANT>

Common reasons a fresh test passes wrongly: asserting on a value the code already returns by coincidence, a typo'd test name that never gets collected, an `expect` inside an unawaited promise, a mocked dependency that returns the expected value on its own.

## What to test

Test **observable behaviour through the public surface** — the return value, the emitted event, the written state, the sent payload.

- ✅ "given a status change from operational to degraded, a notification payload is produced"
- ❌ "given a status change, `_compareSeverity` is called once with these args"

Testing internals means every refactor breaks the suite while every real bug slips through.

### Coverage priorities, in order

1. **The core decision logic** — whatever the system's correctness hinges on (a diff engine, a pricing rule, an auth check). Table-driven, exhaustive on state transitions.
2. **Boundaries** — empty, one, many, null/undefined, zero, negative, max, malformed external input.
3. **Error paths** — a failure must actually surface. Assert the throw *and* its type/message.
4. **Idempotence and restart safety** — running twice must not double-fire side effects; restarting must not re-emit events for state that hasn't changed.
5. **Happy path** — cheap, necessary, and the least likely to catch a bug. Never the only test.

### Table-driven by default

When the same logic is exercised with different inputs, one table beats ten near-identical test functions — and new edge cases get added as rows instead of scattered one-off tests.

```
| input state | event | expected outcome |
```

Add a row when a bug is found. That row *is* the regression test.

## Mocking

**Mock the edges. Never mock the thing you're testing, and never mock the thing whose interaction with it is the point.**

| Mock this | Don't mock this |
|---|---|
| Network calls to third parties | The unit under test |
| Clocks, timers, randomness | The collaborator whose integration is what might break |
| Filesystem/DB *when a fake is slower than real* | Pure functions — call them |
| Paid or rate-limited APIs | Your own data structures |

- Prefer **recorded fixtures** over hand-written mocks for external responses: real shapes catch real parsing bugs. Keep fixtures in a `fixtures/` directory, named for the scenario (`operational.json`, `active-incident.json`, `malformed.json`).
- **Never hit a live third-party endpoint in a test.** Ever. Flaky, slow, and rude.
- For end-to-end confidence, spin up a fake local server rather than mocking the HTTP client — that path exercises the real serialisation, headers, and error handling.

## Assertions

- Assert on **structured values**, not rendered strings. `expect(payload.severity).toBe('major')` survives a copy tweak; `expect(msg).toBe('🔴 Major outage on GitHub')` does not.
- Assert the **specific** thing. `expect(result).toBeTruthy()` passes for `1`, `"error"`, and `{}`.
- One logical behaviour per test. Multiple `expect`s are fine if they describe one behaviour.
- Test names state the behaviour and its condition: `returns no notification when the incident list is only reordered`. Not `test diff engine 3`.

## When a test fails

**A failing test is information. Read it before you touch anything.**

1. Read the actual failure message and diff — not the test name, the message.
2. Decide, explicitly: **is the test wrong, or is the code wrong?** Default assumption: the code is wrong.
3. Fix the cause, not the symptom.

<EXTREMELY-IMPORTANT>
Never make a test pass by weakening it. Forbidden without explicit user approval:
- loosening an assertion to match the wrong output
- deleting or renaming a failing test
- adding `.skip` / `.only` / `xit` / `@Ignore` and moving on
- adding a retry or a `sleep` to paper over a race
- widening a type or adding `any` so it compiles

If a test is genuinely wrong, say so out loud, explain why, and change it deliberately — that's a decision, not a shortcut.
</EXTREMELY-IMPORTANT>

Flaky tests are bugs. Diagnose the shared state, the timing dependency, or the ordering assumption. Never "just re-run CI".

## Test hygiene

- **Isolated**: each test sets up its own state and cleans up. No test may depend on another running first, or on the file's execution order.
- **Deterministic**: no real clocks, no real randomness, no real network. Inject them.
- **Fast**: unit tests in milliseconds. If a test needs seconds, it's an integration test — put it in the integration suite where it belongs.
- **Readable**: arrange / act / assert, visibly separated. A test is documentation of intent; if it needs a comment to be understood, rewrite it.
- Delete tests that assert deleted behaviour. Don't leave them skipped as archaeology.

## Before saying "done"

Run the full suite, not just the file you touched. Report the actual result — pass counts, and any failure output verbatim. If you didn't run something (integration suite needs Docker, etc.), say which and why. Never claim green you haven't seen.

## Red flags

| Thought | Reality |
|---|---|
| "It passed first try, great" | Then it may test nothing. Break the code and confirm it fails. |
| "I'll mock this collaborator, it's simpler" | If its interaction is the risk, mocking it deletes the test. |
| "This assertion is too strict" | Strict is the point. Fix the code. |
| "I'll skip this one, it's flaky" | Flaky = a real bug in the test or the code. Diagnose it. |
| "The test is old, it's probably wrong" | Probably it caught your regression. Prove it wrong first. |
| "Coverage is at 90%, we're fine" | Coverage measures lines executed, not behaviour verified. |
| "I'll add tests in a follow-up" | Behavioural change ships with its test. |
| "It works when I run it manually" | Then write down what you did as a test. |
