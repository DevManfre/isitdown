import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { DEFAULT_LAYOUT, type DashboardLayout } from "../../src/ui/dashboardLayout.ts";

const silent = createLogger("error", () => {});

interface DashboardBody {
  id: string;
  name: string;
  layout: DashboardLayout;
  isDefault: boolean;
  layoutInvalid?: boolean;
  updatedAt: string;
}

interface Api {
  runtime: UiRuntime;
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-dashboards-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    call: async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
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

const halves: DashboardLayout = {
  version: 1,
  widgets: [
    { id: "cloud", type: "fleet-list", width: "half", props: { filter: { groups: ["cloud"], providers: [] } } },
    { id: "pay", type: "fleet-list", width: "half", props: { filter: { groups: [], providers: ["stripe"] } } },
  ],
};

test("a dashboard nobody customised is served the default layout", async () => {
  const app = await api();
  try {
    const { status, body } = await app.call("GET", "/dashboards/default");
    assert.equal(status, 200);
    const dashboard = body as DashboardBody;
    assert.equal(dashboard.id, "default");
    assert.equal(dashboard.isDefault, true);
    assert.deepEqual(dashboard.layout, DEFAULT_LAYOUT);
    assert.equal(typeof dashboard.updatedAt, "string");
  } finally {
    await app.close();
  }
});

test("a saved layout comes back as saved, and no longer as the default", async () => {
  const app = await api();
  try {
    const before = (await app.call("GET", "/dashboards/default")).body as DashboardBody;
    const saved = await app.call("PUT", "/dashboards/default", { layout: halves, updatedAt: before.updatedAt });
    assert.equal(saved.status, 200);
    assert.notEqual((saved.body as DashboardBody).updatedAt, before.updatedAt);

    const { body } = await app.call("GET", "/dashboards/default");
    assert.deepEqual((body as DashboardBody).layout, halves);
    assert.equal((body as DashboardBody).isDefault, false);
  } finally {
    await app.close();
  }
});

test("an invalid layout is refused with the path of what is wrong", async () => {
  const app = await api();
  try {
    const before = (await app.call("GET", "/dashboards/default")).body as DashboardBody;
    const bad = { version: 1, widgets: [{ id: "m", type: "geo-map", width: "third", props: {} }] };
    const { status, body } = await app.call("PUT", "/dashboards/default", { layout: bad, updatedAt: before.updatedAt });
    assert.equal(status, 400);
    assert.match(body.error.message, /^layout\.widgets\.0\.width: /);
  } finally {
    await app.close();
  }
});

test("a save based on a stale copy is a conflict that carries the current one", async () => {
  const app = await api();
  try {
    const before = (await app.call("GET", "/dashboards/default")).body as DashboardBody;
    // Another tab saves first.
    await app.call("PUT", "/dashboards/default", { layout: halves, updatedAt: before.updatedAt });

    const { status, body } = await app.call("PUT", "/dashboards/default", {
      layout: DEFAULT_LAYOUT,
      updatedAt: before.updatedAt,
    });
    assert.equal(status, 409);
    assert.deepEqual((body.current as DashboardBody).layout, halves);
  } finally {
    await app.close();
  }
});

test("reset forgets the customisation and follows the default again", async () => {
  const app = await api();
  try {
    const before = (await app.call("GET", "/dashboards/default")).body as DashboardBody;
    await app.call("PUT", "/dashboards/default", { layout: halves, updatedAt: before.updatedAt });

    const { status, body } = await app.call("DELETE", "/dashboards/default/layout");
    assert.equal(status, 200);
    assert.equal((body as DashboardBody).isDefault, true);
    assert.deepEqual((body as DashboardBody).layout, DEFAULT_LAYOUT);
    const row = app.runtime.db.prepare("SELECT layout FROM dashboards WHERE id = 'default'").get() as {
      layout: string | null;
    };
    assert.equal(row.layout, null);
  } finally {
    await app.close();
  }
});

test("a stored layout this version cannot read is served as the default, flagged", async () => {
  const app = await api();
  try {
    app.runtime.db.prepare("UPDATE dashboards SET layout = ? WHERE id = 'default'").run('{"version":9}');
    const { status, body } = await app.call("GET", "/dashboards/default");
    assert.equal(status, 200);
    assert.deepEqual((body as DashboardBody).layout, DEFAULT_LAYOUT);
    assert.equal((body as DashboardBody).layoutInvalid, true);
  } finally {
    await app.close();
  }
});

test("a dashboard that does not exist is a 404 on every route", async () => {
  const app = await api();
  try {
    assert.equal((await app.call("GET", "/dashboards/ops")).status, 404);
    assert.equal(
      (await app.call("PUT", "/dashboards/ops", { layout: halves, updatedAt: "2026-01-01T00:00:00.000Z" })).status,
      404,
    );
    assert.equal((await app.call("DELETE", "/dashboards/ops/layout")).status, 404);
  } finally {
    await app.close();
  }
});
