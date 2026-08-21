import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

/**
 * `WRITE_KEYS` in `queries.ts` invalidates by prefix match: TanStack Query
 * compares query keys element-by-element, so `["incident"]` matches
 * `["incident", providerId, incidentId]` but does NOT match `["incidents",
 * provider]` — the two are different strings at index 0, not a shared
 * prefix. This is a regression test for that exact mechanism, since it is
 * easy to assume "incident" and "incidents" are close enough to overlap.
 */
describe("query key prefix matching (WRITE_KEYS ↔ useIncident)", () => {
  it("invalidates the incident-detail key with the ['incident'] prefix", async () => {
    const client = new QueryClient();
    client.setQueryData(["incident", "github", "i1"], { id: "i1" });

    await client.invalidateQueries({ queryKey: ["incident"] });

    expect(client.getQueryCache().find({ queryKey: ["incident", "github", "i1"] })?.isStale()).toBe(true);
  });

  it("does not invalidate the incident-detail key with the ['incidents'] prefix", async () => {
    const client = new QueryClient();
    client.setQueryData(["incident", "github", "i1"], { id: "i1" });

    await client.invalidateQueries({ queryKey: ["incidents"] });

    expect(client.getQueryCache().find({ queryKey: ["incident", "github", "i1"] })?.isStale()).toBe(false);
  });
});
