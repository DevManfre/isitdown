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
      channels: { id: string; fields: { name: string; envVar: string; isSet: boolean }[] }[];
    };
    assert.equal(config.services.length, 3);
    assert.equal(config.polling.intervalMinutes, 3);
    const telegram = config.channels.find((channel) => channel.id === "telegram");
    assert.deepEqual(telegram?.fields[0], {
      name: "botToken",
      envVar: "TELEGRAM_BOT_TOKEN",
      isSet: true,
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

test("deleting a service removes it and its history", async () => {
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

    assert.equal((await app.request("DELETE", "/config/services/github")).status, 200);
    assert.deepEqual(await app.runtime.store.getRecentSamples("github", 5), []);
    assert.equal((await app.request("DELETE", "/config/services/github")).status, 404);
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
    assert.deepEqual(webhook?.fields, [{ name: "url", envVar: "MY_HOOK", isSet: true }]);
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
