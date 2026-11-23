import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../../src/core/logger.ts";
import { fetchConditional, resetValidators } from "../../src/core/http.ts";
import { assertTargetAllowed, readOutboundPolicy } from "../../src/core/outboundPolicy.ts";
import { proxyConfigured, useEnvProxy } from "../../src/core/proxy.ts";
import { withServer } from "../helpers/localServer.ts";

/**
 * Roadmap 10.7, against a real (fake) proxy: a plain HTTP server sees an
 * absolute-form request line when a client talks to it as a proxy, so what
 * reached it, and in which form, is the whole assertion.
 */

const read = (url: string): Promise<string> =>
  fetchConditional(url, { providerId: "p", accept: "text/plain", timeoutMs: 2000, label: "read" });

async function withProxy(run: (proxyUrl: string, seen: string[]) => Promise<void>): Promise<void> {
  const seen: string[] = [];
  await withServer(
    (req, res) => {
      seen.push(req.url ?? "");
      res.end("from the proxy");
    },
    (proxyUrl) => run(proxyUrl, seen),
  );
}

test("proxyConfigured reads either case and ignores blank values", () => {
  assert.equal(proxyConfigured({}), false);
  assert.equal(proxyConfigured({ HTTP_PROXY: "  " }), false);
  assert.equal(proxyConfigured({ https_proxy: "http://proxy:3128" }), true);
  assert.equal(proxyConfigured({ HTTP_PROXY: "http://proxy:3128" }), true);
});

test("with no proxy variable nothing changes and nothing is logged", async () => {
  const lines: string[] = [];
  const restore = useEnvProxy({ NO_PROXY: "example.com" }, createLogger("debug", (line) => lines.push(line)));
  restore();
  assert.deepEqual(lines, []);
});

test("every read goes through the proxy, which sees the final destination", async () => {
  resetValidators();
  await withProxy(async (proxyUrl, seen) => {
    const lines: string[] = [];
    const restore = useEnvProxy(
      { http_proxy: proxyUrl.replace("http://", "http://user:secret@") },
      createLogger("info", (line) => lines.push(line)),
    );
    try {
      // A name no resolver here knows: only the proxy can reach it.
      assert.equal(await read("http://status.example.test/api/v2/summary.json"), "from the proxy");
    } finally {
      restore();
    }
    assert.deepEqual(seen, ["http://status.example.test/api/v2/summary.json"]);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /HTTP proxy/);
    assert.doesNotMatch(lines[0] ?? "", /secret/, "the proxy credential never reaches the log");
  });
});

test("a raw fetch outside the helper — a notifier's — goes through the proxy too", async () => {
  await withProxy(async (proxyUrl, seen) => {
    const restore = useEnvProxy({ HTTP_PROXY: proxyUrl }, createLogger("error", () => {}));
    try {
      const response = await fetch("http://hooks.example.test/send", { method: "POST", body: "{}" });
      assert.equal(await response.text(), "from the proxy");
    } finally {
      restore();
    }
    assert.deepEqual(seen, ["http://hooks.example.test/send"]);
  });
});

test("NO_PROXY keeps a host off the proxy", async () => {
  resetValidators();
  await withProxy(async (proxyUrl, seen) => {
    await withServer(
      (_req, res) => res.end("direct"),
      async (directUrl) => {
        const restore = useEnvProxy(
          { HTTP_PROXY: proxyUrl, NO_PROXY: "127.0.0.1" },
          createLogger("error", () => {}),
        );
        try {
          assert.equal(await read(`${directUrl}/summary.json`), "direct");
        } finally {
          restore();
        }
      },
    );
    assert.deepEqual(seen, [], "the proxy was never asked");
  });
});

test("the egress policy judges the destination, not the proxy: an unresolvable name passes only when proxied", async () => {
  const nowhere = async (): Promise<string[]> => {
    throw new Error("getaddrinfo ENOTFOUND status.example.test");
  };
  const direct = readOutboundPolicy({});
  await assert.rejects(assertTargetAllowed("https://status.example.test/", direct, nowhere), /ENOTFOUND/);

  const restore = useEnvProxy({ HTTPS_PROXY: "http://proxy.corp:3128" }, createLogger("error", () => {}));
  try {
    const proxied = readOutboundPolicy({});
    assert.equal(proxied.proxied, true);
    await assertTargetAllowed("https://status.example.test/", proxied, nowhere);

    // A destination that resolves to a refused address is still refused behind a proxy.
    const metadata = async (): Promise<string[]> => ["169.254.169.254"];
    await assert.rejects(assertTargetAllowed("http://looks-public.example/", proxied, metadata), /link-local/);
  } finally {
    restore();
  }
  assert.equal(readOutboundPolicy({}).proxied, false, "restoring turns it off again");
});
