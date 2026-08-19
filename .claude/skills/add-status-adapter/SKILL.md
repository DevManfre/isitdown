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

Create `src/adapters/<provider-id>.adapter.ts` implementing the shared interface:

```ts
import { Adapter, NormalizedStatus } from "../core/adapter.interface";

export const <providerId>Adapter: Adapter = {
  id: "<provider-id>",

  async fetchStatus(baseUrl: string): Promise<NormalizedStatus> {
    const res = await fetch(`${baseUrl}/<status-endpoint>`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`<provider-id> status fetch failed: ${res.status}`);
    }
    const raw = await res.json(); // or res.text() + HTML parsing if scraping

    return {
      provider: "<provider-id>",
      overallStatus: mapToNormalizedStatus(raw),   // implement this mapping
      activeIncidents: mapIncidents(raw),          // implement this mapping
      fetchedAt: new Date().toISOString(),
    };
  },
};
```

Requirements for every custom adapter:

- **Never throw on missing/malformed *individual* fields** — degrade gracefully (e.g. missing incident description → empty string), but *do* throw on a fundamentally broken response (network error, non-2xx, unparseable body) so the Poller's retry/backoff logic can kick in.
- **Timeout every request** (10s default) — a hanging provider must not stall the whole poll cycle.
- **Map to the four-state model**: `operational | degraded | partial_outage | major_outage | unknown`. If the provider's own status vocabulary doesn't map cleanly, prefer the more severe bucket when in doubt (never silently downgrade an outage to "operational").
- If the provider only exposes an HTML page (true scraping case), use a minimal, resilient selector strategy (id/class-based, not full DOM path) and note in a comment which page section it targets, since these break most easily on redesigns.

## Step 3 — Register the adapter

Add it to `src/adapters/index.ts`'s registry map, keyed by the same `id` used in the adapter object.

## Step 4 — Add test fixtures

Under `test/fixtures/<provider-id>/`, add at least:
- `operational.json` (or `.html`) — normal state
- `incident.json` — an active incident sample
- `resolved.json` — incident just resolved

Write the adapter test against these fixtures — never call the live endpoint from a test.

## Step 5 — Document

Add a one-line entry to `README.md`'s list of supported providers, noting whether it uses the generic Statuspage adapter or a custom one.
