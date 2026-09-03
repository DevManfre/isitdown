import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

interface Api {
  runtime: UiRuntime;
  request: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: unknown }>;
  close: () => Promise<void>;
}

async function startApi(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-secrets-api-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    runtime,
    request: async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
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

interface DescribedField {
  name: string;
  envVar: string;
  isSet: boolean;
}

const fieldOf = (body: unknown, name: string): DescribedField | undefined =>
  (body as { fields: DescribedField[] }).fields.find((field) => field.name === name);

/** The dashboard reads channel state from GET /config, so assertions do too. */
const channelIn = (body: unknown, id: string): unknown =>
  (body as { channels: { id: string }[] }).channels.find((channel) => channel.id === id);

/** A receiver that records what reached it, standing in for the channel's provider. */
async function receiver(): Promise<{ url: string; received: unknown[]; close: () => Promise<void> }> {
  const received: unknown[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("a saved value configures the channel without a restart", async () => {
  const hook = await receiver();
  const api = await startApi();
  try {
    const saved = await api.request("PUT", "/config/channels/webhook/secrets", {
      fields: { url: hook.url },
    });
    assert.equal(saved.status, 200);
    assert.equal(fieldOf(saved.body, "url")?.isSet, true);

    await api.request("PATCH", "/config/channels/webhook", { enabled: true });
    const test_ = await api.request("POST", "/config/channels/webhook/test");
    assert.deepEqual(test_.body, { ok: true });
    assert.equal(hook.received.length, 1);
  } finally {
    await api.close();
    await hook.close();
  }
});

test("a saved value is never handed back, by any route", async () => {
  const api = await startApi();
  try {
    const secret = "https://example.com/hook-nobody-should-read";
    await api.request("PUT", "/config/channels/webhook/secrets", { fields: { url: secret } });

    const { body } = await api.request("GET", "/config");
    assert.doesNotMatch(JSON.stringify(body ?? {}), /hook-nobody-should-read/, "GET /config leaked the value");
  } finally {
    await api.close();
  }
});

test("a value is refused for a field the channel does not have, or a channel that does not exist", async () => {
  const api = await startApi();
  try {
    const unknownField = await api.request("PUT", "/config/channels/webhook/secrets", {
      fields: { botToken: "123:abc" },
    });
    assert.equal(unknownField.status, 400);

    const unknownChannel = await api.request("PUT", "/config/channels/carrier-pigeon/secrets", {
      fields: { url: "https://example.com/hook" },
    });
    assert.equal(unknownChannel.status, 404);

    const fieldless = await api.request("PUT", "/config/channels/webpush/secrets", {
      fields: { url: "https://example.com/hook" },
    });
    assert.equal(fieldless.status, 400);
  } finally {
    await api.close();
  }
});

test("a value carrying a newline is refused rather than written as two entries", async () => {
  const api = await startApi();
  try {
    const { status } = await api.request("PUT", "/config/channels/webhook/secrets", {
      fields: { url: "https://example.com/hook\nTELEGRAM_BOT_TOKEN=stolen" },
    });
    assert.equal(status, 400);

    const config = await api.request("GET", "/config");
    assert.equal(fieldOf(channelIn(config.body, "webhook"), "url")?.isSet, false);
  } finally {
    await api.close();
  }
});

test("clearing a saved value leaves the channel unconfigured again", async () => {
  const api = await startApi();
  try {
    await api.request("PUT", "/config/channels/webhook/secrets", {
      fields: { url: "https://example.com/hook" },
    });

    const cleared = await api.request("DELETE", "/config/channels/webhook/secrets/url");
    assert.equal(cleared.status, 200);
    assert.equal(fieldOf(cleared.body, "url")?.isSet, false);
  } finally {
    await api.close();
  }
});

test("clearing a value that came from the container is refused, not silently ignored", async () => {
  const api = await startApi({ WEBHOOK_URL: "https://from-env-file.example.com/hook" });
  try {
    const { status } = await api.request("DELETE", "/config/channels/webhook/secrets/url");
    assert.equal(status, 409);

    const config = await api.request("GET", "/config");
    assert.equal(fieldOf(channelIn(config.body, "webhook"), "url")?.isSet, true);
  } finally {
    await api.close();
  }
});

test("a saved value is keyed by the variable the channel names, so renaming the reference moves it", async () => {
  const api = await startApi();
  try {
    await api.request("PATCH", "/config/channels/webhook", { fields: { urlEnv: "MY_OWN_HOOK_URL" } });
    const saved = await api.request("PUT", "/config/channels/webhook/secrets", {
      fields: { url: "https://example.com/hook" },
    });

    assert.equal(fieldOf(saved.body, "url")?.envVar, "MY_OWN_HOOK_URL");
    assert.equal(fieldOf(saved.body, "url")?.isSet, true);
    assert.equal(api.runtime.env["MY_OWN_HOOK_URL"], "https://example.com/hook");
  } finally {
    await api.close();
  }
});
