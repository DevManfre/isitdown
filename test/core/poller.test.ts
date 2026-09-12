import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPoller, looksLikeOurOwnNetwork, staggerOffsetMs, type ProviderResult } from "../../src/core/poller.ts";
import { createLogger } from "../../src/core/logger.ts";
import { getAdapter } from "../../src/adapters/index.ts";
import { createFileStateStore } from "../../src/light/fileStateStore.ts";
import type { RuntimeConfig, ServiceDefinition } from "../../src/core/configSource.interface.ts";
import type { StateStore } from "../../src/core/stateStore.interface.ts";
import type { ServiceRef } from "../../src/core/adapter.interface.ts";
import { CATCH_ALL_RULE } from "../../src/core/routing.ts";

const silent = createLogger("error", () => {});

async function freshStore(): Promise<StateStore> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-poller-"));
  return createFileStateStore(join(dir, "state.json"));
}

interface Fake {
  baseUrl: string;
  hits: string[];
  close: () => Promise<void>;
}

async function fakeProvider(
  handler: (req: IncomingMessage, res: ServerResponse, hits: string[]) => void,
): Promise<Fake> {
  const hits: string[] = [];
  const server: Server = createServer((req, res) => {
    hits.push(req.url ?? "");
    handler(req, res, hits);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const summary = (indicator: string, incidents: unknown[] = []): string =>
  JSON.stringify({ status: { indicator }, incidents });

const service = (id: string, baseUrl: string, over: Partial<ServiceDefinition> = {}): ServiceDefinition => ({
  id,
  name: id,
  adapter: "statuspage",
  baseUrl,
  enabled: true,
  components: [],
  ...over,
});

const config = (services: ServiceDefinition[], over: Partial<RuntimeConfig["polling"]> = {}): RuntimeConfig => ({
  polling: {
    intervalMinutes: 3,
    requestTimeoutSeconds: 2,
    maxRetries: 3,
    failureThreshold: 5,
    adaptivePolling: true,
    adaptiveIntervalMinutes: 1,
    confirmSamples: 1,
    ...over,
  },
  locale: "en",
  services,
  channels: [],
  rules: [CATCH_ALL_RULE],
});

/**
 * A clock the test moves itself.
 *
 * The poller holds a provider back until its cadence has elapsed — the global
 * one when the provider named none — so a test that runs two cycles has to
 * advance time the way the scheduler's own tick does between them.
 */
function fakeClock(start = Date.parse("2026-09-01T10:00:00.000Z")): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

/** One global cadence, the amount a test advances by between two cycles. */
const ONE_INTERVAL_MS = 3 * 60_000;

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

test("a first cycle stores the status and reports no change", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    const cycle = await poller.runCycle(config([service("github", provider.baseUrl)]));
    assert.deepEqual(cycle.changes, [], "a baseline must never notify");
    assert.equal(cycle.results.length, 1);
    assert.equal(cycle.results[0]?.ok, true);
    assert.equal(cycle.results[0]?.attempts, 1);
    assert.equal((await store.getState("github")).last?.overallStatus, "operational");
    assert.ok(Date.parse(cycle.startedAt) <= Date.parse(cycle.finishedAt));
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a second cycle over a changed provider reports exactly one status change", async () => {
  let indicator = "none";
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary(indicator));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep, now: clock.now });
  const cfg = config([service("github", provider.baseUrl)]);

  try {
    await poller.runCycle(cfg);
    indicator = "critical";
    clock.advance(ONE_INTERVAL_MS);
    const cycle = await poller.runCycle(cfg);
    assert.deepEqual(
      cycle.changes.map((change) => change.kind),
      ["status_change"],
    );
    assert.equal(cycle.changes[0]?.previousStatus, "operational");
    assert.equal(cycle.changes[0]?.currentStatus, "major_outage");
  } finally {
    await store.close();
    await provider.close();
  }
});

test("an unchanged second cycle reports nothing", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("minor", [{ id: "i1", status: "investigating", impact: "minor", name: "x", updated_at: "2026-08-19T14:00:00.000Z" }]));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep, now: clock.now });
  const cfg = config([service("github", provider.baseUrl)]);

  try {
    await poller.runCycle(cfg);
    clock.advance(ONE_INTERVAL_MS);
    const cycle = await poller.runCycle(cfg);
    assert.deepEqual(cycle.changes, []);
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a failing provider is retried exactly maxRetries times with growing backoff", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    const cycle = await poller.runCycle(config([service("github", provider.baseUrl)], { maxRetries: 3 }));
    assert.equal(provider.hits.length, 3, "three attempts, not more and not fewer");
    assert.equal(cycle.results[0]?.ok, false);
    assert.equal(cycle.results[0]?.attempts, 3);
    assert.match(cycle.results[0]?.error ?? "", /500/);
    // One stagger delay for the single provider, then a backoff between attempts.
    const backoffs = timer.delays.slice(1);
    assert.equal(backoffs.length, 2, `expected two backoffs, got ${JSON.stringify(timer.delays)}`);
    assert.ok((backoffs[1] ?? 0) > (backoffs[0] ?? 0), "backoff must grow across attempts");
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a failed cycle leaves the last known status untouched", async () => {
  let healthy = true;
  const provider = await fakeProvider((_req, res) => {
    if (!healthy) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("minor"));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep, now: clock.now });
  const cfg = config([service("github", provider.baseUrl)], { maxRetries: 1 });

  try {
    await poller.runCycle(cfg);
    healthy = false;
    clock.advance(ONE_INTERVAL_MS);
    const cycle = await poller.runCycle(cfg);
    assert.deepEqual(cycle.changes, [], "a fetch failure is never a status transition");
    assert.equal((await store.getState("github")).last?.overallStatus, "degraded");
    assert.equal((await store.getState("github")).failureCount, 1);
  } finally {
    await store.close();
    await provider.close();
  }
});

test("one hanging provider does not stop a healthy one", async () => {
  const hanging = await fakeProvider(() => {
    /* never responds */
  });
  const healthy = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    const cycle = await poller.runCycle(
      config([service("slow", hanging.baseUrl), service("fast", healthy.baseUrl)], {
        requestTimeoutSeconds: 1,
        maxRetries: 1,
      }),
    );
    const byId = new Map(cycle.results.map((result) => [result.providerId, result]));
    assert.equal(byId.get("fast")?.ok, true);
    assert.equal(byId.get("slow")?.ok, false);
    assert.equal((await store.getState("fast")).last?.overallStatus, "operational");
  } finally {
    await store.close();
    await hanging.close();
    await healthy.close();
  }
});

test("an unknown adapter fails only its own provider", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    const cycle = await poller.runCycle(
      config([
        service("broken", provider.baseUrl, { adapter: "carrier-pigeon" }),
        service("github", provider.baseUrl),
      ]),
    );
    const byId = new Map(cycle.results.map((result) => [result.providerId, result]));
    assert.equal(byId.get("broken")?.ok, false);
    assert.match(byId.get("broken")?.error ?? "", /carrier-pigeon/);
    assert.equal(byId.get("github")?.ok, true);
  } finally {
    await store.close();
    await provider.close();
  }
});

test("the monitoring warning fires once at the threshold, not before and not again", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(500);
    res.end();
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep, now: clock.now });
  const cfg = config([service("github", provider.baseUrl)], { maxRetries: 1, failureThreshold: 3 });
  /** One cycle a cadence apart, the way the scheduler's tick delivers them. */
  const nextCycle = async () => {
    clock.advance(ONE_INTERVAL_MS);
    return poller.runCycle(cfg);
  };

  try {
    assert.deepEqual((await poller.runCycle(cfg)).changes, [], "no warning on the first failure");
    assert.deepEqual((await nextCycle()).changes, [], "no warning below the threshold");

    const atThreshold = await nextCycle();
    assert.deepEqual(
      atThreshold.changes.map((change) => change.kind),
      ["monitoring_degraded"],
    );
    assert.equal(atThreshold.changes[0]?.failureCount, 3);

    assert.deepEqual((await nextCycle()).changes, [], "the warning must not repeat every cycle");
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a recovery clears the warning so a later streak can warn again", async () => {
  let healthy = false;
  const provider = await fakeProvider((_req, res) => {
    if (healthy) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(summary("none"));
      return;
    }
    res.writeHead(500);
    res.end();
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep, now: clock.now });
  const cfg = config([service("github", provider.baseUrl)], { maxRetries: 1, failureThreshold: 2 });
  const nextCycle = async () => {
    clock.advance(ONE_INTERVAL_MS);
    return poller.runCycle(cfg);
  };

  try {
    await poller.runCycle(cfg);
    assert.equal((await nextCycle()).changes.length, 1);

    healthy = true;
    await nextCycle();
    assert.equal((await store.getState("github")).degradedNotified, false);
    assert.equal((await store.getState("github")).failureCount, 0);

    healthy = false;
    await nextCycle();
    const warnsAgain = await nextCycle();
    assert.deepEqual(
      warnsAgain.changes.map((change) => change.kind),
      ["monitoring_degraded"],
    );
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a disabled service is never requested", async () => {
  const enabled = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const disabled = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    const cycle = await poller.runCycle(
      config([
        service("on", enabled.baseUrl),
        service("off", disabled.baseUrl, { enabled: false }),
      ]),
    );
    assert.equal(disabled.hits.length, 0);
    assert.equal(enabled.hits.length, 1);
    assert.deepEqual(
      cycle.results.map((result) => result.providerId),
      ["on"],
    );
  } finally {
    await store.close();
    await enabled.close();
    await disabled.close();
  }
});

test("providers are staggered rather than fired at the same instant", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    await poller.runCycle(
      config([
        service("a", provider.baseUrl),
        service("b", provider.baseUrl),
        service("c", provider.baseUrl),
      ]),
    );
    // One stagger per provider, each its own offset inside the cadence, and no
    // two of them the same instant.
    assert.deepEqual(
      [...timer.delays].sort((a, b) => a - b),
      ["a", "b", "c"].map((id) => staggerOffsetMs(id, 3)).sort((a, b) => a - b),
    );
    assert.equal(new Set(timer.delays).size, 3);
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a provider's offset is anchored on its id, not on its place in the list", () => {
  // The point of the anchor: an operator adding a provider must not move every
  // other provider's request to a different moment of the cadence.
  const before = ["github", "cloudflare", "anthropic"].map((id) => staggerOffsetMs(id, 3));
  const after = ["anthropic", "slack", "github", "cloudflare"]
    .filter((id) => id !== "slack")
    .map((id) => staggerOffsetMs(id, 3));
  assert.deepEqual(after, [before[2], before[0], before[1]]);
});

test("the stagger stays inside a tenth of the cadence, and inside its ceiling", () => {
  for (const id of ["a", "github", "a-very-long-provider-id", "zz"]) {
    assert.ok(staggerOffsetMs(id, 3) < 18_000, `${id} at a 3 minute cadence`);
    // A day-long cadence would otherwise spread requests over two hours, which
    // is a cycle that never seems to finish.
    assert.ok(staggerOffsetMs(id, 1440) < 20_001, `${id} at a daily cadence`);
  }
});

test("a manual poll is not staggered: the operator is watching", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    await poller.runCycle(config([service("a", provider.baseUrl), service("b", provider.baseUrl)]), {
      ignoreSchedule: true,
    });
    assert.deepEqual(timer.delays, []);
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a provider answering 429 is left alone for the window it stated", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(429, { "retry-after": "900" });
    res.end("slow down");
  });
  const store = await freshStore();
  const clock = fakeClock();
  const timer = fakeSleep();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: timer.sleep,
    now: clock.now,
  });

  try {
    const first = await poller.runCycle(config([service("a", provider.baseUrl)]));
    assert.equal(first.results[0]?.ok, false);
    // One attempt, not three: retrying inside a window the provider just
    // stated is three more requests it already refused.
    assert.equal(provider.hits.length, 1);

    clock.advance(ONE_INTERVAL_MS);
    const second = await poller.runCycle(config([service("a", provider.baseUrl)]));
    assert.deepEqual(second.results, [], "the provider is still inside its stated window");
    assert.equal(provider.hits.length, 1);

    clock.advance(15 * 60_000);
    await poller.runCycle(config([service("a", provider.baseUrl)]));
    assert.equal(provider.hits.length, 2, "the window has passed, so it is asked again");
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a 429 that states no window is still held off, for a default one", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(429, {});
    res.end("no");
  });
  const store = await freshStore();
  const clock = fakeClock();
  const timer = fakeSleep();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: timer.sleep,
    now: clock.now,
  });

  try {
    // A one-minute cadence, so the default hold is the only thing that can be
    // keeping the provider out of the cycle below.
    const services = [service("a", provider.baseUrl, { intervalMinutes: 1 })];
    await poller.runCycle(config(services));
    clock.advance(55_000);
    assert.deepEqual((await poller.runCycle(config(services))).results, []);
    clock.advance(10_000);
    assert.equal((await poller.runCycle(config(services))).results.length, 1);
  } finally {
    await store.close();
    await provider.close();
  }
});

test("one provider's hold is its own: the rest of the fleet is polled", async () => {
  const limited = await fakeProvider((_req, res) => {
    res.writeHead(429, { "retry-after": "600" });
    res.end("no");
  });
  const healthy = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const clock = fakeClock();
  const timer = fakeSleep();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: timer.sleep,
    now: clock.now,
  });

  try {
    const services = [service("limited", limited.baseUrl), service("healthy", healthy.baseUrl)];
    await poller.runCycle(config(services));
    clock.advance(ONE_INTERVAL_MS);
    const second = await poller.runCycle(config(services));
    assert.deepEqual(
      second.results.map((result) => result.providerId),
      ["healthy"],
      "the rate-limited provider sits the cycle out, the other does not",
    );
  } finally {
    await store.close();
    await limited.close();
    await healthy.close();
  }
});

test("a manual poll asks a held provider anyway: the operator overrode the schedule", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(429, { "retry-after": "600" });
    res.end("slow down");
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    await poller.runCycle(config([service("a", provider.baseUrl)]));
    await poller.runCycle(config([service("a", provider.baseUrl)]), { ignoreSchedule: true });
    assert.equal(provider.hits.length, 2);
  } finally {
    await store.close();
    await provider.close();
  }
});

test("an incident opening and the status moving are reported as separate changes", async () => {
  let body = summary("none");
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep, now: clock.now });
  const cfg = config([service("github", provider.baseUrl)]);

  try {
    await poller.runCycle(cfg);
    clock.advance(ONE_INTERVAL_MS);
    body = summary("major", [
      { id: "i1", status: "investigating", impact: "major", name: "API down", updated_at: "2026-08-19T14:00:00.000Z" },
    ]);
    const cycle = await poller.runCycle(cfg);
    assert.deepEqual(
      cycle.changes.map((change) => change.kind),
      ["status_change", "incident_opened"],
    );
  } finally {
    await store.close();
    await provider.close();
  }
});

test("the poller hands the component selection to the adapter", async () => {
  let seen: ServiceRef | undefined;
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({
    getAdapter: () => ({
      id: "stub",
      fetchStatus: async (service) => {
        seen = service;
        return {
          provider: service.id,
          overallStatus: "operational",
          activeIncidents: [],
          components: [],
          fetchedAt: new Date().toISOString(),
        };
      },
    }),
    store,
    logger: silent,
    sleep: timer.sleep,
  });
  const cfg = config([
    service("github", "http://127.0.0.1:1", {
      adapter: "stub",
      components: [{ id: "c1", name: "Actions" }],
    }),
  ]);

  try {
    await poller.runCycle(cfg);
    assert.deepEqual(seen?.components, [{ id: "c1", name: "Actions" }]);
  } finally {
    await store.close();
  }
});

test("every result carries how long its fetch took, success or failure", async () => {
  const healthy = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const broken = await fakeProvider((_req, res) => {
    res.writeHead(500);
    res.end("nope");
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });

  try {
    const cycle = await poller.runCycle(
      config([service("github", healthy.baseUrl), service("broken", broken.baseUrl)]),
    );

    const ok = cycle.results.find((result) => result.providerId === "github");
    const failed = cycle.results.find((result) => result.providerId === "broken");
    assert.equal(ok?.ok, true);
    assert.equal(failed?.ok, false);
    for (const result of [ok, failed]) {
      assert.equal(typeof result?.durationMs, "number");
      assert.ok((result?.durationMs ?? -1) >= 0, "a duration is never negative");
      assert.ok(Number.isFinite(result?.durationMs), "a duration is always finite");
    }
  } finally {
    await store.close();
    await healthy.close();
    await broken.close();
  }
});

test("a provider with its own interval is left alone until that interval has elapsed", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  let clock = Date.parse("2026-09-01T10:00:00.000Z");
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: fakeSleep().sleep,
    now: () => clock,
  });
  // The global cadence is what the fast provider follows; the slow one has
  // asked for an hour.
  const services = [
    service("fast", provider.baseUrl),
    service("slow", provider.baseUrl, { intervalMinutes: 60 }),
  ];

  const first = await poller.runCycle(config(services, { intervalMinutes: 3 }));
  assert.deepEqual(
    first.results.map((result) => result.providerId).sort(),
    ["fast", "slow"],
    "a provider never polled before is due",
  );

  clock += 3 * 60_000;
  const second = await poller.runCycle(config(services, { intervalMinutes: 3 }));
  assert.deepEqual(
    second.results.map((result) => result.providerId),
    ["fast"],
    "the slow provider is not due three minutes in",
  );

  clock += 57 * 60_000;
  const third = await poller.runCycle(config(services, { intervalMinutes: 3 }));
  assert.deepEqual(
    third.results.map((result) => result.providerId).sort(),
    ["fast", "slow"],
    "an hour in, the slow provider is due again",
  );

  await provider.close();
});

test("a cycle asked to ignore the schedule polls every provider", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const clock = Date.parse("2026-09-01T10:00:00.000Z");
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: fakeSleep().sleep, now: () => clock });
  const services = [service("slow", provider.baseUrl, { intervalMinutes: 60 })];

  await poller.runCycle(config(services));
  // No time has passed at all, so only the manual override can explain a poll.
  const manual = await poller.runCycle(config(services), { ignoreSchedule: true });

  assert.deepEqual(
    manual.results.map((result) => result.providerId),
    ["slow"],
  );
  await provider.close();
});

test("the jitter the scheduler arms with never costs a due provider its cycle", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  let clock = Date.parse("2026-09-01T10:00:00.000Z");
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: fakeSleep().sleep,
    now: () => clock,
  });
  const services = [service("github", provider.baseUrl, { intervalMinutes: 10 })];

  await poller.runCycle(config(services, { intervalMinutes: 10 }));
  // The scheduler's arming jitter is up to a tenth of an interval either way,
  // so an early tick must still count as due — otherwise the provider silently
  // polls every second cycle.
  clock += Math.round(10 * 60_000 * 0.9);
  const early = await poller.runCycle(config(services, { intervalMinutes: 10 }));

  assert.deepEqual(
    early.results.map((result) => result.providerId),
    ["github"],
  );
  await provider.close();
});

test("the latency of the read behind a status reaches the store", async () => {
  const store = await freshStore();
  const saved: (number | undefined)[] = [];
  const timer = fakeSleep();
  // A stub adapter reports the read itself, the way every real one forwards
  // `onRead` to the conditional-fetch helper.
  const poller = createPoller({
    getAdapter: () => ({
      id: "stub",
      fetchStatus: async (service, ctx) => {
        ctx.onRead?.({ latencyMs: 42, notModified: false });
        return {
          provider: service.id,
          overallStatus: "operational",
          activeIncidents: [],
          components: [],
          fetchedAt: new Date().toISOString(),
        };
      },
    }),
    store: {
      ...store,
      saveStatus: async (status, meta) => {
        saved.push(meta?.latencyMs);
        await store.saveStatus(status, meta);
      },
    },
    logger: silent,
    sleep: timer.sleep,
  });

  try {
    await poller.runCycle(config([service("github", "http://127.0.0.1:1", { adapter: "stub" })]));
    assert.deepEqual(saved, [42]);
  } finally {
    await store.close();
  }
});

test("a read that measured nothing saves no latency rather than a zero", async () => {
  const store = await freshStore();
  const saved: (number | undefined)[] = [];
  const timer = fakeSleep();
  const poller = createPoller({
    getAdapter: () => ({
      id: "stub",
      fetchStatus: async (service) => ({
        provider: service.id,
        overallStatus: "operational",
        activeIncidents: [],
        components: [],
        fetchedAt: new Date().toISOString(),
      }),
    }),
    store: {
      ...store,
      saveStatus: async (status, meta) => {
        saved.push(meta?.latencyMs);
        await store.saveStatus(status, meta);
      },
    },
    logger: silent,
    sleep: timer.sleep,
  });

  try {
    await poller.runCycle(config([service("github", "http://127.0.0.1:1", { adapter: "stub" })]));
    assert.deepEqual(saved, [undefined]);
  } finally {
    await store.close();
  }
});

test("a provider with an open incident is polled on the adaptive cadence, not its own", async () => {
  let body = summary("none");
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  const store = await freshStore();
  const clock = fakeClock();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: fakeSleep().sleep,
    now: clock.now,
  });
  // An hourly provider: exactly the case where the configured cadence is far
  // too slow to follow an incident it is in the middle of.
  const services = [service("github", provider.baseUrl, { intervalMinutes: 60 })];
  const cfg = config(services, { intervalMinutes: 60, adaptiveIntervalMinutes: 1 });

  try {
    await poller.runCycle(cfg);
    assert.equal(
      await poller.nextIntervalMinutes(cfg),
      60,
      "a calm provider asks for nothing shorter than its own interval",
    );

    body = summary("major", [
      { id: "i1", status: "investigating", impact: "major", name: "API down", updated_at: "2026-09-01T10:00:00.000Z" },
    ]);
    clock.advance(60 * 60_000);
    await poller.runCycle(cfg);
    assert.equal(await poller.nextIntervalMinutes(cfg), 1, "an open incident asks to be watched closely");

    clock.advance(60_000);
    const oneMinuteIn = await poller.runCycle(cfg);
    assert.deepEqual(
      oneMinuteIn.results.map((result) => result.providerId),
      ["github"],
      "a minute is enough while the incident is open",
    );
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a provider whose incident cleared goes back to its configured cadence", async () => {
  let body = summary("major", [
    { id: "i1", status: "investigating", impact: "major", name: "API down", updated_at: "2026-09-01T10:00:00.000Z" },
  ]);
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  });
  const store = await freshStore();
  const clock = fakeClock();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: fakeSleep().sleep,
    now: clock.now,
  });
  const services = [service("github", provider.baseUrl, { intervalMinutes: 30 })];
  const cfg = config(services, { intervalMinutes: 30, adaptiveIntervalMinutes: 1 });

  try {
    await poller.runCycle(cfg);
    assert.equal(await poller.nextIntervalMinutes(cfg), 1);

    body = summary("none");
    clock.advance(60_000);
    await poller.runCycle(cfg);

    assert.equal(await poller.nextIntervalMinutes(cfg), 30, "back off once the provider is calm again");
    clock.advance(60_000);
    assert.deepEqual(
      (await poller.runCycle(cfg)).results,
      [],
      "a minute after recovering, the provider is not due again",
    );
  } finally {
    await store.close();
    await provider.close();
  }
});

test("adaptive polling switched off leaves a provider in trouble on its own cadence", async () => {
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      summary("major", [
        { id: "i1", status: "investigating", impact: "major", name: "API down", updated_at: "2026-09-01T10:00:00.000Z" },
      ]),
    );
  });
  const store = await freshStore();
  const clock = fakeClock();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: fakeSleep().sleep,
    now: clock.now,
  });
  const services = [service("github", provider.baseUrl, { intervalMinutes: 30 })];
  const cfg = config(services, { intervalMinutes: 30, adaptivePolling: false, adaptiveIntervalMinutes: 1 });

  try {
    await poller.runCycle(cfg);
    assert.equal(await poller.nextIntervalMinutes(cfg), 30);

    clock.advance(60_000);
    assert.deepEqual((await poller.runCycle(cfg)).results, [], "the operator asked for thirty minutes");
  } finally {
    await store.close();
    await provider.close();
  }
});

test("one provider in trouble does not drag the rest of the fleet onto its cadence", async () => {
  const troubled = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      summary("major", [
        { id: "i1", status: "investigating", impact: "major", name: "API down", updated_at: "2026-09-01T10:00:00.000Z" },
      ]),
    );
  });
  const calm = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary("none"));
  });
  const store = await freshStore();
  const clock = fakeClock();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: fakeSleep().sleep,
    now: clock.now,
  });
  // Neither provider names an interval, so both follow the global cadence —
  // which is the case the tick dropping to a minute would otherwise sweep up.
  const services = [service("down", troubled.baseUrl), service("up", calm.baseUrl)];
  const cfg = config(services, { intervalMinutes: 3, adaptiveIntervalMinutes: 1 });

  try {
    await poller.runCycle(cfg);
    assert.equal(await poller.nextIntervalMinutes(cfg), 1, "the fleet's shortest ask is the troubled one's");

    clock.advance(60_000);
    const minuteLater = await poller.runCycle(cfg);
    assert.deepEqual(
      minuteLater.results.map((result) => result.providerId),
      ["down"],
      "only the provider in trouble is due a minute in",
    );

    clock.advance(2 * 60_000);
    assert.deepEqual(
      (await poller.runCycle(cfg)).results.map((result) => result.providerId).sort(),
      ["down", "up"],
      "the calm provider is due on the global cadence, as configured",
    );
  } finally {
    await store.close();
    await troubled.close();
    await calm.close();
  }
});

test("a provider that has never answered is not polled every minute for it", async () => {
  // `unknown` is what an unreadable page looks like. Retries and the failure
  // threshold already cover that; watching it closely would only hammer it.
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  const store = await freshStore();
  const clock = fakeClock();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: fakeSleep().sleep,
    now: clock.now,
  });
  const cfg = config([service("github", provider.baseUrl, { intervalMinutes: 30 })], {
    intervalMinutes: 30,
    maxRetries: 1,
  });

  try {
    await poller.runCycle(cfg);
    assert.equal(await poller.nextIntervalMinutes(cfg), 30);
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a disabled provider's incident asks for nothing: it is not being polled", async () => {
  const store = await freshStore();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: fakeSleep().sleep });
  await store.saveStatus({
    provider: "github",
    overallStatus: "major_outage",
    activeIncidents: [
      { id: "i1", name: "API down", impact: "major", status: "investigating", updatedAt: "2026-09-01T10:00:00.000Z" },
    ],
    components: [],
    maintenances: [],
    fetchedAt: "2026-09-01T10:00:00.000Z",
  });

  try {
    const cfg = config([service("github", "http://127.0.0.1:1", { enabled: false, intervalMinutes: 30 })], {
      intervalMinutes: 5,
    });
    assert.equal(await poller.nextIntervalMinutes(cfg), 5, "only the global cadence is left to honour");
  } finally {
    await store.close();
  }
});

test("with flap damping on, a provider that changes its mind for one cycle notifies nobody", async () => {
  let indicator = "none";
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary(indicator));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({
    getAdapter,
    store,
    logger: silent,
    sleep: timer.sleep,
    now: clock.now,
  });
  const damped = config([service("github", provider.baseUrl)], { confirmSamples: 2 });

  try {
    await poller.runCycle(damped);

    indicator = "major";
    clock.advance(ONE_INTERVAL_MS);
    const flap = await poller.runCycle(damped);
    assert.deepEqual(flap.changes, [], "one disagreeing sample must not notify");
    // The sample itself is still recorded: the dashboard tells the truth about
    // what the page said, damping only holds the notification.
    assert.equal((await store.getState("github")).last?.overallStatus, "partial_outage");

    indicator = "none";
    clock.advance(ONE_INTERVAL_MS);
    const back = await poller.runCycle(damped);
    assert.deepEqual(back.changes, [], "the flap is over; there was never any news");
  } finally {
    await store.close();
    await provider.close();
  }
});

test("with flap damping on, a change that persists is announced one cycle later", async () => {
  let indicator = "none";
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary(indicator));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep, now: clock.now });
  const damped = config([service("github", provider.baseUrl)], { confirmSamples: 2 });

  try {
    await poller.runCycle(damped);
    indicator = "major";
    clock.advance(ONE_INTERVAL_MS);
    assert.deepEqual((await poller.runCycle(damped)).changes, []);

    clock.advance(ONE_INTERVAL_MS);
    const confirmed = await poller.runCycle(damped);
    assert.deepEqual(
      confirmed.changes.map((change) => change.kind),
      ["status_change"],
      "the same reading twice is news, against the baseline it was held against",
    );
    assert.equal(confirmed.changes[0]?.previousStatus, "operational");
    assert.equal(confirmed.changes[0]?.currentStatus, "partial_outage");
  } finally {
    await store.close();
    await provider.close();
  }
});

test("a muted provider is polled and recorded, and reports nothing", async () => {
  let indicator = "none";
  const provider = await fakeProvider((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(summary(indicator));
  });
  const store = await freshStore();
  const timer = fakeSleep();
  const clock = fakeClock();
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep, now: clock.now });
  const muted = {
    ...service("github", provider.baseUrl),
    mutedUntil: new Date(Date.now() + 3_600_000).toISOString(),
  };

  try {
    await poller.runCycle(config([muted]));
    indicator = "major";
    clock.advance(ONE_INTERVAL_MS);
    const cycle = await poller.runCycle(config([muted]));

    assert.deepEqual(cycle.changes, [], "a mute is the operator saying they already know");
    assert.equal(cycle.results[0]?.ok, true, "a mute silences alerts, not monitoring");
    assert.equal((await store.getState("github")).last?.overallStatus, "partial_outage");
  } finally {
    await store.close();
    await provider.close();
  }
});

const outcome = (over: Partial<ProviderResult>): ProviderResult => ({
  providerId: "p",
  ok: true,
  attempts: 1,
  durationMs: 5,
  ...over,
});

test("a cycle where nothing answered is read as our own network, not as the fleet", () => {
  assert.equal(
    looksLikeOurOwnNetwork([
      outcome({ providerId: "api", unreachable: true }),
      outcome({ providerId: "db", unreachable: true }),
      outcome({ providerId: "github", ok: false, error: "getaddrinfo ENOTFOUND" }),
    ]),
    true,
  );
});

test("one provider still answering rules our own network out, whatever the probes say", () => {
  // The whole point of looking at the fleet: if a status page came back
  // normally, the container's network is fine and those probes really are down.
  assert.equal(
    looksLikeOurOwnNetwork([
      outcome({ providerId: "api", unreachable: true }),
      outcome({ providerId: "github" }),
    ]),
    false,
  );
});

test("a single failing probe is a single failing probe", () => {
  assert.equal(looksLikeOurOwnNetwork([outcome({ providerId: "api", unreachable: true })]), false);
});

test("providers that answered badly are not evidence of a network failure of ours", () => {
  // Two endpoints answering 503 answered: the sockets worked.
  assert.equal(
    looksLikeOurOwnNetwork([
      outcome({ providerId: "api", note: "answered HTTP 503, outside the accepted 200-299" }),
      outcome({ providerId: "db", note: "answered HTTP 500, outside the accepted 200-299" }),
    ]),
    false,
  );
});
