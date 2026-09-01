import { test } from "node:test";
import assert from "node:assert/strict";
import { createScheduler } from "../../src/core/scheduler.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { CycleResult, Poller } from "../../src/core/poller.ts";
import type { ChannelConfig, ConfigSource, RuntimeConfig } from "../../src/core/configSource.interface.ts";
import type { Dispatcher, SentRecord } from "../../src/core/notificationDispatcher.ts";
import type { StatusChange } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});

const baseConfig = (over: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  polling: { intervalMinutes: 3, requestTimeoutSeconds: 8, maxRetries: 3, failureThreshold: 5 },
  locale: "en",
  services: [
    {
      id: "github",
      name: "GitHub",
      adapter: "statuspage",
      baseUrl: "https://www.githubstatus.com",
      enabled: true,
    },
  ],
  channels: [],
  ...over,
});

const cycleResult = (changes: StatusChange[] = []): CycleResult => ({
  changes,
  results: [],
  startedAt: "2026-08-19T14:00:00.000Z",
  finishedAt: "2026-08-19T14:00:01.000Z",
});

function fakeConfigSource(config: RuntimeConfig = baseConfig()): ConfigSource & { loads: number; current: RuntimeConfig } {
  const source = {
    loads: 0,
    current: config,
    async load(): Promise<RuntimeConfig> {
      source.loads += 1;
      return source.current;
    },
  };
  return source;
}

function fakePoller(behaviour: () => Promise<CycleResult> = async () => cycleResult()): Poller & { calls: number } {
  const poller = {
    calls: 0,
    async runCycle(): Promise<CycleResult> {
      poller.calls += 1;
      return behaviour();
    },
  };
  return poller;
}

function fakeDispatcher(): Dispatcher & { batches: StatusChange[][]; locales: string[] } {
  const dispatcher = {
    batches: [] as StatusChange[][],
    locales: [] as string[],
    async dispatch(changes: StatusChange[], ctx: { locale: string }): Promise<SentRecord[]> {
      dispatcher.batches.push(changes);
      dispatcher.locales.push(ctx.locale);
      return [];
    },
  };
  return dispatcher;
}

/** Jitter is injected so the arming interval is exact in tests. */
const noJitter = (): number => 0.5;

test("start runs one cycle immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const poller = fakePoller();
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  assert.equal(poller.calls, 1);
  scheduler.stop();
});

test("the next cycle fires one interval later", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const poller = fakePoller();
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  t.mock.timers.tick(3 * 60_000 - 1);
  await Promise.resolve();
  assert.equal(poller.calls, 1, "must not fire early");

  t.mock.timers.tick(1);
  await scheduler.settled();
  assert.equal(poller.calls, 2);
  scheduler.stop();
});

test("the configuration is re-read on every cycle, so a changed interval applies without a restart", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const source = fakeConfigSource();
  const poller = fakePoller();
  const scheduler = createScheduler({
    configSource: source,
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  assert.equal(source.loads, 1);

  source.current = baseConfig({
    polling: { intervalMinutes: 1, requestTimeoutSeconds: 8, maxRetries: 3, failureThreshold: 5 },
  });
  t.mock.timers.tick(3 * 60_000);
  await scheduler.settled();
  assert.equal(source.loads, 2);

  // The new one-minute interval was read on that cycle and governs the next arming.
  t.mock.timers.tick(60_000);
  await scheduler.settled();
  assert.equal(poller.calls, 3);
  scheduler.stop();
});

test("the cycle's changes are handed to the dispatcher with the active locale", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const change: StatusChange = {
    kind: "status_change",
    providerId: "github",
    previousStatus: "operational",
    currentStatus: "degraded",
    at: "2026-08-19T14:00:00.000Z",
  };
  const dispatcher = fakeDispatcher();
  const scheduler = createScheduler({
    configSource: fakeConfigSource(baseConfig({ locale: "it" })),
    poller: fakePoller(async () => cycleResult([change])),
    dispatcher,
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  assert.deepEqual(dispatcher.batches, [[change]]);
  assert.deepEqual(dispatcher.locales, ["it"]);
  scheduler.stop();
});

test("a cycle with no changes still runs but dispatches nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const dispatcher = fakeDispatcher();
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller: fakePoller(),
    dispatcher,
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  assert.deepEqual(dispatcher.batches, [[]]);
  scheduler.stop();
});

test("triggerNow joins an in-flight cycle instead of starting a second one", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const poller = fakePoller(async () => {
    await gate;
    return cycleResult();
  });
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  const first = scheduler.start();
  const joined = scheduler.triggerNow();
  release?.();
  await first;
  const result = await joined;

  assert.equal(poller.calls, 1, "a manual poll must not duplicate a running cycle");
  assert.equal(result.startedAt, "2026-08-19T14:00:00.000Z");
  scheduler.stop();
});

test("triggerNow outside a cycle runs one on demand", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const poller = fakePoller();
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  await scheduler.triggerNow();
  assert.equal(poller.calls, 2);
  scheduler.stop();
});

test("a cycle that throws is logged and the loop keeps running", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: string[] = [];
  let attempts = 0;
  const poller = fakePoller(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("the whole cycle exploded");
    return cycleResult();
  });
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: createLogger("error", (line) => errors.push(line)),
    random: noJitter,
  });

  await scheduler.start();
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /exploded/);

  t.mock.timers.tick(3 * 60_000);
  await scheduler.settled();
  assert.equal(poller.calls, 2, "one bad cycle must not kill the service");
  scheduler.stop();
});

test("a config source that throws does not kill the loop either", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const errors: string[] = [];
  let loads = 0;
  const scheduler = createScheduler({
    configSource: {
      async load(): Promise<RuntimeConfig> {
        loads += 1;
        if (loads === 1) throw new Error("the database is locked");
        return baseConfig();
      },
    },
    poller: fakePoller(),
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: createLogger("error", (line) => errors.push(line)),
    random: noJitter,
  });

  await scheduler.start();
  assert.match(errors[0] ?? "", /locked/);
  t.mock.timers.tick(3 * 60_000);
  await scheduler.settled();
  assert.equal(loads, 2);
  scheduler.stop();
});

test("stop prevents any further cycle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const poller = fakePoller();
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  scheduler.stop();
  t.mock.timers.tick(10 * 60_000);
  await Promise.resolve();
  assert.equal(poller.calls, 1);
});

test("jitter keeps the arming delay within ten percent of the interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const interval = 3 * 60_000;
  for (const [random, expected] of [
    [() => 0, interval * 0.9],
    [() => 1, interval * 1.1],
  ] as const) {
    const poller = fakePoller();
    const scheduler = createScheduler({
      configSource: fakeConfigSource(),
      poller,
      dispatcher: fakeDispatcher(),
      buildNotifiers: () => [],
      logger: silent,
      random,
    });
    await scheduler.start();
    t.mock.timers.tick(expected - 1);
    await Promise.resolve();
    assert.equal(poller.calls, 1, `must not fire before ${expected}ms`);
    t.mock.timers.tick(1);
    await scheduler.settled();
    assert.equal(poller.calls, 2, `must fire at ${expected}ms`);
    scheduler.stop();
  }
});

test("onCycle receives every cycle result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen: CycleResult[] = [];
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller: fakePoller(),
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
    onCycle: (result) => {
      seen.push(result);
    },
  });

  await scheduler.start();
  t.mock.timers.tick(3 * 60_000);
  await scheduler.settled();
  assert.equal(seen.length, 2);
  scheduler.stop();
});

test("notifiers are rebuilt from the channels of each cycle, so enabling one needs no restart", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const source = fakeConfigSource();
  const seen: ChannelConfig[][] = [];
  const dispatcher = fakeDispatcher();
  const scheduler = createScheduler({
    configSource: source,
    poller: fakePoller(),
    dispatcher,
    buildNotifiers: (channels) => {
      seen.push(channels);
      return [];
    },
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  assert.deepEqual(seen, [[]]);

  source.current = baseConfig({
    channels: [{ id: "webhook", enabled: true, settings: { url: "https://hooks.example/x" } }],
  });
  t.mock.timers.tick(3 * 60_000);
  await scheduler.settled();

  assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], [
    { id: "webhook", enabled: true, settings: { url: "https://hooks.example/x" } },
  ]);
  scheduler.stop();
});

test("two sequential manual polls each run a cycle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const poller = fakePoller();
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.triggerNow();
  await scheduler.triggerNow();
  await scheduler.triggerNow();
  assert.equal(poller.calls, 3, "a finished cycle must not be handed back to the next caller");
  scheduler.stop();
});

// The dashboard's countdown is drawn from the scheduler's armed deadline. It
// used to be guessed by the HTTP layer as `lastCycle.finishedAt + interval`,
// which is wrong whenever the real timer lands later than that guess — the
// countdown then parks at "0s" until the cycle actually finishes. The four
// tests below pin the deadline to the timer that will really fire.

test("nextRunAt is null before a cycle has armed anything", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller: fakePoller(),
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  assert.equal(scheduler.nextRunAt(), null, "nothing is armed, so there is no deadline to show");
  scheduler.stop();
});

test("nextRunAt reports the armed deadline with the jitter that was actually drawn", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller: fakePoller(),
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    // The longest draw: interval * 1.1, eighteen seconds beyond a plain interval.
    random: () => 1,
  });

  await scheduler.start();
  assert.equal(
    scheduler.nextRunAt(),
    new Date(3 * 60_000 * 1.1).toISOString(),
    "a countdown built from a plain interval would hit zero eighteen seconds early",
  );
  scheduler.stop();
});

test("nextRunAt is null once stopped, because no cycle is coming", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller: fakePoller(),
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  assert.notEqual(scheduler.nextRunAt(), null);
  scheduler.stop();
  assert.equal(scheduler.nextRunAt(), null);
});

test("a manual poll re-arms, so the next automatic cycle is a full interval after it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const poller = fakePoller();
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random: noJitter,
  });

  await scheduler.start();
  t.mock.timers.tick(60_000);
  await scheduler.triggerNow();

  t.mock.timers.tick(3 * 60_000 - 1);
  await scheduler.settled();
  assert.equal(poller.calls, 2, "the timer armed before the manual poll must not still be standing");

  t.mock.timers.tick(1);
  await scheduler.settled();
  assert.equal(poller.calls, 3, "the interval restarts from the manual poll");
  scheduler.stop();
});

test("no cycle runs before the deadline the dashboard is counting down to", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Each arm() draws once. A fixed draw hides a leaked timer, because both
  // copies then land on the same millisecond and the second joins the first.
  const draws = [0.5, 0, 1];
  let drawn = 0;
  const random = (): number => draws[drawn++] ?? 0.5;

  let release: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  const poller = fakePoller(async () => {
    if (gate !== undefined) await gate;
    return cycleResult();
  });
  const scheduler = createScheduler({
    configSource: fakeConfigSource(),
    poller,
    dispatcher: fakeDispatcher(),
    buildNotifiers: () => [],
    logger: silent,
    random,
  });

  await scheduler.start();

  // The manual poll opens the cycle, so its continuation is first in line; the
  // scheduled tick that lands mid-cycle joins behind it and arms again after
  // the manual poll already did. An arm that does not clear the standing timer
  // leaves both alive, and the earlier of the two polls before the countdown
  // the operator is watching has run out.
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const manual = scheduler.triggerNow();
  t.mock.timers.tick(3 * 60_000);
  release?.();
  await manual;
  await scheduler.settled();
  gate = undefined;
  assert.equal(poller.calls, 2, "the tick must join the manual cycle rather than run a second one");

  const deadline = Date.parse(scheduler.nextRunAt() ?? "");
  t.mock.timers.tick(deadline - Date.now() - 1);
  await scheduler.settled();
  assert.equal(poller.calls, 2, "a poll before the published deadline means a second timer is still armed");

  t.mock.timers.tick(1);
  await scheduler.settled();
  assert.equal(poller.calls, 3);
  scheduler.stop();
});
