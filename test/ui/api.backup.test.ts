import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { backupFilename } from "../../src/ui/dbBackup.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  dir: string;
  getBytes: (path: string) => Promise<{ status: number; bytes: Buffer; headers: Headers }>;
  postJson: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  postFile: (path: string, bytes: Buffer) => Promise<{ status: number; body: unknown }>;
  getJson: (path: string) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

async function api(): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-backup-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;

  return {
    runtime,
    dir,
    getBytes: async (path) => {
      const response = await fetch(url(path));
      return {
        status: response.status,
        bytes: Buffer.from(await response.arrayBuffer()),
        headers: response.headers,
      };
    },
    getJson: async (path) => {
      const response = await fetch(url(path));
      return { status: response.status, body: (await response.json()) as unknown };
    },
    postJson: async (path, body) => {
      const response = await fetch(url(path), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    postFile: async (path, bytes) => {
      const response = await fetch(url(path), {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array(bytes),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

const service = (id: string) => ({
  id,
  name: id,
  adapter: "statuspage",
  baseUrl: `https://${id}.example.com`,
});

test("the backup is a downloadable SQLite file, dated, and says what it leaves behind", async () => {
  const app = await api();
  try {
    const { status, bytes, headers } = await app.getBytes("/config/backup");

    assert.equal(status, 200);
    assert.match(headers.get("content-type") ?? "", /application\/octet-stream/);
    assert.equal(
      headers.get("content-disposition"),
      `attachment; filename="${backupFilename(new Date())}"`,
    );
    // The credentials live in secrets.env beside the database (roadmap 5.17)
    // and are the one thing this does not carry.
    assert.equal(headers.get("x-isitdown-secrets"), "excluded");
    assert.equal(bytes.subarray(0, 16).toString("utf8"), "SQLite format 3\0");
  } finally {
    await app.close();
  }
});

test("a backup taken now, restored later, brings the fleet back as it was", async () => {
  const app = await api();
  try {
    await app.postJson("/config/services", service("wireguard"));
    const backup = await app.getBytes("/config/backup");

    // A provider added after the snapshot, which the restore has to take away.
    const added = await app.postJson("/config/services", service("mailcow"));
    assert.equal(added.status, 201);

    const { status, body } = await app.postFile("/config/restore", backup.bytes);

    assert.equal(status, 200);
    assert.equal((body as { tables: Record<string, number> }).tables["services"] > 0, true);
    const config = await app.getJson("/config");
    const ids = (config.body.services as { id: string }[]).map((entry) => entry.id);
    assert.ok(ids.includes("wireguard"), "the provider in the backup is back");
    assert.ok(!ids.includes("mailcow"), "the provider added after it is gone");
  } finally {
    await app.close();
  }
});

test("the restore reports the schema it read and that the credentials stayed put", async () => {
  const app = await api();
  try {
    const backup = await app.getBytes("/config/backup");
    // A credentials file beside the database, as a dashboard save would write.
    await writeFile(join(app.dir, "secrets.env"), "TELEGRAM_BOT_TOKEN=kept\n", { mode: 0o600 });

    const { body } = await app.postFile("/config/restore", backup.bytes);
    const report = body as { fromSchemaVersion: number; schemaVersion: number; secretsKept: boolean };

    assert.equal(report.fromSchemaVersion, report.schemaVersion);
    assert.equal(report.secretsKept, true);
  } finally {
    await app.close();
  }
});

test("the dashboard keeps working on the same handle: no restart to see the restore", async () => {
  const app = await api();
  try {
    await app.postJson("/config/services", service("nextcloud"));
    const backup = await app.getBytes("/config/backup");
    await app.postFile("/config/restore", backup.bytes);

    // Reads that go through the runtime's own open handle, after the swap.
    const status = await app.getJson("/status");
    assert.equal(status.status, 200);
    const storage = await app.getJson("/config/storage");
    assert.equal(storage.status, 200);
  } finally {
    await app.close();
  }
});

test("a file that is not a database is refused before anything is deleted", async () => {
  const app = await api();
  try {
    await app.postJson("/config/services", service("gitea"));

    const { status, body } = await app.postFile("/config/restore", Buffer.from("not a database"));

    assert.equal(status, 400);
    assert.match((body as { error: { message: string } }).error.message, /not a SQLite database/);
    const config = await app.getJson("/config");
    assert.ok((config.body.services as { id: string }[]).some((entry) => entry.id === "gitea"));
  } finally {
    await app.close();
  }
});

test("somebody else's SQLite file is refused too", async () => {
  const app = await api();
  try {
    const other = await mkdtemp(join(tmpdir(), "isitdown-other-"));
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(other, "other.db"));
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY)");
    db.close();
    const { readFile } = await import("node:fs/promises");

    const { status, body } = await app.postFile("/config/restore", await readFile(join(other, "other.db")));

    assert.equal(status, 400);
    assert.match((body as { error: { message: string } }).error.message, /not an IsItDown backup/);
  } finally {
    await app.close();
  }
});

test("an empty request is a request error, not an empty restore", async () => {
  const app = await api();
  try {
    const { status, body } = await app.postFile("/config/restore", Buffer.alloc(0));

    assert.equal(status, 400);
    assert.match((body as { error: { message: string } }).error.message, /request body/);
  } finally {
    await app.close();
  }
});
