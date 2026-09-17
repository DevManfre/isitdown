import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { decide, isLocalAddress, presentedToken, readTokenPolicy } from "../../src/ui/apiToken.ts";

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
