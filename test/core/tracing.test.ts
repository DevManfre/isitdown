import { test } from "node:test";
import assert from "node:assert/strict";
import { createTracer, parseHeaders, readTracingOptions, setTracer, tracer, disabledTracer } from "../../src/core/tracing.ts";
import { createLogger } from "../../src/core/logger.ts";

/**
 * OpenTelemetry traces — roadmap 6.10.
 *
 * The row's objection was a dependency, and the answer is that there is not
 * one: what follows checks the document this file produces is the OTLP/HTTP
 * JSON a collector reads, and — more importantly — that a collector being
 * broken cannot break a poll cycle.
 */

const silent = createLogger("error", () => {});

interface Export {
  endpoint: string;
  headers: Record<string, string>;
  body: {
    resourceSpans: {
      resource: { attributes: { key: string; value: { stringValue: string } }[] };
      scopeSpans: {
        spans: {
          traceId: string;
          spanId: string;
          parentSpanId?: string;
          name: string;
          startTimeUnixNano: string;
          endTimeUnixNano: string;
          attributes: { key: string; value: Record<string, unknown> }[];
          status: { code: number; message?: string };
        }[];
      }[];
    }[];
  };
}

function harness(behaviour: "ok" | "throw" = "ok") {
  const sent: Export[] = [];
  const lines: string[] = [];
  const traced = createTracer({
    endpoint: "http://collector.example/v1/traces",
    serviceName: "isitdown",
    headers: { authorization: "Bearer k" },
    logger: createLogger("debug", (line) => lines.push(line)),
    send: async (endpoint, body, headers) => {
      if (behaviour === "throw") throw new Error("connection refused");
      sent.push({ endpoint, headers, body: JSON.parse(body) as Export["body"] });
    },
  });
  const spansOf = (): Export["body"]["resourceSpans"][0]["scopeSpans"][0]["spans"] =>
    sent.flatMap((entry) => entry.body.resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)));
  return { traced, sent, lines, spansOf };
}

test("tracing is off unless an endpoint is configured", () => {
  assert.equal(readTracingOptions({}, silent), null);
  assert.equal(
    readTracingOptions({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318" }, silent)?.endpoint,
    // The general variable is a base; the specification says the traces signal
    // hangs off /v1/traces, which is what every collector documents.
    "http://c:4318/v1/traces",
  );
  assert.equal(
    readTracingOptions({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://c/custom" }, silent)?.endpoint,
    "http://c/custom",
  );
  assert.equal(readTracingOptions({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c" }, silent)?.serviceName, "isitdown");
});

test("headers are read in the format the specification defines", () => {
  assert.deepEqual(parseHeaders("api-key=abc,x-scope=team a"), { "api-key": "abc", "x-scope": "team a" });
  // A value with an `=` in it — a base64 key — keeps it.
  assert.deepEqual(parseHeaders("k=YQ=="), { k: "YQ==" });
  assert.deepEqual(parseHeaders(undefined), {});
  assert.deepEqual(parseHeaders("nonsense"), {});
});

test("a span is exported as the OTLP document, with the resource naming the service", async () => {
  const { traced, sent, spansOf } = harness();
  await traced.span("poll.cycle", { "isitdown.manual": true, "isitdown.providers": 4 }, async () => "done");
  await traced.flush();

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.endpoint, "http://collector.example/v1/traces");
  assert.equal(sent[0]?.headers["authorization"], "Bearer k");
  assert.deepEqual(sent[0]?.body.resourceSpans[0]?.resource.attributes, [
    { key: "service.name", value: { stringValue: "isitdown" } },
  ]);

  const [span] = spansOf();
  assert.equal(span?.name, "poll.cycle");
  assert.match(span?.traceId ?? "", /^[0-9a-f]{32}$/);
  assert.match(span?.spanId ?? "", /^[0-9a-f]{16}$/);
  assert.equal(span?.parentSpanId, undefined);
  assert.equal(span?.status.code, 0);
  assert.ok(BigInt(span?.endTimeUnixNano ?? "0") >= BigInt(span?.startTimeUnixNano ?? "0"));
  assert.deepEqual(span?.attributes, [
    { key: "isitdown.manual", value: { boolValue: true } },
    { key: "isitdown.providers", value: { intValue: "4" } },
  ]);
});

test("a nested span is a child, and concurrent siblings each get the right parent", async () => {
  const { traced, spansOf } = harness();
  await traced.span("poll.cycle", {}, async () => {
    // Concurrent on purpose: a single "current span" variable would hand every
    // provider whichever sibling started last as its parent.
    await Promise.all([
      traced.span("provider.read", { "isitdown.provider": "github" }, async () => undefined),
      traced.span("provider.read", { "isitdown.provider": "cloudflare" }, async () => undefined),
    ]);
  });
  await traced.flush();

  const spans = spansOf();
  const root = spans.find((span) => span.name === "poll.cycle");
  const children = spans.filter((span) => span.name === "provider.read");
  assert.equal(children.length, 2);
  for (const child of children) {
    assert.equal(child.parentSpanId, root?.spanId);
    assert.equal(child.traceId, root?.traceId, "one cycle is one trace");
  }
});

test("a span whose work throws records the error and rethrows it", async () => {
  const { traced, spansOf } = harness();
  await assert.rejects(
    traced.span("provider.read", {}, async () => {
      throw new Error("github is unreachable");
    }),
    /github is unreachable/,
  );
  await traced.flush();

  const [span] = spansOf();
  assert.equal(span?.status.code, 2);
  assert.equal(span?.status.message, "github is unreachable");
});

test("an export that fails costs the spans, never the cycle", async () => {
  const { traced, lines } = harness("throw");
  let ran = false;
  await traced.span("poll.cycle", {}, async () => {
    ran = true;
  });
  // The flush itself must not reject: a collector being down is not a reason
  // for a monitoring tool to stop monitoring.
  await traced.flush();
  assert.equal(ran, true);
  assert.match(lines.join("\n"), /exporting traces failed/);
});

test("a broken collector is complained about once, not once per cycle", async () => {
  const { traced, lines } = harness("throw");
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await traced.span("poll.cycle", {}, async () => undefined);
    await traced.flush();
  }
  const complaints = lines.filter((line) => line.includes("exporting traces failed"));
  assert.equal(complaints.length, 1);
});

test("flushing with nothing queued sends nothing", async () => {
  const { traced, sent } = harness();
  await traced.flush();
  assert.deepEqual(sent, []);
});

test("traceparent names the span in progress, and nothing outside one", async () => {
  const { traced } = harness();
  assert.equal(traced.traceparent(), undefined);
  await traced.span("poll.cycle", {}, async () => {
    assert.match(traced.traceparent() ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});

test("the process-wide tracer does nothing until something turns it on", async () => {
  setTracer(disabledTracer());
  // The property every call site depends on: with tracing off, a span is the
  // function it wraps and nothing else happens.
  assert.equal(await tracer().span("poll.cycle", {}, async () => 7), 7);
  assert.equal(tracer().traceparent(), undefined);
  await tracer().flush();
});
