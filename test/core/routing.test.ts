import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATCH_ALL_RULE,
  classOf,
  explain,
  inQuietHours,
  minutesOfDay,
  resolveTargets,
  severityOf,
  type QuietHours,
  type RoutingRule,
} from "../../src/core/routing.ts";
import { STATUS_CHANGE_KINDS, type StatusChange } from "../../src/core/types.ts";

const change = (over: Partial<StatusChange> = {}): StatusChange => ({
  kind: "status_change",
  providerId: "github",
  previousStatus: "operational",
  currentStatus: "degraded",
  at: "2026-09-03T10:00:00.000Z",
  ...over,
});

const rule = (over: Partial<RoutingRule> = {}): RoutingRule => ({
  provider: "*",
  classes: ["status", "incident", "maintenance", "monitoring"],
  minSeverity: "any",
  channels: ["*"],
  ...over,
});

const ALL = ["telegram", "slack", "webpush"];

test("every status change kind maps to a class", () => {
  // The complete Record in routing.ts makes this a compile error too. The test
  // says it to whoever adds a kind without running typecheck first.
  for (const kind of STATUS_CHANGE_KINDS) {
    assert.ok(classOf(kind) !== undefined, `${kind} has no event class`);
  }
});

test("the catch-all rule sends every kind to every enabled channel", () => {
  for (const kind of STATUS_CHANGE_KINDS) {
    assert.deepEqual(resolveTargets(change({ kind }), [CATCH_ALL_RULE], ALL), ALL);
  }
});

test("the first matching rule decides and later rules are not consulted", () => {
  const rules = [
    rule({ provider: "github", channels: ["slack"] }),
    rule({ channels: ["telegram"] }),
  ];
  assert.deepEqual(resolveTargets(change(), rules, ALL), ["slack"]);
  assert.deepEqual(resolveTargets(change({ providerId: "cloudflare" }), rules, ALL), ["telegram"]);
});

test("a rule with no channels mutes, and so does no rule matching at all", () => {
  const muted = [rule({ provider: "github", channels: [] }), rule({ channels: ["telegram"] })];
  assert.deepEqual(resolveTargets(change(), muted, ALL), []);
  assert.deepEqual(resolveTargets(change(), [rule({ provider: "sentry" })], ALL), []);
});

test("a severity floor keeps a lesser change out and lets a worse one through", () => {
  const rules = [rule({ minSeverity: "major_outage", channels: ["webpush"] })];
  assert.deepEqual(resolveTargets(change({ currentStatus: "degraded" }), rules, ALL), []);
  assert.deepEqual(resolveTargets(change({ currentStatus: "major_outage" }), rules, ALL), ["webpush"]);
});

test("a recovery clears the floor its outage cleared", () => {
  // The whole point of ranking on the worse of previous and current: otherwise
  // the operator gets the alarm on their phone and never the all-clear.
  const rules = [rule({ minSeverity: "major_outage", channels: ["webpush"] })];
  const recovery = change({ previousStatus: "major_outage", currentStatus: "operational" });
  assert.equal(severityOf(recovery), "major_outage");
  assert.deepEqual(resolveTargets(recovery, rules, ALL), ["webpush"]);
});

test("unknown is not comparable to the scale and clears only the any floor", () => {
  const degraded = change({
    kind: "monitoring_degraded",
    previousStatus: undefined,
    currentStatus: "unknown",
    failureCount: 5,
  });
  assert.equal(severityOf(degraded), "unknown");
  assert.deepEqual(resolveTargets(degraded, [rule({ minSeverity: "degraded" })], ALL), []);
  assert.deepEqual(resolveTargets(degraded, [rule({ minSeverity: "any", channels: ["slack"] })], ALL), [
    "slack",
  ]);
});

test("an unreadable page that becomes readable is ranked on what could be read", () => {
  const recovered = change({ previousStatus: "unknown", currentStatus: "major_outage" });
  assert.equal(severityOf(recovered), "major_outage");
});

test("classes select which kinds a rule takes", () => {
  const rules = [
    rule({ classes: ["maintenance", "monitoring"], channels: ["slack"] }),
    rule({ classes: ["status", "incident"], channels: ["telegram"] }),
  ];
  assert.deepEqual(resolveTargets(change({ kind: "maintenance_started" }), rules, ALL), ["slack"]);
  assert.deepEqual(resolveTargets(change({ kind: "incident_opened" }), rules, ALL), ["telegram"]);
  assert.deepEqual(resolveTargets(change({ kind: "component_status_change" }), rules, ALL), ["telegram"]);
});

test("an explicit channel list is returned as written, wildcards expand, duplicates collapse", () => {
  assert.deepEqual(resolveTargets(change(), [rule({ channels: ["slack", "telegram"] })], ALL), [
    "slack",
    "telegram",
  ]);
  // A channel that is configured but switched off is still named: the dispatcher
  // decides what to do about it, so the matcher stays a pure function of rules.
  assert.deepEqual(resolveTargets(change(), [rule({ channels: ["discord"] })], ALL), ["discord"]);
  assert.deepEqual(resolveTargets(change(), [rule({ channels: ["*", "slack"] })], ALL), ALL);
});

test("explain reports the winning rule's index and marks every later rule unreached", () => {
  const rules = [
    rule({ provider: "github", channels: ["slack"] }),
    rule({ channels: ["telegram"] }),
  ];
  const result = explain(change(), rules, ALL);
  assert.equal(result.winner, 0);
  assert.deepEqual(result.outcomes, [{ kind: "won" }, { kind: "unreached" }]);
  assert.deepEqual(result.targets, ["slack"]);
});

test("explain gives each skip its own reason, tested in provider/class/severity order", () => {
  const providerSkip = explain(change({ providerId: "cloudflare" }), [rule({ provider: "github" })], ALL);
  assert.deepEqual(providerSkip.outcomes, [{ kind: "skipped", because: "provider" }]);

  const classSkip = explain(change({ kind: "maintenance_started" }), [rule({ classes: ["status"] })], ALL);
  assert.deepEqual(classSkip.outcomes, [{ kind: "skipped", because: "class" }]);

  const severitySkip = explain(
    change({ currentStatus: "degraded" }),
    [rule({ minSeverity: "major_outage" })],
    ALL,
  );
  assert.deepEqual(severitySkip.outcomes, [{ kind: "skipped", because: "severity" }]);
});

test("explain reports no winner and empty targets when nothing matches", () => {
  const result = explain(change(), [rule({ provider: "sentry" })], ALL);
  assert.equal(result.winner, null);
  assert.deepEqual(result.targets, []);
});

test("explain's targets always equal what resolveTargets returns for the same inputs", () => {
  // The equality that stops the dry run and the dispatcher from drifting:
  // both must read off the same evaluation, never a second copy of it.
  const rules = [
    rule({ provider: "github", channels: ["slack"] }),
    rule({ channels: ["telegram"] }),
  ];
  for (const c of [change(), change({ providerId: "cloudflare" }), change({ kind: "maintenance_started" })]) {
    assert.deepEqual(explain(c, rules, ALL).targets, resolveTargets(c, rules, ALL));
  }
});

const quiet = (over: Partial<QuietHours> = {}): QuietHours => ({
  enabled: true,
  start: "23:00",
  end: "07:00",
  timeZone: "UTC",
  minSeverity: "major_outage",
  ...over,
});

test("a wall clock is read in the zone the window is written in", () => {
  const at = new Date("2026-09-08T21:30:00.000Z");
  assert.equal(minutesOfDay(at, "UTC"), 21 * 60 + 30);
  assert.equal(minutesOfDay(at, "Europe/Rome"), 23 * 60 + 30);
  assert.equal(minutesOfDay(new Date("2026-09-08T22:10:00.000Z"), "Europe/Rome"), 10);
  // Not a zone this runtime knows: the caller has to be able to fail open.
  assert.equal(minutesOfDay(at, "Mars/Olympus_Mons"), null);
});

test("a window that wraps midnight covers both sides of it", () => {
  const window = quiet();
  assert.equal(inQuietHours(window, new Date("2026-09-08T23:00:00.000Z")), true, "the start is inside");
  assert.equal(inQuietHours(window, new Date("2026-09-09T03:00:00.000Z")), true);
  assert.equal(inQuietHours(window, new Date("2026-09-09T06:59:00.000Z")), true);
  assert.equal(inQuietHours(window, new Date("2026-09-09T07:00:00.000Z")), false, "the end is outside");
  assert.equal(inQuietHours(window, new Date("2026-09-09T12:00:00.000Z")), false);
});

test("a daytime window does not wrap", () => {
  const window = quiet({ start: "09:00", end: "18:00" });
  assert.equal(inQuietHours(window, new Date("2026-09-08T12:00:00.000Z")), true);
  assert.equal(inQuietHours(window, new Date("2026-09-08T20:00:00.000Z")), false);
});

test("quiet hours fail open on anything unusable", () => {
  const at = new Date("2026-09-09T03:00:00.000Z");
  assert.equal(inQuietHours(quiet({ enabled: false }), at), false);
  assert.equal(inQuietHours(quiet({ start: "25:00" }), at), false, "a malformed start");
  assert.equal(inQuietHours(quiet({ end: "7:00" }), at), false, "a malformed end");
  assert.equal(inQuietHours(quiet({ timeZone: "Nowhere/Nothing" }), at), false, "an unknown zone");
  // Equal ends read as either "always" or "never"; a whole day of silence is
  // the reading that loses alerts, so it is the one that is refused.
  assert.equal(inQuietHours(quiet({ start: "07:00", end: "07:00" }), at), false);
});

test("quiet hours take a change from the rule that won it, and say so", () => {
  const night = change({ currentStatus: "degraded", at: "2026-09-09T03:00:00.000Z" });
  const held = explain(night, [CATCH_ALL_RULE], ALL, { quietHours: quiet() });
  assert.deepEqual(held.targets, [], "nothing goes out");
  assert.equal(held.quieted, true, "and the dry run can explain why");
  assert.equal(held.winner, 0, "the rule still won: quiet hours are not a rule");

  const bad = change({ currentStatus: "major_outage", at: "2026-09-09T03:00:00.000Z" });
  const through = explain(bad, [CATCH_ALL_RULE], ALL, { quietHours: quiet() });
  assert.deepEqual(through.targets, ALL);
  assert.equal(through.quieted, false);
});

test("a change no rule wanted is not reported as quieted", () => {
  const muting = rule({ channels: [] });
  const held = explain(change({ at: "2026-09-09T03:00:00.000Z" }), [muting], ALL, {
    quietHours: quiet(),
  });
  assert.deepEqual(held.targets, []);
  assert.equal(held.quieted, false, "the rule silenced it, not the hour");
});

test("the timestamp quiet hours are read at is the change's own, unless one is given", () => {
  const night = change({ at: "2026-09-09T03:00:00.000Z" });
  assert.equal(explain(night, [CATCH_ALL_RULE], ALL, { quietHours: quiet() }).quieted, true);
  // A dry run asks "what would happen right now", so it passes its own clock.
  assert.equal(
    explain(night, [CATCH_ALL_RULE], ALL, {
      quietHours: quiet(),
      at: new Date("2026-09-09T12:00:00.000Z"),
    }).quieted,
    false,
  );
});

test("with no quiet hours passed, routing behaves exactly as it did before them", () => {
  const night = change({ at: "2026-09-09T03:00:00.000Z" });
  assert.deepEqual(resolveTargets(night, [CATCH_ALL_RULE], ALL), ALL);
  assert.equal(explain(night, [CATCH_ALL_RULE], ALL).quieted, false);
});

// Roadmap 2.6. A rule that had to name four provider ids to cover one stack
// went stale the moment the stack gained a fifth.
test("a group rule covers every provider in that group, and nothing else", () => {
  const rules = [rule({ provider: "group:deploy-path", channels: ["telegram"] }), CATCH_ALL_RULE];

  assert.deepEqual(
    resolveTargets(change({ providerId: "vercel" }), rules, ALL, { providerGroup: "deploy-path" }),
    ["telegram"],
  );
  // Same provider, different group: the group rule is not theirs, so the
  // catch-all below it decides.
  assert.deepEqual(resolveTargets(change({ providerId: "vercel" }), rules, ALL, { providerGroup: "billing" }), ALL);
  // A provider in no group at all matches no group rule.
  assert.deepEqual(resolveTargets(change({ providerId: "vercel" }), rules, ALL), ALL);
});

test("a group rule can mute a whole stack, and says which rule did it", () => {
  const rules = [rule({ provider: "group:noisy", channels: [] }), CATCH_ALL_RULE];

  const explained = explain(change({ providerId: "aws" }), rules, ALL, { providerGroup: "noisy" });

  assert.equal(explained.winner, 0);
  assert.deepEqual(explained.targets, []);
  assert.deepEqual(explained.outcomes[1], { kind: "unreached" });
});

test("a group that shares a provider id's name is still a group", () => {
  // `group:github` must not be read as the provider `github`.
  const rules = [rule({ provider: "group:github", channels: ["slack"] })];

  assert.deepEqual(resolveTargets(change({ providerId: "github" }), rules, ALL), []);
  assert.deepEqual(resolveTargets(change({ providerId: "github" }), rules, ALL, { providerGroup: "github" }), [
    "slack",
  ]);
});
