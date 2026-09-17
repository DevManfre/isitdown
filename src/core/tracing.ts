import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type { Logger } from "./logger.ts";

/**
 * OpenTelemetry traces — roadmap 6.10.
 *
 * The row said "probably no", and it was right about why: the useful thing is
 * seeing where a slow cycle went, and the usual way to get it is
 * `@opentelemetry/sdk-node` and its thirty transitive packages — in a project
 * whose whole pitch is that it has three dependencies and that you can read all
 * of them.
 *
 * That trade is only forced if the SDK is the only way, and it is not. OTLP
 * over HTTP is a JSON document posted to `/v1/traces`; a span is an id, a
 * parent, two timestamps and some attributes. What follows is that document and
 * nothing else — no dependency, no auto-instrumentation, no monkey-patching of
 * `fetch`, and no vendor. Any collector that speaks OTLP/HTTP reads it.
 *
 * What that costs, said plainly, because it is the honest half of the trade:
 *
 * - **Only what is instrumented here appears.** There are three spans — the
 *   cycle, a provider read, a notification send — and no automatic HTTP or
 *   SQLite spans underneath them. That happens to be exactly the question the
 *   row asked ("where did a slow cycle go"), and nothing more.
 * - **No metrics and no logs signal.** `/metrics` already exists and is better
 *   at the first; the logger is already structured for the second.
 * - **No sampling, no retry, no backpressure beyond a bounded queue.** Spans
 *   are dropped rather than buffered without limit, and an export that fails is
 *   a warning, never a failed cycle. Telemetry must not be able to take
 *   monitoring down.
 *
 * Off unless `OTEL_EXPORTER_OTLP_ENDPOINT` (or `…_TRACES_ENDPOINT`) is set, at
 * which point every function below is doing real work and, until then, every
 * one of them is a no-op that allocates nothing.
 */

/** What a span records. Attribute values are kept to what OTLP takes without ceremony. */
export type SpanAttributes = Record<string, string | number | boolean | undefined>;

interface Span {
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  name: string;
  startedAtNanos: bigint;
  attributes: SpanAttributes;
}

interface FinishedSpan extends Span {
  endedAtNanos: bigint;
  /** OTLP status: 0 unset, 2 error. A successful span is left unset, as the spec intends. */
  errorMessage: string | undefined;
}

export interface Tracer {
  /** Runs `fn` inside a span, which ends when it settles — with its error recorded if it throws. */
  span<T>(name: string, attributes: SpanAttributes, fn: () => Promise<T>): Promise<T>;
  /** Sends whatever is queued. Awaited on shutdown so the last cycle is not lost. */
  flush(): Promise<void>;
  /** The W3C `traceparent` of the span in progress, or undefined outside one. */
  traceparent(): string | undefined;
}

/** A tracer that costs nothing: what every call site holds when tracing is off. */
const DISABLED: Tracer = {
  span: async (_name, _attributes, fn) => fn(),
  flush: async () => undefined,
  traceparent: () => undefined,
};

/**
 * How many finished spans may wait for the next export. A cycle over a large
 * fleet is a few hundred spans; past this, the oldest are dropped, because a
 * collector that has gone away must not turn into unbounded memory in a process
 * whose job is to still be running tomorrow.
 */
const MAX_QUEUE = 2048;

/** How often the queue is sent, and the deadline on the request itself. */
const FLUSH_INTERVAL_MS = 5_000;
const EXPORT_TIMEOUT_MS = 10_000;

const id = (bytes: number): string => randomBytes(bytes).toString("hex");

const nowNanos = (): bigint => BigInt(Date.now()) * 1_000_000n;

/**
 * The span in progress, per async context. `AsyncLocalStorage` rather than a
 * variable, because a cycle polls its providers concurrently: a single "current
 * span" would give every provider read whichever sibling started last as its
 * parent.
 */
const active = new AsyncLocalStorage<Span>();

export interface TracingOptions {
  /** OTLP/HTTP traces endpoint, already resolved to the full path. */
  endpoint: string;
  /** `service.name` on the resource — how the collector labels this process. */
  serviceName: string;
  /** Extra headers, e.g. an API key a hosted collector wants. */
  headers: Record<string, string>;
  logger: Logger;
  /** Injected by the tests so an export is asserted rather than sent. */
  send?: ((endpoint: string, body: string, headers: Record<string, string>) => Promise<void>) | undefined;
}

/**
 * Reads the standard OTEL variables, and answers `null` when tracing is off —
 * which is the default and which every caller has to handle anyway.
 *
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is taken as written; the general
 * `OTEL_EXPORTER_OTLP_ENDPOINT` gets `/v1/traces` appended, which is what the
 * specification says and what every collector's documented base URL expects.
 */
export function readTracingOptions(
  env: NodeJS.ProcessEnv,
  logger: Logger,
): Omit<TracingOptions, "send"> | null {
  const exact = (env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] ?? "").trim();
  const base = (env["OTEL_EXPORTER_OTLP_ENDPOINT"] ?? "").trim();
  if (exact === "" && base === "") return null;

  const endpoint = exact !== "" ? exact : `${base.replace(/\/+$/, "")}/v1/traces`;
  return {
    endpoint,
    serviceName: (env["OTEL_SERVICE_NAME"] ?? "").trim() || "isitdown",
    headers: parseHeaders(env["OTEL_EXPORTER_OTLP_HEADERS"]),
    logger,
  };
}

/** `key=value,other=value`, the format the specification defines for that variable. */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key !== "") headers[key] = value;
  }
  return headers;
}

export function createTracer(options: TracingOptions): Tracer {
  const { endpoint, serviceName, headers, logger } = options;
  const send = options.send ?? httpSend;

  let queue: FinishedSpan[] = [];
  let dropped = 0;
  /** Said once per outage rather than once per failed export, like the poller's own rule. */
  let exportFailing = false;

  const timer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  // The one thing that must not keep a Light container alive between cycles.
  timer.unref();

  function record(span: FinishedSpan): void {
    if (queue.length >= MAX_QUEUE) {
      // Oldest first: the spans worth having when a collector comes back are
      // the recent ones, not a five-minute-old cycle.
      queue.shift();
      dropped += 1;
      return;
    }
    queue.push(span);
  }

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue;
    queue = [];
    if (dropped > 0) {
      logger.warn("dropped spans: the trace queue is full", { dropped });
      dropped = 0;
    }
    try {
      await send(endpoint, JSON.stringify(payload(serviceName, batch)), headers);
      if (exportFailing) {
        logger.info("exporting traces is working again", { endpoint });
        exportFailing = false;
      }
    } catch (error) {
      // Never rethrown, and never retried: these spans are gone. A collector
      // being down is not a reason for a monitoring tool to stop monitoring,
      // and a retry queue would be the unbounded buffer this deliberately does
      // not have.
      if (!exportFailing) {
        exportFailing = true;
        logger.warn("exporting traces failed — spans are being dropped", {
          endpoint,
          spans: batch.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    async span<T>(name: string, attributes: SpanAttributes, fn: () => Promise<T>): Promise<T> {
      const parent = active.getStore();
      const span: Span = {
        traceId: parent?.traceId ?? id(16),
        spanId: id(8),
        parentSpanId: parent?.spanId,
        name,
        startedAtNanos: nowNanos(),
        attributes,
      };
      try {
        const result = await active.run(span, fn);
        record({ ...span, endedAtNanos: nowNanos(), errorMessage: undefined });
        return result;
      } catch (error) {
        // Recorded and rethrown: the span is telemetry, the error is the
        // caller's, and swallowing one to report the other would be the worst
        // possible trade.
        record({
          ...span,
          endedAtNanos: nowNanos(),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    flush,

    traceparent(): string | undefined {
      const span = active.getStore();
      // Version 00, sampled: this exporter has no sampler, so everything it
      // produces is by definition sampled.
      return span === undefined ? undefined : `00-${span.traceId}-${span.spanId}-01`;
    },
  };
}

/** The OTLP/HTTP JSON document, which is all this file's output is. */
export function payload(serviceName: string, spans: FinishedSpan[]): unknown {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
        },
        scopeSpans: [
          {
            scope: { name: "isitdown" },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
              name: span.name,
              // 1 = INTERNAL. Every span here is work this process did itself;
              // a provider read is a client call, but calling it one would
              // promise HTTP attributes this does not collect.
              kind: 1,
              startTimeUnixNano: span.startedAtNanos.toString(),
              endTimeUnixNano: span.endedAtNanos.toString(),
              attributes: Object.entries(span.attributes)
                .filter(([, value]) => value !== undefined)
                .map(([key, value]) => ({ key, value: otlpValue(value as string | number | boolean) })),
              status:
                span.errorMessage === undefined
                  ? { code: 0 }
                  : { code: 2, message: span.errorMessage },
            })),
          },
        ],
      },
    ],
  };
}

function otlpValue(value: string | number | boolean): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: value };
}

async function httpSend(
  endpoint: string,
  body: string,
  headers: Record<string, string>,
): Promise<void> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/**
 * The process-wide tracer.
 *
 * A module-level value rather than a dependency threaded through the poller,
 * the dispatcher and every adapter. That is a deliberate exception to how the
 * rest of this codebase is wired, and the reason is that tracing is not a
 * collaborator: nothing's behaviour depends on it, nothing should be testable
 * only with it, and a `tracer` parameter on every function would put an
 * observability concern in every signature in the engine. Off, it is one object
 * whose methods do nothing.
 */
let current: Tracer = DISABLED;

export const tracer = (): Tracer => current;

/**
 * Turns tracing on when the environment asks for it. Called once per process,
 * by each edition's runtime, before anything is polled.
 */
export function initTracing(env: NodeJS.ProcessEnv, logger: Logger): Tracer {
  const options = readTracingOptions(env, logger);
  if (options === null) return current;
  current = createTracer(options);
  logger.info("exporting traces", { endpoint: options.endpoint, service: options.serviceName });
  return current;
}

/** Used by the tests, and by a shutdown that wants the last cycle exported. */
export function setTracer(next: Tracer): void {
  current = next;
}

export const disabledTracer = (): Tracer => DISABLED;
