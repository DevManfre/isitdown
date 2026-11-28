import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Request, Response } from "express";
import { buildUiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { clientAddress, identityOf, proxyIdentity, readProxyTrust } from "../../src/ui/trustedProxy.ts";

const silent = createLogger("error", () => {});

/** The two things the module reads from a request: the peer and the headers. */
function request(peer: string | undefined, headers: Record<string, string> = {}): Request {
  return { socket: { remoteAddress: peer }, headers: { ...headers } } as unknown as Request;
}

function run(env: Record<string, string>, req: Request): { req: Request; identity: string | undefined } {
  const res = { locals: {} } as Response;
  proxyIdentity(readProxyTrust(env).trust)(req, res, () => {});
  return { req, identity: identityOf(res) };
}

test("addresses and CIDR ranges, v4 and v6, are trusted; anything else is not", () => {
  const { trust, unusable } = readProxyTrust({ TRUSTED_PROXY: "10.0.0.5, 172.18.0.0/16 fd00::/8 not-an-ip 10.0.0.0/40" });
  assert.equal(trust.trusts("10.0.0.5"), true);
  assert.equal(trust.trusts("::ffff:10.0.0.5"), true, "the IPv4-mapped spelling an IPv6 socket reports");
  assert.equal(trust.trusts("172.18.200.3"), true);
  assert.equal(trust.trusts("fd12::1"), true);
  assert.equal(trust.trusts("10.0.0.6"), false);
  assert.equal(trust.trusts("127.0.0.1"), false);
  assert.equal(trust.trusts(undefined), false);
  assert.deepEqual(unusable, ["not-an-ip", "10.0.0.0/40"]);
});

test("without TRUSTED_PROXY nobody is trusted, loopback included", () => {
  const { trust } = readProxyTrust({});
  assert.equal(trust.trusts("127.0.0.1"), false);
  assert.equal(trust.trusts("::1"), false);
});

test("the identity header from the trusted proxy becomes the identity", () => {
  const { identity } = run({ TRUSTED_PROXY: "10.0.0.5" }, request("10.0.0.5", { "remote-user": "alice" }));
  assert.equal(identity, "alice");
});

test("the same header from any other address is ignored and removed before the routes", () => {
  const { req, identity } = run({ TRUSTED_PROXY: "10.0.0.5" }, request("10.0.0.9", { "remote-user": "mallory" }));
  assert.equal(identity, undefined);
  assert.equal(req.headers["remote-user"], undefined);
});

test("IDENTITY_HEADER names another header, case-insensitively; Tailscale Serve's for instance", () => {
  const env = { TRUSTED_PROXY: "100.64.0.0/10", IDENTITY_HEADER: "Tailscale-User-Login" };
  assert.equal(run(env, request("100.100.1.2", { "tailscale-user-login": "alice@github" })).identity, "alice@github");
  assert.equal(run(env, request("100.100.1.2", { "remote-user": "alice" })).identity, undefined);
});

test("AUDIT_ACTOR_HEADER still names the header, flagged as deprecated; IDENTITY_HEADER wins over it", () => {
  assert.equal(readProxyTrust({ AUDIT_ACTOR_HEADER: "X-Forwarded-User" }).trust.identityHeader, "x-forwarded-user");
  assert.equal(readProxyTrust({ AUDIT_ACTOR_HEADER: "X-Forwarded-User" }).deprecatedHeader, true);
  const both = readProxyTrust({ AUDIT_ACTOR_HEADER: "X-Forwarded-User", IDENTITY_HEADER: "Remote-Email" });
  assert.equal(both.trust.identityHeader, "remote-email");
  assert.equal(both.deprecatedHeader, false);
});

test("control characters are dropped and the identity is bounded; a blank one is none", () => {
  const env = { TRUSTED_PROXY: "10.0.0.5" };
  assert.equal(run(env, request("10.0.0.5", { "remote-user": " al\u0007ice\u007f " })).identity, "alice");
  assert.equal(run(env, request("10.0.0.5", { "remote-user": "x".repeat(500) })).identity?.length, 120);
  assert.equal(run(env, request("10.0.0.5", { "remote-user": "  " })).identity, undefined);
});

test("X-Forwarded-For is read only from a trusted peer", () => {
  const { trust } = readProxyTrust({ TRUSTED_PROXY: "10.0.0.5" });
  assert.equal(clientAddress(request("203.0.113.7", { "x-forwarded-for": "127.0.0.1" }), trust), "203.0.113.7");
  assert.equal(clientAddress(request("10.0.0.5", { "x-forwarded-for": "203.0.113.7" }), trust), "203.0.113.7");
  assert.equal(clientAddress(request("10.0.0.5"), trust), "10.0.0.5");
});

test("a client's own X-Forwarded-For entry sits left of the one its proxy appends, so it is never the answer", () => {
  const { trust } = readProxyTrust({ TRUSTED_PROXY: "10.0.0.5, 10.0.0.6" });
  const req = request("10.0.0.5", { "x-forwarded-for": "127.0.0.1, 198.51.100.4, 10.0.0.6" });
  assert.equal(clientAddress(req, trust), "198.51.100.4");
});

async function serve(env: NodeJS.ProcessEnv) {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-proxy-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    call: async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

const marker = { at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), label: "deploy v3", colour: "accent" };

test("an annotation made through the trusted proxy carries who made it; from elsewhere, nobody", async () => {
  const trusted = await serve({ TRUSTED_PROXY: "127.0.0.1" });
  try {
    const created = await trusted.call("POST", "/annotations", marker, { "remote-user": "alice" });
    assert.equal(created.status, 201);
    assert.equal((created.body as { createdBy: string | null }).createdBy, "alice");
    const listed = (await trusted.call("GET", "/annotations?days=7")).body as { annotations: { createdBy: string | null }[] };
    assert.equal(listed.annotations[0]?.createdBy, "alice");
  } finally {
    await trusted.close();
  }

  const untrusted = await serve({ TRUSTED_PROXY: "10.0.0.5" });
  try {
    const created = await untrusted.call("POST", "/annotations", marker, { "remote-user": "mallory" });
    assert.equal((created.body as { createdBy: string | null }).createdBy, null);
  } finally {
    await untrusted.close();
  }
});

test("behind a trusted proxy on this host, a forwarded remote client no longer passes as local", async () => {
  const app = await serve({ API_TOKEN: "s3cret", TRUSTED_PROXY: "127.0.0.1" });
  try {
    assert.equal((await app.call("GET", "/status")).status, 200, "a direct loopback request is still local");
    assert.equal((await app.call("GET", "/status", undefined, { "x-forwarded-for": "203.0.113.7" })).status, 401);
    assert.equal((await app.call("GET", "/status", undefined, { "x-forwarded-for": "127.0.0.1" })).status, 200);
  } finally {
    await app.close();
  }
});
