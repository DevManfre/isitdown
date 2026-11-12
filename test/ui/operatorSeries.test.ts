import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { parseSeriesCsv, thin } from "../../src/ui/operatorSeries.ts";
import { buildUiRuntime, type UiRuntime } from "../../src/ui/runtime.ts";
import { createLogger } from "../../src/core/logger.ts";
import { withServer } from "../helpers/localServer.ts";

const silent = createLogger("error", () => {});

test("csv: ISO and Unix stamps, a header, comments and blank lines; sorted", () => {
  const points = parseSeriesCsv("time,errors\n# exported from grafana\n\n1762000200,2.5\n2026-11-01T12:00:00Z,1\n1762000100000;0.5\n");
  assert.deepEqual(points, [
    { at: "2025-11-01T12:28:20.000Z", value: 0.5 },
    { at: "2025-11-01T12:30:00.000Z", value: 2.5 },
    { at: "2026-11-01T12:00:00.000Z", value: 1 },
  ]);
});

test("csv: a row that cannot be read names its line rather than vanishing", () => {
  assert.throws(() => parseSeriesCsv("2026-11-01T12:00:00Z,1\n2026-11-01T12:01:00Z,n/a\n"), /line 2/);
  assert.throws(() => parseSeriesCsv("time,value\n"), /no rows/);
  assert.throws(() => parseSeriesCsv("just one cell\n"), /line 1/);
});

test("thinning keeps the spike in each bucket", () => {
  const points = Array.from({ length: 1000 }, (_, index) => ({ at: String(index).padStart(4, "0"), value: index === 503 ? 99 : 1 }));
  const thinned = thin(points, 100);
  assert.equal(thinned.length, 100);
  assert.ok(thinned.some((point) => point.value === 99));
  assert.equal(thin(points.slice(0, 50), 100).length, 50);
});

interface Api {
  runtime: UiRuntime;
  send: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  close: () => Promise<void>;
}

async function api(env: NodeJS.ProcessEnv = {}): Promise<Api> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-series-"));
  const runtime = await buildUiRuntime({ dbPath: join(dir, "isitdown.db"), env, logger: silent, seriesDeps: { fetch: (url, init) => fetch(url, init) } });
  const server: Server = runtime.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    send: async (method, path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
    },
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      runtime.close();
    },
  };
}

const window = "from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z";

test("a CSV series is stored, read back over a window, and deleted with its points", async () => {
  const app = await api();
  try {
    assert.equal((await app.send("POST", "/config/series", { source: "csv", name: "", csv: "x" })).status, 400);
    assert.equal((await app.send("POST", "/config/series", { source: "csv", name: "Errors", csv: "2026-11-01T10:00:00Z,oops" })).status, 400);

    const created = await app.send("POST", "/config/series", {
      source: "csv",
      name: "Error rate",
      unit: "%",
      csv: "at,value\n2026-10-31T23:00:00Z,9\n2026-11-01T10:00:00Z,0.4\n2026-11-01T11:00:00Z,3.2\n",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.points, 3);
    assert.equal((await app.send("GET", "/config/series")).body.series.length, 1);

    const read = await app.send("GET", `/series/${created.body.id}?${window}`);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.points, [
      { at: "2026-11-01T10:00:00.000Z", value: 0.4 },
      { at: "2026-11-01T11:00:00.000Z", value: 3.2 },
    ]);

    assert.equal((await app.send("GET", `/series/${created.body.id}?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z`)).status, 400);
    assert.equal((await app.send("DELETE", `/config/series/${created.body.id}`)).status, 204);
    assert.equal((await app.send("GET", `/series/${created.body.id}?${window}`)).status, 404);
    const left = app.runtime.db.prepare("SELECT COUNT(*) AS n FROM operator_points").get() as { n: number };
    assert.equal(left.n, 0);
  } finally {
    await app.close();
  }
});

test("a Prometheus series is asked with query_range over the window, with the token when set", async () => {
  const seen: { url: URL; auth: string | undefined }[] = [];
  await withServer(
    (req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      seen.push({ url, auth: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          status: "success",
          data: { resultType: "matrix", result: [{ metric: {}, values: [[1762000000, "0.5"], [1762000300, "NaN"], [1762000600, "4"]] }] },
        }),
      );
    },
    async (baseUrl) => {
      const app = await api({ PROMETHEUS_TOKEN: "tok" });
      try {
        const created = await app.send("POST", "/config/series", {
          source: "prometheus",
          name: "5xx rate",
          url: baseUrl,
          query: 'sum(rate(http_requests_total{code=~"5.."}[5m]))',
        });
        assert.equal(created.status, 201);
        const read = await app.send("GET", `/series/${created.body.id}?${window}`);
        assert.equal(read.status, 200);
        assert.deepEqual(read.body.points.map((point: { value: number }) => point.value), [0.5, 4]);
      } finally {
        await app.close();
      }
    },
  );
  assert.equal(seen[0]?.url.pathname, "/api/v1/query_range");
  assert.equal(seen[0]?.url.searchParams.get("start"), String(Date.parse("2026-11-01T00:00:00Z") / 1000));
  assert.equal(seen[0]?.url.searchParams.get("step"), "288");
  assert.equal(seen[0]?.auth, "Bearer tok");
});

test("a query that returns several series, or an error, is a 502 that says why", async () => {
  let answer: unknown = { status: "success", data: { resultType: "matrix", result: [{ values: [] }, { values: [] }] } };
  await withServer(
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer));
    },
    async (baseUrl) => {
      const app = await api();
      try {
        const { body } = await app.send("POST", "/config/series", { source: "prometheus", name: "p", url: baseUrl, query: "up" });
        const many = await app.send("GET", `/series/${body.id}?${window}`);
        assert.equal(many.status, 502);
        assert.match(many.body.error.message, /2 series.*sum/);
        answer = { status: "error", error: "parse error at char 3" };
        const bad = await app.send("GET", `/series/${body.id}?${window}`);
        assert.equal(bad.status, 502);
        assert.match(bad.body.error.message, /parse error/);
      } finally {
        await app.close();
      }
    },
  );
});
