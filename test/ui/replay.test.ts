import { test } from "node:test";
import assert from "node:assert/strict";
import { replayNotification, type ReplayInput } from "../../src/ui/replay.ts";
import { DELIVERY_DEFAULTS } from "../../src/core/delivery.ts";
import type { NormalizedStatus, OverallStatus } from "../../src/core/types.ts";
import type { RoutingRule } from "../../src/core/routing.ts";

const reading = (at: string, overallStatus: OverallStatus): NormalizedStatus => ({
  provider: "github",
  overallStatus,
  activeIncidents: [],
  components: [],
  maintenances: [],
  fetchedAt: at,
});

const catchAll: RoutingRule = {
  provider: "*",
  classes: ["status", "incident", "maintenance", "monitoring"],
  minSeverity: "any",
  channels: ["*"],
};

/** Three calm minutes, then an outage that lasts. */
const outage = [
  reading("2026-11-01T10:00:00.000Z", "operational"),
  reading("2026-11-01T10:03:00.000Z", "operational"),
  reading("2026-11-01T10:06:00.000Z", "major_outage"),
  reading("2026-11-01T10:09:00.000Z", "major_outage"),
  reading("2026-11-01T10:12:00.000Z", "major_outage"),
];

const input = (over: Partial<ReplayInput> = {}): ReplayInput => ({
  notification: { providerId: "github", channel: "telegram", kind: "status_change", sentAt: "2026-11-01T10:06:05.000Z" },
  readings: outage,
  service: { id: "github", name: "GitHub" },
  rules: [catchAll],
  enabledChannelIds: ["telegram", "slack"],
  delivery: DELIVERY_DEFAULTS,
  confirmSamples: 1,
  alertsInPreviousHour: 0,
  ...over,
});

const steps = (replayed: ReturnType<typeof replayNotification>) => replayed.path.map((step) => step.step);

test("an alert is traced back to the reading that caused it, and forward to the channel it went to", () => {
  const replayed = replayNotification(input());

  assert.equal(replayed.reproduced, true);
  assert.equal(replayed.trigger?.fetchedAt, "2026-11-01T10:06:00.000Z");
  assert.equal(replayed.previous?.fetchedAt, "2026-11-01T10:03:00.000Z");
  assert.deepEqual(steps(replayed), ["diff", "damping", "routing", "channel", "quiet-hours", "cap"]);
  const routing = replayed.path.find((step) => step.step === "routing");
  assert.equal(routing?.detail["winner"], 0, "the catch-all is rule number one");
  assert.equal(replayed.path.find((step) => step.step === "channel")?.outcome, "included");
});

test("flap damping shows the samples that were held back before the alert was confirmed", () => {
  const replayed = replayNotification(
    input({
      confirmSamples: 3,
      notification: { providerId: "github", channel: "telegram", kind: "status_change", sentAt: "2026-11-01T10:12:05.000Z" },
    }),
  );

  assert.equal(replayed.reproduced, true);
  assert.equal(replayed.trigger?.fetchedAt, "2026-11-01T10:12:00.000Z", "confirmed on the third matching sample");
  const damping = replayed.path.find((step) => step.step === "damping");
  assert.deepEqual(damping?.detail, { required: 3, held: ["2026-11-01T10:06:00.000Z", "2026-11-01T10:09:00.000Z"] });
});

test("a rule that sends nowhere is named as the winner, and the channel is not included", () => {
  const silencer: RoutingRule = { ...catchAll, provider: "github", channels: [] };
  const replayed = replayNotification(input({ rules: [silencer, catchAll] }));

  assert.equal(replayed.path.find((step) => step.step === "routing")?.detail["winner"], 0);
  assert.equal(replayed.path.find((step) => step.step === "channel")?.outcome, "not-included");
});

test("a severity floor that the change does not clear skips the rule, and the next one decides", () => {
  const picky: RoutingRule = { ...catchAll, provider: "github", minSeverity: "major_outage", channels: ["slack"] };
  const replayed = replayNotification(
    input({
      rules: [picky, catchAll],
      readings: [reading("2026-11-01T10:00:00.000Z", "operational"), reading("2026-11-01T10:03:00.000Z", "degraded")],
      notification: { providerId: "github", channel: "telegram", kind: "status_change", sentAt: "2026-11-01T10:03:05.000Z" },
    }),
  );

  const routing = replayed.path.find((step) => step.step === "routing");
  assert.equal(routing?.detail["winner"], 1, "the picky rule's floor was not cleared, so the catch-all won");
  const outcomes = (routing?.detail["outcomes"] ?? []) as { kind: string }[];
  assert.deepEqual(outcomes.map((outcome) => outcome.kind), ["skipped", "won"]);
});

test("quiet hours are reported with the window, whether or not they took the alert away", () => {
  const delivery = {
    ...DELIVERY_DEFAULTS,
    quietHours: { enabled: true, start: "09:00", end: "11:00", timeZone: "UTC", minSeverity: "major_outage" as const },
  };
  const replayed = replayNotification(
    input({
      delivery,
      readings: [reading("2026-11-01T10:00:00.000Z", "operational"), reading("2026-11-01T10:03:00.000Z", "degraded")],
      notification: { providerId: "github", channel: "telegram", kind: "status_change", sentAt: "2026-11-01T10:03:05.000Z" },
    }),
  );

  const quiet = replayed.path.find((step) => step.step === "quiet-hours");
  assert.equal(quiet?.outcome, "suppressed", "degraded is below the window's floor, so it would have been held back today");
  assert.equal(quiet?.detail["start"], "09:00");
});

test("the cap is described from the log, and only when it is switched on", () => {
  const off = replayNotification(input({ alertsInPreviousHour: 4 }));
  assert.equal(off.path.find((step) => step.step === "cap")?.outcome, "off");

  const on = replayNotification(
    input({ delivery: { ...DELIVERY_DEFAULTS, cap: { enabled: true, maxPerHour: 3 } }, alertsInPreviousHour: 4 }),
  );
  const cap = on.path.find((step) => step.step === "cap");
  assert.equal(cap?.outcome, "at-limit");
  assert.deepEqual(cap?.detail, { maxPerHour: 3, alertsInPreviousHour: 4 });
});

test("when today's settings would not produce this alert, it says so rather than inventing a path", () => {
  const replayed = replayNotification(
    input({ service: { id: "github", name: "GitHub", mutedUntil: "2027-01-01T00:00:00.000Z" } }),
  );

  assert.equal(replayed.reproduced, false);
  assert.equal(replayed.trigger, null);
  assert.deepEqual(steps(replayed), ["diff"]);
  assert.equal(replayed.path[0]?.outcome, "no-change");
});

test("with no saved readings there is nothing to replay, and that is its own answer", () => {
  const replayed = replayNotification(input({ readings: [] }));

  assert.equal(replayed.available, false);
  assert.equal(replayed.reproduced, false);
  assert.deepEqual(replayed.path, []);
});

test("an alert that is about no reading — a report, a channel failing — has no diff to replay", () => {
  const replayed = replayNotification(
    input({ notification: { providerId: "github", channel: "telegram", kind: "periodic_report", sentAt: "2026-11-01T10:06:05.000Z" } }),
  );

  assert.equal(replayed.replayable, false);
  assert.deepEqual(replayed.path, []);
});

test("readings that all come after the alert mean the readings are gone, not that nothing happened", () => {
  const replayed = replayNotification(
    input({
      readings: [reading("2026-11-02T10:00:00.000Z", "operational")],
      notification: { providerId: "github", channel: "telegram", kind: "status_change", sentAt: "2026-10-01T10:00:00.000Z" },
    }),
  );

  assert.equal(replayed.available, false);
  assert.equal(replayed.reproduced, false);
  assert.deepEqual(replayed.path, []);
});
