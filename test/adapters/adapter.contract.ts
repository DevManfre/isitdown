import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { getAdapter } from "../../src/adapters/index.ts";
import type { Adapter, FetchContext, ServiceRef } from "../../src/core/adapter.interface.ts";
import { normalizedStatusSchema } from "../../src/core/status.schema.ts";
import { withDeadServer, withServer } from "../helpers/localServer.ts";

/** Bodies keyed by the request path the adapter is expected to hit. */
export type Routes = Record<string, string>;

export interface AdapterHarness {
  adapter: Adapter;
  /** The service under test, aimed at the fake provider on `baseUrl`. */
  service: (baseUrl: string) => ServiceRef;
  /** A complete, well-formed response for every endpoint the adapter reads. */
  ok: Routes;
  /**
   * The same endpoints with every optional field stripped. The adapter must
   * still resolve: a provider dropping a field is not an outage of our own.
   */
  degraded: Routes;
  /**
   * Set by the probe adapter (roadmap 1.8), the only one whose subject is a
   * service rather than a document about one. It inverts the contract's
   * failure rules rather than escaping them: where a document adapter must
   * *throw* on a 503, an unreachable host or a timeout so the poller can
   * retry, a probe must *resolve* those into a non-operational reading, since
   * for it they are the answer rather than the absence of one. The tests below
   * assert that inverted form, and skip the two that only make sense against a
   * parsed document — a probe has none, and its body handling is pinned by its
   * own mapping tests instead.
   */
  readsResponseNotBody?: boolean | undefined;
}

const ctx: FetchContext = { timeoutMs: 2000 };

/** Backstop: a non-compliant adapter fails the suite, it does not stall it. */
const TEST_OPTS = { timeout: 10_000 };

/** How long a rejection may take before the adapter counts as hung. */
const REJECT_DEADLINE_MS = 3000;

const historicalIncidentSchema = z.object({
  id: z.string(),
  name: z.string(),
  impact: z.string(),
  status: z.string(),
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  updatedAt: z.string(),
});

const incidentHistorySchema = z.object({
  incidents: z.array(historicalIncidentSchema),
  coverageStart: z.string().nullable(),
});

const componentPreviewSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    group: z.string().nullable(),
    showcase: z.boolean(),
    status: z.enum(["operational", "degraded", "partial_outage", "major_outage", "unknown"]),
  }),
);

/**
 * Like `assert.rejects`, but an adapter that never settles fails the test
 * instead of hanging the whole run — a missing request timeout is exactly the
 * kind of non-compliance this suite exists to catch.
 */
async function assertRejectsWithin(promise: Promise<unknown>, deadlineMs: number, message: string): Promise<void> {
  const settled = promise.then(
    () => "resolved" as const,
    () => "rejected" as const,
  );
  const hung = new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), deadlineMs).unref());
  assert.equal(await Promise.race([settled, hung]), "rejected", message);
}

type Outcome =
  | { kind: "resolved"; value: unknown }
  | { kind: "rejected"; error: unknown }
  | { kind: "hung" };

/**
 * Both outcomes, rather than one asserted one: a mutated payload may honestly
 * reject *or* honestly degrade, and only never settling is out of contract.
 */
async function settle(promise: Promise<unknown>, deadlineMs: number): Promise<Outcome> {
  const settled: Promise<Outcome> = promise.then(
    (value) => ({ kind: "resolved", value }) as const,
    (error: unknown) => ({ kind: "rejected", error }) as const,
  );
  const hung = new Promise<Outcome>((resolve) =>
    setTimeout(() => resolve({ kind: "hung" }), deadlineMs).unref(),
  );
  return Promise.race([settled, hung]);
}

/**
 * Swaps the type of every value in the document, leaving its structure alone:
 * the field an adapter reads is still there, and still where it was, but it now
 * holds the wrong kind of thing. This is the shape of a provider that changed
 * its API without changing its endpoint, which is the mutation a hand-written
 * fixture never covers.
 *
 * A document that is not JSON is flattened to its own text instead — the same
 * failure for a feed or a scraped page: everything the adapter navigates by is
 * gone, everything it reads is still on screen.
 */
function retype(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.replaceAll("<", " ").replaceAll(">", " ");
  }
  const swap = (value: unknown): unknown => {
    if (Array.isArray(value)) return { items: value.map(swap) };
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, swap(inner)]));
    }
    if (typeof value === "string") return value.length;
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return !value;
    return "null";
  };
  return JSON.stringify(swap(parsed));
}

/**
 * Malformed variants of an adapter's own well-formed body (roadmap 7.7). The
 * contract kit above asserts the shapes we thought to write a fixture for; these
 * are generated from the fixture instead, so every adapter is held to the same
 * property against payloads nobody anticipated.
 */
const MUTATIONS: { name: string; mutate: (body: string) => string }[] = [
  { name: "an empty body", mutate: () => "" },
  { name: "whitespace alone", mutate: () => "\n  \n" },
  { name: "a body cut in half", mutate: (body) => body.slice(0, Math.floor(body.length / 2)) },
  { name: "a bare null", mutate: () => "null" },
  { name: "an empty array", mutate: () => "[]" },
  { name: "an empty object", mutate: () => "{}" },
  { name: "every value re-typed", mutate: retype },
];

/**
 * The mutations that leave nothing readable behind. Truncation and re-typing can
 * legitimately still carry a status word — half a scraped page keeps its banner —
 * so they assert the weaker property above; these cannot, and an adapter that
 * answers `operational` to one of them is reporting health it never read.
 *
 * An empty *array* is deliberately not one of them: AWS and Google Cloud publish
 * a flat list of current events, so `[]` is that document saying "nothing is
 * open", which is a reading rather than an absence of one.
 */
const EMPTIED = new Set(["an empty body", "whitespace alone", "a bare null", "an empty object"]);

/**
 * The probe form of "this must not be swallowed": the reading has to arrive,
 * validate, and say something other than healthy. Same guarantee the rejection
 * assertions give a document adapter — a target that misbehaves stays visible —
 * expressed in the terms of an adapter for which misbehaviour *is* the reading.
 */
async function assertReadsUnhealthy(adapter: Adapter, ref: ServiceRef, what: string): Promise<void> {
  const outcome = await settle(adapter.fetchStatus(ref, ctx), REJECT_DEADLINE_MS);
  assert.equal(outcome.kind, "resolved", `fetchStatus did not turn ${what} into a reading`);
  const status = normalizedStatusSchema.parse((outcome as { value: unknown }).value);
  assert.notEqual(status.overallStatus, "operational", `fetchStatus read operational out of ${what}`);
}

interface Method {
  name: string;
  call: (service: ServiceRef) => Promise<unknown>;
  schema: z.ZodType;
}

/** Every method the adapter actually implements. `fetchStatus` is mandatory. */
function methodsOf(adapter: Adapter): Method[] {
  const methods: Method[] = [
    {
      name: "fetchStatus",
      call: (service) => adapter.fetchStatus(service, ctx),
      schema: normalizedStatusSchema,
    },
  ];
  if (adapter.fetchIncidentHistory !== undefined) {
    methods.push({
      name: "fetchIncidentHistory",
      call: (service) => adapter.fetchIncidentHistory!(service, ctx),
      schema: incidentHistorySchema,
    });
  }
  if (adapter.listComponents !== undefined) {
    methods.push({
      name: "listComponents",
      call: (service) => adapter.listComponents!(service, ctx),
      schema: componentPreviewSchema,
    });
  }
  return methods;
}

/** Serves `routes` by path; anything else is a 404, which is a bug in the harness. */
function serve(routes: Routes) {
  return (req: { url?: string | undefined }, res: import("node:http").ServerResponse): void => {
    const body = routes[req.url ?? ""];
    if (body === undefined) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`no route for ${req.url}`);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  };
}

/**
 * The behaviour every adapter must have, whatever shape its provider publishes.
 * Run it from each adapter's own test file alongside that adapter's mapping
 * tests: this suite pins the contract the poller relies on — throw loudly on a
 * broken response so retry and failure accounting can act, degrade quietly on a
 * missing field, and never hand back a shape nothing validated.
 */
export function runAdapterContract(name: string, harness: () => AdapterHarness): void {
  test(`${name}: the adapter is registered under its own id`, TEST_OPTS, () => {
    const { adapter } = harness();
    assert.equal(getAdapter(adapter.id), adapter);
  });

  test(`${name}: a well-formed response is returned in the documented shape`, TEST_OPTS, async () => {
    const { adapter, service, ok } = harness();
    for (const method of methodsOf(adapter)) {
      await withServer(serve(ok), async (baseUrl) => {
        const result = await method.call(service(baseUrl));
        // Parsed, not merely truthy: an adapter that leaks an unvalidated
        // provider payload straight through fails here rather than downstream.
        method.schema.parse(result);
      });
    }
  });

  test(`${name}: fetchStatus reports the provider id it was asked about`, TEST_OPTS, async () => {
    const { adapter, service, ok } = harness();
    await withServer(serve(ok), async (baseUrl) => {
      const ref = service(baseUrl);
      const status = await adapter.fetchStatus(ref, ctx);
      assert.equal(status.provider, ref.id);
      assert.ok(!Number.isNaN(Date.parse(status.fetchedAt)), `fetchedAt was ${status.fetchedAt}`);
    });
  });

  test(`${name}: a response missing every optional field still resolves`, TEST_OPTS, async () => {
    const { adapter, service, degraded } = harness();
    for (const method of methodsOf(adapter)) {
      await withServer(serve(degraded), async (baseUrl) => {
        const result = await method.call(service(baseUrl));
        method.schema.parse(result);
      });
    }
  });

  test(`${name}: a non-2xx response is never swallowed`, TEST_OPTS, async () => {
    const { adapter, service, readsResponseNotBody } = harness();
    for (const method of methodsOf(adapter)) {
      await withServer(
        (_req, res) => {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("nope");
        },
        async (baseUrl) => {
          if (readsResponseNotBody === true) {
            await assertReadsUnhealthy(adapter, service(baseUrl), "a 503");
            return;
          }
          await assertRejectsWithin(
            method.call(service(baseUrl)),
            REJECT_DEADLINE_MS,
            `${method.name} swallowed a 503`,
          );
        },
      );
    }
  });

  test(`${name}: an unparseable body rejects rather than yielding an empty reading`, TEST_OPTS, async () => {
    const { adapter, service, readsResponseNotBody } = harness();
    // A probe parses no document, so there is no such thing as an unparseable
    // one: a body it was not told to match against is not evidence of anything.
    if (readsResponseNotBody === true) return;
    for (const method of methodsOf(adapter)) {
      await withServer(
        (_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("<html>not json at all</html>");
        },
        async (baseUrl) => {
          await assertRejectsWithin(
            method.call(service(baseUrl)),
            REJECT_DEADLINE_MS,
            `${method.name} accepted a broken body`,
          );
        },
      );
    }
  });

  test(`${name}: an unreachable provider is never read as healthy`, TEST_OPTS, async () => {
    const { adapter, service, readsResponseNotBody } = harness();
    for (const method of methodsOf(adapter)) {
      await withDeadServer(async (baseUrl) => {
        if (readsResponseNotBody === true) {
          await assertReadsUnhealthy(adapter, service(baseUrl), "nothing listening");
          return;
        }
        await assertRejectsWithin(
          method.call(service(baseUrl)),
          REJECT_DEADLINE_MS,
          `${method.name} resolved with nothing listening`,
        );
      });
    }
  });

  test(`${name}: a provider that never answers gives up on the timeout`, TEST_OPTS, async () => {
    const { adapter, service, readsResponseNotBody } = harness();
    await withServer(
      () => {
        /* never responds */
      },
      async (baseUrl) => {
        if (readsResponseNotBody === true) {
          // Still has to give up on `timeoutMs`: settling inside the deadline
          // is the assertion, and the reading it settles on says down.
          const outcome = await settle(adapter.fetchStatus(service(baseUrl), { timeoutMs: 150 }), REJECT_DEADLINE_MS);
          assert.equal(outcome.kind, "resolved", "fetchStatus never gave up on a provider that does not answer");
          const status = normalizedStatusSchema.parse((outcome as { value: unknown }).value);
          assert.notEqual(status.overallStatus, "operational", "fetchStatus read operational out of a timeout");
          return;
        }
        await assertRejectsWithin(
          adapter.fetchStatus(service(baseUrl), { timeoutMs: 150 }),
          REJECT_DEADLINE_MS,
          "fetchStatus never gave up on a provider that does not answer",
        );
      },
    );
  });

  test(`${name}: a malformed payload degrades or rejects, and never hangs`, TEST_OPTS, async () => {
    const { adapter, service, ok } = harness();
    for (const mutation of MUTATIONS) {
      const routes: Routes = Object.fromEntries(
        Object.entries(ok).map(([path, body]) => [path, mutation.mutate(body)]),
      );
      for (const method of methodsOf(adapter)) {
        await withServer(serve(routes), async (baseUrl) => {
          const outcome = await settle(method.call(service(baseUrl)), REJECT_DEADLINE_MS);
          assert.notEqual(outcome.kind, "hung", `${method.name} never settled on ${mutation.name}`);
          if (outcome.kind === "rejected") {
            // The poller logs `error.message` and counts the failure; a thrown
            // string or object would read as "undefined" in that log.
            assert.ok(
              outcome.error instanceof Error,
              `${method.name} threw a non-Error on ${mutation.name}`,
            );
            return;
          }
          // Degrading is allowed, handing back an unvalidated shape is not.
          method.schema.parse(outcome.value);
        });
      }
    }
  });

  test(`${name}: an unreadable payload never reads as operational`, TEST_OPTS, async () => {
    const { adapter, service, ok } = harness();
    for (const mutation of MUTATIONS.filter((entry) => EMPTIED.has(entry.name))) {
      const routes: Routes = Object.fromEntries(
        Object.entries(ok).map(([path, body]) => [path, mutation.mutate(body)]),
      );
      await withServer(serve(routes), async (baseUrl) => {
        const outcome = await settle(adapter.fetchStatus(service(baseUrl), ctx), REJECT_DEADLINE_MS);
        if (outcome.kind !== "resolved") return;
        const status = normalizedStatusSchema.parse(outcome.value);
        assert.notEqual(
          status.overallStatus,
          "operational",
          `fetchStatus read operational out of ${mutation.name}`,
        );
      });
    }
  });
}
