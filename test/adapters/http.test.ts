import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import {
  certificateDaysLeft,
  failureReason,
  httpAdapter,
  noteFromOutcome,
  parseStatusSpec,
  probeConfig,
  readingFromOutcome,
  severityFromOutcome,
  type ProbeConfig,
} from "../../src/adapters/http.adapter.ts";
import type { FetchContext, ReadingNote, ServiceRef } from "../../src/core/adapter.interface.ts";
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
  assert.equal(severityFromOutcome({ answered: false, reason: "connect ECONNREFUSED" }, config()), "major_outage");
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
  assert.throws(() => config({ slowMs: "0" }), /positive whole number of milliseconds/);
  assert.throws(() => config({ tlsWarnDays: "soon" }), /positive whole number of days/);
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

test("a certificate close to expiry reads degraded, and one with time left does not", () => {
  const probe = config({ tlsWarnDays: "14" });
  const answered = { answered: true, status: 200, body: null, latencyMs: 5 } as const;

  assert.equal(severityFromOutcome({ ...answered, tlsDaysLeft: 9 }, probe), "degraded");
  assert.equal(severityFromOutcome({ ...answered, tlsDaysLeft: 40 }, probe), "operational");
  // Asked for, but the handshake said nothing: not a reason to call a service
  // anything at all.
  assert.equal(severityFromOutcome(answered, probe), "operational");
  // Not asked for: an expiring certificate the operator never asked about
  // cannot change the reading.
  assert.equal(severityFromOutcome({ ...answered, tlsDaysLeft: 1 }, config()), "operational");
});

test("an endpoint that is already down is not reported as a certificate problem", () => {
  const probe = config({ tlsWarnDays: "14" });

  assert.equal(
    severityFromOutcome({ answered: true, status: 500, body: null, latencyMs: 5, tlsDaysLeft: 2 }, probe),
    "major_outage",
  );
  assert.match(
    noteFromOutcome({ answered: true, status: 500, body: null, latencyMs: 5, tlsDaysLeft: 2 }, probe)?.text ?? "",
    /outside the accepted/,
  );
});

test("the note says why the reading is not operational, and nothing when it is", () => {
  assert.equal(noteFromOutcome({ answered: true, status: 200, body: null, latencyMs: 5 }, config()), null);

  assert.deepEqual(noteFromOutcome({ answered: false, reason: "fetch failed" }, config()), {
    text: "no answer from https://app.example.com: fetch failed",
    unreachable: true,
  });
  assert.match(
    noteFromOutcome({ answered: true, status: 503, body: null, latencyMs: 5 }, config())?.text ?? "",
    /answered HTTP 503, outside the accepted 200-299/,
  );
  assert.match(
    noteFromOutcome({ answered: true, status: 200, body: "nope", latencyMs: 5 }, config({ expectBody: "ok" }))?.text ??
      "",
    /without the expected "ok"/,
  );
  assert.match(
    noteFromOutcome(
      { answered: true, status: 200, body: "Application error", latencyMs: 5 },
      config({ absentBody: "Application error" }),
    )?.text ?? "",
    /carrying the forbidden "Application error"/,
  );
  assert.match(
    noteFromOutcome({ answered: true, status: 200, body: null, latencyMs: 900 }, config({ slowMs: "500" }))?.text ?? "",
    /answered in 900 ms, at or over the 500 ms threshold/,
  );
});

test("only a failure to answer is reported as unreachable: a 503 answered", () => {
  assert.equal(noteFromOutcome({ answered: false, reason: "boom" }, config())?.unreachable, true);
  assert.equal(
    noteFromOutcome({ answered: true, status: 503, body: null, latencyMs: 1 }, config())?.unreachable,
    undefined,
  );
});

test("a probe that cannot reach the endpoint reports the reason to the poller", async () => {
  const notes: ReadingNote[] = [];

  const reading = await httpAdapter.fetchStatus(service({}, "http://127.0.0.1:1"), {
    ...ctx,
    onNote: (note) => notes.push(note),
  });

  assert.equal(reading.overallStatus, "major_outage");
  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.unreachable, true);
  assert.match(notes[0]?.text ?? "", /no answer from http:\/\/127\.0\.0\.1:1/);
});

test("a healthy probe reports no note at all", async () => {
  const notes: ReadingNote[] = [];

  await withServer(answering(200, "ok"), async (baseUrl) => {
    await httpAdapter.fetchStatus(service({}, baseUrl), { ...ctx, onNote: (note) => notes.push(note) });
  });

  assert.deepEqual(notes, []);
});

test("the certificate expiry is read off the host that served the answer", async () => {
  const key = readFileSync(new URL("../fixtures/tls/key.pem", import.meta.url));
  const cert = readFileSync(new URL("../fixtures/tls/cert.pem", import.meta.url));
  const server = createHttpsServer({ key, cert }, (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const daysLeft = await certificateDaysLeft(`https://127.0.0.1:${port}/`, 2000);

    assert.equal(typeof daysLeft, "number");
    // The fixture is issued for 7300 days; the assertion is that a real
    // handshake yields a real date, not the exact number of days left in it.
    assert.ok((daysLeft ?? 0) > 3000, `expected a far-future expiry, got ${daysLeft}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a host that cannot be asked for a certificate reports none rather than an outage", async () => {
  // Plain HTTP, and a url that is not one: both are "no expiry to read", never
  // a reason to call the service down.
  assert.equal(await certificateDaysLeft("http://127.0.0.1:1/", 500), null);
  assert.equal(await certificateDaysLeft("not a url", 500), null);
  assert.equal(await certificateDaysLeft("https://127.0.0.1:1/", 500), null);
});

test("the reason names the transport failure, not fetch's three-word summary", () => {
  const wrapped = new Error("fetch failed", { cause: new Error("connect ECONNREFUSED 10.0.0.4:8080") });
  assert.equal(failureReason(wrapped), "connect ECONNREFUSED 10.0.0.4:8080");

  const abort = new Error("The operation was aborted");
  abort.name = "TimeoutError";
  assert.equal(failureReason(abort), "timed out");

  assert.equal(failureReason(new Error("plain")), "plain");
  assert.equal(failureReason("not an error"), "not an error");
});

test("a probe that times out says so rather than reporting an empty reason", async () => {
  const notes: ReadingNote[] = [];

  await withServer(
    () => {
      /* never answers */
    },
    async (baseUrl) => {
      const reading = await httpAdapter.fetchStatus(service({}, baseUrl), {
        timeoutMs: 150,
        onNote: (note) => notes.push(note),
      });

      assert.equal(reading.overallStatus, "major_outage");
    },
  );

  assert.match(notes[0]?.text ?? "", /timed out|aborted/);
  assert.equal(notes[0]?.unreachable, true);
});
