import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BodyTooLargeError,
  MAX_BODY_BYTES,
  EgressRefusedError,
  type OutboundPolicy,
  assertHostAllowed,
  assertTargetAllowed,
  configureOutbound,
  guardedFetch,
  parseAllowList,
  readCapped,
  readOutboundPolicy,
  resetOutbound,
  unusableAllowEntries,
} from "../../src/core/outboundPolicy.ts";
import { withServer } from "../helpers/localServer.ts";

const bytes = (n: number): Uint8Array => new Uint8Array(n).fill(97);

test("readCapped returns a body under the cap", async () => {
  const buffer = await readCapped(new Response(bytes(10)), 100);
  assert.equal(buffer.byteLength, 10);
});

test("readCapped throws once the stream passes the cap", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes(60));
      controller.enqueue(bytes(60));
      controller.close();
    },
  });
  await assert.rejects(
    readCapped(new Response(stream), 100),
    (error: unknown) => error instanceof BodyTooLargeError && /response exceeded 100 bytes/.test(error.message),
  );
});

test("readCapped refuses a declared content-length above the cap before reading", async () => {
  let pulled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      pulled = true;
    },
  });
  const response = new Response(stream, { headers: { "content-length": "1000" } });
  await assert.rejects(readCapped(response, 100), /response exceeded 100 bytes/);
  assert.equal(pulled, false);
});

test("the default cap is 8 MiB", () => {
  assert.equal(MAX_BODY_BYTES, 8 * 1024 * 1024);
});

const lookupTo = (...addresses: string[]) => async (): Promise<string[]> => addresses;
const noLookup = async (): Promise<string[]> => {
  throw new Error("no DNS expected");
};

const ALLOW: OutboundPolicy = { privateTargets: "allow", allow: [] };
const WARN: OutboundPolicy = { privateTargets: "warn", allow: [] };
const DENY: OutboundPolicy = { privateTargets: "deny", allow: [] };
const deny = (...allow: string[]): OutboundPolicy => ({ privateTargets: "deny", allow });

type Expect = "always" | "private" | "public";
const cases: { url: string; lookup?: () => Promise<string[]>; expect: Expect; kind?: string; label: string }[] = [
  { url: "http://169.254.169.254/latest", expect: "always", label: "metadata" },
  { url: "http://[fd00:ec2::254]/", expect: "always", label: "aws ipv6 metadata" },
  { url: "http://[fe80::1]/", expect: "always", label: "ipv6 link-local" },
  { url: "http://[::ffff:169.254.169.254]/", expect: "always", label: "mapped link-local" },
  { url: "http://127.0.0.1/", expect: "private", kind: "loopback", label: "loopback" },
  { url: "http://127.8.9.10/", expect: "private", kind: "loopback", label: "all of 127/8" },
  { url: "http://localhost/", lookup: lookupTo("127.0.0.1"), expect: "private", kind: "loopback", label: "localhost" },
  { url: "http://192.168.1.10/", expect: "private", kind: "private", label: "192.168" },
  { url: "http://10.0.0.5/", expect: "private", kind: "private", label: "10/8" },
  { url: "http://172.16.0.1/", expect: "private", kind: "private", label: "172.16/12" },
  { url: "http://100.64.0.1/", expect: "private", kind: "private", label: "cgnat" },
  { url: "http://0.0.0.0/", expect: "private", kind: "private", label: "this host" },
  { url: "http://[fd12::1]/", expect: "private", kind: "private", label: "ula" },
  { url: "http://[::]/", expect: "private", kind: "private", label: "ipv6 unspecified" },
  { url: "http://[::1]/", expect: "private", kind: "loopback", label: "ipv6 loopback" },
  { url: "http://[::ffff:10.0.0.1]/", expect: "private", kind: "private", label: "mapped private" },
  { url: "http://[::ffff:127.0.0.1]/", expect: "private", kind: "loopback", label: "mapped loopback" },
  { url: "https://example.com/", lookup: lookupTo("93.184.216.34"), expect: "public", label: "public" },
  { url: "http://[2606:4700::1111]/", expect: "public", label: "public ipv6" },
  { url: "http://172.32.0.1/", expect: "public", label: "just outside 172.16/12" },
  { url: "http://100.128.0.1/", expect: "public", label: "just outside cgnat" },
];

for (const c of cases) {
  test(`assertTargetAllowed: ${c.label}`, async () => {
    const lookup = c.lookup ?? noLookup;
    if (c.expect === "always") {
      for (const policy of [ALLOW, WARN, DENY]) {
        await assert.rejects(assertTargetAllowed(c.url, policy, lookup), /blocked by the egress policy: .*link-local/);
      }
    } else if (c.expect === "public") {
      for (const policy of [ALLOW, WARN, DENY]) await assertTargetAllowed(c.url, policy, lookup);
    } else {
      await assertTargetAllowed(c.url, ALLOW, lookup);
      await assertTargetAllowed(c.url, WARN, lookup);
      await assert.rejects(
        assertTargetAllowed(c.url, DENY, lookup),
        (error: unknown) =>
          error instanceof EgressRefusedError &&
          error.message.includes(`is a ${c.kind} address`) &&
          /add \S+ to EGRESS_ALLOW/.test(error.message),
      );
    }
  });
}

test("a public name resolving to a private address is that private address", async () => {
  const lookup = lookupTo("10.0.0.9");
  await assertTargetAllowed("https://example.com/", ALLOW, lookup);
  await assert.rejects(
    assertTargetAllowed("https://example.com/", DENY, lookup),
    /example\.com \(10\.0\.0\.9\) is a private address; add example\.com to EGRESS_ALLOW/,
  );
});

test("one bad address among the answers refuses the name", async () => {
  const lookup = lookupTo("93.184.216.34", "169.254.169.254");
  await assert.rejects(assertTargetAllowed("https://example.com/", ALLOW, lookup), /link-local/);
});

test("a scheme other than http(s) is refused", async () => {
  await assert.rejects(assertTargetAllowed("file:///etc/passwd", ALLOW, noLookup), /egress policy: scheme/);
  await assert.rejects(assertTargetAllowed("ftp://example.com/", ALLOW, noLookup), /egress policy: scheme/);
});

const allowCases: { url: string; allow: string; lookup?: () => Promise<string[]>; ok: boolean; label: string }[] = [
  { url: "http://10.1.2.3/", allow: "10.0.0.0/8", ok: true, label: "inside a v4 range" },
  { url: "http://11.0.0.1/", allow: "10.0.0.0/8", ok: true, label: "public stays public" },
  { url: "http://192.168.1.5/", allow: "10.0.0.0/8", ok: false, label: "outside the v4 range" },
  { url: "http://192.168.1.5/", allow: "192.168.1.5", ok: true, label: "a bare address" },
  { url: "http://192.168.1.6/", allow: "192.168.1.5", ok: false, label: "the bare address next door" },
  { url: "http://[::ffff:10.0.0.1]/", allow: "10.0.0.0/8", ok: true, label: "mapped v6 inside a v4 range" },
  { url: "http://[fd12::1]/", allow: "fd00::/8", ok: true, label: "inside a v6 range" },
  { url: "http://[fe80::1]/", allow: "fd00::/8", ok: false, label: "link-local outside the v6 range" },
  { url: "http://[::1]/", allow: "::1", ok: true, label: "ipv6 loopback by address" },
  { url: "http://127.0.0.1/", allow: "127.0.0.0/8", ok: true, label: "loopback range" },
  { url: "http://169.254.169.254/", allow: "169.254.169.254/32", ok: true, label: "link-local, typed on purpose" },
  { url: "http://nas.lan/", allow: "nas.lan", lookup: lookupTo("192.168.1.20"), ok: true, label: "a host name" },
  { url: "http://NAS.lan./", allow: "nas.lan", lookup: lookupTo("192.168.1.20"), ok: true, label: "host name case and dot" },
  { url: "http://other.lan/", allow: "nas.lan", lookup: lookupTo("192.168.1.20"), ok: false, label: "another host name" },
  { url: "http://nas.lan/", allow: "nas.lan", lookup: lookupTo("169.254.1.1"), ok: false, label: "a name never opens link-local" },
  { url: "http://10.0.0.1/", allow: "0.0.0.0/0", ok: true, label: "the whole v4 space" },
];

for (const c of allowCases) {
  test(`EGRESS_ALLOW: ${c.label}`, async () => {
    const check = assertTargetAllowed(c.url, deny(c.allow), c.lookup ?? noLookup);
    if (c.ok) await check;
    else await assert.rejects(check, EgressRefusedError);
  });
}

test("parseAllowList splits on commas and spaces and lowercases", () => {
  assert.deepEqual(parseAllowList(" 10.0.0.0/8, NAS.lan  fd00::/8,,"), ["10.0.0.0/8", "nas.lan", "fd00::/8"]);
  assert.deepEqual(parseAllowList(undefined), []);
});

test("unusableAllowEntries names what no rule can use", () => {
  assert.deepEqual(
    unusableAllowEntries(["10.0.0.0/8", "nas.lan", "[fd00::]/8", "10.0.0.0/33", "300.1.1.1", "http://x", "a/b/c"]),
    ["10.0.0.0/33", "300.1.1.1", "http://x", "a/b/c"],
  );
});

test("readOutboundPolicy: the edition's mode, OUTBOUND_BLOCK_PRIVATE forcing deny, EGRESS_ALLOW added", (t) => {
  t.after(resetOutbound);
  assert.deepEqual(readOutboundPolicy({}), { ...ALLOW, proxied: false });
  configureOutbound({ privateTargets: "warn", allow: ["nas.lan"] });
  assert.deepEqual(readOutboundPolicy({}), { privateTargets: "warn", allow: ["nas.lan"], proxied: false });
  assert.deepEqual(readOutboundPolicy({ OUTBOUND_BLOCK_PRIVATE: "yes" }).privateTargets, "warn");
  assert.deepEqual(readOutboundPolicy({ OUTBOUND_BLOCK_PRIVATE: " TRUE " }).privateTargets, "deny");
  assert.deepEqual(readOutboundPolicy({ EGRESS_ALLOW: "10.0.0.0/8" }).allow, ["nas.lan", "10.0.0.0/8"]);
});

test("warn mode reads a private target and logs it once per host", async (t) => {
  t.after(resetOutbound);
  const lines: unknown[] = [];
  configureOutbound({ warn: (message, fields) => lines.push({ message, fields }) });
  await assertTargetAllowed("http://10.0.0.5/a", WARN, noLookup);
  await assertTargetAllowed("http://10.0.0.5/b", WARN, noLookup);
  await assertTargetAllowed("http://10.0.0.6/", WARN, noLookup);
  await assertTargetAllowed("http://10.0.0.7/", deny("10.0.0.7"), noLookup);
  assert.equal(lines.length, 2);
  assert.match(JSON.stringify(lines[0]), /the UI edition refuses it unless EGRESS_ALLOW lists it.*"host":"10\.0\.0\.5"/);
});

test("assertHostAllowed: a probe passes an unresolvable name through, a read does not", async () => {
  const failing = async (): Promise<string[]> => {
    throw new Error("getaddrinfo ENOTFOUND nope.invalid");
  };
  await assertHostAllowed("nope.invalid", DENY, { lookup: failing, passUnresolved: true });
  await assert.rejects(assertHostAllowed("nope.invalid", DENY, { lookup: failing }), /ENOTFOUND/);
  await assert.rejects(assertHostAllowed("[::1]", DENY, { lookup: noLookup }), /::1 is a loopback address/);
});

test("guardedFetch follows a redirect between allowed targets", async () => {
  await withServer(
    (req, res) => {
      if (req.url === "/a") {
        res.writeHead(302, { location: "/b" });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end("landed");
    },
    async (baseUrl) => {
      const response = await guardedFetch(`${baseUrl}/a`, {}, ALLOW, true);
      assert.equal(await response.text(), "landed");
    },
  );
});

test("guardedFetch refuses a redirect to a link-local target", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      res.end();
    },
    async (baseUrl) => {
      await assert.rejects(guardedFetch(baseUrl, {}, ALLOW, true), /blocked by the egress policy: .*link-local/);
    },
  );
});

test("guardedFetch hands a redirect back untouched when not following", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/" });
      res.end();
    },
    async (baseUrl) => {
      const response = await guardedFetch(baseUrl, {}, ALLOW, false);
      assert.equal(response.status, 302);
    },
  );
});

test("guardedFetch gives up after five hops", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(302, { location: "/again" });
      res.end();
    },
    async (baseUrl) => {
      await assert.rejects(guardedFetch(baseUrl, {}, ALLOW, true), /too many redirects/);
    },
  );
});

test("guardedFetch re-checks a redirect to a private address under deny", async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(302, { location: "http://10.0.0.1/admin" });
      res.end();
    },
    async (baseUrl) => {
      // The local server itself is let through by address; the hop it points at is not.
      await assert.rejects(
        guardedFetch(baseUrl, {}, deny("127.0.0.1"), true),
        /10\.0\.0\.1 is a private address; add 10\.0\.0\.1 to EGRESS_ALLOW/,
      );
    },
  );
});
