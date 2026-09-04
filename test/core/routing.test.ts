import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATCH_ALL_RULE,
  classOf,
  explain,
  resolveTargets,
  severityOf,
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
