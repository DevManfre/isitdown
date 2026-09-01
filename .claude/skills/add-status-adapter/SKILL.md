---
name: add-status-adapter
description: Scaffold a new provider adapter for IsItDown — turns a status page's raw response into a NormalizedStatus. Use whenever the user wants to add monitoring for a new third-party service/provider, mentions a status page URL, or asks "how do I add X to IsItDown". Covers both Statuspage.io-based providers (majority of cases) and custom/non-standard status pages requiring a bespoke parser.
---

# Add Status Adapter

Scaffolds a new adapter under `src/adapters/` for a provider IsItDown should monitor. Always check "is this a Statuspage.io provider?" first — most are, and it means zero new code.

## Step 1 — Determine if a custom adapter is even needed

Before writing anything, check whether the provider runs on Atlassian Statuspage:

```bash
curl -s https://<provider-domain>/api/v2/summary.json | head -c 500
```

If this returns a JSON object with `page`, `components`, `incidents`, and `status` keys — **no new adapter is needed**. Just add an entry to `config.yml` (Light) or via the dashboard (UI) using `adapter: statuspage` and the provider's `baseUrl`. Stop here.

If the endpoint 404s, redirects to an HTML page, or returns a different shape, proceed to Step 2.

## Step 2 — Scaffold the custom adapter

Create `src/adapters/<provider-id>.adapter.ts` implementing the shared interface
(`src/core/adapter.interface.ts` is the source of truth — read it first):

```ts
import type { Adapter, FetchContext, ServiceRef } from "../core/adapter.interface.ts";
import type { NormalizedStatus } from "../core/types.ts";

/** Pure mapping from payload to internal shape, exported so the fixture tests
 *  can exercise it with no network at all. */
export function parseStatus(raw: unknown, service: ServiceRef): NormalizedStatus {
  // Validate the shape with zod, then map. Throw when the body is not this
  // provider's payload at all; degrade on a missing individual field.
}

export const <providerId>Adapter: Adapter = {
  id: "<provider-id>",

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const response = await fetch(`${service.baseUrl}/<status-endpoint>`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`<provider-id> fetch for ${service.id} failed: HTTP ${response.status}`);
    }
    return parseStatus(await response.json(), service);
  },
};
```

`fetchIncidentHistory` and `listComponents` are optional: implement them only if
the provider exposes the data, and match `statuspage.adapter.ts`'s split between
a pure `parse*` function and the thin fetch wrapper around it.

Requirements for every custom adapter:

- **Never throw on missing/malformed *individual* fields** — degrade gracefully (e.g. missing incident description → empty string), but *do* throw on a fundamentally broken response (network error, non-2xx, unparseable body) so the Poller's retry/backoff logic can kick in.
- **Timeout every request** (10s default) — a hanging provider must not stall the whole poll cycle.
- **Map to the four-state model**: `operational | degraded | partial_outage | major_outage | unknown`. If the provider's own status vocabulary doesn't map cleanly, prefer the more severe bucket when in doubt (never silently downgrade an outage to "operational").
- If the provider only exposes an HTML page (true scraping case), use a minimal, resilient selector strategy (id/class-based, not full DOM path) and note in a comment which page section it targets, since these break most easily on redesigns.

## Step 3 — Register the adapter

Add it to `src/adapters/index.ts`'s registry map, keyed by the same `id` used in the adapter object.

## Step 4 — Record test fixtures

Record the provider's real answer instead of hand-typing one — a fixture invented
from the docs proves nothing about the shape that actually ships:

```bash
npm run record-fixture -- https://<provider>/<status-endpoint> <provider-id> operational
npm run record-fixture -- https://<provider>/<status-endpoint> <provider-id> incident   # while it is down
```

Files land in `test/fixtures/<provider-id>/`. Record at least `operational`,
`incident` and `resolved`. Re-recording an existing name needs `--force`.

## Step 5 — Run the adapter contract

Every adapter must pass the shared suite in `test/adapters/adapter.contract.ts` —
it pins the behaviour the poller depends on (throws on a non-2xx, on an
unparseable body and on an unreachable provider; degrades on a missing optional
field; never returns an unvalidated shape; honours `ctx.timeoutMs`). Add it at
the top of `test/adapters/<provider-id>.test.ts`, then write that provider's own
mapping tests below it:

```ts
runAdapterContract("<provider-id>", () => ({
  adapter: <providerId>Adapter,
  service: (baseUrl) => ({ id: "<provider-id>", name: "<Provider>", baseUrl }),
  ok: { "/<status-endpoint>": fixtureText("operational") },
  // The same endpoints with every optional field stripped.
  degraded: { "/<status-endpoint>": JSON.stringify({ /* only the required keys */ }) },
}));
```

## Step 6 — Document

Add a one-line entry to `README.md`'s list of supported providers, noting whether it uses the generic Statuspage adapter or a custom one.
