import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { insertService, updateService } from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";
import { escapeHtml } from "../../src/ui/publicPage.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string, headers?: Record<string, string>) => Promise<{ status: number; text: string }>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-public-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    get: async (path, headers) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
      return { status: response.status, text: await response.text() };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

const ON = { PUBLIC_PAGE: "true" };

test("the page does not exist unless the operator turned it on", async () => {
  // A 404, not a 403: a stranger should not learn there is a page here they are
  // not being shown.
  const app = await api();
  try {
    assert.equal((await app.get("/public")).status, 404);
    assert.equal((await app.get("/public/summary.json")).status, 404);
  } finally {
    await app.close();
  }
});

test("turned on, it renders every published provider with its status", async () => {
  const app = await api(ON);
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "degraded",
      activeIncidents: [
        { id: "i1", name: "API errors", impact: "major", status: "investigating", updatedAt: "2026-09-17T09:00:00.000Z" },
      ],
      components: [],
      maintenances: [],
      fetchedAt: "2026-09-17T10:00:00.000Z",
    });
    const { status, text } = await app.get("/public");
    assert.equal(status, 200);
    assert.match(text, /<h1>Service status<\/h1>/);
    assert.match(text, /GitHub/);
    assert.match(text, /API errors/);
    assert.match(text, /Some services are having problems/);
  } finally {
    await app.close();
  }
});

test("the page carries no script at all, so it cannot be made to call the dashboard API", async () => {
  const app = await api(ON);
  try {
    const { text } = await app.get("/public");
    assert.ok(!/<script/i.test(text), "the public page must contain no script");
    assert.ok(!/fetch\(/.test(text), "the public page must make no request of its own");
  } finally {
    await app.close();
  }
});

test("nothing private reaches the published JSON", async () => {
  const app = await api({ ...ON, TELEGRAM_BOT_TOKEN: "123:secret" });
  try {
    const { text } = await app.get("/public/summary.json");
    const summary = JSON.parse(text) as { providers: Record<string, unknown>[] };
    // The projection is written out by hand; these are the fields a filtered
    // dashboard payload would have carried through by accident.
    for (const key of ["adapter", "baseUrl", "mutedUntil", "failureCount", "channels", "options", "crossChecks"]) {
      assert.ok(
        summary.providers.every((provider) => !(key in provider)),
        `${key} must never appear on the public page`,
      );
    }
    assert.ok(!text.includes("secret"), "no credential may reach the public page");
  } finally {
    await app.close();
  }
});

test("a direct probe's base url is withheld, because it is the operator's own host", async () => {
  const app = await api(ON);
  try {
    insertService(app.runtime.db, {
      id: "billing",
      name: "Billing",
      adapter: "http",
      baseUrl: "https://billing.internal.acme.corp/health",
      enabled: true,
      components: [],
      scopeToComponents: false,
    });
    const page = await app.get("/public");
    const json = await app.get("/public/summary.json");
    assert.match(page.text, /Billing/, "the provider itself still appears");
    assert.ok(
      !page.text.includes("billing.internal.acme.corp"),
      "an internal hostname must never be published",
    );
    assert.ok(!json.text.includes("billing.internal.acme.corp"));
  } finally {
    await app.close();
  }
});

test("a vendor's own status page is linked, because it is already public", async () => {
  const app = await api(ON);
  try {
    const { text } = await app.get("/public");
    assert.match(text, /href="https:\/\/www\.githubstatus\.com"/);
  } finally {
    await app.close();
  }
});

test("PUBLIC_PAGE_PROVIDERS narrows what is published, and a visitor cannot widen it", async () => {
  const app = await api({ ...ON, PUBLIC_PAGE_PROVIDERS: "github" });
  try {
    const { text } = await app.get("/public/summary.json");
    const summary = JSON.parse(text) as { providers: { id: string }[] };
    assert.deepEqual(summary.providers.map((provider) => provider.id), ["github"]);
    // There is no request input at all, so there is nothing to widen it with.
    const probed = await app.get("/public/summary.json?providers=cloudflare");
    const widened = JSON.parse(probed.text) as { providers: { id: string }[] };
    assert.deepEqual(widened.providers.map((provider) => provider.id), ["github"]);
  } finally {
    await app.close();
  }
});

test("a disabled provider is never published", async () => {
  const app = await api(ON);
  try {
    updateService(app.runtime.db, "github", { enabled: false });
    const { text } = await app.get("/public/summary.json");
    const summary = JSON.parse(text) as { providers: { id: string }[] };
    assert.ok(summary.providers.every((provider) => provider.id !== "github"));
  } finally {
    await app.close();
  }
});

test("the page stays readable when a read-only API token is set", async () => {
  // The token gates the dashboard, never this: its readers are exactly the
  // people who do not hold one.
  const app = await api({ ...ON, API_TOKEN: "s3cret", API_LOCAL_BYPASS: "false" });
  try {
    assert.equal((await app.get("/public")).status, 200);
    assert.equal((await app.get("/public/summary.json")).status, 200);
    assert.equal((await app.get("/status")).status, 401);
  } finally {
    await app.close();
  }
});

test("a provider's own incident title is escaped, because it is somebody else's copy", () => {
  // A vendor naming an incident `<img onerror=...>` must not be able to run
  // script on a page our operator publishes.
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')">`),
    "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
  );
});

test("an incident title carrying markup reaches the page inert", async () => {
  const app = await api(ON);
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "major_outage",
      activeIncidents: [
        { id: "x", name: "<script>alert(1)</script>", impact: "major", status: "investigating", updatedAt: "2026-09-17T09:00:00.000Z" },
      ],
      components: [],
      maintenances: [],
      fetchedAt: "2026-09-17T10:00:00.000Z",
    });
    const { text } = await app.get("/public");
    assert.ok(!text.includes("<script>alert(1)</script>"));
    assert.match(text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  } finally {
    await app.close();
  }
});
