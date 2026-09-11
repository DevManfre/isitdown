import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  request: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-cfg-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    request: async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

async function fakeProvider(indicator = "none"): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    if (req.url === "/api/v2/summary.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: { indicator }, incidents: [] }));
    } else if (req.url === "/api/v2/incidents.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ incidents: [] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function fakeComponentsProvider(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const fixture = readFileSync(new URL("../fixtures/statuspage/components-mixed.json", import.meta.url), "utf8");
  const server = createServer((req, res) => {
    if (req.url === "/api/v2/summary.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(fixture);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("config returns the services, the polling settings and the channels", async () => {
  const app = await api({ TELEGRAM_BOT_TOKEN: "123:ABC" });
  try {
    const { status, body } = await app.request("GET", "/config");
    assert.equal(status, 200);
    const config = body as {
      services: { id: string }[];
      polling: { intervalMinutes: number };
      channels: { id: string; fields: { name: string; envVar: string; isSet: boolean; optional: boolean }[] }[];
    };
    assert.equal(config.services.length, 3);
    assert.equal(config.polling.intervalMinutes, 3);
    const telegram = config.channels.find((channel) => channel.id === "telegram");
    assert.deepEqual(telegram?.fields[0], {
      name: "botToken",
      envVar: "TELEGRAM_BOT_TOKEN",
      isSet: true,
      optional: false,
    });
  } finally {
    await app.close();
  }
});

test("adding a service returns 201 and it shows up in the config", async () => {
  const provider = await fakeProvider();
  const app = await api();
  try {
    const { status } = await app.request("POST", "/config/services", {
      id: "vercel",
      name: "Vercel",
      adapter: "statuspage",
      baseUrl: provider.baseUrl,
    });
    assert.equal(status, 201);
    const config = (await app.request("GET", "/config")).body as { services: { id: string }[] };
    assert.ok(config.services.some((service) => service.id === "vercel"));
  } finally {
    await app.close();
    await provider.close();
  }
});

test("a new service is polled on the next cycle with no restart", async () => {
  const provider = await fakeProvider("minor");
  const app = await api();
  try {
    await app.request("POST", "/config/services", {
      id: "fake",
      name: "Fake",
      adapter: "statuspage",
      baseUrl: provider.baseUrl,
    });
    await app.request("POST", "/poll");
    assert.equal((await app.runtime.store.getState("fake")).last?.overallStatus, "degraded");
  } finally {
    await app.close();
    await provider.close();
  }
});

test("a duplicate service id is a conflict", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("POST", "/config/services", {
      id: "github",
      name: "GitHub again",
      adapter: "statuspage",
      baseUrl: "https://example.com",
    });
    assert.equal(status, 409);
    assert.match((body as { error: { message: string } }).error.message, /github/);
  } finally {
    await app.close();
  }
});

test("an invalid service is a 400 naming the offending field", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("POST", "/config/services", {
      id: "bad",
      name: "Bad",
      adapter: "statuspage",
      baseUrl: "not-a-url",
    });
    assert.equal(status, 400);
    assert.match((body as { error: { message: string } }).error.message, /baseUrl/);
  } finally {
    await app.close();
  }
});

test("editing a service applies and an unknown id is a 404", async () => {
  const app = await api();
  try {
    assert.equal((await app.request("PATCH", "/config/services/github", { name: "GH" })).status, 200);
    const config = (await app.request("GET", "/config")).body as { services: { id: string; name: string }[] };
    assert.equal(config.services.find((service) => service.id === "github")?.name, "GH");

    assert.equal((await app.request("PATCH", "/config/services/nope", { name: "x" })).status, 404);
  } finally {
    await app.close();
  }
});

test("GET /config/services/:id/impact reports what a removal would take", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });

    const { status, body } = await app.request("GET", "/config/services/github/impact");

    assert.equal(status, 200);
    assert.equal((body as { samples: number }).samples, 1);
    assert.equal((body as { incidents: number }).incidents, 0);
  } finally {
    await app.close();
  }
});

test("GET /config/services/:id/impact 404s for a service that is not there", async () => {
  const app = await api();
  try {
    const { status } = await app.request("GET", "/config/services/nope/impact");

    assert.equal(status, 404);
  } finally {
    await app.close();
  }
});

test("removing a service hides it but keeps its history for the restore window", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });
    assert.equal((await app.runtime.store.getRecentSamples("github", 5)).length, 1);

    const removal = await app.request("DELETE", "/config/services/github");
    assert.equal(removal.status, 200);
    const { restoreUntil } = removal.body as { restoreUntil: string };
    // The response has to say when the undo expires, or the dashboard's offer
    // of one is a guess.
    assert.ok(Date.parse(restoreUntil) > Date.now());

    // Gone from the config and from the poll cycle, but nothing was taken yet.
    const config = (await app.request("GET", "/config")).body as {
      services: { id: string }[];
      removed: { id: string; restoreUntil: string }[];
    };
    assert.ok(!config.services.some((service) => service.id === "github"));
    assert.deepEqual(
      config.removed.map((service) => service.id),
      ["github"],
    );
    assert.equal((await app.runtime.store.getRecentSamples("github", 5)).length, 1);

    // A second removal is a 404: the row is already on its way out.
    assert.equal((await app.request("DELETE", "/config/services/github")).status, 404);
  } finally {
    await app.close();
  }
});

test("restoring a removed service puts it back, and an unknown restore is a 404", async () => {
  const app = await api();
  try {
    await app.request("DELETE", "/config/services/github");

    assert.equal((await app.request("POST", "/config/services/github/restore")).status, 200);
    const config = (await app.request("GET", "/config")).body as {
      services: { id: string }[];
      removed: unknown[];
    };
    assert.ok(config.services.some((service) => service.id === "github"));
    assert.deepEqual(config.removed, []);

    assert.equal((await app.request("POST", "/config/services/github/restore")).status, 404);
  } finally {
    await app.close();
  }
});

test("removing a service permanently is what finally takes its history", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });

    assert.equal((await app.request("DELETE", "/config/services/github/permanently")).status, 200);

    assert.deepEqual(await app.runtime.store.getRecentSamples("github", 5), []);
    const config = (await app.request("GET", "/config")).body as { removed: unknown[] };
    assert.deepEqual(config.removed, []);
    assert.equal((await app.request("DELETE", "/config/services/github/permanently")).status, 404);
  } finally {
    await app.close();
  }
});

test("changing the polling interval is reflected in the next config load", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("PATCH", "/config/settings", { intervalMinutes: 10 });
    assert.equal(status, 200);
    assert.equal((body as { polling: { intervalMinutes: number } }).polling.intervalMinutes, 10);
    assert.equal((await app.runtime.configSource.load()).polling.intervalMinutes, 10);
  } finally {
    await app.close();
  }
});

test("an out-of-range polling setting is refused", async () => {
  const app = await api();
  try {
    for (const patch of [{ intervalMinutes: 0 }, { maxRetries: 99 }, { intervalMinutes: 1.5 }]) {
      const { status } = await app.request("PATCH", "/config/settings", patch);
      assert.equal(status, 400, JSON.stringify(patch));
    }
  } finally {
    await app.close();
  }
});

test("a channel can be enabled and its variable name changed", async () => {
  const app = await api({ MY_HOOK: "https://hooks.example/x" });
  try {
    const { status } = await app.request("PATCH", "/config/channels/webhook", {
      enabled: true,
      fields: { urlEnv: "MY_HOOK" },
    });
    assert.equal(status, 200);
    const config = (await app.request("GET", "/config")).body as {
      channels: { id: string; enabled: boolean; fields: { envVar: string; isSet: boolean }[] }[];
    };
    const webhook = config.channels.find((channel) => channel.id === "webhook");
    assert.equal(webhook?.enabled, true);
    assert.deepEqual(webhook?.fields, [
      { name: "url", envVar: "MY_HOOK", isSet: true, optional: false },
      // The signing secret is offered to every installation and set by few:
      // unset, it must read as optional rather than as a broken channel.
      { name: "secret", envVar: "WEBHOOK_SECRET", isSet: false, optional: true },
    ]);
  } finally {
    await app.close();
  }
});

test("the API refuses to accept a literal secret value", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("PATCH", "/config/channels/telegram", {
      fields: { botToken: "123:ABC" },
    });
    assert.equal(status, 400);
    assert.match((body as { error: { message: string } }).error.message, /Env/);

    // And nothing resembling it was stored.
    const stored = JSON.stringify((await app.request("GET", "/config")).body);
    assert.ok(!stored.includes("123:ABC"));
  } finally {
    await app.close();
  }
});

test("an unknown channel is a 404", async () => {
  const app = await api();
  try {
    assert.equal((await app.request("PATCH", "/config/channels/pigeon", { enabled: true })).status, 404);
  } finally {
    await app.close();
  }
});

test("testing a service connection reports the status it saw without recording anything", async () => {
  const provider = await fakeProvider("critical");
  const app = await api();
  try {
    await app.request("POST", "/config/services", {
      id: "fake",
      name: "Fake",
      adapter: "statuspage",
      baseUrl: provider.baseUrl,
    });

    // Wait for backfill to settle: poll until sample count is non-zero and stable.
    // applyBackfill writes in one transaction, so stable non-zero = backfill complete.
    const count = () =>
      (
        app.runtime.db
          .prepare("SELECT COUNT(*) AS n FROM status_samples WHERE provider_id = 'fake'")
          .get() as { n: number }
      ).n;
    const deadline = Date.now() + 5000;
    let sampleCount = 0;
    let previousCount = -1;
    while (Date.now() < deadline) {
      sampleCount = count();
      if (sampleCount > 0 && sampleCount === previousCount) {
        break; // Stable non-zero count: backfill settled.
      }
      previousCount = sampleCount;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(sampleCount > 0, "backfill must create samples");

    // Snapshot samples before the test endpoint call.
    const samplesBefore = count();

    const { status, body } = await app.request("POST", "/config/services/fake/test");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, overallStatus: "major_outage" });

    // Verify the test endpoint itself recorded no new samples — it is diagnostics only.
    const samplesAfter = count();
    assert.equal(samplesAfter, samplesBefore, "test endpoint must not record samples");
    assert.deepEqual(await app.runtime.store.listNotifications(5), []);
    assert.equal((await app.runtime.store.getState("fake")).last, null);
  } finally {
    await app.close();
    await provider.close();
  }
});

test("testing an unreachable service reports the failure rather than throwing", async () => {
  const app = await api();
  try {
    await app.request("POST", "/config/services", {
      id: "dead",
      name: "Dead",
      adapter: "statuspage",
      baseUrl: "http://127.0.0.1:1",
    });
    const { status, body } = await app.request("POST", "/config/services/dead/test");
    assert.equal(status, 200);
    const result = body as { ok: boolean; error: string };
    assert.equal(result.ok, false);
    assert.ok(result.error.length > 0);
  } finally {
    await app.close();
  }
});

test("testing a channel delivers one message and records it", async () => {
  const received: unknown[] = [];
  const receiver = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const { port } = receiver.address() as AddressInfo;

  const app = await api({ WEBHOOK_URL: `http://127.0.0.1:${port}/hook` });
  try {
    await app.request("PATCH", "/config/channels/webhook", { enabled: true });
    const { status, body } = await app.request("POST", "/config/channels/webhook/test");
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true });
    assert.equal(received.length, 1);

    const recorded = await app.runtime.store.listNotifications(5);
    assert.equal(recorded.length, 1, "a test send belongs in the audit trail too");
    assert.equal(recorded[0]?.channel, "webhook");
  } finally {
    await app.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  }
});

test("testing a channel whose variable is unset reports why", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("POST", "/config/channels/webhook/test");
    assert.equal(status, 200);
    const result = body as { ok: boolean; error: string };
    assert.equal(result.ok, false);
    assert.match(result.error, /WEBHOOK_URL/);
  } finally {
    await app.close();
  }
});

test("preview-components lists a statuspage provider's components", async () => {
  const provider = await fakeComponentsProvider();
  const app = await api();
  try {
    const { status, body } = await app.request("POST", "/config/services/preview-components", {
      adapter: "statuspage",
      baseUrl: provider.baseUrl,
    });
    assert.equal(status, 200);
    const result = body as { supported: boolean; components: unknown[] };
    assert.equal(result.supported, true);
    assert.equal(result.components.length, 5);
    assert.deepEqual(result.components[0], {
      id: "cmp1",
      name: "API",
      group: "Core Services",
      showcase: true,
      status: "operational",
    });
  } finally {
    await app.close();
    await provider.close();
  }
});

test("preview-components rejects an unknown adapter", async () => {
  const app = await api();
  try {
    const { status } = await app.request("POST", "/config/services/preview-components", {
      adapter: "nope",
      baseUrl: "https://status.example.com",
    });
    assert.equal(status, 400);
  } finally {
    await app.close();
  }
});

test("preview-components reports an unreachable provider as 502", async () => {
  const app = await api();
  try {
    const { status } = await app.request("POST", "/config/services/preview-components", {
      adapter: "statuspage",
      baseUrl: "http://127.0.0.1:1",
    });
    assert.equal(status, 502);
  } finally {
    await app.close();
  }
});

test("lowering the interval leaves the armed countdown alone rather than pushing it into the past", async () => {
  const app = await api();
  try {
    await app.request("POST", "/poll");
    const before = (await app.request("GET", "/status")).body as { nextPollAt: string | null };

    // The scheduler re-reads the config on its next cycle, by design — so the
    // cycle already on the clock keeps its own deadline. Recomputing the
    // countdown from the new, shorter interval would date it two minutes into
    // the past and leave the dashboard reading "0s" until the real cycle ran.
    await app.request("PATCH", "/config/settings", { intervalMinutes: 1 });
    const after = (await app.request("GET", "/status")).body as { nextPollAt: string | null };

    assert.equal(after.nextPollAt, before.nextPollAt);
    assert.ok(after.nextPollAt !== null && Date.parse(after.nextPollAt) > Date.now());
  } finally {
    await app.close();
  }
});

test("GET /config reports the routing rules and the invalid count", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("GET", "/config");
    assert.equal(status, 200);
    const config = body as { routing: { rules: unknown[]; invalidRules: number } };
    assert.deepEqual(config.routing.rules, [
      { provider: "*", classes: ["status", "incident", "maintenance", "monitoring"], minSeverity: "any", channels: ["*"] },
    ]);
    assert.equal(config.routing.invalidRules, 0);
  } finally {
    await app.close();
  }
});

test("PUT /config/routing replaces the list and reports it back in order", async () => {
  const app = await api();
  try {
    const rules = [
      { provider: "github", classes: ["status"], minSeverity: "any", channels: [] },
      { provider: "*", classes: ["status", "incident"], minSeverity: "major_outage", channels: ["telegram"] },
    ];

    const { status, body } = await app.request("PUT", "/config/routing", { rules });

    assert.equal(status, 200);
    const result = body as { rules: { provider: string }[] };
    assert.deepEqual(
      result.rules.map((rule) => rule.provider),
      ["github", "*"],
    );
  } finally {
    await app.close();
  }
});

test("PUT /config/routing refuses an invalid list and writes nothing", async () => {
  const app = await api();
  try {
    const before = ((await app.request("GET", "/config")).body as { routing: { rules: unknown[] } }).routing.rules;

    const { status, body } = await app.request("PUT", "/config/routing", {
      rules: [{ provider: "*", minSeverity: "critical" }],
    });

    assert.equal(status, 400);
    assert.match((body as { error: { message: string } }).error.message, /minSeverity/);
    const after = ((await app.request("GET", "/config")).body as { routing: { rules: unknown[] } }).routing.rules;
    assert.deepEqual(after, before);
  } finally {
    await app.close();
  }
});

test("PUT /config/routing refuses a rule naming a channel nothing knows about", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("PUT", "/config/routing", {
      rules: [{ provider: "*", channels: ["pushover"] }],
    });

    assert.equal(status, 400);
    assert.match((body as { error: { message: string } }).error.message, /pushover/);
  } finally {
    await app.close();
  }
});

test("PUT /config/routing accepts an empty list", async () => {
  // An operator who deletes every rule gets the catch-all back at load time,
  // not an error at write time: the two are different questions.
  const app = await api();
  try {
    const { status, body } = await app.request("PUT", "/config/routing", { rules: [] });

    assert.equal(status, 200);
    assert.deepEqual((body as { rules: unknown[] }).rules, []);
  } finally {
    await app.close();
  }
});

test("a provider can be given its own poll interval and put back on the global one", async () => {
  const provider = await fakeProvider();
  const app = await api();
  const intervalOf = async (): Promise<number | undefined> => {
    const config = (await app.request("GET", "/config")).body as {
      services: { id: string; intervalMinutes?: number }[];
    };
    return config.services.find((service) => service.id === "vercel")?.intervalMinutes;
  };
  try {
    await app.request("POST", "/config/services", {
      id: "vercel",
      name: "Vercel",
      adapter: "statuspage",
      baseUrl: provider.baseUrl,
      intervalMinutes: 60,
    });
    assert.equal(await intervalOf(), 60);

    // Null is the only way to say "back to the global cadence": omitting the
    // field on a patch means "leave it alone".
    const cleared = await app.request("PATCH", "/config/services/vercel", { intervalMinutes: null });
    assert.equal(cleared.status, 200);
    assert.equal(await intervalOf(), undefined);
  } finally {
    await app.close();
    await provider.close();
  }
});

test("a poll interval outside the allowed range is refused", async () => {
  const provider = await fakeProvider();
  const app = await api();
  try {
    const { status, body } = await app.request("POST", "/config/services", {
      id: "vercel",
      name: "Vercel",
      adapter: "statuspage",
      baseUrl: provider.baseUrl,
      intervalMinutes: 0,
    });
    assert.equal(status, 400);
    assert.match(JSON.stringify(body), /intervalMinutes/);
  } finally {
    await app.close();
    await provider.close();
  }
});

test("retention is part of the config payload and can be changed", async () => {
  const app = await api();
  try {
    const initial = (await app.request("GET", "/config")).body as { retention: { days: number } };
    assert.equal(initial.retention.days, 120);

    const { status, body } = await app.request("PATCH", "/config/settings", { retentionDays: 365 });
    assert.equal(status, 200);
    assert.equal((body as { retention: { days: number } }).retention.days, 365);

    const reread = (await app.request("GET", "/config")).body as { retention: { days: number } };
    assert.equal(reread.retention.days, 365);
  } finally {
    await app.close();
  }
});

test("an out-of-range retention is refused", async () => {
  const app = await api();
  try {
    for (const patch of [{ retentionDays: 6 }, { retentionDays: 3651 }, { retentionDays: 30.5 }]) {
      const { status } = await app.request("PATCH", "/config/settings", patch);
      assert.equal(status, 400, JSON.stringify(patch));
    }
  } finally {
    await app.close();
  }
});

test("the storage report measures the database so a retention choice can be costed", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    });

    const { status, body } = await app.request("GET", "/config/storage");
    assert.equal(status, 200);
    const report = body as {
      dbBytes: number;
      sampleCount: number;
      bytesPerSample: number;
      samplesPerDay: number;
    };
    assert.ok(report.dbBytes > 0, "an existing database has a size");
    assert.equal(report.sampleCount, 1);
    assert.ok(report.bytesPerSample > 0);
    // Three seeded providers polled every three minutes.
    assert.equal(report.samplesPerDay, 3 * (1440 / 3));
  } finally {
    await app.close();
  }
});

test("database maintenance checks the file, vacuums it, and reports what it reclaimed", async () => {
  // Roadmap 6.13. Deleted rows leave their pages behind until a vacuum returns
  // them, which is why the storage report never moved after a large prune.
  const app = await api();
  try {
    const insert = app.runtime.db.prepare(
      "INSERT INTO status_samples (provider_id, observed_at, overall_status, ok) VALUES ('github', ?, 'operational', 1)",
    );
    for (let index = 0; index < 1500; index += 1) {
      insert.run(new Date(Date.now() - index * 60_000).toISOString());
    }
    const { body: compact } = await app.request("POST", "/config/storage/maintenance");
    app.runtime.db.prepare("DELETE FROM status_samples").run();
    assert.equal((compact as { ok: boolean }).ok, true);

    const { status, body } = await app.request("POST", "/config/storage/maintenance");
    assert.equal(status, 200);
    const report = body as { ok: boolean; integrity: string; bytesBefore: number; bytesAfter: number; reclaimed: number };
    assert.equal(report.ok, true);
    assert.equal(report.integrity, "ok");
    assert.ok(report.reclaimed > 0, `expected reclaimed bytes, got ${report.reclaimed}`);
    assert.equal(report.reclaimed, report.bytesBefore - report.bytesAfter);

    // And the size the dashboard reports agrees with what the vacuum left.
    const { body: storage } = await app.request("GET", "/config/storage");
    assert.equal((storage as { dbBytes: number }).dbBytes, report.bytesAfter);
  } finally {
    await app.close();
  }
});

test("adaptive polling can be switched off and given its own cadence from the dashboard", async () => {
  // Roadmap 2.3. Both fields travel on the same settings patch as the rest of
  // the engine, and take effect on the next config load — no restart.
  const app = await api();
  try {
    const { status, body } = await app.request("PATCH", "/config/settings", {
      adaptivePolling: false,
      adaptiveIntervalMinutes: 5,
    });
    assert.equal(status, 200);
    const polling = (body as { polling: { adaptivePolling: boolean; adaptiveIntervalMinutes: number } }).polling;
    assert.equal(polling.adaptivePolling, false);
    assert.equal(polling.adaptiveIntervalMinutes, 5);

    const loaded = (await app.runtime.configSource.load()).polling;
    assert.equal(loaded.adaptivePolling, false);
    assert.equal(loaded.adaptiveIntervalMinutes, 5);

    const config = (await app.request("GET", "/config")).body as {
      polling: { adaptivePolling: boolean; adaptiveIntervalMinutes: number };
    };
    assert.equal(config.polling.adaptivePolling, false);
    assert.equal(config.polling.adaptiveIntervalMinutes, 5);
  } finally {
    await app.close();
  }
});

test("an out-of-range adaptive cadence is refused", async () => {
  const app = await api();
  try {
    for (const patch of [{ adaptiveIntervalMinutes: 0 }, { adaptiveIntervalMinutes: 1441 }, { adaptivePolling: "yes" }]) {
      const { status } = await app.request("PATCH", "/config/settings", patch);
      assert.equal(status, 400, JSON.stringify(patch));
    }
  } finally {
    await app.close();
  }
});

test("a provider can be muted for a while and unmuted early", async () => {
  const provider = await fakeProvider();
  const app = await api();
  const mutedUntilOf = async (): Promise<string | undefined> => {
    const config = (await app.request("GET", "/config")).body as {
      services: { id: string; mutedUntil?: string }[];
    };
    return config.services.find((service) => service.id === "vercel")?.mutedUntil;
  };
  try {
    await app.request("POST", "/config/services", {
      id: "vercel",
      name: "Vercel",
      adapter: "statuspage",
      baseUrl: provider.baseUrl,
    });
    const until = new Date(Date.now() + 7_200_000).toISOString();

    assert.equal((await app.request("PATCH", "/config/services/vercel", { mutedUntil: until })).status, 200);
    assert.equal(await mutedUntilOf(), until);
    // The mute has to reach the engine's input, not just the config payload.
    const loaded = (await app.runtime.configSource.load()).services.find((service) => service.id === "vercel");
    assert.equal(loaded?.mutedUntil, until);

    assert.equal((await app.request("PATCH", "/config/services/vercel", { mutedUntil: null })).status, 200);
    assert.equal(await mutedUntilOf(), undefined);
  } finally {
    await app.close();
    await provider.close();
  }
});

test("a mute that has already run out is not reported as one", async () => {
  const provider = await fakeProvider();
  const app = await api();
  try {
    await app.request("POST", "/config/services", {
      id: "vercel",
      name: "Vercel",
      adapter: "statuspage",
      baseUrl: provider.baseUrl,
      mutedUntil: new Date(Date.now() - 60_000).toISOString(),
    });

    const config = (await app.request("GET", "/config")).body as {
      services: { id: string; mutedUntil?: string }[];
    };
    assert.equal(config.services.find((service) => service.id === "vercel")?.mutedUntil, undefined);
  } finally {
    await app.close();
    await provider.close();
  }
});

test("the flap-damping threshold is stored and reaches the next config load", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("PATCH", "/config/settings", { confirmSamples: 3 });

    assert.equal(status, 200);
    assert.equal((body as { polling: { confirmSamples: number } }).polling.confirmSamples, 3);
    assert.equal((await app.runtime.configSource.load()).polling.confirmSamples, 3);
    assert.equal((await app.request("PATCH", "/config/settings", { confirmSamples: 99 })).status, 400);
  } finally {
    await app.close();
  }
});

test("GET /config reports the delivery policy, and an unconfigured one reads as off", async () => {
  const it = await api();
  try {
    const { body } = await it.request("GET", "/config");
    assert.deepEqual((body as { delivery: unknown }).delivery, {
      quietHours: {
        enabled: false,
        start: "23:00",
        end: "07:00",
        timeZone: "auto",
        minSeverity: "major_outage",
      },
      digest: { enabled: false, windowMinutes: 15, immediateFloor: "major_outage" },
      cap: { enabled: false, maxPerHour: 10 },
      updateInPlace: false,
    });
  } finally {
    await it.close();
  }
});

test("a delivery patch writes only the fields it names, and reaches the engine", async () => {
  const it = await api();
  try {
    const { status, body } = await it.request("PATCH", "/config/settings", {
      delivery: { quietHours: { enabled: true, start: "22:30", timeZone: "Europe/Rome" } },
    });
    assert.equal(status, 200);
    const patched = (body as { delivery: { quietHours: Record<string, unknown> } }).delivery;
    assert.equal(patched.quietHours.enabled, true);
    assert.equal(patched.quietHours.start, "22:30");
    // Untouched, rather than reset to a default by a partial write.
    assert.equal(patched.quietHours.end, "07:00");
    assert.equal(patched.quietHours.minSeverity, "major_outage");

    // And it is the same policy the dispatcher will read on the next cycle,
    // not a second copy assembled by the route.
    const config = await it.runtime.configSource.load();
    assert.equal(config.delivery.quietHours.enabled, true);
    assert.equal(config.delivery.quietHours.timeZone, "Europe/Rome");
  } finally {
    await it.close();
  }
});

test("a delivery patch the schema refuses changes nothing", async () => {
  const it = await api();
  try {
    const { status } = await it.request("PATCH", "/config/settings", {
      delivery: { quietHours: { start: "25:00" } },
    });
    assert.equal(status, 400);
    const config = await it.runtime.configSource.load();
    assert.equal(config.delivery.quietHours.start, "23:00");
  } finally {
    await it.close();
  }
});

test("a digest and a cap survive the round trip through the setting rows", async () => {
  const it = await api();
  try {
    await it.request("PATCH", "/config/settings", {
      delivery: {
        digest: { enabled: true, windowMinutes: 45, immediateFloor: "partial_outage" },
        cap: { enabled: true, maxPerHour: 6 },
        updateInPlace: true,
      },
    });

    const config = await it.runtime.configSource.load();
    assert.deepEqual(config.delivery.digest, {
      enabled: true,
      windowMinutes: 45,
      immediateFloor: "partial_outage",
    });
    assert.deepEqual(config.delivery.cap, { enabled: true, maxPerHour: 6 });
    assert.equal(config.delivery.updateInPlace, true);
  } finally {
    await it.close();
  }
});

test("the detect route names the adapter that reads a pasted page, and the base url it wants", async () => {
  const app = await api();
  const provider = await fakeProvider();
  try {
    const { status, body } = await app.request("POST", "/config/services/detect", { url: provider.baseUrl });
    assert.equal(status, 200);
    // `fakeProvider` serves exactly the Statuspage summary document, which is
    // what the detection is reading.
    assert.deepEqual(
      { adapter: (body as { adapter: string }).adapter, baseUrl: (body as { baseUrl: string }).baseUrl },
      { adapter: "statuspage", baseUrl: provider.baseUrl },
    );
  } finally {
    await provider.close();
    await app.close();
  }
});

test("a page no adapter recognises answers 200 with a null adapter, not an error", async () => {
  const app = await api();
  try {
    // Nothing is listening here, so every probe comes back unreachable — the
    // dashboard still asked a fair question and gets an answer it can show.
    const { status, body } = await app.request("POST", "/config/services/detect", { url: "http://192.0.2.1:9" });
    assert.equal(status, 200);
    assert.equal((body as { adapter: string | null }).adapter, null);
  } finally {
    await app.close();
  }
});

test("the detect route refuses a url it cannot parse", async () => {
  const app = await api();
  try {
    assert.equal((await app.request("POST", "/config/services/detect", { url: "not a url" })).status, 400);
    assert.equal((await app.request("POST", "/config/services/detect", {})).status, 400);
  } finally {
    await app.close();
  }
});

test("the catalog is served from the image, and says which entries are already watched", async () => {
  const app = await api();
  try {
    const { status, body } = await app.request("GET", "/config/catalog");
    assert.equal(status, 200);
    const providers = (body as { providers: { id: string; adapter: string; baseUrl: string; configured: boolean }[] })
      .providers;
    assert.ok(providers.length > 20, "a menu worth calling a catalog");

    const github = providers.find((entry) => entry.id === "github");
    assert.deepEqual(
      { adapter: github?.adapter, baseUrl: github?.baseUrl },
      { adapter: "statuspage", baseUrl: "https://www.githubstatus.com" },
    );
    // The seeded fleet already watches GitHub, and the row stays in the menu
    // saying so rather than disappearing from it.
    assert.equal(github?.configured, true);
    assert.equal(providers.find((entry) => entry.id === "twitch")?.configured, false);
  } finally {
    await app.close();
  }
});

test("a catalog pick is a service the add route accepts as it stands", async () => {
  const app = await api();
  try {
    const { providers } = (await app.request("GET", "/config/catalog")).body as {
      providers: { id: string; name: string; adapter: string; baseUrl: string; configured: boolean }[];
    };
    const pick = providers.find((entry) => !entry.configured);
    assert.ok(pick !== undefined, "the seeded fleet cannot have taken every catalog id");

    const { status } = await app.request("POST", "/config/services", {
      id: pick.id,
      name: pick.name,
      adapter: pick.adapter,
      baseUrl: pick.baseUrl,
    });

    assert.equal(status, 201, "the menu row travels to the add route unedited");
    assert.equal((await app.request("GET", "/config/catalog")).body !== undefined, true);
    const after = (await app.request("GET", "/config/catalog")).body as {
      providers: { id: string; configured: boolean }[];
    };
    assert.equal(after.providers.find((entry) => entry.id === pick.id)?.configured, true);
  } finally {
    await app.close();
  }
});

test("a provider's group round-trips through the add and patch routes", async () => {
  const app = await api();
  try {
    const added = await app.request("POST", "/config/services", {
      id: "vercel",
      name: "Vercel",
      adapter: "statuspage",
      baseUrl: "https://www.vercel-status.com",
      group: "deploy-path",
    });
    assert.equal(added.status, 201);
    assert.equal((added.body as { group?: string }).group, "deploy-path");

    // Null takes it back out, the way a cleared interval does.
    const patched = await app.request("PATCH", "/config/services/vercel", { group: null });
    assert.equal(patched.status, 200);
    const services = (await app.request("GET", "/config")).body as { services: { id: string; group?: string }[] };
    assert.equal(services.services.find((service) => service.id === "vercel")?.group, undefined);
  } finally {
    await app.close();
  }
});

test("a group name the schema would reject is a 400, not a stored oddity", async () => {
  const app = await api();
  try {
    const { status } = await app.request("POST", "/config/services", {
      id: "vercel",
      name: "Vercel",
      adapter: "statuspage",
      baseUrl: "https://www.vercel-status.com",
      group: "Deploy Path",
    });

    assert.equal(status, 400, "a group is a slug, so a routing rule can name it");
  } finally {
    await app.close();
  }
});
