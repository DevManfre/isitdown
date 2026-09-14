import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAdapter, originOf } from "../../src/adapters/detect.ts";
import { resetValidators } from "../../src/core/http.ts";
import { withServer } from "../helpers/localServer.ts";

const ctx = { timeoutMs: 2000 };

/** Serves `routes` by path, 404 for anything else — a real status page's own shape. */
function serve(routes: Record<string, string>) {
  return (req: { url?: string | undefined }, res: import("node:http").ServerResponse): void => {
    const body = routes[req.url ?? ""];
    if (body === undefined) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  };
}

const statuspageSummary = JSON.stringify({
  page: { id: "abc", name: "Example", url: "https://status.example.com" },
  status: { indicator: "none", description: "All Systems Operational" },
  components: [],
  incidents: [],
  scheduled_maintenances: [],
});

const instatusSummary = JSON.stringify({
  page: { name: "Example", status: "UP" },
  activeIncidents: [],
  activeMaintenances: [],
});

const betterStackIndex = JSON.stringify({
  data: { attributes: { aggregate_state: "operational" } },
  included: [],
});

test("a Statuspage page is recognised, and the origin is the base url its adapter wants", async () => {
  resetValidators();
  await withServer(serve({ "/api/v2/summary.json": statuspageSummary }), async (baseUrl) => {
    const detected = await detectAdapter(baseUrl, ctx);
    assert.equal(detected.adapter, "statuspage");
    assert.equal(detected.baseUrl, baseUrl);
  });
});

test("an Instatus page is told apart from a Statuspage one by its own document", async () => {
  resetValidators();
  await withServer(serve({ "/summary.json": instatusSummary }), async (baseUrl) => {
    const detected = await detectAdapter(baseUrl, ctx);
    assert.equal(detected.adapter, "instatus");
    assert.equal(detected.baseUrl, baseUrl);
  });
});

test("a Better Stack page is recognised by its index document", async () => {
  resetValidators();
  await withServer(serve({ "/index.json": betterStackIndex }), async (baseUrl) => {
    assert.equal((await detectAdapter(baseUrl, ctx)).adapter, "betterstack");
  });
});

test("a Cachet instance is recognised by its paginated component list", async () => {
  resetValidators();
  const components = JSON.stringify({
    meta: { pagination: { total: 1, count: 1, per_page: 1, current_page: 1 } },
    data: [{ id: 1, name: "API", status: 1 }],
  });
  await withServer(serve({ "/api/v1/components?per_page=1": components }), async (baseUrl) => {
    const detected = await detectAdapter(baseUrl, ctx);
    assert.equal(detected.adapter, "cachet");
    assert.equal(detected.baseUrl, baseUrl);
  });
});

test("an Uptime Kuma instance is recognised by its default status page", async () => {
  resetValidators();
  const page = JSON.stringify({ config: { slug: "default" }, incident: null, publicGroupList: [] });
  await withServer(serve({ "/api/status-page/default": page }), async (baseUrl) => {
    assert.equal((await detectAdapter(baseUrl, ctx)).adapter, "uptimekuma");
  });
});

test("an Uptime.com page on its own domain is recognised by the payload it renders from", async () => {
  resetValidators();
  const ajax = JSON.stringify({ error: null, data: { global_is_operational: true, components: [] } });
  await withServer(serve({ "/ajax": ajax }), async (baseUrl) => {
    assert.equal((await detectAdapter(baseUrl, ctx)).adapter, "uptimecom");
  });
});

test("a page that only publishes a feed hands back the feed's own url", async () => {
  resetValidators();
  const feed = '<?xml version="1.0"?><rss version="2.0"><channel><title>Status</title></channel></rss>';
  await withServer(serve({ "/history.rss": feed }), async (baseUrl) => {
    const detected = await detectAdapter(baseUrl, ctx);
    assert.equal(detected.adapter, "rss");
    // The feed adapter reads the url it is given, so the origin alone would
    // have it fetching the home page.
    assert.equal(detected.baseUrl, `${baseUrl}/history.rss`);
  });
});

test("a Statuspage page is not filed as a feed just because it also publishes one", async () => {
  resetValidators();
  const feed = '<?xml version="1.0"?><rss version="2.0"><channel><title>Status</title></channel></rss>';
  await withServer(
    serve({ "/api/v2/summary.json": statuspageSummary, "/history.rss": feed }),
    async (baseUrl) => {
      assert.equal((await detectAdapter(baseUrl, ctx)).adapter, "statuspage");
    },
  );
});

test("a page answering 200 with something else entirely is not a match", async () => {
  resetValidators();
  // One SPA shell for every path, which is what makes a bare 200 worthless as
  // evidence.
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body><div id=root></div></body></html>");
    },
    async (baseUrl) => {
      const detected = await detectAdapter(baseUrl, ctx);
      assert.equal(detected.adapter, null);
      assert.equal(detected.baseUrl, null);
      // Every candidate answered, and none of them matched: the probes say so
      // rather than reporting a page nobody could reach.
      assert.ok(detected.probes.length > 0);
      assert.ok(detected.probes.every((probe) => probe.outcome === "other-shape"));
    },
  );
});

test("a host nothing is listening on reports probes rather than throwing", async () => {
  resetValidators();
  // Reserved for documentation use, and unroutable, so nothing answers.
  const detected = await detectAdapter("http://192.0.2.1:9", { timeoutMs: 250 });
  assert.equal(detected.adapter, null);
  assert.ok(detected.probes.every((probe) => probe.outcome === "unreachable"));
});

test("the four single-provider adapters are recognised by host, with no request at all", async () => {
  for (const [input, adapter] of [
    ["https://health.aws.amazon.com", "aws"],
    ["status.cloud.google.com", "gcp"],
    ["https://azure.status.microsoft/en-us/status", "azure"],
    ["https://slack-status.com/", "slack"],
  ] as const) {
    const detected = await detectAdapter(input, ctx);
    assert.equal(detected.adapter, adapter);
    assert.deepEqual(detected.probes, []);
  }
});

test("a pasted document url is reduced to the origin an adapter appends to", () => {
  assert.equal(originOf("https://status.example.com/api/v2/summary.json"), "https://status.example.com");
  assert.equal(originOf("status.example.com"), "https://status.example.com");
  assert.equal(originOf("  https://status.example.com/?x=1  "), "https://status.example.com");
});

test("an unusable url is refused rather than probed", () => {
  assert.throws(() => originOf(""), /empty/);
  assert.throws(() => originOf("not a url at all"), /Invalid URL|not a url/);
});
