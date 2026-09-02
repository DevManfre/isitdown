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

  test(`${name}: a non-2xx response rejects so the poller can retry`, TEST_OPTS, async () => {
    const { adapter, service } = harness();
    for (const method of methodsOf(adapter)) {
      await withServer(
        (_req, res) => {
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("nope");
        },
        async (baseUrl) => {
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
    const { adapter, service } = harness();
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

  test(`${name}: an unreachable provider rejects`, TEST_OPTS, async () => {
    const { adapter, service } = harness();
    for (const method of methodsOf(adapter)) {
      await withDeadServer(async (baseUrl) => {
        await assertRejectsWithin(
          method.call(service(baseUrl)),
          REJECT_DEADLINE_MS,
          `${method.name} resolved with nothing listening`,
        );
      });
    }
  });

  test(`${name}: a provider that never answers gives up on the timeout`, TEST_OPTS, async () => {
    const { adapter, service } = harness();
    await withServer(
      () => {
        /* never responds */
      },
      async (baseUrl) => {
        await assertRejectsWithin(
          adapter.fetchStatus(service(baseUrl), { timeoutMs: 150 }),
          REJECT_DEADLINE_MS,
          "fetchStatus never gave up on a provider that does not answer",
        );
      },
    );
  });
}
