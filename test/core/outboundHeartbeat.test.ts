import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { createLogger } from "../../src/core/logger.ts";
import { createHeartbeatPinger, readHeartbeatTarget, type HeartbeatTarget } from "../../src/core/outboundHeartbeat.ts";
import { createScheduler } from "../../src/core/scheduler.ts";
import type { ConfigSource, RuntimeConfig } from "../../src/core/configSource.interface.ts";
import type { CycleResult, Poller } from "../../src/core/poller.ts";
import { CATCH_ALL_RULE } from "../../src/core/routing.ts";
import { manualClock } from "../helpers/manualClock.ts";
import { withDeadServer, withServer } from "../helpers/localServer.ts";

/** Roadmap 10.5: IsItDown pinging a dead-man's switch after every cycle. */

const silent = createLogger("error", () => {});

interface Hit {
  method: string;
  path: string;
  body: string;
}

/** A Healthchecks.io stand-in: records every ping, answers 200. */
async function withReceiver(run: (baseUrl: string, hits: Hit[]) => Promise<void>, status = 200): Promise<void> {
  const hits: Hit[] = [];
  await withServer(
    (req: IncomingMessage, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => (body += chunk.toString()));
      req.on("end", () => {
        hits.push({ method: req.method ?? "", path: req.url ?? "", body });
        res.statusCode = status;
        res.end("OK");
      });
    },
    (baseUrl) => run(baseUrl, hits),
  );
}

const config = (heartbeat?: HeartbeatTarget): RuntimeConfig =>
  ({
    polling: { intervalMinutes: 3, requestTimeoutSeconds: 8, maxRetries: 3, failureThreshold: 5, adaptivePolling: false, adaptiveIntervalMinutes: 1 },
    locale: "en",
    services: [],
    channels: [],
    rules: [CATCH_ALL_RULE],
    ...(heartbeat === undefined ? {} : { heartbeat }),
  }) as RuntimeConfig;

const ok: CycleResult = {
  changes: [],
  results: [],
  startedAt: "2026-11-23T10:00:00.000Z",
  finishedAt: "2026-11-23T10:00:02.000Z",
};

function poller(run: () => Promise<CycleResult>): Poller {
  return { runCycle: run, nextIntervalMinutes: async () => 3 };
}

function source(load: () => Promise<RuntimeConfig>): ConfigSource {
  return { load };
}

/** One scheduled cycle, then everything it set off — pings included — finished. */
async function oneCycle(opts: {
  load: () => Promise<RuntimeConfig>;
  run?: () => Promise<CycleResult>;
  heartbeat?: HeartbeatTarget;
  logger?: ReturnType<typeof createLogger>;
}): Promise<{ cycles: number }> {
  let cycles = 0;
  const scheduler = createScheduler({
    clock: manualClock(0),
    configSource: source(opts.load),
    poller: poller(async () => {
      cycles += 1;
      return (opts.run ?? (async () => ok))();
    }),
    dispatcher: { dispatch: async () => [] },
    buildNotifiers: () => [],
    logger: opts.logger ?? silent,
    random: () => 0.5,
    heartbeat: opts.heartbeat,
  });
  await scheduler.start();
  await scheduler.settled();
  scheduler.stop();
  return { cycles };
}

test("readHeartbeatTarget: nothing set is no heartbeat", () => {
  assert.equal(readHeartbeatTarget({}), undefined);
  assert.equal(readHeartbeatTarget({ HEARTBEAT_URL: "  ", HEARTBEAT_METHOD: "POST" }), undefined);
});

test("readHeartbeatTarget: URLs and method, GET by default, method in any case", () => {
  assert.deepEqual(readHeartbeatTarget({ HEARTBEAT_URL: "https://hc-ping.com/abc" }), {
    url: "https://hc-ping.com/abc",
    method: "GET",
  });
  assert.deepEqual(
    readHeartbeatTarget({ HEARTBEAT_FAIL_URL: "https://ntfy.sh/isitdown", HEARTBEAT_METHOD: "post" }),
    { failUrl: "https://ntfy.sh/isitdown", method: "POST" },
  );
});

test("readHeartbeatTarget: a value that cannot work names its variable", () => {
  assert.throws(() => readHeartbeatTarget({ HEARTBEAT_URL: "hc-ping.com/abc" }), /HEARTBEAT_URL/);
  assert.throws(() => readHeartbeatTarget({ HEARTBEAT_FAIL_URL: "ftp://x.example/" }), /HEARTBEAT_FAIL_URL.*http/);
  assert.throws(
    () => readHeartbeatTarget({ HEARTBEAT_URL: "https://hc-ping.com/abc", HEARTBEAT_METHOD: "PUT" }),
    /HEARTBEAT_METHOD/,
  );
});

test("a cycle that completes pings the URL once", async () => {
  await withReceiver(async (base, hits) => {
    await oneCycle({ load: async () => config(), heartbeat: { url: `${base}/ping/abc`, failUrl: `${base}/ping/abc/fail`, method: "GET" } });
    assert.deepEqual(hits.map((hit) => `${hit.method} ${hit.path}`), ["GET /ping/abc"]);
  });
});

test("a cycle that fails pings the fail URL, and never the success one", async () => {
  await withReceiver(async (base, hits) => {
    await oneCycle({
      load: async () => config(),
      run: async () => {
        throw new Error("database is locked");
      },
      heartbeat: { url: `${base}/ping/abc`, failUrl: `${base}/ping/abc/fail`, method: "POST" },
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.path, "/ping/abc/fail");
    assert.equal(hits[0]?.body, "poll cycle failed: database is locked", "POST carries why, for the service's log");
  });
});

test("a failed cycle with no fail URL sends nothing — the missing success ping is the signal", async () => {
  await withReceiver(async (base, hits) => {
    await oneCycle({
      load: async () => config(),
      run: async () => {
        throw new Error("boom");
      },
      heartbeat: { url: `${base}/ping/abc`, method: "GET" },
    });
    assert.deepEqual(hits, []);
  });
});

test("POST on success sends a one-line summary", async () => {
  await withReceiver(async (base, hits) => {
    await oneCycle({ load: async () => config(), heartbeat: { url: `${base}/topic`, method: "POST" } });
    assert.equal(hits[0]?.method, "POST");
    assert.equal(hits[0]?.body, "0 providers read in 2s");
  });
});

test("config.yml's heartbeat wins over the environment's", async () => {
  await withReceiver(async (base, hits) => {
    await oneCycle({
      load: async () => config({ url: `${base}/from-file`, method: "GET" }),
      heartbeat: { url: `${base}/from-env`, method: "GET" },
    });
    assert.deepEqual(hits.map((hit) => hit.path), ["/from-file"]);
  });
});

test("a config that fails to load still reaches the environment's fail URL", async () => {
  await withReceiver(async (base, hits) => {
    await oneCycle({
      load: async () => {
        throw new Error("config.yml: bad indentation");
      },
      heartbeat: { failUrl: `${base}/fail`, method: "GET" },
    });
    assert.deepEqual(hits.map((hit) => hit.path), ["/fail"]);
  });
});

test("an unreachable heartbeat never fails the cycle, and warns once, not every cycle", async () => {
  await withDeadServer(async (dead) => {
    const lines: string[] = [];
    const logger = createLogger("info", (line) => lines.push(line));
    const { cycles } = await oneCycle({ load: async () => config(), heartbeat: { url: `${dead}/ping`, method: "GET" }, logger });
    assert.equal(cycles, 1);
    assert.equal(lines.filter((line) => line.includes("poll cycle failed")).length, 0);

    const pinger = createHeartbeatPinger(logger);
    await pinger.succeeded({ url: `${dead}/ping`, method: "GET" }, "x");
    await pinger.succeeded({ url: `${dead}/ping`, method: "GET" }, "x");
    const warnings = lines.filter((line) => line.includes("heartbeat ping failed"));
    // One from the scheduler's pinger, one from this one: each warns on its first failure only.
    assert.equal(warnings.length, 2);
    assert.ok(warnings.every((line) => !line.includes("/ping")), "the host is logged, never the URL");
  });
});

test("a heartbeat answering an error status counts as failed, and its recovery is logged", async () => {
  const lines: string[] = [];
  const pinger = createHeartbeatPinger(createLogger("info", (line) => lines.push(line)));
  await withReceiver(async (base) => {
    await pinger.succeeded({ url: `${base}/ping`, method: "GET" }, "x");
  }, 404);
  await withReceiver(async (base) => {
    await pinger.succeeded({ url: `${base}/ping`, method: "GET" }, "x");
  });
  assert.match(lines[0] ?? "", /heartbeat ping failed.*HTTP 404/);
  assert.match(lines[1] ?? "", /heartbeat reachable again/);
});

test("a ping that hangs is given up on after its timeout", async () => {
  await withServer(
    () => {
      /* never answers */
    },
    async (base) => {
      const lines: string[] = [];
      const pinger = createHeartbeatPinger(createLogger("info", (line) => lines.push(line)), 50);
      const started = Date.now();
      await pinger.succeeded({ url: `${base}/ping`, method: "GET" }, "x");
      assert.ok(Date.now() - started < 2000);
      assert.match(lines[0] ?? "", /heartbeat ping failed/);
    },
  );
});
