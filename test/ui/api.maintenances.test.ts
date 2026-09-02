import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { updateService } from "../../src/ui/dbConfigSource.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { MaintenanceWindow } from "../../src/core/types.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-maint-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    get: async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

const window = (id: string, over: Partial<MaintenanceWindow> = {}): MaintenanceWindow => ({
  id,
  name: "Scheduled network maintenance",
  status: "in_progress",
  startsAt: new Date(Date.now() - 3600 * 1000).toISOString(),
  endsAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  componentIds: [],
  ...over,
});

interface StatusBody {
  serverNow: string;
  providers: {
    id: string;
    maintenance: { active: MaintenanceWindow[]; upcoming: MaintenanceWindow[] };
  }[];
}

interface MaintenancesBody {
  maintenances: (MaintenanceWindow & { providerId: string; firstSeenAt: string; lastSeenAt: string })[];
}

test("status reports a currently running window under active, not upcoming", async () => {
  const app = await api();
  try {
    const startsAt = new Date(Date.now() - 3600 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 3600 * 1000).toISOString();
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [window("running", { startsAt, endsAt })],
      fetchedAt: new Date().toISOString(),
    });

    const { status, body } = await app.get("/status");
    assert.equal(status, 200);
    const payload = body as StatusBody;
    const github = payload.providers.find((provider) => provider.id === "github");
    assert.equal(github?.maintenance.active.map((w) => w.id).includes("running"), true);
    assert.equal(github?.maintenance.upcoming.map((w) => w.id).includes("running"), false);
  } finally {
    await app.close();
  }
});

test("status reports a window starting tomorrow as upcoming, not active", async () => {
  const app = await api();
  try {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [window("future", { startsAt: tomorrow, endsAt: null })],
      fetchedAt: new Date().toISOString(),
    });

    const { body } = await app.get("/status");
    const payload = body as StatusBody;
    const github = payload.providers.find((provider) => provider.id === "github");
    assert.equal(github?.maintenance.upcoming.map((w) => w.id).includes("future"), true);
    assert.equal(github?.maintenance.active.map((w) => w.id).includes("future"), false);
  } finally {
    await app.close();
  }
});

test("a window that has already ended appears in neither active nor upcoming", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [
        window("ended", { startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2020-01-01T02:00:00.000Z" }),
      ],
      fetchedAt: new Date().toISOString(),
    });

    const { body } = await app.get("/status");
    const payload = body as StatusBody;
    const github = payload.providers.find((provider) => provider.id === "github");
    assert.equal(github?.maintenance.active.map((w) => w.id).includes("ended"), false);
    assert.equal(github?.maintenance.upcoming.map((w) => w.id).includes("ended"), false);
  } finally {
    await app.close();
  }
});

test("maintenances filters by provider", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [window("gh-1")],
      fetchedAt: new Date().toISOString(),
    });
    await app.runtime.store.saveStatus({
      provider: "cloudflare",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [window("cf-1")],
      fetchedAt: new Date().toISOString(),
    });

    const { status, body } = await app.get("/maintenances?provider=github");
    assert.equal(status, 200);
    const payload = body as MaintenancesBody;
    assert.deepEqual(
      payload.maintenances.map((row) => row.providerId),
      ["github"],
    );
  } finally {
    await app.close();
  }
});

test("maintenances excludes a disabled provider's rows exactly as /incidents does", async () => {
  const app = await api();
  try {
    await app.runtime.store.saveStatus({
      provider: "github",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [window("gh-1")],
      fetchedAt: new Date().toISOString(),
    });
    await app.runtime.store.saveStatus({
      provider: "cloudflare",
      overallStatus: "operational",
      activeIncidents: [],
      components: [],
      maintenances: [window("cf-1")],
      fetchedAt: new Date().toISOString(),
    });
    updateService(app.runtime.db, "cloudflare", { enabled: false });

    const { status, body } = await app.get("/maintenances");
    assert.equal(status, 200);
    const payload = body as MaintenancesBody;
    assert.deepEqual(
      payload.maintenances.filter((row) => row.providerId === "cloudflare"),
      [],
    );
    assert.equal(
      payload.maintenances.some((row) => row.providerId === "github"),
      true,
    );
  } finally {
    await app.close();
  }
});
