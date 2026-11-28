import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { decide, isLocalAddress, presentedToken, readTokenPolicy, requiredScope, ROUTE_SCOPES } from "../../src/ui/apiToken.ts";
import { createApiTokenStore, type ApiScope } from "../../src/ui/dbApiTokens.ts";

/**
 * The read-only API token — roadmap 4.15.
 *
 * The decision is tested as a function, because the interesting cases are
 * combinations ("token, but a POST", "no token, but not local") rather than
 * anything express does with them. The end-to-end tests below then check that
 * the middleware really is in front of everything.
 */

const silent = createLogger("error", () => {});

const policy = { token: "s3cret", localBypass: true };

const ask = (over: Partial<Parameters<typeof decide>[0]> = {}) =>
  decide({ policy, path: "/status", method: "GET", presented: "", local: true, ...over });

test("with no token configured, nothing is gated", () => {
  assert.deepEqual(
    decide({ policy: { token: "", localBypass: true }, path: "/config", method: "POST", presented: "", local: false }),
    { allow: true },
  );
});

test("the token grants reads from anywhere", () => {
  assert.deepEqual(ask({ presented: "s3cret", local: false }), { allow: true });
  assert.deepEqual(ask({ presented: "s3cret", local: false, method: "HEAD" }), { allow: true });
});

test("the token grants nothing but reads", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const verdict = ask({ presented: "s3cret", local: false, method });
    assert.equal(verdict.allow, false, method);
    assert.equal(verdict.allow === false && verdict.status, 403);
  }
});

test("a write from a token holder is refused even from this machine", () => {
  // The token is the weaker credential of the two, and holding one must never
  // be worth more than not holding one.
  const verdict = ask({ presented: "s3cret", local: true, method: "POST" });
  assert.equal(verdict.allow === false && verdict.status, 403);
});

test("without the token, only this machine is let in", () => {
  assert.deepEqual(ask({ local: true }), { allow: true });
  const remote = ask({ local: false });
  assert.equal(remote.allow === false && remote.status, 401);
});

test("a wrong token from this machine still gets in, so a stale variable cannot lock the operator out", () => {
  assert.deepEqual(ask({ presented: "wrong", local: true }), { allow: true });
});

test("a wrong token from elsewhere says so, rather than saying nothing was sent", () => {
  const verdict = ask({ presented: "wrong", local: false });
  assert.equal(verdict.allow === false && verdict.message, "that API token is not this instance's");
});

test("with the local bypass off, this machine needs the token too", () => {
  const strict = { token: "s3cret", localBypass: false };
  const verdict = decide({ policy: strict, path: "/status", method: "GET", presented: "", local: true });
  assert.equal(verdict.allow === false && verdict.status, 401);
  assert.deepEqual(
    decide({ policy: strict, path: "/status", method: "GET", presented: "s3cret", local: true }),
    { allow: true },
  );
});

test("the container's own two questions are never gated", () => {
  for (const path of ["/health", "/ready"]) {
    assert.deepEqual(
      decide({ policy: { token: "s3cret", localBypass: false }, path, method: "GET", presented: "", local: false }),
      { allow: true },
      path,
    );
  }
});

test("the token is read from either header, and a bearer scheme is optional on one of them", () => {
  assert.equal(presentedToken({ authorization: "Bearer abc" }), "abc");
  assert.equal(presentedToken({ authorization: "bearer  abc  " }), "abc");
  assert.equal(presentedToken({ apiToken: "abc" }), "abc");
  assert.equal(presentedToken({ authorization: "Basic abc" }), "");
  assert.equal(presentedToken({}), "");
});

test("loopback is recognised in all three spellings a socket reports", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", undefined]) {
    assert.equal(isLocalAddress(address), true, String(address));
  }
  assert.equal(isLocalAddress("10.0.0.7"), false);
});

test("the policy comes from the environment, and a typo leaves the bypass on", () => {
  assert.deepEqual(readTokenPolicy({}), { token: "", localBypass: true });
  assert.deepEqual(readTokenPolicy({ API_TOKEN: " s3cret " }), { token: "s3cret", localBypass: true });
  assert.deepEqual(readTokenPolicy({ API_TOKEN: "x", API_LOCAL_BYPASS: "FALSE" }), {
    token: "x",
    localBypass: false,
  });
  assert.equal(readTokenPolicy({ API_TOKEN: "x", API_LOCAL_BYPASS: "nope" }).localBypass, true);
});

/**
 * End to end, over a real socket, with the bypass off — the only way to be sure
 * the middleware sits in front of the routes and the static dashboard rather
 * than beside them.
 */
interface Api {
  runtime: UiRuntime;
  request: (method: string, path: string, headers?: Record<string, string>) => Promise<number>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-token-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    request: async (method, path, headers = {}) =>
      (await fetch(`http://127.0.0.1:${port}${path}`, { method, headers })).status,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

test("the gate is in front of every route, the dashboard included", async () => {
  const app = await api({ API_TOKEN: "s3cret", API_LOCAL_BYPASS: "false" });
  try {
    assert.equal(await app.request("GET", "/status"), 401);
    assert.equal(await app.request("GET", "/"), 401);
    assert.equal(await app.request("GET", "/status", { authorization: "Bearer s3cret" }), 200);
    assert.equal(await app.request("GET", "/status", { "x-api-token": "s3cret" }), 200);
    assert.equal(await app.request("POST", "/poll", { "x-api-token": "s3cret" }), 403);
    // Probes answer whatever the gate says.
    assert.equal(await app.request("GET", "/health"), 200);
  } finally {
    await app.close();
  }
});

test("a 401 says what to send back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-token-"));
  const runtime = await buildUiRuntime({
    dbPath: join(dir, "isitdown.db"),
    env: { API_TOKEN: "s3cret", API_LOCAL_BYPASS: "false" },
    logger: silent,
  });
  const server = createServer(runtime.app).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="isitdown"');
    assert.match(JSON.stringify(await response.json()), /Authorization: Bearer/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});

test("with no token set, a remote request is answered exactly as it was before", async () => {
  const app = await api({});
  try {
    assert.equal(await app.request("GET", "/status"), 200);
    assert.equal(await app.request("POST", "/poll"), 200);
  } finally {
    await app.close();
  }
});

/**
 * Named, scoped, revocable tokens — roadmap 9.11.
 */

const fakeStore = (tokens: Record<string, readonly ApiScope[]>) => ({
  anyActive: () => Object.keys(tokens).length > 0,
  find: (token: string) => {
    const scopes = tokens[token];
    return scopes === undefined ? null : { id: Object.keys(tokens).indexOf(token) + 1, scopes };
  },
});

const remote = (over: Partial<Parameters<typeof decide>[0]>) =>
  decide({ policy: { token: "", localBypass: true }, path: "/status", method: "GET", presented: "", local: false, ...over });

test("a stored token turns the gate on even with no API_TOKEN", () => {
  assert.deepEqual(remote({ stored: fakeStore({}) }), { allow: true });
  const verdict = remote({ stored: fakeStore({ iid_a: ["read"] }) });
  assert.equal(verdict.allow === false && verdict.status, 401);
});

test("each scope opens its own routes and nothing else", () => {
  const stored = fakeStore({
    iid_read: ["read"],
    iid_notes: ["annotations:write"],
    iid_mute: ["mute"],
    iid_push: ["push"],
  });
  const cases: [string, string, string, boolean][] = [
    ["iid_read", "GET", "/status", true],
    ["iid_read", "POST", "/annotations", false],
    ["iid_notes", "POST", "/annotations", true],
    ["iid_notes", "DELETE", "/annotations/7", true],
    ["iid_notes", "GET", "/status", false],
    ["iid_notes", "POST", "/providers/github/mute", false],
    ["iid_mute", "POST", "/providers/github/mute", true],
    ["iid_mute", "POST", "/providers/github/ack", true],
    ["iid_mute", "DELETE", "/config/services/github", false],
    ["iid_push", "POST", "/poll", true],
    ["iid_push", "POST", "/annotations", false],
  ];
  for (const [token, method, path, allowed] of cases) {
    const verdict = remote({ stored, presented: token, method, path });
    assert.equal(verdict.allow, allowed, `${token} ${method} ${path}`);
    if (!allowed) assert.equal(verdict.allow === false && verdict.status, 403, `${token} ${method} ${path}`);
  }
});

test("a 403 names the scope that was missing", () => {
  const verdict = remote({ stored: fakeStore({ iid_read: ["read"] }), presented: "iid_read", method: "POST", path: "/providers/x/mute" });
  assert.equal(verdict.allow === false && verdict.message, "this token lacks the mute scope");
});

test("admin implies every scope", () => {
  const stored = fakeStore({ iid_admin: ["admin"] });
  for (const [method, path] of [
    ["GET", "/status"],
    ["POST", "/annotations"],
    ["POST", "/providers/x/mute"],
    ["POST", "/poll"],
    ["POST", "/config/tokens"],
    ["DELETE", "/config/services/x"],
  ] as const) {
    assert.equal(remote({ stored, presented: "iid_admin", method, path }).allow, true, `${method} ${path}`);
  }
});

test("listing tokens is the operator's, not a read token's", () => {
  assert.equal(requiredScope("GET", "/config/tokens"), "admin");
  assert.equal(requiredScope("HEAD", "/status"), "read");
  assert.equal(requiredScope("POST", "/nowhere"), "admin");
  const verdict = remote({ stored: fakeStore({ iid_read: ["read"] }), presented: "iid_read", path: "/config/tokens" });
  assert.equal(verdict.allow === false && verdict.status, 403);
});

test("API_TOKEN beside stored tokens is still a read token, and still 403s a write", () => {
  const stored = fakeStore({ iid_admin: ["admin"] });
  const policy = { token: "s3cret", localBypass: true };
  assert.deepEqual(remote({ policy, stored, presented: "s3cret" }), { allow: true });
  const write = remote({ policy, stored, presented: "s3cret", method: "POST", path: "/annotations" });
  assert.equal(write.allow === false && write.message, "this token grants read access only");
});

test("a request let in by a stored token carries its id, for the last-used stamp", () => {
  assert.deepEqual(remote({ stored: fakeStore({ iid_a: ["read"] }), presented: "iid_a" }), { allow: true, tokenId: 1 });
});

test("every write route the app registers has an explicit scope", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-token-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  try {
    const declared = new Set(ROUTE_SCOPES.map((entry) => `${entry.method} ${entry.path}`));
    const missing: string[] = [];
    const registered = new Set<string>();
    const walk = (stack: unknown[]): void => {
      for (const entry of stack) {
        const layer = entry as { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: unknown[] } };
        if (layer.route !== undefined) {
          for (const [method, on] of Object.entries(layer.route.methods)) {
            const upper = method.toUpperCase();
            registered.add(`${upper} ${layer.route.path}`);
            if (!on || ["_ALL", "GET", "HEAD", "OPTIONS"].includes(upper)) continue;
            // Ungated by design: a provider's webhook and a cron job's ping carry their own credential.
            if (layer.route.path.startsWith("/push/") || layer.route.path.startsWith("/heartbeat/")) continue;
            if (!declared.has(`${upper} ${layer.route.path}`)) missing.push(`${upper} ${layer.route.path}`);
          }
          continue;
        }
        if (Array.isArray(layer.handle?.stack)) walk(layer.handle.stack);
      }
    };
    walk((runtime.app as unknown as { router: { stack: unknown[] } }).router.stack);
    assert.deepEqual(missing, [], "write routes without an entry in ROUTE_SCOPES");
    // And no entry names a route that is not there any more.
    assert.deepEqual([...declared].filter((route) => !registered.has(route)), [], "ROUTE_SCOPES entries with no route");
  } finally {
    await runtime.close();
  }
});

test("the store keeps a hash, never the token, and a revoked token stops working", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-token-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  try {
    const store = runtime.apiTokens;
    assert.equal(store.anyActive(), false);
    const created = store.create({ name: "ci", scopes: ["mute", "annotations:write", "mute"] });
    assert.match(created.token, /^iid_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(created.scopes, ["annotations:write", "mute"]);
    const raw = JSON.stringify(runtime.db.prepare("SELECT * FROM api_tokens").all());
    assert.equal(raw.includes(created.token), false, "the token is stored in clear");
    assert.equal(raw.includes(created.token.slice(4)), false, "the token's random part is stored in clear");
    assert.equal(JSON.stringify(store.list()).includes(created.token), false);
    assert.deepEqual(store.find(created.token), { id: created.id, scopes: ["annotations:write", "mute"] });
    assert.equal(store.revoke(created.id), true);
    assert.equal(store.revoke(created.id), false, "already revoked");
    assert.equal(store.find(created.token), null);
    assert.equal(store.anyActive(), false);
    assert.notEqual(store.list()[0]?.revokedAt, null);
  } finally {
    await runtime.close();
  }
});

test("last used is written at most once a minute", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-token-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: {}, logger: silent });
  try {
    let now = Date.parse("2026-11-27T10:00:00.000Z");
    const store = createApiTokenStore(runtime.db, () => now);
    const { id } = store.create({ name: "widget", scopes: ["read"] });
    const lastUsed = () => store.list().find((row) => row.id === id)?.lastUsedAt;
    assert.equal(lastUsed(), null);
    store.touch(id);
    assert.equal(lastUsed(), "2026-11-27T10:00:00.000Z");
    now += 59_000;
    store.touch(id);
    assert.equal(lastUsed(), "2026-11-27T10:00:00.000Z");
    now += 1_000;
    store.touch(id);
    assert.equal(lastUsed(), "2026-11-27T10:01:00.000Z");
  } finally {
    await runtime.close();
  }
});

test("the token list says whether API_TOKEN is set, and never what it is", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-token-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: { API_TOKEN: "env-secret" }, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/config/tokens`)).text();
    assert.equal((JSON.parse(body) as { envToken: boolean }).envToken, true);
    assert.equal(body.includes("env-secret"), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});

test("end to end: the first token is created openly, then the gate holds, and revoking closes it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-token-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env: { API_LOCAL_BYPASS: "false" }, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  const call = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    // Nothing configured: the gate is off, so the operator can make the first key.
    const admin = (await (await call("POST", "/config/tokens", undefined, { name: "ops", scopes: ["admin"] })).json()) as { token: string };
    assert.equal((await call("GET", "/status")).status, 401, "a token now exists: the gate is on");
    const made = await call("POST", "/config/tokens", admin.token, { name: "ci", scopes: ["annotations:write"] });
    assert.equal(made.status, 201);
    const ci = (await made.json()) as { id: number; token: string };
    assert.equal((await call("GET", "/status", ci.token)).status, 403);
    assert.equal((await call("POST", "/config/tokens", ci.token, { name: "x", scopes: ["admin"] })).status, 403);
    assert.equal((await call("POST", "/config/tokens", admin.token, { name: "", scopes: [] })).status, 400);
    assert.equal((await call("POST", "/config/tokens", admin.token, { name: "x", scopes: ["root"] })).status, 400);
    const listed = (await (await call("GET", "/config/tokens", admin.token)).json()) as {
      tokens: Record<string, unknown>[];
      envToken: boolean;
    };
    assert.equal(listed.tokens.length, 2);
    assert.equal(listed.envToken, false, "no API_TOKEN in this environment");
    assert.equal(JSON.stringify(listed).includes("hash"), false);
    assert.equal((await call("DELETE", `/config/tokens/${ci.id}`, admin.token)).status, 204);
    assert.equal((await call("GET", "/status", ci.token)).status, 401, "revoked answers like unknown");
    assert.equal((await call("DELETE", `/config/tokens/${ci.id}`, admin.token)).status, 404);
    const history = (await (await call("GET", "/config/history?kind=credential", admin.token)).json()) as { entries: { target: string }[] };
    assert.ok(history.entries.filter((entry) => entry.target === "api-token").length >= 3, "creates and revokes are in the trail");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});
