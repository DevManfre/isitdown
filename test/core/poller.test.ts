import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPoller } from "../../src/core/poller.ts";
import { createLogger } from "../../src/core/logger.ts";
import { getAdapter } from "../../src/adapters/index.ts";
import { createFileStateStore } from "../../src/light/fileStateStore.ts";
import type { RuntimeConfig, ServiceDefinition } from "../../src/core/configSource.interface.ts";
import type { StateStore } from "../../src/core/stateStore.interface.ts";

const silent = createLogger("error", () => {});

async function freshStore(): Promise<StateStore> {
  const dir = await mkdtemp(join(tmpdir(), "statuswatch-poller-"));
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
  ...over,
});

const config = (services: ServiceDefinition[], over: Partial<RuntimeConfig["polling"]> = {}): RuntimeConfig => ({
  polling: {
    intervalMinutes: 3,
    requestTimeoutSeconds: 2,
    maxRetries: 3,
    failureThreshold: 5,
    ...over,
  },
  locale: "en",
  services,
  channels: [],
});

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
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });
  const cfg = config([service("github", provider.baseUrl)]);

  try {
    await poller.runCycle(cfg);
    indicator = "critical";
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
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });
  const cfg = config([service("github", provider.baseUrl)]);

  try {
    await poller.runCycle(cfg);
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
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });
  const cfg = config([service("github", provider.baseUrl)], { maxRetries: 1 });

  try {
    await poller.runCycle(cfg);
    healthy = false;
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
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });
  const cfg = config([service("github", provider.baseUrl)], { maxRetries: 1, failureThreshold: 3 });

  try {
    assert.deepEqual((await poller.runCycle(cfg)).changes, [], "no warning on the first failure");
    assert.deepEqual((await poller.runCycle(cfg)).changes, [], "no warning below the threshold");

    const atThreshold = await poller.runCycle(cfg);
    assert.deepEqual(
      atThreshold.changes.map((change) => change.kind),
      ["monitoring_degraded"],
    );
    assert.equal(atThreshold.changes[0]?.failureCount, 3);

    assert.deepEqual((await poller.runCycle(cfg)).changes, [], "the warning must not repeat every cycle");
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
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });
  const cfg = config([service("github", provider.baseUrl)], { maxRetries: 1, failureThreshold: 2 });

  try {
    await poller.runCycle(cfg);
    assert.equal((await poller.runCycle(cfg)).changes.length, 1);

    healthy = true;
    await poller.runCycle(cfg);
    assert.equal((await store.getState("github")).degradedNotified, false);
    assert.equal((await store.getState("github")).failureCount, 0);

    healthy = false;
    await poller.runCycle(cfg);
    const warnsAgain = await poller.runCycle(cfg);
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
    // One stagger per provider, growing with position, and the first is not delayed.
    assert.deepEqual(timer.delays, [0, 250, 500]);
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
  const poller = createPoller({ getAdapter, store, logger: silent, sleep: timer.sleep });
  const cfg = config([service("github", provider.baseUrl)]);

  try {
    await poller.runCycle(cfg);
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
