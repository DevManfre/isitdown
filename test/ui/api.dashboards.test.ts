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

// Roadmap 4.2 — more than one dashboard.

interface SummaryBody {
  id: string;
  name: string;
  home: boolean;
  isDefault: boolean;
  updatedAt: string;
}

test("a fresh install lists one dashboard, the Overview, as home", async () => {
  const app = await api();
  try {
    const { status, body } = await app.call("GET", "/dashboards");
    assert.equal(status, 200);
    assert.deepEqual(
      (body as SummaryBody[]).map(({ id, name, home, isDefault }) => ({ id, name, home, isDefault })),
      [{ id: "default", name: "Overview", home: true, isDefault: true }],
    );
    assert.equal(((await app.call("GET", "/dashboards/default")).body as { home: boolean }).home, true);
  } finally {
    await app.close();
  }
});

test("a created dashboard gets an id from its name and is listed after the others", async () => {
  const app = await api();
  try {
    const created = await app.call("POST", "/dashboards", { name: "Vendor che pago", layout: halves });
    assert.equal(created.status, 201);
    assert.equal(created.body.id, "vendor-che-pago");
    assert.equal(created.body.home, false);
    assert.deepEqual(created.body.layout, halves);
    const again = await app.call("POST", "/dashboards", { name: "Vendor  che pago!" });
    assert.equal(again.body.id, "vendor-che-pago-2");
    // No layout given: it follows the code default, like the Overview did.
    assert.equal(again.body.isDefault, true);
    const list = (await app.call("GET", "/dashboards")).body as SummaryBody[];
    assert.deepEqual(
      list.map((d) => d.id),
      ["default", "vendor-che-pago", "vendor-che-pago-2"],
    );
  } finally {
    await app.close();
  }
});

test("two dashboards cannot share a name, whatever its case", async () => {
  const app = await api();
  try {
    assert.equal((await app.call("POST", "/dashboards", { name: "My stack" })).status, 201);
    const clash = await app.call("POST", "/dashboards", { name: "  my STACK " });
    assert.equal(clash.status, 409);
    const blank = await app.call("POST", "/dashboards", { name: "   " });
    assert.equal(blank.status, 400);
    const rename = await app.call("PATCH", "/dashboards/default", { name: "my stack" });
    assert.equal(rename.status, 409);
  } finally {
    await app.close();
  }
});

test("renaming keeps the layout version, so an open edit can still save", async () => {
  const app = await api();
  try {
    const before = (await app.call("GET", "/dashboards/default")).body as DashboardBody;
    const renamed = await app.call("PATCH", "/dashboards/default", { name: "Il mio stack" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.name, "Il mio stack");
    assert.equal(renamed.body.updatedAt, before.updatedAt);
    const saved = await app.call("PUT", "/dashboards/default", { layout: halves, updatedAt: before.updatedAt });
    assert.equal(saved.status, 200);
  } finally {
    await app.close();
  }
});

test("exactly one dashboard is home, and choosing another moves it", async () => {
  const app = await api();
  try {
    await app.call("POST", "/dashboards", { name: "Ops" });
    const moved = await app.call("PATCH", "/dashboards/ops", { home: true });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.home, true);
    const list = (await app.call("GET", "/dashboards")).body as SummaryBody[];
    assert.deepEqual(
      list.filter((d) => d.home).map((d) => d.id),
      ["ops"],
    );
    assert.equal((await app.call("PATCH", "/dashboards/ops", { home: false })).status, 400);
  } finally {
    await app.close();
  }
});

test("deleting the home dashboard hands home to the first one left, and the last one stays", async () => {
  const app = await api();
  try {
    await app.call("POST", "/dashboards", { name: "Ops" });
    await app.call("POST", "/dashboards", { name: "Pay" });
    await app.call("PATCH", "/dashboards/pay", { home: true });
    assert.equal((await app.call("DELETE", "/dashboards/pay")).status, 200);
    const list = (await app.call("GET", "/dashboards")).body as SummaryBody[];
    assert.deepEqual(
      list.map((d) => [d.id, d.home]),
      [
        ["default", true],
        ["ops", false],
      ],
    );
    assert.equal((await app.call("DELETE", "/dashboards/default")).status, 200);
    const last = await app.call("DELETE", "/dashboards/ops");
    assert.equal(last.status, 409);
    assert.equal((await app.call("DELETE", "/dashboards/nope")).status, 404);
  } finally {
    await app.close();
  }
});

test("a database restored without a home flag still has a home: the first dashboard", async () => {
  const app = await api();
  try {
    await app.call("POST", "/dashboards", { name: "Ops" });
    app.runtime.db.prepare("UPDATE dashboards SET home = 0").run();
    const list = (await app.call("GET", "/dashboards")).body as SummaryBody[];
    assert.deepEqual(
      list.map((d) => [d.id, d.home]),
      [
        ["default", true],
        ["ops", false],
      ],
    );
  } finally {
    await app.close();
  }
});

test("an exported dashboard imports as a new one, renamed when its name is taken", async () => {
  const app = await api();
  try {
    const before = (await app.call("GET", "/dashboards/default")).body as DashboardBody;
    await app.call("PUT", "/dashboards/default", { layout: halves, updatedAt: before.updatedAt });
    const exported = await app.call("GET", "/dashboards/default/export");
    assert.equal(exported.status, 200);
    assert.deepEqual(exported.body, { format: "isitdown.dashboard", version: 1, name: "Overview", layout: halves });

    const imported = await app.call("POST", "/dashboards/import", exported.body);
    assert.equal(imported.status, 201);
    assert.equal(imported.body.name, "Overview (2)");
    assert.deepEqual(imported.body.layout, halves);
    assert.equal(imported.body.home, false);

    // A never-customised dashboard exports what it draws, not a NULL.
    await app.call("POST", "/dashboards", { name: "Blank" });
    const plain = await app.call("GET", "/dashboards/blank/export");
    assert.deepEqual(plain.body.layout, DEFAULT_LAYOUT);
  } finally {
    await app.close();
  }
});

test("an import that is not a dashboard export is refused with what is wrong", async () => {
  const app = await api();
  try {
    const wrong = await app.call("POST", "/dashboards/import", { format: "isitdown.dashboard", version: 1, name: "X" });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error.message, /layout/);
    const other = await app.call("POST", "/dashboards/import", { name: "X", layout: halves });
    assert.equal(other.status, 400);
    assert.equal(((await app.call("GET", "/dashboards")).body as SummaryBody[]).length, 1);
  } finally {
    await app.close();
  }
});

test("there is a ceiling on how many dashboards there can be", async () => {
  const app = await api();
  try {
    for (let i = 1; i < 20; i++) {
      assert.equal((await app.call("POST", "/dashboards", { name: `D${i}` })).status, 201);
    }
    const over = await app.call("POST", "/dashboards", { name: "One too many" });
    assert.equal(over.status, 409);
  } finally {
    await app.close();
  }
});

test("a deleted dashboard comes back by undo: same id, same place, home again", async () => {
  const app = await api();
  try {
    await app.call("POST", "/dashboards", { name: "Ops", layout: halves });
    await app.call("POST", "/dashboards", { name: "Pay" });
    await app.call("PATCH", "/dashboards/ops", { home: true });
    const deleted = await app.call("DELETE", "/dashboards/ops");
    assert.equal(deleted.status, 200);
    assert.deepEqual(
      { ...deleted.body, layout: JSON.parse(deleted.body.layout) },
      { id: "ops", name: "Ops", layout: halves, position: 1, home: true },
    );

    const restored = await app.call("POST", "/dashboards/restore", deleted.body);
    assert.equal(restored.status, 201);
    assert.deepEqual(restored.body.layout, halves);
    const list = (await app.call("GET", "/dashboards")).body as SummaryBody[];
    assert.deepEqual(
      list.map((d) => [d.id, d.home]),
      [
        ["default", false],
        ["ops", true],
        ["pay", false],
      ],
    );
    // Twice is not two copies.
    assert.equal((await app.call("POST", "/dashboards/restore", deleted.body)).status, 409);
    assert.equal((await app.call("POST", "/dashboards/restore", { ...deleted.body, id: "../x" })).status, 400);
  } finally {
    await app.close();
  }
});
