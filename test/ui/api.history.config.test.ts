import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { diffAuditDocuments } from "../../src/ui/configAudit.ts";

const silent = createLogger("error", () => {});

async function api(env: NodeJS.ProcessEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-audit-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };
  const history = async (query = "") =>
    ((await call("GET", `/config/history${query}`)).body as { entries: Entry[] }).entries;
  return {
    runtime, call, history,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

interface Entry {
  id: number; actor: string; method: string; kind: string; target: string; field: string;
  before: unknown; after: unknown; revertible: boolean;
}

test("a fresh install has an empty trail", async () => {
  const app = await api();
  try {
    assert.deepEqual(await app.history(), []);
  } finally {
    await app.close();
  }
});

test("a setting change records the old and the new value, with the actor", async () => {
  const app = await api({ AUDIT_ACTOR_HEADER: "x-forwarded-user" });
  try {
    const old = ((await app.call("GET", "/config")).body as { polling: { intervalMinutes: number } }).polling.intervalMinutes;
    const patched = await app.call("PATCH", "/config/settings", { intervalMinutes: old + 4 }, { "x-forwarded-user": "alice" });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));

    const [entry, ...rest] = await app.history();
    assert.equal(rest.length, 0);
    assert.equal(entry?.kind, "setting");
    assert.equal(entry?.field, "pollIntervalMinutes");
    assert.equal(entry?.before, old);
    assert.equal(entry?.after, old + 4);
    assert.equal(entry?.actor, "alice");
    assert.equal(entry?.revertible, true);
  } finally {
    await app.close();
  }
});

test("without a configured header the actor is local, and the header is ignored", async () => {
  const app = await api();
  try {
    await app.call("PATCH", "/config/settings", { maxRetries: 4 }, { "x-forwarded-user": "mallory" });
    assert.equal((await app.history())[0]?.actor, "local");
  } finally {
    await app.close();
  }
});

test("a provider added, edited and removed shows up as three kinds of entry", async () => {
  const app = await api();
  try {
    await app.call("POST", "/config/services", { id: "acme", name: "Acme", adapter: "statuspage", baseUrl: "http://127.0.0.1:1" });
    await app.call("PATCH", "/config/services/acme", { name: "Acme Inc" });
    await app.call("DELETE", "/config/services/acme");

    const entries = (await app.history("?target=acme")).map((e) => `${e.field}`);
    assert.deepEqual(entries.sort(), ["*", "*", "name"].sort());
    const rename = (await app.history("?target=acme")).find((e) => e.field === "name");
    assert.equal(rename?.before, "Acme");
    assert.equal(rename?.after, "Acme Inc");
  } finally {
    await app.close();
  }
});

test("a mute is recorded", async () => {
  const app = await api();
  try {
    const id = app.runtime.listAllServices()[0]?.id as string;
    const until = new Date(Date.now() + 3600_000).toISOString();
    await app.call("PATCH", `/config/services/${id}`, { mutedUntil: until });
    const mute = (await app.history()).find((e) => e.field === "mutedUntil");
    assert.equal(mute?.target, id);
    assert.equal(mute?.before, null);
    assert.equal(mute?.after, until);
  } finally {
    await app.close();
  }
});

test("a refused write and a read leave nothing behind", async () => {
  const app = await api();
  try {
    await app.call("PATCH", "/config/settings", { retentionDays: 6 });
    await app.call("GET", "/config");
    assert.deepEqual(await app.history(), []);
  } finally {
    await app.close();
  }
});

test("a credential being set is an event with no value in it", async () => {
  const app = await api();
  try {
    const put = await app.call("PUT", "/config/channels/telegram/secrets", { fields: { botToken: "123:ABC-very-secret", chatId: "-100" } });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const entries = await app.history("?kind=credential");
    assert.ok(entries.length > 0);
    assert.equal(entries[0]?.target, "telegram");
    assert.equal(entries[0]?.revertible, false);
    assert.doesNotMatch(JSON.stringify(await app.history()), /ABC-very-secret|-100/);
  } finally {
    await app.close();
  }
});

test("restoring a value writes the old one back, and the restore is itself recorded", async () => {
  const app = await api();
  try {
    const old = ((await app.call("GET", "/config")).body as { polling: { intervalMinutes: number } }).polling.intervalMinutes;
    await app.call("PATCH", "/config/settings", { intervalMinutes: old + 2 });
    const entry = (await app.history())[0] as Entry;

    const reverted = await app.call("POST", `/config/history/${entry.id}/revert`);
    assert.equal(reverted.status, 200, JSON.stringify(reverted.body));
    const now = ((await app.call("GET", "/config")).body as { polling: { intervalMinutes: number } }).polling.intervalMinutes;
    assert.equal(now, old);

    const [latest] = await app.history();
    assert.equal(latest?.field, "pollIntervalMinutes");
    assert.equal(latest?.before, old + 2);
    assert.equal(latest?.after, old);
  } finally {
    await app.close();
  }
});

test("a removed provider comes back through its history entry, and a credential cannot", async () => {
  const app = await api();
  try {
    const id = app.runtime.listAllServices()[0]?.id as string;
    await app.call("DELETE", `/config/services/${id}`);
    const gone = (await app.history()).find((e) => e.target === id && e.field === "*") as Entry;
    assert.equal((await app.call("POST", `/config/history/${gone.id}/revert`)).status, 200);
    assert.ok(app.runtime.listAllServices().some((s) => s.id === id));

    await app.call("PUT", "/config/channels/telegram/secrets", { fields: { botToken: "123:ABC", chatId: "-100" } });
    const credential = (await app.history("?kind=credential"))[0] as Entry;
    assert.equal((await app.call("POST", `/config/history/${credential.id}/revert`)).status, 409);
  } finally {
    await app.close();
  }
});

test("an unknown entry is a 404 and a bad filter a 400", async () => {
  const app = await api();
  try {
    assert.equal((await app.call("POST", "/config/history/999/revert")).status, 404);
    assert.equal((await app.call("POST", "/config/history/abc/revert")).status, 404);
    assert.equal((await app.call("GET", "/config/history?kind=nope")).status, 400);
    assert.equal((await app.call("GET", "/config/history?limit=0")).status, 400);
  } finally {
    await app.close();
  }
});

test("the diff is by top-level value: a changed list is one entry, an unchanged one none", () => {
  const before = { a: 1, services: [{ id: "s", tags: ["x"], name: "S" }], notifications: { telegram: { enabled: true } } };
  const after = { a: 1, services: [{ id: "s", tags: ["x", "y"], name: "S" }], notifications: { telegram: { enabled: false } } };
  const changes = diffAuditDocuments(before, after);
  assert.deepEqual(changes.map((c) => `${c.kind}:${c.target}:${c.field}`).sort(), ["channel:telegram:enabled", "service:s:tags"]);
  assert.deepEqual(diffAuditDocuments(before, before), []);
});
