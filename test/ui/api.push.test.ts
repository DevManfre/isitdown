import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { isVapidPublicKey } from "../../src/ui/vapidKeys.ts";
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
  const dir = await mkdtemp(join(tmpdir(), "isitdown-push-api-"));
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

test("the public key is served and the private key never leaves the process", async () => {
  const api = await startApi();
  try {
    const response = await api.request("GET", "/config/push");
    assert.equal(response.status, 200);
    const { publicKey } = response.body as { publicKey: string };
    // Generated on first use, so the route answers with a key a browser can
    // actually subscribe with even though nothing was ever configured.
    assert.ok(isVapidPublicKey(publicKey), `not a VAPID public key: ${publicKey}`);

    // The stored private half is the one thing that must never appear on the
    // wire — compare against the real row, not a fixture.
    const privateKey = (
      api.runtime.db.prepare("SELECT value FROM settings WHERE key = 'vapidPrivateKey'").get() as {
        value: string;
      }
    ).value;
    assert.notEqual(privateKey, "");
    assert.doesNotMatch(JSON.stringify(response.body), new RegExp(privateKey.replace(/[-_]/gu, ".")));

    // Stable across calls: a key that rotated per request would invalidate
    // every browser that had already subscribed.
    assert.deepEqual((await api.request("GET", "/config/push")).body, { publicKey });
  } finally {
    await api.close();
  }
});

test("the webpush channel is described with no fields to configure", async () => {
  const api = await startApi();
  try {
    const response = await api.request("GET", "/config");
    const channels = (response.body as { channels: { id: string; fields: unknown[] }[] }).channels;
    const webpush = channels.find((channel) => channel.id === "webpush");
    assert.ok(webpush);
    // The two VAPID variables were the only fields this channel ever had; the
    // dashboard now shows a switch and the per-browser button, nothing else.
    assert.deepEqual(webpush.fields, []);
  } finally {
    await api.close();
  }
});

test("a browser subscribes, appears as a device, and can be unregistered", async () => {
  const api = await startApi();
  try {
    const created = await api.request("POST", "/config/push/subscriptions", {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
      label: "Chrome · Windows",
    });
    assert.equal(created.status, 201);

    const listed = await api.request("GET", "/config/push/subscriptions");
    const devices = (listed.body as { devices: { id: string; label: string }[] }).devices;
    assert.equal(devices.length, 1);
    assert.equal(devices[0]!.label, "Chrome · Windows");

    const removed = await api.request("DELETE", `/config/push/subscriptions/${devices[0]!.id}`);
    assert.equal(removed.status, 204);
    const after = await api.request("GET", "/config/push/subscriptions");
    assert.deepEqual((after.body as { devices: unknown[] }).devices, []);
  } finally {
    await api.close();
  }
});

test("a malformed subscription is refused", async () => {
  const api = await startApi();
  try {
    const response = await api.request("POST", "/config/push/subscriptions", { endpoint: "not-a-url" });
    assert.equal(response.status, 400);
  } finally {
    await api.close();
  }
});

test("an otherwise well-formed subscription with only its endpoint malformed is refused", async () => {
  const api = await startApi();
  try {
    const response = await api.request("POST", "/config/push/subscriptions", {
      endpoint: "not-a-url",
      keys: { p256dh: "p", auth: "a" },
      label: "Chrome · Windows",
    });
    assert.equal(response.status, 400);
  } finally {
    await api.close();
  }
});

test("a subscription with a non-https endpoint is refused", async () => {
  const api = await startApi();
  try {
    const response = await api.request("POST", "/config/push/subscriptions", {
      endpoint: "http://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
      label: "Chrome · Windows",
    });
    assert.equal(response.status, 400);
  } finally {
    await api.close();
  }
});

test("unregistering a device that is not there is a 404", async () => {
  const api = await startApi();
  try {
    // Register a real device first so a 404 here proves the route matched and
    // looked the id up, rather than passing vacuously because the route did
    // not exist at all (Express's own fallback is also a 404).
    await api.request("POST", "/config/push/subscriptions", {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p", auth: "a" },
      label: "Chrome · Windows",
    });
    assert.equal((await api.request("DELETE", "/config/push/subscriptions/nope")).status, 404);
  } finally {
    await api.close();
  }
});

// The `*Env` write guards below no longer have webpush to defend — that
// channel stores no variable names at all — but they still protect telegram
// and webhook, whose values a route never returns and must never start
// returning by way of an alias.
test("blanking a channel's env field is refused rather than accepted as unconfigured", async () => {
  const api = await startApi();
  try {
    const response = await api.request("PATCH", "/config/channels/telegram", { fields: { botTokenEnv: "" } });
    assert.equal(response.status, 400);
    assert.match((response.body as { error: { message: string } }).error.message, /cannot be blank/u);
  } finally {
    await api.close();
  }
});

test("aliasing a channel's env field onto a different channel's variable is refused", async () => {
  const api = await startApi();
  try {
    const response = await api.request("PATCH", "/config/channels/telegram", {
      fields: { botTokenEnv: "WEBHOOK_URL" },
    });
    assert.equal(response.status, 400);
    assert.match((response.body as { error: { message: string } }).error.message, /WEBHOOK_URL/u);
  } finally {
    await api.close();
  }
});

test("the webpush channel has no env field to patch in the first place", async () => {
  const api = await startApi({ TELEGRAM_BOT_TOKEN: "123:ABC" });
  try {
    // The old shape of this attack — point webpush's `publicKeyEnv` at a
    // variable holding someone else's secret, then read it back from
    // GET /config/push — has no surface left: the route reads the generated
    // key from SQLite and never touches the environment, so even a config
    // forced straight into the table changes nothing it serves.
    api.runtime.db
      .prepare("UPDATE channels SET config = ? WHERE id = 'webpush'")
      .run(JSON.stringify({ publicKeyEnv: "TELEGRAM_BOT_TOKEN" }));

    const response = await api.request("GET", "/config/push");
    assert.equal(response.status, 200);
    assert.ok(isVapidPublicKey((response.body as { publicKey: string }).publicKey));
    assert.doesNotMatch(JSON.stringify(response.body), /123:ABC/u);
  } finally {
    await api.close();
  }
});
