import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { parse } from "yaml";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { loadConfig } from "../../src/light/config/loadConfig.ts";
import { writeFile } from "node:fs/promises";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  get: (path: string) => Promise<{ status: number; text: string; headers: Headers }>;
  postYaml: (path: string, yaml: string) => Promise<{ status: number; body: unknown }>;
  postJson: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  putJson: (path: string, body: unknown) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-configfile-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  const send = async (path: string, contentType: string, body: string, method = "POST") => {
    const response = await fetch(url(path), { method, headers: { "content-type": contentType }, body });
    const text = await response.text();
    return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
  };

  return {
    runtime,
    get: async (path) => {
      const response = await fetch(url(path));
      return { status: response.status, text: await response.text(), headers: response.headers };
    },
    postYaml: (path, yaml) => send(path, "text/yaml", yaml),
    postJson: (path, body) => send(path, "application/json", JSON.stringify(body)),
    putJson: (path, body) => send(path, "application/json", JSON.stringify(body), "PUT"),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

test("the export is a download the Light edition's own loader accepts", async () => {
  const app = await api();
  try {
    const { status, headers, text } = await app.get("/config/export");

    assert.equal(status, 200);
    assert.match(headers.get("content-type") ?? "", /^text\/yaml/);
    assert.match(
      headers.get("content-disposition") ?? "",
      /^attachment; filename="isitdown-config-\d{4}-\d{2}-\d{2}\.yml"$/,
    );

    // The real proof: the file is not "yaml that looks right", it is a file the
    // other edition starts on. Read it with the Light loader itself.
    const dir = await mkdtemp(join(tmpdir(), "isitdown-roundtrip-"));
    const path = join(dir, "config.yml");
    await writeFile(path, text, "utf8");
    const config = await loadConfig(path, { TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_CHAT_ID: "-100" });

    assert.deepEqual(
      config.services.map((service) => service.id).sort(),
      app.runtime.listAllServices().map((service) => service.id).sort(),
    );
    assert.equal(config.polling.intervalMinutes > 0, true);
  } finally {
    await app.close();
  }
});

test("a credential leaves as a reference, never as a value", async () => {
  const app = await api({ TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_CHAT_ID: "-100" });
  try {
    const { text } = await app.get("/config/export");

    assert.match(text, /botToken: \$\{TELEGRAM_BOT_TOKEN\}/);
    assert.doesNotMatch(text, /123:ABC/, "the value must never reach the file");
    assert.doesNotMatch(text, /-100/);
  } finally {
    await app.close();
  }
});

test("a service added by the file appears, and one the file omits is removed but restorable", async () => {
  const app = await api();
  try {
    const before = app.runtime.listAllServices().map((service) => service.id);
    assert.ok(before.length > 1, "the seeded fleet is what the omission is measured against");
    const kept = before[0] as string;

    const { status, body } = await app.postYaml(
      "/config/import",
      `services:\n  - id: ${kept}\n    name: Kept\n    adapter: statuspage\n    baseUrl: https://status.kept.test\n  - id: newcomer\n    name: Newcomer\n    adapter: statuspage\n    baseUrl: https://status.newcomer.test\n`,
    );

    assert.equal(status, 200, JSON.stringify(body));
    const report = body as { added: string[]; updated: string[]; removed: string[] };
    assert.deepEqual(report.added, ["newcomer"]);
    assert.deepEqual(report.updated, [kept]);
    assert.deepEqual(report.removed.sort(), before.slice(1).sort());

    const now = app.runtime.listAllServices();
    assert.deepEqual(now.map((service) => service.id).sort(), [kept, "newcomer"].sort());
    assert.equal(now.find((service) => service.id === kept)?.name, "Kept");

    // Removed the way the dashboard removes: still restorable, history intact.
    const config = (await app.get("/config")).text;
    assert.match(config, new RegExp(`"removed":\\[.*${before[1] as string}`));
  } finally {
    await app.close();
  }
});

test("a literal credential is refused, and nothing at all is written", async () => {
  const app = await api();
  try {
    const before = app.runtime.listAllServices().map((service) => service.id).sort();

    const { status, body } = await app.postYaml(
      "/config/import",
      `services:\n  - id: only\n    name: Only\n    adapter: statuspage\n    baseUrl: https://status.only.test\nnotifications:\n  telegram:\n    enabled: true\n    botToken: "123:ABC-real-secret"\n    chatId: "\${TELEGRAM_CHAT_ID}"\n`,
    );

    assert.equal(status, 400);
    assert.match((body as { error: { message: string } }).error.message, /never a literal value/);
    assert.deepEqual(
      app.runtime.listAllServices().map((service) => service.id).sort(),
      before,
      "a refused import must not have removed the fleet on its way to the error",
    );
  } finally {
    await app.close();
  }
});

test("an invalid file is refused with the field that is wrong", async () => {
  const app = await api();
  try {
    const bad = await app.postYaml("/config/import", "services: []\n");
    assert.equal(bad.status, 400);
    assert.match((bad.body as { error: { message: string } }).error.message, /services/);

    const notYaml = await app.postYaml("/config/import", "services: [\n  - broken\n");
    assert.equal(notYaml.status, 400);

    const empty = await app.postYaml("/config/import", "   ");
    assert.equal(empty.status, 400);
  } finally {
    await app.close();
  }
});

test("the file can arrive as JSON, for a browser that would rather send it that way", async () => {
  const app = await api();
  try {
    const { status, body } = await app.postJson("/config/import", {
      yaml: "pollIntervalMinutes: 9\nservices:\n  - id: solo\n    name: Solo\n    adapter: statuspage\n    baseUrl: https://status.solo.test\n",
    });

    assert.equal(status, 200, JSON.stringify(body));
    assert.ok((body as { settings: string[] }).settings.includes("pollIntervalMinutes"));

    const exported = parse((await app.get("/config/export")).text) as { pollIntervalMinutes: number };
    assert.equal(exported.pollIntervalMinutes, 9, "what came in comes back out");
  } finally {
    await app.close();
  }
});

test("routing survives a round trip, and an absent routing block leaves the rules alone", async () => {
  const app = await api();
  try {
    await app.putJson("/config/routing", {
      rules: [{ provider: "*", channels: ["telegram"], events: ["status_change"], minSeverity: "degraded" }],
    });

    const exported = (await app.get("/config/export")).text;
    assert.match(exported, /routing:/);

    const { status } = await app.postYaml(
      "/config/import",
      `services:\n  - id: solo\n    name: Solo\n    adapter: statuspage\n    baseUrl: https://status.solo.test\n`,
    );
    assert.equal(status, 200);

    const after = parse((await app.get("/config/export")).text) as { routing: { channels: string[] }[] };
    assert.deepEqual(after.routing[0]?.channels, ["telegram"], "no routing block means leave the routing alone");
  } finally {
    await app.close();
  }
});
