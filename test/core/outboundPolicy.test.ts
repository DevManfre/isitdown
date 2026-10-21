import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BodyTooLargeError,
  MAX_BODY_BYTES,
  assertTargetAllowed,
  guardedFetch,
  readCapped,
  readOutboundPolicy,
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

const cases: { url: string; lookup?: () => Promise<string[]>; open: boolean; strict: boolean; label: string }[] = [
  { url: "http://169.254.169.254/latest", open: false, strict: false, label: "metadata" },
  { url: "http://[fd00:ec2::254]/", open: false, strict: false, label: "aws ipv6 metadata" },
  { url: "http://[fe80::1]/", open: false, strict: false, label: "ipv6 link-local" },
  { url: "http://[::ffff:169.254.169.254]/", open: false, strict: false, label: "mapped link-local" },
  { url: "http://127.0.0.1/", open: true, strict: false, label: "loopback" },
  { url: "http://localhost/", lookup: lookupTo("127.0.0.1"), open: true, strict: false, label: "localhost" },
  { url: "http://192.168.1.10/", open: true, strict: false, label: "192.168" },
  { url: "http://10.0.0.5/", open: true, strict: false, label: "10/8" },
  { url: "http://172.16.0.1/", open: true, strict: false, label: "172.16/12" },
  { url: "http://100.64.0.1/", open: true, strict: false, label: "cgnat" },
  { url: "http://0.0.0.0/", open: true, strict: false, label: "this host" },
  { url: "http://[fd12::1]/", open: true, strict: false, label: "ula" },
  { url: "http://[::1]/", open: true, strict: false, label: "ipv6 loopback" },
  { url: "http://[::ffff:10.0.0.1]/", open: true, strict: false, label: "mapped private" },
  { url: "https://example.com/", lookup: lookupTo("93.184.216.34"), open: true, strict: true, label: "public" },
  { url: "http://172.32.0.1/", open: true, strict: true, label: "just outside 172.16/12" },
];

for (const c of cases) {
  // `open` = refused when blockPrivate; `strict` = allowed under both policies.
  test(`assertTargetAllowed: ${c.label}`, async () => {
    const lookup = c.lookup ?? noLookup;
    const alwaysBad = !c.open && !c.strict;
    if (alwaysBad) {
      await assert.rejects(assertTargetAllowed(c.url, { blockPrivate: false }, lookup), /refused: link-local address/);
      await assert.rejects(assertTargetAllowed(c.url, { blockPrivate: true }, lookup), /refused: link-local address/);
    } else if (c.strict) {
      await assertTargetAllowed(c.url, { blockPrivate: false }, lookup);
      await assertTargetAllowed(c.url, { blockPrivate: true }, lookup);
    } else {
      await assertTargetAllowed(c.url, { blockPrivate: false }, lookup);
      await assert.rejects(
        assertTargetAllowed(c.url, { blockPrivate: true }, lookup),
        /refused: private address \(OUTBOUND_BLOCK_PRIVATE is set\)/,
      );
    }
  });
}

test("a public name resolving to a private address is refused only under blockPrivate", async () => {
  const lookup = lookupTo("10.0.0.9");
  await assertTargetAllowed("https://example.com/", { blockPrivate: false }, lookup);
  await assert.rejects(assertTargetAllowed("https://example.com/", { blockPrivate: true }, lookup), /private address/);
});

test("one bad address among the answers refuses the name", async () => {
  const lookup = lookupTo("93.184.216.34", "169.254.169.254");
  await assert.rejects(assertTargetAllowed("https://example.com/", { blockPrivate: false }, lookup), /link-local/);
});

test("a scheme other than http(s) is refused", async () => {
  await assert.rejects(assertTargetAllowed("file:///etc/passwd", { blockPrivate: false }, noLookup), /refused: scheme/);
  await assert.rejects(assertTargetAllowed("ftp://example.com/", { blockPrivate: false }, noLookup), /refused: scheme/);
});

test("readOutboundPolicy is off unless the variable is exactly true", () => {
  assert.deepEqual(readOutboundPolicy({}), { blockPrivate: false });
  assert.deepEqual(readOutboundPolicy({ OUTBOUND_BLOCK_PRIVATE: "yes" }), { blockPrivate: false });
  assert.deepEqual(readOutboundPolicy({ OUTBOUND_BLOCK_PRIVATE: " TRUE " }), { blockPrivate: true });
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
      const response = await guardedFetch(`${baseUrl}/a`, {}, { blockPrivate: false }, true);
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
      await assert.rejects(guardedFetch(baseUrl, {}, { blockPrivate: false }, true), /refused: link-local address/);
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
      const response = await guardedFetch(baseUrl, {}, { blockPrivate: false }, false);
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
      await assert.rejects(guardedFetch(baseUrl, {}, { blockPrivate: false }, true), /too many redirects/);
    },
  );
});
