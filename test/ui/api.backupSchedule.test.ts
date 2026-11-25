import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

/** Roadmap 10.1: the Data section's three calls — read, change, run now. */

const silent = createLogger("error", () => {});

async function api(env: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-backup-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: `http://127.0.0.1:${port}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  return {
    dir,
    call,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

test("a fresh instance reports scheduled backups off, never run, into the data folder", async () => {
  const { dir, call, close } = await api();
  try {
    const { status, body } = await call("GET", "/config/backup/schedule");
    assert.equal(status, 200);
    assert.equal(body.cron, "");
    assert.equal(body.keep, 7);
    assert.equal(body.dir, join(dir, "backups"));
    assert.equal(body.nextAt, null);
    assert.equal(body.lastOkAt, null);
    assert.deepEqual(body.uploads, []);
  } finally {
    await close();
  }
});

test("a schedule saved from the dashboard arms the next run; a bad one is refused with the field at fault", async () => {
  const { call, close } = await api();
  try {
    const bad = await call("PUT", "/config/backup/schedule", { cron: "0 25 * * *" });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error.message, /hour/);

    const saved = await call("PUT", "/config/backup/schedule", { cron: "0 3 * * *", keep: 14 });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.cron, "0 3 * * *");
    assert.equal(saved.body.keep, 14);
    assert.deepEqual(saved.body.source, { cron: "settings", keep: "settings" });
    assert.ok(saved.body.nextAt !== null && Date.parse(saved.body.nextAt) > Date.now());

    const off = await call("PUT", "/config/backup/schedule", { cron: "" });
    assert.equal(off.body.nextAt, null);
  } finally {
    await close();
  }
});

test("a field the environment sets cannot be changed from the dashboard", async () => {
  const { call, close } = await api({ BACKUP_CRON: "0 4 * * *" });
  try {
    const refused = await call("PUT", "/config/backup/schedule", { cron: "0 3 * * *" });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /BACKUP_CRON/);
    const keep = await call("PUT", "/config/backup/schedule", { keep: 3 });
    assert.equal(keep.status, 200, "the other half is still the dashboard's");
  } finally {
    await close();
  }
});

test("run now writes a file into the folder and reports it as the last backup", async () => {
  const { dir, call, close } = await api();
  try {
    const { status, body } = await call("POST", "/config/backup/run");
    assert.equal(status, 200);
    assert.ok(body.lastOkAt !== null);
    assert.equal(body.lastError, null);
    const files = await readdir(join(dir, "backups"));
    assert.equal(files.length, 1);
    assert.equal(join(dir, "backups", files[0]!), body.lastFile);
  } finally {
    await close();
  }
});
