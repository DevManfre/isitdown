import { test } from "node:test";
import assert from "node:assert/strict";
import { createDispatcher, type SentRecord } from "../../src/core/notificationDispatcher.ts";
import { createLogger } from "../../src/core/logger.ts";
import { CATCH_ALL_RULE } from "../../src/core/routing.ts";
import { DELIVERY_DEFAULTS, type DeliveryConfig } from "../../src/core/delivery.ts";
import type { MessageRefStore } from "../../src/core/messageRefStore.interface.ts";
import type { Notifier } from "../../src/core/notifier.interface.ts";
import type { ServiceDefinition } from "../../src/core/configSource.interface.ts";
import type { NotificationPayload, StatusChange } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});

const KNOWN = ["telegram", "slack", "webpush", "discord", "webhook"];

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

/** Fails the first `failures` attempts, then works. */
function flaky(id: string, failures: number): { notifier: Notifier; calls: number } {
  const channel = {
    calls: 0,
    notifier: {
      id,
      async send() {
        channel.calls += 1;
        if (channel.calls <= failures) throw new Error(`${id} is rate limited`);
      },
    },
  };
  return channel;
}

/** Records requested delays instead of waiting, so backoff is asserted not endured. */
function fakeSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

test("each change becomes one payload carrying the change, service and locale", async () => {
  const channel = recorder("telegram");
  const dispatcher = createDispatcher({ logger: silent });

  await dispatcher.dispatch([change()], {
    services,
    locale: "it",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

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
  const dispatcher = createDispatcher({ logger: silent });

  const changes: StatusChange[] = [
    change({ kind: "status_change" }),
    change({ kind: "incident_opened", incident }),
    change({ kind: "incident_updated", incident }),
    change({ kind: "incident_resolved", incident, currentStatus: "operational" }),
    change({ kind: "monitoring_degraded", failureCount: 5 }),
  ];
  await dispatcher.dispatch(changes, {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

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
  const dispatcher = createDispatcher({ logger: silent });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [a.notifier, b.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

  assert.equal(a.seen.length, 1);
  assert.equal(b.seen.length, 1);
  assert.equal(records.length, 2);
  assert.ok(records.every((record) => record.ok));
});

test("one failing channel never blocks another and never rejects the dispatch", async () => {
  const broken = recorder("telegram", "throw");
  const healthy = recorder("webhook");
  const dispatcher = createDispatcher({ logger: silent, sleep: fakeSleep().sleep });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [broken.notifier, healthy.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

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
    logger: silent,
    sleep: fakeSleep().sleep,
    onSent: (record) => {
      seen.push(record);
    },
  });

  await dispatcher.dispatch([change(), change({ kind: "incident_opened", incident })], {
    services,
    locale: "en",
    notifiers: [broken.notifier, healthy.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
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
  const dispatcher = createDispatcher({ logger: silent });
  assert.deepEqual(
    await dispatcher.dispatch([], {
      services,
      locale: "en",
      notifiers: [channel.notifier],
      rules: [CATCH_ALL_RULE],
      knownChannelIds: KNOWN,
    }),
    [],
  );
  assert.equal(channel.seen.length, 0);
});

test("no channels means no delivery, not a crash", async () => {
  const dispatcher = createDispatcher({ logger: silent });
  assert.deepEqual(
    await dispatcher.dispatch([change()], {
      services,
      locale: "en",
      notifiers: [],
      rules: [CATCH_ALL_RULE],
      knownChannelIds: KNOWN,
    }),
    [],
  );
});

test("a change for a provider that is no longer configured is skipped, not thrown", async () => {
  const channel = recorder("telegram");
  const warnings: string[] = [];
  const dispatcher = createDispatcher({
    logger: createLogger("warn", (line) => warnings.push(line)),
  });

  const records = await dispatcher.dispatch([change({ providerId: "deleted" })], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

  assert.deepEqual(records, []);
  assert.equal(channel.seen.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /deleted/);
});

test("a throwing onSent hook does not lose the dispatch result", async () => {
  const channel = recorder("telegram");
  const dispatcher = createDispatcher({
    logger: silent,
    onSent: () => {
      throw new Error("the store is on fire");
    },
  });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.ok, true);
});

test("a rule naming one channel sends to that channel only", async () => {
  const telegram = recorder("telegram");
  const slack = recorder("slack");
  const dispatcher = createDispatcher({ logger: silent });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [telegram.notifier, slack.notifier],
    rules: [{ provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] }],
    knownChannelIds: KNOWN,
  });

  assert.equal(telegram.seen.length, 0);
  assert.equal(slack.seen.length, 1);
  assert.deepEqual(
    records.map((record) => record.channel),
    ["slack"],
  );
});

test("a change no rule matches sends nothing and records nothing", async () => {
  const telegram = recorder("telegram");
  const dispatcher = createDispatcher({ logger: silent });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [telegram.notifier],
    rules: [{ provider: "sentry", classes: ["status"], minSeverity: "any", channels: ["telegram"] }],
    knownChannelIds: KNOWN,
  });

  assert.equal(telegram.seen.length, 0);
  assert.deepEqual(records, []);
});

test("a rule naming a channel the operator switched off sends nothing and stays quiet", async () => {
  // `notifiers` only ever holds enabled channels, so a disabled target simply
  // has nothing to send through. It is expected, not a misconfiguration.
  const lines: string[] = [];
  const logger = createLogger("warn", (line) => lines.push(line));
  const telegram = recorder("telegram");
  const dispatcher = createDispatcher({ logger });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [telegram.notifier],
    rules: [{ provider: "*", classes: ["status"], minSeverity: "any", channels: ["slack"] }],
    knownChannelIds: KNOWN,
  });

  assert.deepEqual(records, []);
  assert.equal(
    lines.filter((line) => line.includes("unknown channel")).length,
    0,
    "a disabled channel must not be reported as unknown",
  );
});

test("a rule naming a channel nothing knows about is warned about", async () => {
  const lines: string[] = [];
  const logger = createLogger("warn", (line) => lines.push(line));
  const telegram = recorder("telegram");
  const dispatcher = createDispatcher({ logger });

  await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [telegram.notifier],
    rules: [{ provider: "*", classes: ["status"], minSeverity: "any", channels: ["pushover"] }],
    knownChannelIds: KNOWN,
  });

  assert.equal(lines.filter((line) => line.includes("pushover")).length, 1);
});

test("an unknown channel is warned about even with every channel disabled", async () => {
  // The operator mid-reconfiguration with everything switched off is exactly
  // who most needs this diagnostic, not the case it should go quiet for.
  const lines: string[] = [];
  const logger = createLogger("warn", (line) => lines.push(line));
  const dispatcher = createDispatcher({ logger });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [],
    rules: [{ provider: "*", classes: ["status"], minSeverity: "any", channels: ["pushover"] }],
    knownChannelIds: KNOWN,
  });

  assert.deepEqual(records, []);
  assert.equal(lines.filter((line) => line.includes("pushover")).length, 1);
});

test("sendTest ignores the rules entirely", async () => {
  // A delivery test answers "is this channel configured", not "do my rules
  // permit this event". Mixing the two makes the button useless exactly when
  // the operator needs it.
  const slack = recorder("slack");
  const dispatcher = createDispatcher({ logger: silent });

  const record = await dispatcher.sendTest(slack.notifier, services[0]!, "en");

  assert.equal(slack.seen.length, 1);
  assert.equal(record.ok, true);
});

test("a send that fails once and then works is one delivered record, not two", async () => {
  // The delivery log is a log of messages, not of attempts: a retried alert
  // that arrived must not read as a failure beside a success.
  const channel = flaky("telegram", 1);
  const seen: SentRecord[] = [];
  const dispatcher = createDispatcher({
    logger: silent,
    sleep: fakeSleep().sleep,
    onSent: (record) => {
      seen.push(record);
    },
  });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

  assert.equal(channel.calls, 2, "the second attempt is what delivered it");
  assert.equal(records.length, 1);
  assert.equal(records[0]?.ok, true);
  assert.equal(records[0]?.attempts, 2);
  assert.equal(records[0]?.error, undefined);
  assert.deepEqual(seen.length, 1, "one row per message, whatever it took");
});

test("a channel that fails every attempt is a dead letter, with growing backoff", async () => {
  const channel = flaky("telegram", 99);
  const timer = fakeSleep();
  const dispatcher = createDispatcher({ logger: silent, sleep: timer.sleep });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

  assert.equal(channel.calls, 3, "three attempts, not more and not fewer");
  assert.equal(records[0]?.ok, false);
  assert.equal(records[0]?.attempts, 3);
  assert.match(records[0]?.error ?? "", /rate limited/);
  assert.equal(timer.delays.length, 2, `expected two backoffs, got ${JSON.stringify(timer.delays)}`);
  assert.ok((timer.delays[1] ?? 0) > (timer.delays[0] ?? 0), "backoff must grow across attempts");
});

test("a send that works first time is never retried and never waits", async () => {
  const channel = flaky("telegram", 0);
  const timer = fakeSleep();
  const dispatcher = createDispatcher({ logger: silent, sleep: timer.sleep });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

  assert.equal(channel.calls, 1);
  assert.equal(records[0]?.attempts, 1);
  assert.deepEqual(timer.delays, []);
});

test("a delivery test is tried once: the operator is waiting for the answer", async () => {
  const channel = flaky("telegram", 99);
  const timer = fakeSleep();
  const dispatcher = createDispatcher({ logger: silent, sleep: timer.sleep });

  const record = await dispatcher.sendTest(channel.notifier, services[0]!, "en");

  assert.equal(channel.calls, 1);
  assert.equal(record.ok, false);
  assert.equal(record.attempts, 1);
  assert.deepEqual(timer.delays, []);
});

test("a dead letter is logged as an error, its retried attempts only as warnings", async () => {
  const lines: string[] = [];
  const channel = flaky("telegram", 99);
  const dispatcher = createDispatcher({
    logger: createLogger("warn", (line) => lines.push(line)),
    sleep: fakeSleep().sleep,
  });

  await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

  assert.equal(lines.filter((line) => line.includes("attempt failed")).length, 3);
  assert.equal(lines.filter((line) => line.includes("failed permanently")).length, 1);
});

/**
 * A clock the test moves itself, so a digest window and the cap's rolling hour
 * are asserted rather than waited out.
 */
function fakeClock(start = Date.parse("2026-09-08T14:00:00.000Z")): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let at = start;
  return { now: () => at, advance: (ms: number) => void (at += ms) };
}

const delivery = (over: Partial<DeliveryConfig> = {}): DeliveryConfig => ({
  ...DELIVERY_DEFAULTS,
  ...over,
});

test("quiet hours hold back a change under their floor, and let a worse one through", async () => {
  const channel = recorder("telegram");
  // 23:30 in Rome, which is inside 23:00–07:00 there and not inside it in UTC —
  // so a zone read from the wrong place fails this rather than passing by luck.
  const clock = fakeClock(Date.parse("2026-09-08T21:30:00.000Z"));
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({
      quietHours: {
        enabled: true,
        start: "23:00",
        end: "07:00",
        timeZone: "Europe/Rome",
        minSeverity: "major_outage",
      },
    }),
  };

  await dispatcher.dispatch([change({ currentStatus: "degraded" })], ctx);
  assert.deepEqual(channel.seen, [], "a degradation at half past eleven wakes nobody");

  await dispatcher.dispatch(
    [change({ previousStatus: "operational", currentStatus: "major_outage" })],
    ctx,
  );
  assert.equal(channel.seen.length, 1, "an outage clears the floor and is sent");
});

test("outside the window quiet hours change nothing", async () => {
  const channel = recorder("telegram");
  const clock = fakeClock(Date.parse("2026-09-08T10:00:00.000Z"));
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });

  await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({
      quietHours: {
        enabled: true,
        start: "23:00",
        end: "07:00",
        timeZone: "Europe/Rome",
        minSeverity: "major_outage",
      },
    }),
  });

  assert.equal(channel.seen.length, 1);
});

test("the hourly cap stops a provider flooding, and the next message says how much it hid", async () => {
  const channel = recorder("telegram");
  const clock = fakeClock();
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ cap: { enabled: true, maxPerHour: 2 } }),
  };

  for (let index = 0; index < 5; index += 1) {
    await dispatcher.dispatch([change()], ctx);
    clock.advance(60_000);
  }
  assert.equal(channel.seen.length, 2, "two messages an hour is two messages an hour");

  // An hour after the first, its slot comes back — and the message that takes
  // it reports the three that were swallowed in between.
  clock.advance(56 * 60_000);
  await dispatcher.dispatch([change()], ctx);
  assert.equal(channel.seen.length, 3);
  assert.equal(channel.seen[2]?.suppressedCount, 3);

  // Reported once, not on every message after it.
  clock.advance(60_000);
  await dispatcher.dispatch([change()], ctx);
  assert.equal(channel.seen[3]?.suppressedCount, 0);
});

test("the cap counts one change once, however many channels it reaches", async () => {
  const telegram = recorder("telegram");
  const slack = recorder("slack");
  const clock = fakeClock();
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });
  const ctx = {
    services,
    locale: "en",
    notifiers: [telegram.notifier, slack.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ cap: { enabled: true, maxPerHour: 2 } }),
  };

  await dispatcher.dispatch([change()], ctx);
  clock.advance(60_000);
  await dispatcher.dispatch([change()], ctx);
  clock.advance(60_000);
  await dispatcher.dispatch([change()], ctx);

  assert.equal(telegram.seen.length, 2, "two changes got through, not one");
  assert.equal(slack.seen.length, 2);
});

test("a change under the digest floor waits for the window, then arrives as one message", async () => {
  const channel = recorder("telegram");
  const clock = fakeClock();
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({
      digest: { enabled: true, windowMinutes: 15, immediateFloor: "major_outage" },
    }),
  };

  await dispatcher.dispatch([change({ currentStatus: "degraded" })], ctx);
  await dispatcher.dispatch([change({ currentStatus: "partial_outage" })], ctx);
  assert.deepEqual(channel.seen, [], "nothing goes out while the window is collecting");


  // A cycle in which nothing changed at all is exactly when a window runs out.
  clock.advance(16 * 60_000);
  const records = await dispatcher.dispatch([], ctx);

  assert.equal(channel.seen.length, 1, "one message for the whole window");
  assert.equal(records.length, 1);
  assert.equal(channel.seen[0]?.digest?.items.length, 2);
  // The most severe member stands in as the message's own change.
  assert.equal(channel.seen[0]?.change.currentStatus, "partial_outage");
});

test("a change at or above the digest floor is sent immediately, batch or no batch", async () => {
  const channel = recorder("telegram");
  const clock = fakeClock();
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({
      digest: { enabled: true, windowMinutes: 15, immediateFloor: "partial_outage" },
    }),
  };

  await dispatcher.dispatch([change({ currentStatus: "degraded" })], ctx);
  await dispatcher.dispatch([change({ currentStatus: "major_outage" })], ctx);

  assert.equal(channel.seen.length, 1, "the outage did not wait for the batch");
  assert.equal(channel.seen[0]?.change.currentStatus, "major_outage");
  assert.equal(channel.seen[0]?.digest, undefined);
  // And the degradation is still collecting: it arrives when the window ends.
  clock.advance(16 * 60_000);
  await dispatcher.dispatch([], ctx);
  assert.equal(channel.seen.length, 2);
  assert.equal(channel.seen[1]?.digest?.items.length, 1);
});

test("a digest for a channel switched off mid-window is dropped, not sent elsewhere", async () => {
  const telegram = recorder("telegram");
  const clock = fakeClock();
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });
  const shared = {
    services,
    locale: "en",
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({
      digest: { enabled: true, windowMinutes: 15, immediateFloor: "major_outage" },
    }),
  };

  await dispatcher.dispatch([change({ currentStatus: "degraded" })], {
    ...shared,
    notifiers: [telegram.notifier],
  });
  clock.advance(16 * 60_000);
  const records = await dispatcher.dispatch([], { ...shared, notifiers: [] });

  assert.deepEqual(records, []);
  assert.deepEqual(telegram.seen, []);

  // And gone rather than held forever: the channel coming back does not
  // deliver a batch from an hour ago.
  clock.advance(16 * 60_000);
  await dispatcher.dispatch([], { ...shared, notifiers: [telegram.notifier] });
  assert.deepEqual(telegram.seen, []);
});

test("quiet hours and the digest compose: a held-back change never reaches the batch", async () => {
  const channel = recorder("telegram");
  const clock = fakeClock(Date.parse("2026-09-08T21:30:00.000Z"));
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({
      quietHours: {
        enabled: true,
        start: "23:00",
        end: "07:00",
        timeZone: "Europe/Rome",
        minSeverity: "major_outage",
      },
      digest: { enabled: true, windowMinutes: 15, immediateFloor: "major_outage" },
    }),
  };

  await dispatcher.dispatch([change({ currentStatus: "degraded" })], ctx);

  // Quiet hours drop it, they do not defer it: no batch forms, so the end of
  // the window brings nothing.
  clock.advance(16 * 60_000);
  assert.deepEqual(await dispatcher.dispatch([], ctx), []);
  assert.deepEqual(channel.seen, []);
});

/** An in-memory message reference store, the shape both editions persist. */
function refStore(): MessageRefStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const key = (channel: string, providerId: string, incidentId: string): string =>
    `${channel}|${providerId}|${incidentId}`;
  return {
    rows,
    async getRef(channel, providerId, incidentId) {
      return rows.get(key(channel, providerId, incidentId)) ?? null;
    },
    async saveRef(channel, providerId, incidentId, ref) {
      rows.set(key(channel, providerId, incidentId), ref);
    },
    async forgetRef(channel, providerId, incidentId) {
      rows.delete(key(channel, providerId, incidentId));
    },
  };
}

/** A channel that names its messages and can edit them, like Telegram's. */
function editable(id: string, behaviour: "ok" | "refuse-edit" = "ok"): {
  notifier: Notifier;
  sent: NotificationPayload[];
  edited: { payload: NotificationPayload; ref: string }[];
} {
  const sent: NotificationPayload[] = [];
  const edited: { payload: NotificationPayload; ref: string }[] = [];
  let next = 0;
  return {
    sent,
    edited,
    notifier: {
      id,
      async send(payload) {
        sent.push(payload);
        next += 1;
        return `m${next}`;
      },
      async update(payload, ref) {
        if (behaviour === "refuse-edit") throw new Error("message can't be edited");
        edited.push({ payload, ref });
      },
    },
  };
}

const incidentChange = (kind: StatusChange["kind"], status = "investigating"): StatusChange =>
  change({
    kind,
    currentStatus: "major_outage",
    incident: { ...incident, status },
  });

test("with editing on, an incident's updates rewrite the message its opening sent", async () => {
  const channel = editable("telegram");
  const refs = refStore();
  const dispatcher = createDispatcher({ logger: silent, messageRefs: refs });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ updateInPlace: true }),
  };

  await dispatcher.dispatch([incidentChange("incident_opened")], ctx);
  await dispatcher.dispatch([incidentChange("incident_updated", "identified")], ctx);
  await dispatcher.dispatch([incidentChange("incident_resolved")], ctx);

  assert.equal(channel.sent.length, 1, "one message for the whole incident");
  assert.deepEqual(
    channel.edited.map((edit) => edit.ref),
    ["m1", "m1"],
    "the update and the resolution both edited it",
  );
  assert.equal(refs.rows.size, 0, "the closed incident's reference is let go");
});

test("with editing off, every update is its own message", async () => {
  const channel = editable("telegram");
  const dispatcher = createDispatcher({ logger: silent, messageRefs: refStore() });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery(),
  };

  await dispatcher.dispatch([incidentChange("incident_opened")], ctx);
  await dispatcher.dispatch([incidentChange("incident_updated", "identified")], ctx);

  assert.equal(channel.sent.length, 2);
  assert.deepEqual(channel.edited, []);
});

test("a change that is not part of an incident is never folded into one", async () => {
  const channel = editable("telegram");
  const refs = refStore();
  const dispatcher = createDispatcher({ logger: silent, messageRefs: refs });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ updateInPlace: true }),
  };

  await dispatcher.dispatch([incidentChange("incident_opened")], ctx);
  await dispatcher.dispatch([change({ currentStatus: "degraded" })], ctx);

  assert.equal(channel.sent.length, 2, "the status change got its own message");
  assert.deepEqual(channel.edited, []);
});

test("an edit the channel refuses becomes a new message, and is not retried forever", async () => {
  const channel = editable("telegram", "refuse-edit");
  const refs = refStore();
  const dispatcher = createDispatcher({ logger: silent, messageRefs: refs });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ updateInPlace: true }),
  };

  await dispatcher.dispatch([incidentChange("incident_opened")], ctx);
  const records = await dispatcher.dispatch([incidentChange("incident_updated", "identified")], ctx);

  assert.equal(channel.sent.length, 2, "the refused edit fell back to a send");
  assert.equal(records[0]?.ok, true, "which is a delivered notification, not a failure");
  // The new message replaced the reference, rather than the refused one being
  // offered to the next update as well.
  assert.equal(refs.rows.get("telegram|github|i1"), "m2");
});

test("a channel that cannot edit is simply sent to, with editing on", async () => {
  const channel = recorder("slack");
  const dispatcher = createDispatcher({ logger: silent, messageRefs: refStore() });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ updateInPlace: true }),
  };

  await dispatcher.dispatch([incidentChange("incident_opened")], ctx);
  await dispatcher.dispatch([incidentChange("incident_updated", "identified")], ctx);

  assert.equal(channel.seen.length, 2);
});

test("with nowhere to keep a reference, editing cannot silently drop updates", async () => {
  const channel = editable("telegram");
  // No messageRefs dependency at all: what an edition that has no store passes.
  const dispatcher = createDispatcher({ logger: silent });

  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ updateInPlace: true }),
  };
  await dispatcher.dispatch([incidentChange("incident_opened")], ctx);
  await dispatcher.dispatch([incidentChange("incident_updated", "identified")], ctx);

  assert.equal(channel.sent.length, 2);
  assert.deepEqual(channel.edited, []);
});

/**
 * Per-channel locale (roadmap 3.20) and per-channel template (roadmap 3.15).
 *
 * Both are the same claim from the dispatcher's side: one change, routed to two
 * channels, is allowed to be two different messages — so the wording cannot be
 * decided when the payload is built, only when a channel is picked.
 */

test("each channel is handed the change in the language it asked for", async () => {
  const italian = recorder("telegram");
  const english = recorder("webhook");
  const dispatcher = createDispatcher({ logger: silent });

  await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [italian.notifier, english.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    channelMessages: { telegram: { locale: "it" } },
  });

  assert.equal(italian.seen[0]?.locale, "it");
  // The channel that asked for nothing keeps the fleet's own locale.
  assert.equal(english.seen[0]?.locale, "en");
});

test("a channel's template reaches it, and only it", async () => {
  const templated = recorder("telegram");
  const plain = recorder("webhook");
  const dispatcher = createDispatcher({ logger: silent });

  await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [templated.notifier, plain.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    channelMessages: { telegram: { template: "{{provider}} {{status}}" } },
  });

  assert.equal(templated.seen[0]?.template, "{{provider}} {{status}}");
  assert.equal(plain.seen[0]?.template, undefined);
});

test("a digest reads in the batching channel's language, line by line", async () => {
  const channel = recorder("telegram");
  let now = 0;
  const dispatcher = createDispatcher({ logger: silent, now: () => now });
  const delivery: DeliveryConfig = {
    ...DELIVERY_DEFAULTS,
    digest: { enabled: true, windowMinutes: 1, immediateFloor: "major_outage" },
  };
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery,
    channelMessages: { telegram: { locale: "it", template: "{{provider}}" } },
  };

  await dispatcher.dispatch([change()], ctx);
  assert.equal(channel.seen.length, 0);

  now += 61_000;
  await dispatcher.dispatch([], ctx);

  const [payload] = channel.seen;
  assert.equal(payload?.locale, "it");
  // Every member too: the digest renders one line per item out of the item's
  // own locale, and the items were collected before the channel was known.
  assert.deepEqual(payload?.digest?.items.map((item) => item.locale), ["it"]);
  // A template describes one change; a batch of them is not templated.
  assert.equal(payload?.template, undefined);
});

// Roadmap 3.1: only the channels that can take a press are told to draw buttons.
test("only channels the context names as interactive are handed an interactive payload", async () => {
  const withButtons = recorder("telegram");
  const without = recorder("webhook");
  const dispatcher = createDispatcher({ logger: silent });

  await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [withButtons.notifier, without.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    interactiveChannels: ["telegram"],
  });

  assert.equal(withButtons.seen[0]?.interactive, true);
  assert.equal(without.seen[0]?.interactive, undefined);
});

test("a context that names no interactive channel leaves every payload as it always was", async () => {
  const channel = recorder("telegram");
  await createDispatcher({ logger: silent }).dispatch([change()], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });
  assert.equal("interactive" in (channel.seen[0] ?? {}), false);
});

// Roadmap 3.2: a major change nobody has taken in charge is said again, elsewhere.
const KNOWN_ESCALATION = ["telegram", "pushover", "webhook"];

const escalationPolicy = (over: Partial<DeliveryConfig["escalation"]> = {}): DeliveryConfig => ({
  ...DELIVERY_DEFAULTS,
  escalation: { enabled: true, afterMinutes: 15, channel: "pushover", minSeverity: "major_outage", ...over },
});

function escalationHarness(over: { acked?: boolean; inTrouble?: boolean; delivery?: DeliveryConfig } = {}) {
  let at = Date.parse("2026-08-19T14:00:00.000Z");
  const state = { acked: over.acked ?? false, inTrouble: over.inTrouble ?? true, troubleLookupFails: false };
  const primary = recorder("telegram");
  const escalation = recorder("pushover");
  // Copied so a test can mute the provider after the outage was announced.
  const fleet = services.map((service) => ({ ...service }));
  const dispatcher = createDispatcher({
    logger: silent,
    now: () => at,
    sleep: async () => {},
    escalation: {
      isAcked: async () => state.acked,
      inTrouble: async () => {
        if (state.troubleLookupFails) throw new Error("database is locked");
        return state.inTrouble;
      },
    },
  });
  const run = (changes: StatusChange[]) =>
    dispatcher.dispatch(changes, {
      services: fleet,
      locale: "en",
      notifiers: [primary.notifier, escalation.notifier],
      rules: [{ provider: "*", classes: ["status", "incident"], minSeverity: "any", channels: ["telegram"] }],
      knownChannelIds: KNOWN_ESCALATION,
      delivery: over.delivery ?? escalationPolicy(),
    });
  return {
    state,
    primary,
    escalation,
    run,
    advance: (minutes: number) => void (at += minutes * 60_000),
    mute: () => void (fleet[0]!.mutedUntil = "2999-01-01T00:00:00.000Z"),
  };
}

const outage = (): StatusChange => change({ currentStatus: "major_outage" });

test("a major change nobody takes in charge is sent again, once, on the escalation channel", async () => {
  const h = escalationHarness();
  await h.run([outage()]);
  assert.equal(h.primary.seen.length, 1);
  assert.equal(h.escalation.seen.length, 0, "not yet: nobody has had the time to answer");

  h.advance(14);
  await h.run([]);
  assert.equal(h.escalation.seen.length, 0, "still inside the wait");

  h.advance(1);
  await h.run([]);
  assert.equal(h.escalation.seen.length, 1);
  assert.deepEqual(h.escalation.seen[0]?.escalated, { afterMinutes: 15 });
  assert.equal(h.escalation.seen[0]?.change.kind, "status_change");
  assert.equal(h.primary.seen.length, 1, "the primary channel is not told twice");

  h.advance(60);
  await h.run([]);
  assert.equal(h.escalation.seen.length, 1, "once per stretch of trouble, not every cycle");
});

test("a trouble lookup that throws does not abort the other changes", async () => {
  const h = escalationHarness();
  await h.run([outage()]);
  h.state.troubleLookupFails = true;
  await h.run([change({ currentStatus: "degraded" }), change({ currentStatus: "major_outage" })]);
  assert.equal(h.primary.seen.length, 3);
});

test("somebody taking it in charge before the wait is up cancels the escalation", async () => {
  const h = escalationHarness();
  await h.run([outage()]);
  h.advance(10);
  h.state.acked = true;
  h.advance(10);
  await h.run([]);
  assert.equal(h.escalation.seen.length, 0);
});

test("trouble that ended on its own before the wait is up is not escalated", async () => {
  const h = escalationHarness();
  await h.run([outage()]);
  h.advance(20);
  h.state.inTrouble = false;
  await h.run([]);
  assert.equal(h.escalation.seen.length, 0);
});

test("trouble that ends and comes back is a new stretch, and escalates again", async () => {
  const h = escalationHarness();
  await h.run([outage()]);
  h.advance(20);
  await h.run([]);
  assert.equal(h.escalation.seen.length, 1);

  h.state.inTrouble = false;
  await h.run([]);
  h.state.inTrouble = true;
  await h.run([outage()]);
  h.advance(20);
  await h.run([]);
  assert.equal(h.escalation.seen.length, 2);
});

test("only a change that clears the escalation floor starts the clock", async () => {
  const h = escalationHarness();
  await h.run([change({ currentStatus: "degraded" })]);
  h.advance(60);
  await h.run([]);
  assert.equal(h.escalation.seen.length, 0);

  const wide = escalationHarness({ delivery: escalationPolicy({ minSeverity: "degraded" }) });
  await wide.run([change({ currentStatus: "degraded" })]);
  wide.advance(20);
  await wide.run([]);
  assert.equal(wide.escalation.seen.length, 1);
});

test("a recovery never starts the clock, and a change that was held back by quiet hours never did", async () => {
  const h = escalationHarness();
  await h.run([change({ previousStatus: "major_outage", currentStatus: "operational" })]);
  h.advance(60);
  await h.run([]);
  assert.equal(h.escalation.seen.length, 0);
});

test("a muted provider is not escalated, and the escalation is off unless it was asked for", async () => {
  const muted = escalationHarness();
  await muted.run([outage()]);
  muted.mute();
  muted.advance(20);
  await muted.run([]);
  assert.equal(muted.escalation.seen.length, 0, "I know, stop telling me");
  const off = escalationHarness({ delivery: escalationPolicy({ enabled: false }) });
  await off.run([outage()]);
  off.advance(60);
  await off.run([]);
  assert.equal(off.escalation.seen.length, 0);
  const none = escalationHarness({ delivery: DELIVERY_DEFAULTS });
  await none.run([outage()]);
  none.advance(60);
  await none.run([]);
  assert.equal(none.escalation.seen.length, 0);
});

test("an escalation channel that is not enabled says so in the log instead of vanishing", async () => {
  const lines: string[] = [];
  const logger = createLogger("warn", (line: string) => void lines.push(line));
  let at = Date.parse("2026-08-19T14:00:00.000Z");
  const primary = recorder("telegram");
  const dispatcher = createDispatcher({
    logger,
    now: () => at,
    escalation: { isAcked: async () => false, inTrouble: async () => true },
  });
  const ctx = {
    services,
    locale: "en",
    notifiers: [primary.notifier],
    rules: [{ provider: "*", classes: ["status" as const], minSeverity: "any" as const, channels: ["telegram"] }],
    knownChannelIds: KNOWN_ESCALATION,
    delivery: escalationPolicy({ channel: "pushover" }),
  };
  await dispatcher.dispatch([outage()], ctx);
  at += 20 * 60_000;
  await dispatcher.dispatch([], ctx);
  assert.ok(lines.some((line) => /escalat/i.test(line) && /pushover/.test(line)), lines.join("\n"));
});

test("the escalated message says it was not taken in charge, in the channel's own language", async () => {
  const h = escalationHarness();
  await h.run([outage()]);
  h.advance(20);
  await h.run([]);
  const payload = h.escalation.seen[0]!;
  const { renderMessage } = await import("../../src/notifiers/formatting.ts");
  assert.match(renderMessage(payload), /15 min/);
  assert.match(renderMessage({ ...payload, locale: "it" }), /15 min/);
  assert.notEqual(renderMessage(payload), renderMessage({ ...payload, escalated: undefined }));
});

test("without a way to ask who has taken it in charge, an escalation that was asked for is refused, not guessed", async () => {
  const lines: string[] = [];
  const logger = createLogger("warn", (line: string) => void lines.push(line));
  let at = Date.parse("2026-08-19T14:00:00.000Z");
  const primary = recorder("telegram");
  const escalation = recorder("pushover");
  const dispatcher = createDispatcher({ logger, now: () => at });
  const ctx = {
    services,
    locale: "en",
    notifiers: [primary.notifier, escalation.notifier],
    rules: [{ provider: "*", classes: ["status" as const], minSeverity: "any" as const, channels: ["telegram"] }],
    knownChannelIds: KNOWN_ESCALATION,
    delivery: escalationPolicy(),
  };
  await dispatcher.dispatch([outage()], ctx);
  at += 60 * 60_000;
  await dispatcher.dispatch([], ctx);
  assert.equal(escalation.seen.length, 0);
  assert.ok(lines.some((line) => /escalat/i.test(line)), "the refusal is said out loud");
});

// Roadmap 3.4: a channel that keeps failing is reported on the others.
const channelHealthPolicy = (afterFailures = 3): DeliveryConfig => ({
  ...DELIVERY_DEFAULTS,
  channelHealth: { enabled: true, afterFailures },
});

function channelHealthHarness(delivery: DeliveryConfig = channelHealthPolicy()) {
  let behaviour: "ok" | "throw" = "throw";
  const brokenSeen: NotificationPayload[] = [];
  const broken: Notifier = {
    id: "webhook",
    async send(payload) {
      brokenSeen.push(payload);
      if (behaviour === "throw") throw new Error("HTTP 500");
    },
  };
  const healthy = recorder("telegram");
  const dispatcher = createDispatcher({ logger: silent, sleep: async () => {} });
  const ctx = {
    services,
    locale: "en",
    notifiers: [broken, healthy.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery,
  };
  return {
    healthy,
    brokenSeen,
    run: (changes: StatusChange[]) => dispatcher.dispatch(changes, ctx),
    dispatcher,
    recover: () => void (behaviour = "ok"),
    breakAgain: () => void (behaviour = "throw"),
  };
}

const told = (seen: NotificationPayload[]) => seen.filter((payload) => payload.change.kind === "channel_failing");

test("a channel that refuses enough messages in a row is reported once on the others", async () => {
  const h = channelHealthHarness();
  await h.run([change()]);
  await h.run([change()]);
  assert.equal(told(h.healthy.seen).length, 0, "two failures are not yet a broken channel");

  const records = await h.run([change()]);
  const alerts = told(h.healthy.seen);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.change.channel?.id, "webhook");
  assert.equal(alerts[0]?.change.channel?.failures, 3);
  assert.equal(alerts[0]?.change.channel?.error, "HTTP 500");
  assert.equal(told(h.brokenSeen).length, 0, "the broken channel is not asked to report itself");
  assert.ok(records.some((record) => record.kind === "channel_failing" && record.channel === "telegram"));

  await h.run([change()]);
  assert.equal(told(h.healthy.seen).length, 1, "once per run of failures, not every cycle after");
});

test("a channel that works again ends its run, so the next run is reported again", async () => {
  const h = channelHealthHarness();
  for (let n = 0; n < 3; n += 1) await h.run([change()]);
  assert.equal(told(h.healthy.seen).length, 1);

  h.recover();
  await h.run([change()]);
  h.breakAgain();
  for (let n = 0; n < 3; n += 1) await h.run([change()]);
  assert.equal(told(h.healthy.seen).length, 2);
});

test("a failing channel is not reported while the feature is off", async () => {
  const h = channelHealthHarness(DELIVERY_DEFAULTS);
  for (let n = 0; n < 5; n += 1) await h.run([change()]);
  assert.equal(told(h.healthy.seen).length, 0);
});

test("quiet hours hold the report back, and it goes out once they are over", async () => {
  let at = Date.parse("2026-08-19T02:00:00.000Z");
  const delivery: DeliveryConfig = {
    ...channelHealthPolicy(2),
    quietHours: { enabled: true, start: "23:00", end: "07:00", timeZone: "UTC", minSeverity: "major_outage" },
  };
  const broken: Notifier = { id: "webhook", send: async () => Promise.reject(new Error("HTTP 500")) };
  const healthy = recorder("telegram");
  const dispatcher = createDispatcher({ logger: silent, sleep: async () => {}, now: () => at });
  const run = (changes: StatusChange[]) =>
    dispatcher.dispatch(changes, {
      services,
      locale: "en",
      notifiers: [broken, healthy.notifier],
      rules: [{ provider: "*", classes: ["status"], minSeverity: "any", channels: ["webhook"] }, CATCH_ALL_RULE],
      knownChannelIds: KNOWN,
      delivery,
    });
  // A major outage clears the quiet-hours floor, so it is still sent — and fails.
  await run([change({ currentStatus: "major_outage" })]);
  await run([change({ currentStatus: "major_outage" })]);
  assert.equal(told(healthy.seen).length, 0, "held: a broken webhook is not worth waking anybody");

  at = Date.parse("2026-08-19T08:00:00.000Z");
  await run([]);
  assert.equal(told(healthy.seen).length, 1);
});

test("an operator's test send does not count towards a channel's run", async () => {
  const h = channelHealthHarness(channelHealthPolicy(2));
  const broken = { id: "webhook", send: async () => Promise.reject(new Error("HTTP 500")) };
  await h.dispatcher.sendTest(broken, services[0]!, "en");
  await h.dispatcher.sendTest(broken, services[0]!, "en");
  await h.run([]);
  assert.equal(told(h.healthy.seen).length, 0);
});

// Roadmap 3.5: a recipient hears a change once, on its preferred channel.
const recipients = [{ id: "alice", name: "Alice", channels: ["telegram", "discord"] }];

test("a recipient's channels collapse into its preferred one", async () => {
  const telegram = recorder("telegram");
  const discord = recorder("discord");
  const webhook = recorder("webhook");
  const dispatcher = createDispatcher({ logger: silent, sleep: async () => {} });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [discord.notifier, telegram.notifier, webhook.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    recipients,
  });

  assert.equal(telegram.seen.length, 1);
  assert.equal(discord.seen.length, 0, "the fallback stays quiet while the preferred channel works");
  assert.equal(webhook.seen.length, 1, "a channel in no recipient is sent to as before");
  assert.equal(records.length, 2);
});

test("a preferred channel that fails for good hands the message to the next", async () => {
  const telegram = recorder("telegram", "throw");
  const discord = recorder("discord");
  const dispatcher = createDispatcher({ logger: silent, sleep: async () => {} });

  const records = await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [telegram.notifier, discord.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    recipients,
  });

  assert.equal(discord.seen.length, 1);
  assert.deepEqual(
    records.map((record) => [record.channel, record.ok]),
    [
      ["telegram", false],
      ["discord", true],
    ],
    "the delivery log shows why the fallback was needed",
  );
});

test("a recipient only falls back onto channels the rule reached", async () => {
  const telegram = recorder("telegram", "throw");
  const discord = recorder("discord");
  const dispatcher = createDispatcher({ logger: silent, sleep: async () => {} });

  await dispatcher.dispatch([change()], {
    services,
    locale: "en",
    notifiers: [telegram.notifier, discord.notifier],
    rules: [{ provider: "*", classes: ["status"], minSeverity: "any", channels: ["telegram"] }],
    knownChannelIds: KNOWN,
    recipients,
  });

  assert.equal(discord.seen.length, 0, "the rule kept this provider off Discord, fallback included");
});

test("a recipient's digest goes to its preferred channel only", async () => {
  let at = Date.parse("2026-08-19T14:00:00.000Z");
  const telegram = recorder("telegram");
  const discord = recorder("discord");
  const dispatcher = createDispatcher({ logger: silent, sleep: async () => {}, now: () => at });
  const ctx = {
    services,
    locale: "en",
    notifiers: [telegram.notifier, discord.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    recipients,
    delivery: { ...DELIVERY_DEFAULTS, digest: { enabled: true, windowMinutes: 15, immediateFloor: "major_outage" as const } },
  };
  await dispatcher.dispatch([change()], ctx);
  at += 16 * 60_000;
  await dispatcher.dispatch([], ctx);
  assert.equal(telegram.seen.length, 1);
  assert.notEqual(telegram.seen[0]?.digest, undefined);
  assert.equal(discord.seen.length, 0);
});

// Roadmap 3.6: a followed incident reaches every channel until it resolves.
test("a followed incident reaches every enabled channel whatever the rules say, until it resolves", async () => {
  const followed = new Set(["github/i1"]);
  const telegram = recorder("telegram");
  const slack = recorder("slack");
  const dispatcher = createDispatcher({
    logger: silent,
    follows: {
      isFollowed: async (providerId, incidentId) => followed.has(`${providerId}/${incidentId}`),
      unfollow: async (providerId, incidentId) => void followed.delete(`${providerId}/${incidentId}`),
    },
  });
  const ctx = {
    services,
    locale: "en",
    notifiers: [telegram.notifier, slack.notifier],
    // A rule that mutes this provider outright.
    rules: [{ provider: "github", classes: ["status" as const, "incident" as const], minSeverity: "any" as const, channels: [] }],
    knownChannelIds: KNOWN,
  };

  await dispatcher.dispatch([change({ kind: "incident_updated", incident })], ctx);
  assert.equal(telegram.seen.length, 1);
  assert.equal(slack.seen.length, 1);

  await dispatcher.dispatch([change({ kind: "status_change" })], ctx);
  assert.equal(telegram.seen.length, 1, "only the incident is followed, not the provider");

  await dispatcher.dispatch([change({ kind: "incident_resolved", incident, currentStatus: "operational" })], ctx);
  assert.equal(telegram.seen.length, 2, "the resolution is the last update it carries");
  assert.equal(followed.size, 0, "and the follow ends with it");

  await dispatcher.dispatch([change({ kind: "incident_updated", incident })], ctx);
  assert.equal(telegram.seen.length, 2);
});

test("a follow lookup that throws still delivers the change by the normal rules", async () => {
  const telegram = recorder("telegram");
  const dispatcher = createDispatcher({
    logger: silent,
    follows: {
      isFollowed: async () => {
        throw new Error("database is locked");
      },
      unfollow: async () => {},
    },
  });
  await dispatcher.dispatch([change({ kind: "incident_opened", incident })], {
    services,
    locale: "en",
    notifiers: [telegram.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });
  assert.equal(telegram.seen.length, 1);
});

test("an unfollow that throws does not drop the resolution", async () => {
  const telegram = recorder("telegram");
  const dispatcher = createDispatcher({
    logger: silent,
    follows: {
      isFollowed: async () => true,
      unfollow: async () => {
        throw new Error("database is locked");
      },
    },
  });
  await dispatcher.dispatch([change({ kind: "incident_resolved", incident, currentStatus: "operational" })], {
    services,
    locale: "en",
    notifiers: [telegram.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });
  assert.equal(telegram.seen.length, 1);
});

test("quiet hours still hold a followed incident's update", async () => {
  const telegram = recorder("telegram");
  const dispatcher = createDispatcher({
    logger: silent,
    now: () => Date.parse("2026-08-19T02:00:00.000Z"),
    follows: { isFollowed: async () => true, unfollow: async () => {} },
  });
  await dispatcher.dispatch([change({ kind: "incident_updated", incident, currentStatus: "degraded" })], {
    services,
    locale: "en",
    notifiers: [telegram.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: {
      ...DELIVERY_DEFAULTS,
      quietHours: { enabled: true, start: "23:00", end: "07:00", timeZone: "UTC", minSeverity: "major_outage" },
    },
  });
  assert.equal(telegram.seen.length, 0);
});

// Roadmap 3.7: why a provider matters travels with every message about it.
test("a provider's impact and owner reach the payload", async () => {
  const channel = recorder("telegram");
  const dispatcher = createDispatcher({ logger: silent });
  await dispatcher.dispatch([change()], {
    services: [{ ...services[0]!, impact: "deploys blocked", owner: "@alice" }],
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });
  assert.equal(channel.seen[0]?.service.impact, "deploys blocked");
  assert.equal(channel.seen[0]?.service.owner, "@alice");
});

test("a message reference that cannot be saved does not resend a delivered message", async () => {
  const channel = editable("telegram");
  const refs: MessageRefStore = {
    ...refStore(),
    async saveRef() {
      throw new Error("database is locked");
    },
  };
  const sent: SentRecord[] = [];
  const dispatcher = createDispatcher({
    logger: silent,
    messageRefs: refs,
    sleep: async () => {},
    onSent: (record) => {
      sent.push(record);
    },
  });

  await dispatcher.dispatch([incidentChange("incident_opened")], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ updateInPlace: true }),
  });

  assert.equal(channel.sent.length, 1, "delivered once, not once per retry");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.ok, true);
});

test("a delivery that throws before it can try is logged and recorded, not dropped", async () => {
  const channel = editable("telegram");
  const refs: MessageRefStore = {
    ...refStore(),
    async getRef() {
      throw new Error("database is locked");
    },
  };
  const lines: string[] = [];
  const sent: SentRecord[] = [];
  const dispatcher = createDispatcher({
    logger: createLogger("error", (line) => lines.push(line)),
    messageRefs: refs,
    sleep: async () => {},
    onSent: (record) => {
      sent.push(record);
    },
  });

  const records = await dispatcher.dispatch([incidentChange("incident_updated", "identified")], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ updateInPlace: true }),
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.ok, false);
  assert.equal(records[0]?.channel, "telegram");
  assert.equal(sent.filter((record) => !record.ok && record.channel === "telegram").length, 1);
  assert.ok(lines.some((line) => line.includes('"level":"error"')), "an error line was logged");
});

test("a periodic report goes to its own channel only, through quiet hours, the cap and the digest", async () => {
  const chosen = recorder("slack");
  const other = recorder("telegram");
  const dispatcher = createDispatcher({ logger: silent });
  const report: StatusChange = {
    kind: "periodic_report",
    providerId: "github",
    currentStatus: "unknown",
    report: { frequency: "weekly", from: "2026-10-12", to: "2026-10-18", fleetUptime: 99, incidentCount: 1, worst: [], sla: [] },
    at: "2026-10-19T00:05:00.000Z",
  };

  const records = await dispatcher.dispatch([report], {
    services,
    locale: "en",
    notifiers: [other.notifier, chosen.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({
      report: { enabled: true, frequency: "weekly", channel: "slack" },
      quietHours: { enabled: true, start: "00:00", end: "23:59", timeZone: "UTC", minSeverity: "major_outage" },
      cap: { enabled: true, maxPerHour: 1 },
      digest: { enabled: true, windowMinutes: 15, immediateFloor: "major_outage" },
    }),
  });

  assert.equal(chosen.seen.length, 1);
  assert.equal(chosen.seen[0]?.digest, undefined, "never batched");
  assert.deepEqual(other.seen, [], "the rules did not widen it");
  assert.equal(records.length, 1);
});

test("a report whose channel is not enabled is dropped with a warning, not sent elsewhere", async () => {
  const other = recorder("telegram");
  const lines: string[] = [];
  const dispatcher = createDispatcher({ logger: createLogger("warn", (line) => lines.push(line)) });

  const records = await dispatcher.dispatch(
    [{ kind: "periodic_report", providerId: "github", currentStatus: "unknown", at: "2026-10-19T00:05:00.000Z" }],
    {
      services,
      locale: "en",
      notifiers: [other.notifier],
      rules: [CATCH_ALL_RULE],
      knownChannelIds: KNOWN,
      delivery: delivery({ report: { enabled: true, frequency: "weekly", channel: "slack" } }),
    },
  );

  assert.deepEqual(other.seen, []);
  assert.deepEqual(records, []);
  assert.ok(lines.some((line) => line.includes("channel is not enabled")), lines.join("\n"));
});

test("a chart is drawn once per change, for provider-state changes only, and a failure costs the picture not the alert", async () => {
  const telegram = recorder("telegram");
  const slack = recorder("slack");
  const drawn: string[] = [];
  const dispatcher = createDispatcher({
    logger: silent,
    charts: {
      async uptimeBar(providerId, name) {
        drawn.push(`${providerId}:${name}`);
        return "<svg/>";
      },
    },
  });
  const ctx = {
    services,
    locale: "en",
    notifiers: [telegram.notifier, slack.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ attachChart: true }),
  };

  await dispatcher.dispatch([change(), change({ kind: "maintenance_started", currentStatus: "operational" })], ctx);

  assert.deepEqual(drawn, ["github:GitHub"], "once, though two channels took it, and not for a maintenance notice");
  assert.deepEqual(telegram.seen[0]?.chart, { svg: "<svg/>", filename: "github-uptime-24h.svg" });
  assert.equal(telegram.seen[1]?.chart, undefined);

  const broken = createDispatcher({
    logger: silent,
    charts: {
      async uptimeBar() {
        throw new Error("history unreadable");
      },
    },
  });
  const after = recorder("telegram");
  const records = await broken.dispatch([change()], { ...ctx, notifiers: [after.notifier] });
  assert.equal(records[0]?.ok, true);
  assert.equal(after.seen[0]?.chart, undefined);
});

test("without the option, or in an edition that cannot draw one, no chart is attached", async () => {
  const channel = recorder("telegram");
  let asked = 0;
  const charts = {
    async uptimeBar() {
      asked += 1;
      return "<svg/>";
    },
  };
  const base = { services, locale: "en", notifiers: [channel.notifier], rules: [CATCH_ALL_RULE], knownChannelIds: KNOWN };

  await createDispatcher({ logger: silent, charts }).dispatch([change()], { ...base, delivery: delivery() });
  await createDispatcher({ logger: silent }).dispatch([change()], { ...base, delivery: delivery({ attachChart: true }) });

  assert.equal(asked, 0);
  assert.ok(channel.seen.every((payload) => payload.chart === undefined));
});

const updated = (note: string, over: Partial<StatusChange> = {}): StatusChange =>
  change({
    kind: "incident_updated",
    currentStatus: "degraded",
    incident: { ...incident, status: note },
    ...over,
  });

function coalescing(windowMinutes = 2): {
  channel: ReturnType<typeof recorder>;
  clock: ReturnType<typeof fakeClock>;
  dispatcher: ReturnType<typeof createDispatcher>;
  ctx: Parameters<ReturnType<typeof createDispatcher>["dispatch"]>[1];
} {
  const channel = recorder("telegram");
  const clock = fakeClock();
  return {
    channel,
    clock,
    dispatcher: createDispatcher({ logger: silent, now: clock.now }),
    ctx: {
      services,
      locale: "en",
      notifiers: [channel.notifier],
      rules: [CATCH_ALL_RULE],
      knownChannelIds: KNOWN,
      delivery: delivery({ coalesce: { enabled: true, windowMinutes } }),
    },
  };
}

test("coalescing sends only the last of several updates once the window has passed", async () => {
  const { channel, clock, dispatcher, ctx } = coalescing();

  await dispatcher.dispatch([updated("investigating")], ctx);
  clock.advance(30_000);
  await dispatcher.dispatch([updated("identified")], ctx);
  clock.advance(30_000);
  await dispatcher.dispatch([updated("monitoring")], ctx);
  assert.deepEqual(channel.seen, [], "nothing goes out while updates keep arriving inside the window");

  clock.advance(90_000);
  const records = await dispatcher.dispatch([], ctx);

  assert.equal(records.length, 1);
  assert.equal(channel.seen.length, 1);
  assert.equal(channel.seen[0]?.change.incident?.status, "monitoring");
});

test("coalescing does not wait forever on a provider that updates every minute", async () => {
  const { channel, clock, dispatcher, ctx } = coalescing();

  for (const note of ["a", "b", "c"]) {
    await dispatcher.dispatch([updated(note)], ctx);
    clock.advance(60_000);
  }
  // The window opened by "a" ran out as "c" arrived: the latest state it had
  // seen goes out, and "c" starts the next window rather than extending the old.
  assert.equal(channel.seen.length, 1, "released from the first update's clock, not the last");
  assert.equal(channel.seen[0]?.change.incident?.status, "b");
});

test("coalescing keeps incidents apart and never holds an opening or a resolution", async () => {
  const { channel, dispatcher, ctx } = coalescing();
  const other = { ...incident, id: "i2" };

  await dispatcher.dispatch(
    [
      change({ kind: "incident_opened", incident }),
      updated("identified"),
      updated("identified", { incident: { ...other, status: "identified" } }),
    ],
    ctx,
  );

  assert.equal(channel.seen.length, 1, "only the opening goes out at once");
  assert.equal(channel.seen[0]?.change.kind, "incident_opened");
});

test("a resolution cancels the update still waiting, so it cannot arrive after it", async () => {
  const { channel, clock, dispatcher, ctx } = coalescing();

  await dispatcher.dispatch([updated("monitoring")], ctx);
  await dispatcher.dispatch(
    [change({ kind: "incident_resolved", currentStatus: "operational", incident: { ...incident, status: "resolved" } })],
    ctx,
  );
  clock.advance(10 * 60_000);
  await dispatcher.dispatch([], ctx);

  assert.deepEqual(channel.seen.map((payload) => payload.change.kind), ["incident_resolved"]);
});

test("switching coalescing off releases what was waiting instead of stranding it", async () => {
  const { channel, dispatcher, ctx } = coalescing();

  await dispatcher.dispatch([updated("investigating")], ctx);
  await dispatcher.dispatch([], { ...ctx, delivery: delivery() });

  assert.equal(channel.seen.length, 1);
});

test("without the policy every update is sent as it arrives", async () => {
  const channel = recorder("telegram");
  const dispatcher = createDispatcher({ logger: silent });

  await dispatcher.dispatch([updated("a"), updated("b")], {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
  });

  assert.equal(channel.seen.length, 2);
});

test("a known outage sends further updates to the digest and lets a resolution through", async () => {
  const channel = recorder("telegram");
  const clock = fakeClock();
  const dispatcher = createDispatcher({ logger: silent, now: clock.now });
  const ctx = {
    services,
    locale: "en",
    notifiers: [channel.notifier],
    rules: [CATCH_ALL_RULE],
    knownChannelIds: KNOWN,
    delivery: delivery({ knownOutage: { enabled: true } }),
  };
  const outage = { currentStatus: "major_outage" as const };

  await dispatcher.dispatch([updated("identified", outage), updated("monitoring", outage)], ctx);
  assert.deepEqual(channel.seen, [], "updates of a known major outage do not interrupt");

  await dispatcher.dispatch(
    [change({ kind: "incident_resolved", currentStatus: "operational", incident: { ...incident, status: "resolved" } })],
    ctx,
  );
  assert.equal(channel.seen.length, 1, "the resolution interrupts");
  assert.equal(channel.seen[0]?.change.kind, "incident_resolved");

  clock.advance(16 * 60_000);
  await dispatcher.dispatch([], ctx);
  assert.equal(channel.seen.length, 2, "the held updates arrive as one digest");
  assert.equal(channel.seen[1]?.digest?.items.length, 2);
});

test("a known outage still interrupts for an update below major, and for a change of status", async () => {
  const channel = recorder("telegram");
  const dispatcher = createDispatcher({ logger: silent });

  await dispatcher.dispatch(
    [updated("identified", { currentStatus: "partial_outage" }), change({ currentStatus: "major_outage", previousStatus: "partial_outage" })],
    {
      services,
      locale: "en",
      notifiers: [channel.notifier],
      rules: [CATCH_ALL_RULE],
      knownChannelIds: KNOWN,
      delivery: delivery({ knownOutage: { enabled: true } }),
    },
  );

  assert.equal(channel.seen.length, 2);
});
