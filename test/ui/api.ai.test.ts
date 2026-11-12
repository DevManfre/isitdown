import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import type { Adapter } from "../../src/core/adapter.interface.ts";
import type { SummaryDeps } from "../../src/ui/incidentSummary.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  dir: string;
  send: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

/** What the next request's adapter and model client are; swapped per step. */
const seams: { adapter: (id: string) => Adapter; anthropic: NonNullable<SummaryDeps["anthropic"]> | undefined } = {
  adapter: () => ({ id: "none", fetchStatus: async () => { throw new Error("unused"); } }) as Adapter,
  anthropic: undefined,
};

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-ai-api-"));
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env,
    logger: silent,
    getAdapter: (id) => seams.adapter(id),
    summaryDeps: { anthropic: (key) => (seams.anthropic as NonNullable<SummaryDeps["anthropic"]>)(key) },
  });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    dir,
    send: async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      runtime.close();
    },
  };
}

test("AI settings start off, and a patch is validated and stored", async () => {
  const app = await api();
  try {
    const start = await app.send("GET", "/config/ai");
    assert.equal(start.status, 200);
    assert.equal(start.body.provider, "off");
    assert.deepEqual(start.body.key, { envVar: "AI_API_KEY", set: false, saved: false });
    assert.equal(typeof start.body.claudeCli, "boolean");

    assert.equal((await app.send("PATCH", "/config/ai", { provider: "skynet" })).status, 400);
    assert.equal((await app.send("PATCH", "/config/ai", { baseUrl: "not a url" })).status, 400);
    assert.equal((await app.send("PATCH", "/config/ai", { apiKey: "sk" })).status, 400, "the key never rides on the settings patch");

    const saved = await app.send("PATCH", "/config/ai", { provider: "openai", model: "llama3", baseUrl: "http://ollama:11434/v1" });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.provider, "openai");
    assert.equal(saved.body.model, "llama3");
    assert.equal((await app.send("GET", "/config/ai")).body.baseUrl, "http://ollama:11434/v1");
  } finally {
    await app.close();
  }
});

test("the AI key is write-only: saved beside the database, reported only as set", async () => {
  const app = await api();
  try {
    const put = await app.send("PUT", "/config/ai/key", { value: "sk-secret-value" });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.key, { envVar: "AI_API_KEY", set: true, saved: true });
    assert.doesNotMatch(JSON.stringify((await app.send("GET", "/config/ai")).body), /sk-secret-value/);
    assert.match(await readFile(join(app.dir, "secrets.env"), "utf8"), /^AI_API_KEY=sk-secret-value$/m);
    assert.equal(app.runtime.env["AI_API_KEY"], "sk-secret-value");

    assert.equal((await app.send("PUT", "/config/ai/key", { value: "two\nlines" })).status, 400);

    const cleared = await app.send("DELETE", "/config/ai/key");
    assert.deepEqual(cleared.body.key, { envVar: "AI_API_KEY", set: false, saved: false });
    assert.equal((await app.send("DELETE", "/config/ai/key")).status, 409);
  } finally {
    await app.close();
  }
});

test("a key the container supplied is reported set but cannot be cleared from the dashboard", async () => {
  const app = await api({ AI_API_KEY: "from-compose" });
  try {
    assert.deepEqual((await app.send("GET", "/config/ai")).body.key, { envVar: "AI_API_KEY", set: true, saved: false });
    assert.equal((await app.send("DELETE", "/config/ai/key")).status, 409);
  } finally {
    await app.close();
  }
});

async function openIncident(app: Api): Promise<string> {
  const providerId = app.runtime.listAllServices()[0]?.id as string;
  await app.runtime.store.saveStatus({
    provider: providerId,
    overallStatus: "major_outage",
    activeIncidents: [{ id: "inc-1", name: "Elevated API errors", impact: "major", status: "monitoring", updatedAt: new Date().toISOString() }],
    components: [],
    maintenances: [],
    fetchedAt: new Date().toISOString(),
  });
  return providerId;
}

const adapterWith = (updates: Adapter["fetchIncidentUpdates"]): ((id: string) => Adapter) => () =>
  ({ id: "fake", fetchStatus: async () => { throw new Error("unused"); }, fetchIncidentUpdates: updates }) as Adapter;

test("a summary is refused while AI is off, and for an unknown incident", async () => {
  const app = await api();
  try {
    const providerId = await openIncident(app);
    const off = await app.send("POST", `/incidents/${providerId}/inc-1/summary`, {});
    assert.equal(off.status, 409);
    assert.equal(off.body.error.code, "not-configured");

    await app.send("PATCH", "/config/ai", { provider: "anthropic" });
    assert.equal((await app.send("POST", `/incidents/${providerId}/nope/summary`, {})).status, 404);
  } finally {
    await app.close();
  }
});

test("a summary reads the provider's updates live and hands them to the chosen model", async () => {
  const app = await api({ AI_API_KEY: "sk-test" });
  try {
    const providerId = await openIncident(app);
    const asked: { incidentId: string }[] = [];
    const sent: { system: string; messages: { content: string }[] }[] = [];
    seams.adapter = adapterWith(async (_service, incidentId) => {
      asked.push({ incidentId });
      return [
        { at: "2026-11-01T10:00:00Z", status: "investigating", body: "Errors on the API." },
        { at: "2026-11-01T10:30:00Z", status: "monitoring", body: "Fix deployed." },
      ];
    });
    seams.anthropic = (() =>
        ({
          beta: {
            messages: {
              create: async (body: never) => {
                sent.push(body);
                return { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "Errori API, fix rilasciato." }] };
              },
            },
          },
        }) as never);
    await app.send("PATCH", "/config/ai", { provider: "anthropic" });

    const result = await app.send("POST", `/incidents/${providerId}/inc-1/summary`, { locale: "it" });
    assert.equal(result.status, 200);
    assert.equal(result.body.summary, "Errori API, fix rilasciato.");
    assert.equal(result.body.model, "claude-opus-5-5");
    assert.equal(result.body.updates, 2);
    assert.deepEqual(asked, [{ incidentId: "inc-1" }]);
    assert.match(sent[0]?.system ?? "", /Italian/);
    assert.match(sent[0]?.messages[0]?.content ?? "", /Fix deployed\./);
  } finally {
    await app.close();
  }
});

test("no updates, an unreadable feed and a model error are each told apart", async () => {
  const app = await api();
  try {
    const providerId = await openIncident(app);
    await app.send("PATCH", "/config/ai", { provider: "anthropic" });

    seams.adapter = adapterWith(async () => []);
    const empty = await app.send("POST", `/incidents/${providerId}/inc-1/summary`, {});
    assert.equal(empty.status, 422);
    assert.equal(empty.body.error.code, "no-updates");

    seams.adapter = adapterWith(async () => {
      throw new Error("HTTP 503");
    });
    const down = await app.send("POST", `/incidents/${providerId}/inc-1/summary`, {});
    assert.equal(down.status, 502);
    assert.equal(down.body.error.code, "updates");

    seams.adapter = adapterWith(async () => [{ at: "2026-11-01T10:00:00Z", status: "x", body: "y" }]);
    const noKey = await app.send("POST", `/incidents/${providerId}/inc-1/summary`, {});
    assert.equal(noKey.status, 409);
    assert.equal(noKey.body.error.code, "no-key");
  } finally {
    await app.close();
  }
});

test("saving and clearing the AI key is audited without its value", async () => {
  const app = await api();
  try {
    await app.send("PUT", "/config/ai/key", { value: "sk-audit-me" });
    await app.send("DELETE", "/config/ai/key");
    const rows = app.runtime.db.prepare("SELECT * FROM config_audit WHERE target = 'ai'").all() as Record<string, unknown>[];
    assert.equal(rows.length, 2);
    assert.doesNotMatch(JSON.stringify(rows), /sk-audit-me/);
  } finally {
    await app.close();
  }
});

test("the Claude Code token is a second write-only credential, reported apart from the API key", async () => {
  const app = await api();
  try {
    const start = await app.send("GET", "/config/ai");
    assert.deepEqual(start.body.cliToken, { envVar: "CLAUDE_CODE_OAUTH_TOKEN", set: false, saved: false });
    const put = await app.send("PUT", "/config/ai/cli-token", { value: "sk-ant-oat-test" });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.cliToken, { envVar: "CLAUDE_CODE_OAUTH_TOKEN", set: true, saved: true });
    assert.equal(put.body.key.set, false, "the API key is untouched");
    assert.equal(app.runtime.env["CLAUDE_CODE_OAUTH_TOKEN"], "sk-ant-oat-test");
    assert.doesNotMatch(JSON.stringify(put.body), /sk-ant-oat-test/);
    assert.equal((await app.send("PUT", "/config/ai/anything", { value: "x" })).status, 404, "only the two named credentials");
    assert.equal((await app.send("DELETE", "/config/ai/cli-token")).status, 200);
    assert.equal(app.runtime.env["CLAUDE_CODE_OAUTH_TOKEN"], undefined);
  } finally {
    await app.close();
  }
});
