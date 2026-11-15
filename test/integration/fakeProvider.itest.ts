import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAdapter } from "../../src/adapters/index.ts";
import { buildLightRuntime } from "../../src/light/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { startFakeProvider } from "../../tools/fake-provider.mjs";

// The fake `npm run fake-provider` serves to a developer is the one these
// tests drive: if a real adapter stops reading it, the tool is broken for
// whoever opens it next, and this suite says so first.

const silent = createLogger("error", () => {});
const ctx = { timeoutMs: 2000 };

for (const adapterId of ["statuspage", "instatus", "rss"] as const) {
  test(`the ${adapterId} adapter reads the fake through an incident's whole life`, async () => {
    const fake = await startFakeProvider({ port: 0 });
    try {
      const adapter = getAdapter(adapterId);
      const service = { id: "fake", name: "Fake Provider", baseUrl: fake.baseUrls[adapterId] };

      const calm = await adapter.fetchStatus(service, ctx);
      assert.equal(calm.overallStatus, "operational");
      assert.deepEqual(calm.activeIncidents, []);

      fake.apply("incident-open", { name: "Elevated error rates", impact: "critical", componentIds: ["api"] });
      const broken = await adapter.fetchStatus(service, ctx);
      assert.equal(broken.overallStatus, "major_outage");
      assert.deepEqual(
        broken.activeIncidents.map((incident) => incident.name),
        ["Elevated error rates"],
      );

      const [incident] = fake.state.incidents;
      fake.apply("incident-resolve", { id: incident?.id });
      const recovered = await adapter.fetchStatus(service, ctx);
      assert.equal(recovered.overallStatus, "operational");
      assert.deepEqual(recovered.activeIncidents, []);
    } finally {
      await fake.close();
    }
  });
}

test("a component level set on the control page reaches the statuspage reading", async () => {
  const fake = await startFakeProvider({ port: 0 });
  try {
    const response = await fetch(`${fake.url}/control/component`, {
      method: "POST",
      body: JSON.stringify({ id: "web", status: "partial_outage" }),
    });
    assert.equal(response.status, 200);
    const reading = await getAdapter("statuspage").fetchStatus(
      { id: "fake", name: "Fake Provider", baseUrl: fake.baseUrls.statuspage },
      ctx,
    );
    assert.equal(reading.overallStatus, "partial_outage");
  } finally {
    await fake.close();
  }
});

test("an injected 500 fails the read, so the poller's failure accounting sees it", async () => {
  const fake = await startFakeProvider({ port: 0 });
  try {
    fake.apply("fault", { mode: "error" });
    await assert.rejects(
      getAdapter("statuspage").fetchStatus({ id: "fake", name: "Fake Provider", baseUrl: fake.baseUrls.statuspage }, ctx),
    );
  } finally {
    await fake.close();
  }
});

test("an unknown control action is refused with the reason, not a crash", async () => {
  const fake = await startFakeProvider({ port: 0 });
  try {
    const response = await fetch(`${fake.url}/control/explode`, { method: "POST", body: "{}" });
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /unknown action/);
  } finally {
    await fake.close();
  }
});

test("Light polls the fake and its notification lands on the fake's own receiver", async () => {
  const fake = await startFakeProvider({ port: 0 });
  const dir = await mkdtemp(join(tmpdir(), "isitdown-fake-"));
  const configPath = join(dir, "config.yml");
  await writeFile(
    configPath,
    `pollIntervalMinutes: 1
requestTimeoutSeconds: 2
maxRetries: 1
failureThreshold: 2
locale: en

services:
  - name: Fake Provider
    id: fake
    adapter: statuspage
    baseUrl: ${fake.baseUrls.statuspage}

notifications:
  webhook:
    enabled: true
    url: "${fake.baseUrls.webhook}"
`,
    "utf8",
  );
  const runtime = await buildLightRuntime({
    configPath,
    dataPath: join(dir, "state.json"),
    env: process.env,
    logger: silent,
  });
  try {
    await runtime.scheduler.triggerNow();
    assert.equal(fake.state.deliveries.length, 0, "a first cycle is a baseline, not news");

    fake.apply("incident-open", { name: "Elevated error rates", impact: "major" });
    await runtime.scheduler.triggerNow();
    const kinds = fake.state.deliveries
      .map((delivery) => (delivery.body as { change: { kind: string } }).change.kind)
      .sort();
    assert.deepEqual(kinds, ["incident_opened", "status_change"]);
  } finally {
    await runtime.close();
    await fake.close();
  }
});

test("a maintenance window started on the fake shows up in both dialects that carry one, and ends", async () => {
  const fake = await startFakeProvider({ port: 0 });
  try {
    fake.apply("maintenance-start", { name: "Database upgrade", minutes: 30 });
    for (const adapterId of ["statuspage", "instatus"] as const) {
      const service = { id: "fake", name: "Fake Provider", baseUrl: fake.baseUrls[adapterId] };
      const reading = await getAdapter(adapterId).fetchStatus(service, ctx);
      assert.deepEqual(
        reading.maintenances.map((window) => window.name),
        ["Database upgrade"],
        adapterId,
      );
    }
    fake.apply("maintenance-end", { id: fake.state.maintenances[0]?.id });
    const after = await getAdapter("statuspage").fetchStatus(
      { id: "fake", name: "Fake Provider", baseUrl: fake.baseUrls.statuspage },
      ctx,
    );
    assert.deepEqual(after.maintenances, []);
  } finally {
    await fake.close();
  }
});
