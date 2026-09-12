import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  httpAdapter,
  parseStatusSpec,
  probeConfig,
  readingFromOutcome,
  severityFromOutcome,
  type ProbeConfig,
} from "../../src/adapters/http.adapter.ts";
import type { FetchContext, ServiceRef } from "../../src/core/adapter.interface.ts";
import type { StatusPageRead } from "../../src/core/http.ts";
import { withServer } from "../helpers/localServer.ts";
import { runAdapterContract } from "./adapter.contract.ts";

const ctx: FetchContext = { timeoutMs: 2000 };

const service = (options: Record<string, string> = {}, baseUrl = "https://app.example.com"): ServiceRef => ({
  id: "my-api",
  name: "My API",
  baseUrl,
  options,
});

const config = (options: Record<string, string> = {}): ProbeConfig => probeConfig(service(options));

/** Answers every path with one status and body, the way a probed endpoint does. */
const answering = (status: number, body = "ok", headers: Record<string, string> = {}) =>
  (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(status, { "content-type": "text/plain", ...headers });
    res.end(body);
  };

// The contract, in its probe form: a target that misbehaves must resolve into a
// reading that is not healthy, rather than throw the way a document adapter
// does. `expectBody` is configured so an emptied body is a real failure here —
// without it a 200 carrying nothing is a legitimately healthy answer, and the
// kit's "unreadable payload never reads operational" case would say nothing.
runAdapterContract("http", () => ({
  adapter: httpAdapter,
  service: (baseUrl) => service({ expectBody: "ok" }, baseUrl),
  ok: { "/": "ok" },
  degraded: { "/": "ok" },
  readsResponseNotBody: true,
}));

test("an endpoint answering 200 reads operational, and reports nothing but a severity", () => {
  const reading = readingFromOutcome(service(), config(), { answered: true, status: 200, body: null, latencyMs: 12 });

  assert.equal(reading.provider, "my-api");
  assert.equal(reading.overallStatus, "operational");
  assert.deepEqual(reading.activeIncidents, []);
  assert.deepEqual(reading.components, []);
  assert.deepEqual(reading.maintenances, []);
});

test("a status outside the accepted set reads as an outage, not as a failed read", () => {
  const outcome = { answered: true, status: 503, body: null, latencyMs: 4 } as const;

  assert.equal(severityFromOutcome(outcome, config()), "major_outage");
});

test("an endpoint that did not answer at all reads as an outage", () => {
  // The inversion this adapter exists for: for a status page this is us going
  // blind, for a probe it is the answer.
  assert.equal(severityFromOutcome({ answered: false }, config()), "major_outage");
});

test("the operator's own accepted statuses decide, so a 401 from a live API is healthy", () => {
  const probe = config({ expectStatus: "200-299,401" });

  assert.equal(severityFromOutcome({ answered: true, status: 401, body: null, latencyMs: 3 }, probe), "operational");
  assert.equal(severityFromOutcome({ answered: true, status: 404, body: null, latencyMs: 3 }, probe), "major_outage");
});

test("a body that does not carry the expected text reads as an outage", () => {
  const probe = config({ expectBody: "\"db\":\"up\"" });

  assert.equal(
    severityFromOutcome({ answered: true, status: 200, body: '{"db":"up"}', latencyMs: 3 }, probe),
    "operational",
  );
  assert.equal(
    severityFromOutcome({ answered: true, status: 200, body: '{"db":"down"}', latencyMs: 3 }, probe),
    "major_outage",
  );
});

test("a body carrying forbidden text reads as an outage even on a 200", () => {
  // The failure mode a status check misses on its own: an error page served
  // with a perfectly healthy status line.
  const probe = config({ absentBody: "Application error" });

  assert.equal(
    severityFromOutcome({ answered: true, status: 200, body: "<h1>Application error</h1>", latencyMs: 3 }, probe),
    "major_outage",
  );
});

test("an answer at or over the slow threshold reads degraded rather than operational", () => {
  const probe = config({ slowMs: "500" });

  assert.equal(severityFromOutcome({ answered: true, status: 200, body: null, latencyMs: 499 }, probe), "operational");
  assert.equal(severityFromOutcome({ answered: true, status: 200, body: null, latencyMs: 500 }, probe), "degraded");
});

test("a wrong status wins over a slow one: the endpoint is down, not merely slow", () => {
  const probe = config({ slowMs: "10" });

  assert.equal(severityFromOutcome({ answered: true, status: 500, body: null, latencyMs: 900 }, probe), "major_outage");
});

test("accepted statuses are read as single values and as inclusive ranges", () => {
  assert.deepEqual(parseStatusSpec("200", service()), [[200, 200]]);
  assert.deepEqual(parseStatusSpec("200-299, 301 ,302", service()), [[200, 299], [301, 301], [302, 302]]);
});

test("an unreadable option throws, so a misconfigured check never quietly reads down", () => {
  assert.throws(() => config({ expectStatus: "2xx" }), /unreadable part/);
  assert.throws(() => config({ expectStatus: "299-200" }), /ends before it starts/);
  assert.throws(() => config({ expectStatus: "," }), /is empty/);
  // A field left blank is not a mistake, it is the operator saying nothing:
  // it falls back to the default rather than throwing at them.
  assert.deepEqual(config({ expectStatus: "  " }).accepted, [[200, 299]]);
  assert.throws(() => config({ method: "DELETE" }), /is not one of GET, HEAD/);
  assert.throws(() => config({ slowMs: "soon" }), /positive whole number/);
  assert.throws(() => config({ slowMs: "0" }), /positive whole number/);
  assert.throws(() => config({ followRedirects: "maybe" }), /must be yes or no/);
});

test("POST is refused: the poller retries a failed read, and a retried POST is not the same request twice", () => {
  assert.throws(() => config({ method: "POST" }), /is not one of GET, HEAD/);
});

test("matching a body a HEAD never downloads is a configuration error, not a permanent outage", () => {
  assert.throws(() => config({ method: "HEAD", expectBody: "ok" }), /downloads no body/);
});

test("a header referencing an unset variable throws rather than sending the literal ${VAR}", () => {
  // Sending it would earn a 401 and report the service down — the wrong thing
  // to be woken up by.
  assert.throws(() => config({ "header.Authorization": "Bearer ${PROBE_TEST_TOKEN_MISSING}" }), /which is not set/);
});

test("a header referencing a set variable travels resolved", () => {
  process.env["PROBE_TEST_TOKEN"] = "s3cret";
  try {
    assert.equal(config({ "header.Authorization": "Bearer ${PROBE_TEST_TOKEN}" }).headers["Authorization"], "Bearer s3cret");
  } finally {
    delete process.env["PROBE_TEST_TOKEN"];
  }
});

test("the path option is appended verbatim, which is how a trailing slash survives the config schema", () => {
  assert.equal(config({ path: "/health/" }).url, "https://app.example.com/health/");
  assert.equal(config().url, "https://app.example.com");
});

test("a probe reads the endpoint it was pointed at and reports the latency it took", async () => {
  const reads: StatusPageRead[] = [];

  await withServer(answering(200, "ok"), async (baseUrl) => {
    const reading = await httpAdapter.fetchStatus(service({}, baseUrl), { ...ctx, onRead: (read) => reads.push(read) });

    assert.equal(reading.overallStatus, "operational");
  });

  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.notModified, false);
  assert.ok(typeof reads[0]?.latencyMs === "number");
});

test("an endpoint that never answered reports no latency at all", async () => {
  const reads: StatusPageRead[] = [];
  // Nothing is listening on this port, so there is no round trip to time; a
  // recorded zero would draw a flat, fast line through an outage.
  const reading = await httpAdapter.fetchStatus(service({}, "http://127.0.0.1:1"), {
    ...ctx,
    onRead: (read) => reads.push(read),
  });

  assert.equal(reading.overallStatus, "major_outage");
  assert.deepEqual(reads, []);
});

test("a redirect is followed by default and read as itself when the operator says not to", async () => {
  await withServer(
    (req, res) => {
      if (req.url === "/moved") {
        res.writeHead(302, { location: "/here" });
        res.end();
        return;
      }
      answering(200, "ok")(req, res);
    },
    async (baseUrl) => {
      const followed = await httpAdapter.fetchStatus(service({ path: "/moved" }, baseUrl), ctx);
      assert.equal(followed.overallStatus, "operational");

      const asItself = await httpAdapter.fetchStatus(
        service({ path: "/moved", followRedirects: "no" }, baseUrl),
        ctx,
      );
      // A 302 to a login page is the classic way a dead app looks healthy.
      assert.equal(asItself.overallStatus, "major_outage");
    },
  );
});

test("a HEAD probe asks for no body and still reads the status", async () => {
  const methods: (string | undefined)[] = [];

  await withServer(
    (req, res) => {
      methods.push(req.method);
      answering(200, "ok")(req, res);
    },
    async (baseUrl) => {
      const reading = await httpAdapter.fetchStatus(service({ method: "HEAD" }, baseUrl), ctx);

      assert.equal(reading.overallStatus, "operational");
    },
  );

  assert.deepEqual(methods, ["HEAD"]);
});

test("configured headers reach the endpoint", async () => {
  let seen: string | undefined;

  await withServer(
    (req, res) => {
      seen = req.headers["x-probe-key"] as string | undefined;
      answering(200, "ok")(req, res);
    },
    async (baseUrl) => {
      await httpAdapter.fetchStatus(service({ "header.X-Probe-Key": "abc" }, baseUrl), ctx);
    },
  );

  assert.equal(seen, "abc");
});
