import { test } from "node:test";
import assert from "node:assert/strict";
import { createDispatcher, type SentRecord } from "../../src/core/notificationDispatcher.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { Notifier } from "../../src/core/notifier.interface.ts";
import type { ServiceDefinition } from "../../src/core/configSource.interface.ts";
import type { NotificationPayload, StatusChange } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});

const services: ServiceDefinition[] = [
  {
    id: "github",
    name: "GitHub",
    adapter: "statuspage",
    baseUrl: "https://www.githubstatus.com",
    enabled: true,
  },
];

const incident = {
  id: "i1",
  name: "API requests failing",
  impact: "major",
  status: "investigating",
  updatedAt: "2026-08-19T14:32:07.000Z",
};

const change = (over: Partial<StatusChange> = {}): StatusChange => ({
  kind: "status_change",
  providerId: "github",
  previousStatus: "operational",
  currentStatus: "degraded",
  at: "2026-08-19T14:32:07.000Z",
  ...over,
});

function recorder(id: string, behaviour: "ok" | "throw" = "ok"): {
  notifier: Notifier;
  seen: NotificationPayload[];
} {
  const seen: NotificationPayload[] = [];
  return {
    seen,
    notifier: {
      id,
      async send(payload) {
        seen.push(payload);
        if (behaviour === "throw") throw new Error(`${id} is down`);
      },
    },
  };
}

test("each change becomes one payload carrying the change, service and locale", async () => {
  const channel = recorder("telegram");
  const dispatcher = createDispatcher({ notifiers: [channel.notifier], logger: silent });

  await dispatcher.dispatch([change()], { services, locale: "it" });

  assert.equal(channel.seen.length, 1);
  const [payload] = channel.seen;
  assert.equal(payload?.locale, "it");
  assert.deepEqual(payload?.service, {
    id: "github",
    name: "GitHub",
    statusUrl: "https://www.githubstatus.com",
  });
  assert.equal(payload?.change.kind, "status_change");
  assert.equal(payload?.change.currentStatus, "degraded");
});

test("every change kind is dispatched with its own structured payload", async () => {
  const channel = recorder("webhook");
  const dispatcher = createDispatcher({ notifiers: [channel.notifier], logger: silent });

  const changes: StatusChange[] = [
    change({ kind: "status_change" }),
    change({ kind: "incident_opened", incident }),
    change({ kind: "incident_updated", incident }),
    change({ kind: "incident_resolved", incident, currentStatus: "operational" }),
    change({ kind: "monitoring_degraded", failureCount: 5 }),
  ];
  await dispatcher.dispatch(changes, { services, locale: "en" });

  assert.deepEqual(
    channel.seen.map((payload) => payload.change.kind),
    ["status_change", "incident_opened", "incident_updated", "incident_resolved", "monitoring_degraded"],
  );
  assert.equal(channel.seen[1]?.change.incident?.id, "i1");
  assert.equal(channel.seen[4]?.change.failureCount, 5);
});

test("a change goes to every enabled channel", async () => {
  const a = recorder("telegram");
  const b = recorder("webhook");
  const dispatcher = createDispatcher({ notifiers: [a.notifier, b.notifier], logger: silent });

  const records = await dispatcher.dispatch([change()], { services, locale: "en" });

  assert.equal(a.seen.length, 1);
  assert.equal(b.seen.length, 1);
  assert.equal(records.length, 2);
  assert.ok(records.every((record) => record.ok));
});

test("one failing channel never blocks another and never rejects the dispatch", async () => {
  const broken = recorder("telegram", "throw");
  const healthy = recorder("webhook");
  const dispatcher = createDispatcher({ notifiers: [broken.notifier, healthy.notifier], logger: silent });

  const records = await dispatcher.dispatch([change()], { services, locale: "en" });

  assert.equal(healthy.seen.length, 1, "the healthy channel must still be delivered to");
  const failed = records.find((record) => record.channel === "telegram");
  const sent = records.find((record) => record.channel === "webhook");
  assert.equal(failed?.ok, false);
  assert.match(failed?.error ?? "", /telegram is down/);
  assert.equal(sent?.ok, true);
  assert.equal(sent?.error, undefined);
});

test("onSent is called once per change and channel, with the outcome", async () => {
  const broken = recorder("telegram", "throw");
  const healthy = recorder("webhook");
  const seen: SentRecord[] = [];
  const dispatcher = createDispatcher({
    notifiers: [broken.notifier, healthy.notifier],
    logger: silent,
    onSent: (record) => {
      seen.push(record);
    },
  });

  await dispatcher.dispatch([change(), change({ kind: "incident_opened", incident })], {
    services,
    locale: "en",
  });

  assert.equal(seen.length, 4);
  assert.equal(seen.filter((record) => record.ok).length, 2);
  assert.equal(seen.filter((record) => !record.ok).length, 2);
  for (const record of seen) {
    assert.equal(record.providerId, "github");
    assert.ok(record.text.length > 0, "the record carries the rendered text for the feed");
    assert.ok(!Number.isNaN(Date.parse(record.sentAt)));
  }
});

test("no changes means no delivery and no records", async () => {
  const channel = recorder("telegram");
  const dispatcher = createDispatcher({ notifiers: [channel.notifier], logger: silent });
  assert.deepEqual(await dispatcher.dispatch([], { services, locale: "en" }), []);
  assert.equal(channel.seen.length, 0);
});

test("no channels means no delivery, not a crash", async () => {
  const dispatcher = createDispatcher({ notifiers: [], logger: silent });
  assert.deepEqual(await dispatcher.dispatch([change()], { services, locale: "en" }), []);
});

test("a change for a provider that is no longer configured is skipped, not thrown", async () => {
  const channel = recorder("telegram");
  const warnings: string[] = [];
  const dispatcher = createDispatcher({
    notifiers: [channel.notifier],
    logger: createLogger("warn", (line) => warnings.push(line)),
  });

  const records = await dispatcher.dispatch([change({ providerId: "deleted" })], {
    services,
    locale: "en",
  });

  assert.deepEqual(records, []);
  assert.equal(channel.seen.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /deleted/);
});

test("a throwing onSent hook does not lose the dispatch result", async () => {
  const channel = recorder("telegram");
  const dispatcher = createDispatcher({
    notifiers: [channel.notifier],
    logger: silent,
    onSent: () => {
      throw new Error("the store is on fire");
    },
  });

  const records = await dispatcher.dispatch([change()], { services, locale: "en" });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.ok, true);
});
