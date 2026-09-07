import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchConditional, forgetProvider, resetValidators } from "../../src/core/http.ts";
import { withServer } from "../helpers/localServer.ts";

const opts = { providerId: "github", accept: "application/json", timeoutMs: 2000, label: "statuspage fetch" };

/**
 * A provider that answers 200 with `body` the first time and 304 to any request
 * carrying a matching validator afterwards — which is what a real status page
 * does between two cycles that saw no change.
 */
function conditionalProvider(body: string, etag = 'W/"v1"') {
  const seen: (string | undefined)[] = [];
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    seen.push(req.headers["if-none-match"] ?? req.headers["if-modified-since"]);
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json", etag });
    res.end(body);
  };
  return { handler, seen };
}

test("a first fetch has nothing to revalidate with and returns the body", async () => {
  resetValidators();
  const provider = conditionalProvider('{"ok":true}');
  await withServer(provider.handler, async (baseUrl) => {
    assert.equal(await fetchConditional(`${baseUrl}/summary.json`, opts), '{"ok":true}');
    assert.deepEqual(provider.seen, [undefined]);
  });
});

test("the stored ETag comes back as If-None-Match and a 304 replays the cached body", async () => {
  resetValidators();
  const provider = conditionalProvider('{"ok":true}');
  await withServer(provider.handler, async (baseUrl) => {
    const url = `${baseUrl}/summary.json`;
    await fetchConditional(url, opts);
    // The provider answers 304 here: the body can only come from the cache.
    assert.equal(await fetchConditional(url, opts), '{"ok":true}');
    assert.deepEqual(provider.seen, [undefined, 'W/"v1"']);
  });
});

test("a provider that only sends Last-Modified is revalidated with If-Modified-Since", async () => {
  resetValidators();
  const modified = "Wed, 02 Sep 2026 10:00:00 GMT";
  const seen: (string | undefined)[] = [];
  await withServer(
    (req, res) => {
      seen.push(req.headers["if-modified-since"]);
      if (req.headers["if-modified-since"] === modified) {
        res.writeHead(304);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "last-modified": modified });
      res.end("[]");
    },
    async (baseUrl) => {
      const url = `${baseUrl}/incidents.json`;
      await fetchConditional(url, opts);
      assert.equal(await fetchConditional(url, opts), "[]");
      assert.deepEqual(seen, [undefined, modified]);
    },
  );
});

test("a fresh 200 replaces the cached body rather than replaying the old one", async () => {
  resetValidators();
  let version = 1;
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json", etag: `"v${version}"` });
      res.end(`{"v":${version}}`);
      version += 1;
    },
    async (baseUrl) => {
      const url = `${baseUrl}/summary.json`;
      assert.equal(await fetchConditional(url, opts), '{"v":1}');
      assert.equal(await fetchConditional(url, opts), '{"v":2}');
    },
  );
});

test("two providers reading the same url do not share a validator", async () => {
  resetValidators();
  const provider = conditionalProvider('{"ok":true}');
  await withServer(provider.handler, async (baseUrl) => {
    const url = `${baseUrl}/summary.json`;
    await fetchConditional(url, opts);
    await fetchConditional(url, { ...opts, providerId: "cloudflare" });
    assert.deepEqual(provider.seen, [undefined, undefined]);
  });
});

test("a 304 with nothing cached is a failed fetch, not an empty reading", async () => {
  resetValidators();
  await withServer(
    (_req, res) => {
      res.writeHead(304);
      res.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        fetchConditional(`${baseUrl}/summary.json`, opts),
        /statuspage fetch for github: HTTP 304 with nothing cached/,
      );
    },
  );
});

test("a non-2xx answer throws, naming the provider and the status", async () => {
  resetValidators();
  await withServer(
    (_req, res) => {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("nope");
    },
    async (baseUrl) => {
      await assert.rejects(fetchConditional(`${baseUrl}/summary.json`, opts), /statuspage fetch for github failed: HTTP 503/);
    },
  );
});

test("a failed revalidation drops the validator so the next cycle asks unconditionally", async () => {
  resetValidators();
  const seen: (string | undefined)[] = [];
  let fail = false;
  await withServer(
    (req, res) => {
      seen.push(req.headers["if-none-match"]);
      if (fail) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("boom");
        return;
      }
      res.writeHead(200, { "content-type": "application/json", etag: '"v1"' });
      res.end("{}");
    },
    async (baseUrl) => {
      const url = `${baseUrl}/summary.json`;
      await fetchConditional(url, opts);
      fail = true;
      await assert.rejects(fetchConditional(url, opts));
      fail = false;
      await fetchConditional(url, opts);
      assert.deepEqual(seen, [undefined, '"v1"', undefined]);
    },
  );
});

test("forgetting a provider clears what was cached for it", async () => {
  resetValidators();
  const provider = conditionalProvider('{"ok":true}');
  await withServer(provider.handler, async (baseUrl) => {
    const url = `${baseUrl}/summary.json`;
    await fetchConditional(url, opts);
    forgetProvider("github");
    await fetchConditional(url, opts);
    assert.deepEqual(provider.seen, [undefined, undefined]);
  });
});

test("a provider that never answers gives up on the timeout", async () => {
  resetValidators();
  await withServer(
    () => {
      /* never responds */
    },
    async (baseUrl) => {
      await assert.rejects(fetchConditional(`${baseUrl}/summary.json`, { ...opts, timeoutMs: 150 }));
    },
  );
});

test("a provider answering in UTF-16 is decoded by the charset it declared", async () => {
  resetValidators();
  // AWS publishes its health feed this way, and `Response.text()` is UTF-8
  // regardless of the header — the bytes have to be decoded by hand.
  const body = '[{"summary":"Increased Error Rates"}]';
  const utf16be = Buffer.from(`﻿${body}`, "utf16le").swap16();
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json;charset=utf-16" });
      res.end(utf16be);
    },
    async (baseUrl) => {
      assert.equal(await fetchConditional(`${baseUrl}/currentevents`, opts), body);
    },
  );
});

test("a completed read reports its latency, whether the body was replayed or not", async () => {
  resetValidators();
  const provider = conditionalProvider('{"ok":true}');
  const reads: { latencyMs: number; notModified: boolean }[] = [];
  await withServer(provider.handler, async (baseUrl) => {
    const url = `${baseUrl}/summary.json`;
    await fetchConditional(url, { ...opts, onRead: (read) => reads.push(read) });
    await fetchConditional(url, { ...opts, onRead: (read) => reads.push(read) });
  });
  assert.deepEqual(
    reads.map((read) => read.notModified),
    [false, true],
  );
  for (const read of reads) {
    assert.ok(Number.isInteger(read.latencyMs) && read.latencyMs >= 0, `bad latency ${read.latencyMs}`);
  }
});

test("a failed read reports no latency", async () => {
  resetValidators();
  const reads: { latencyMs: number; notModified: boolean }[] = [];
  await withServer(
    (_req, res) => {
      res.writeHead(503);
      res.end();
    },
    async (baseUrl) => {
      await assert.rejects(
        fetchConditional(`${baseUrl}/summary.json`, { ...opts, onRead: (read) => reads.push(read) }),
      );
    },
  );
  assert.deepEqual(reads, []);
});
