import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import webpush from "web-push";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";

const silent = createLogger("error", () => {});

// An uncompressed P-256 public key, base64url-encoded, is 87 characters — use
// a realistic-length stand-in so GET /config/push's decode guard does not
// itself blank out the value in tests that expect to see it returned intact.
// (This particular stand-in happens to decode to a valid-shaped 65-byte,
// 0x04-prefixed point too, but the tests that actually need a genuine key —
// round-tripping it unchanged, and the exploit-replay regression — use a
// real generated pair below instead of relying on that coincidence.)
const REALISTIC_VAPID_PUBLIC_KEY = "B".repeat(87);

// A real key pair, so the tests that must reflect genuine VAPID shapes don't
// depend on a placeholder that happens to decode correctly, or on a private
// key fixture too short to ever have passed the decode guard in the first
// place (which would mask whether the earlier write-time guards are doing
// anything).
const { publicKey: REAL_VAPID_PUBLIC_KEY, privateKey: REAL_VAPID_PRIVATE_KEY } = webpush.generateVAPIDKeys();

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

test("the public key is exposed and the private key is not", async () => {
  const api = await startApi({ VAPID_PUBLIC_KEY: REALISTIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: "kPriv" });
  try {
    const response = await api.request("GET", "/config/push");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { publicKey: REALISTIC_VAPID_PUBLIC_KEY });
    assert.doesNotMatch(JSON.stringify(response.body), /kPriv/);
  } finally {
    await api.close();
  }
});

test("a browser subscribes, appears as a device, and can be unregistered", async () => {
  const api = await startApi({ VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "kPriv" });
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
  const api = await startApi({ VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "kPriv" });
  try {
    const response = await api.request("POST", "/config/push/subscriptions", { endpoint: "not-a-url" });
    assert.equal(response.status, 400);
  } finally {
    await api.close();
  }
});

test("an otherwise well-formed subscription with only its endpoint malformed is refused", async () => {
  const api = await startApi({ VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "kPriv" });
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
  const api = await startApi({ VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "kPriv" });
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
  const api = await startApi({ VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "kPriv" });
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

test("a channel whose public and private key variables collide never leaks the private value", async () => {
  const api = await startApi({ VAPID_PUBLIC_KEY: "BPub", VAPID_PRIVATE_KEY: "kPriv" });
  try {
    // Simulate a row already in this bad state (e.g. from before the
    // updateChannel guard existed, or a direct DB edit) by bypassing
    // updateChannel and writing the colliding config straight into the table.
    api.runtime.db
      .prepare("UPDATE channels SET config = ? WHERE id = 'webpush'")
      .run(JSON.stringify({ publicKeyEnv: "VAPID_PRIVATE_KEY", privateKeyEnv: "VAPID_PRIVATE_KEY" }));

    const response = await api.request("GET", "/config/push");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { publicKey: "" });
    assert.doesNotMatch(JSON.stringify(response.body), /kPriv/);
  } finally {
    await api.close();
  }
});

test("patching a channel to alias two secrets onto the same variable is refused", async () => {
  const api = await startApi({ VAPID_PUBLIC_KEY: REALISTIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: "kPriv" });
  try {
    const response = await api.request("PATCH", "/config/channels/webpush", {
      fields: { publicKeyEnv: "VAPID_PRIVATE_KEY" },
    });
    assert.equal(response.status, 400);
    assert.match(
      (response.body as { error: { message: string } }).error.message,
      /VAPID_PRIVATE_KEY/,
    );

    // The collision was refused, so the public key still resolves to the
    // actual public value rather than the private one.
    const push = await api.request("GET", "/config/push");
    assert.deepEqual(push.body, { publicKey: REALISTIC_VAPID_PUBLIC_KEY });
  } finally {
    await api.close();
  }
});

test("blanking a channel's env field is refused rather than accepted as unconfigured", async () => {
  const api = await startApi({ VAPID_PUBLIC_KEY: REALISTIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: "kPriv" });
  try {
    const response = await api.request("PATCH", "/config/channels/webpush", {
      fields: { privateKeyEnv: "" },
    });
    assert.equal(response.status, 400);
    assert.match((response.body as { error: { message: string } }).error.message, /privateKeyEnv/);
  } finally {
    await api.close();
  }
});

test("aliasing a channel's env field onto a different channel's variable is refused", async () => {
  // telegram.botTokenEnv is seeded to TELEGRAM_BOT_TOKEN by default — pointing
  // webpush's public key at that same variable would let GET /config/push
  // echo the Telegram bot token back to any page that can reach this
  // dashboard, so the collision check must span every channel, not just the
  // one being patched.
  const api = await startApi({
    VAPID_PUBLIC_KEY: REALISTIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: "kPriv",
    TELEGRAM_BOT_TOKEN: "123:ABC",
  });
  try {
    const response = await api.request("PATCH", "/config/channels/webpush", {
      fields: { publicKeyEnv: "TELEGRAM_BOT_TOKEN" },
    });
    assert.equal(response.status, 400);
    assert.match((response.body as { error: { message: string } }).error.message, /TELEGRAM_BOT_TOKEN/);

    const push = await api.request("GET", "/config/push");
    assert.deepEqual(push.body, { publicKey: REALISTIC_VAPID_PUBLIC_KEY });
  } finally {
    await api.close();
  }
});

test("a public key variable that resolves to a short value is treated as unset", async () => {
  const api = await startApi({
    VAPID_PUBLIC_KEY: REALISTIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: "kPriv",
    SHORT_SECRET: "not-a-real-vapid-key",
  });
  try {
    // No name collision here (SHORT_SECRET is not used by any other channel
    // field), so the patch itself succeeds — it is the route's shape guard,
    // not the name-collision guard, doing the work in this test.
    const patch = await api.request("PATCH", "/config/channels/webpush", {
      fields: { publicKeyEnv: "SHORT_SECRET" },
    });
    assert.equal(patch.status, 200);

    const response = await api.request("GET", "/config/push");
    assert.deepEqual(response.body, { publicKey: "" });
  } finally {
    await api.close();
  }
});

test("the reported exploit sequence (blank the private key, then alias) never exposes its value", async () => {
  // A realistic 43-character private key is used here deliberately: it is
  // long and shaped enough that it would sail through the route's decode
  // guard if that guard were the only thing standing in the exploit's way.
  // So this test genuinely depends on the write-time guards in updateChannel
  // (refusing the blank, then refusing the alias) rather than being saved by
  // a fixture too short to have passed the decode guard anyway.
  const api = await startApi({
    VAPID_PUBLIC_KEY: REALISTIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: REAL_VAPID_PRIVATE_KEY,
  });
  try {
    const step1 = await api.request("PATCH", "/config/channels/webpush", {
      fields: { privateKeyEnv: "" },
    });
    assert.equal(step1.status, 400, "blanking the private key's variable name must itself be refused");

    const step2 = await api.request("PATCH", "/config/channels/webpush", {
      fields: { publicKeyEnv: "VAPID_PRIVATE_KEY" },
    });
    assert.equal(
      step2.status,
      400,
      "aliasing onto the same variable must be refused even if the blank step had somehow gone through",
    );

    const push = await api.request("GET", "/config/push");
    assert.notDeepEqual(push.body, { publicKey: REAL_VAPID_PRIVATE_KEY });
    assert.doesNotMatch(JSON.stringify(push.body), new RegExp(REAL_VAPID_PRIVATE_KEY));
    // Both patches were refused, so the channel's config never changed — the
    // real public key still resolves normally.
    assert.deepEqual(push.body, { publicKey: REALISTIC_VAPID_PUBLIC_KEY });
  } finally {
    await api.close();
  }
});

test("a genuine VAPID public key decodes correctly and round-trips unchanged", async () => {
  const api = await startApi({
    VAPID_PUBLIC_KEY: REAL_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: REAL_VAPID_PRIVATE_KEY,
  });
  try {
    const response = await api.request("GET", "/config/push");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { publicKey: REAL_VAPID_PUBLIC_KEY });
  } finally {
    await api.close();
  }
});

test("a long base64url run that only looks key-shaped is treated as unset", async () => {
  // The re-reviewer's finding: an 80+ character base64url string passed the
  // old regex-only shape guard regardless of what it actually decoded to.
  // 90 "A" characters is exactly such a string — long and legally
  // base64url-shaped, but it decodes to 67 bytes starting with 0x00, not the
  // 65 bytes starting with 0x04 a real VAPID public key requires.
  const api = await startApi({
    VAPID_PUBLIC_KEY: REALISTIC_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: REAL_VAPID_PRIVATE_KEY,
    UNREFERENCED_SECRET: "A".repeat(90),
  });
  try {
    // Nothing else references UNREFERENCED_SECRET, so the cross-channel
    // collision guard has no name to object to — the patch itself succeeds.
    // It is the route's decode guard, not a write-time guard, being
    // exercised here.
    const patch = await api.request("PATCH", "/config/channels/webpush", {
      fields: { publicKeyEnv: "UNREFERENCED_SECRET" },
    });
    assert.equal(patch.status, 200);

    const response = await api.request("GET", "/config/push");
    assert.deepEqual(response.body, { publicKey: "" });
  } finally {
    await api.close();
  }
});
