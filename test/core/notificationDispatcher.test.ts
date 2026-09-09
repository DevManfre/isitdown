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
