import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useConfigChrome, useIncidents, useStatusChrome } from "./queries.ts";
import { BusyProvider, useFieldProps } from "./useBusy.tsx";

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

class Boundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state: { hasError: boolean } = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override render() {
    return this.state.hasError ? <p>boundary-tripped</p> : this.props.children;
  }
}

interface ChromeQueryResult {
  data: unknown;
  isError: boolean;
  fetchStatus: "fetching" | "paused" | "idle";
}

// "chrome-no-data" alone is also true while the query is still pending
// (data is undefined before the first fetch resolves, same as after a
// failure) — asserting on that text without checking settlement lets a
// test pass trivially during the loading render, before the fetch has
// even had a chance to fail and throw. Distinguishing the still-fetching
// case from the settled-with-error case forces the assertion below to
// actually wait for the failure to happen. Shared by every *Chrome hook's
// regression test below, since they all need the same distinction.
function makeChromeProbe(useHook: () => ChromeQueryResult) {
  return function Probe() {
    const { data, isError, fetchStatus } = useHook();
    if (fetchStatus === "fetching" && data === undefined) return <p>chrome-pending</p>;
    return <p>{data === undefined ? `chrome-no-data:${String(isError)}` : "chrome-has-data"}</p>;
  };
}

const StatusProbe = makeChromeProbe(useStatusChrome);
const ConfigProbe = makeChromeProbe(useConfigChrome);

describe("useStatusChrome", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Rail, Header and PollIndicator render as siblings of the view's own
  // <Outlet/> (App.tsx), not inside it — so a plain useStatus() would throw
  // right alongside them under the app's global throwOnError default, and
  // that throw escapes past the nested error boundary meant to catch a
  // failed *view*. This mounts the client's real throwing default (the same
  // predicate lib/queryClient.ts ships) around the hook directly, so a
  // regression here is caught without needing the full Rail/Header tree.
  it("degrades to no data instead of throwing when /status fails, even under the app's throwing default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "" })),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, throwOnError: (_error, query) => query.state.data === undefined },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <Boundary>
          <StatusProbe />
        </Boundary>
      </QueryClientProvider>,
    );
    // Waits out the real fetch-then-fail cycle: only settles once the query
    // has actually reached its error state, not on the pending render.
    expect(await screen.findByText("chrome-no-data:true")).toBeInTheDocument();
    expect(screen.queryByText("boundary-tripped")).toBeNull();
  });
});

describe("useConfigChrome", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Same shape as useStatusChrome above: Rail also reads config directly
  // for its own chrome (the notifier-channel list), as a sibling of
  // <Outlet/>, so a /config load failure needs the same non-throwing
  // variant for the same reason.
  it("degrades to no data instead of throwing when /config fails, even under the app's throwing default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "" })),
    );
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, throwOnError: (_error, query) => query.state.data === undefined },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <Boundary>
          <ConfigProbe />
        </Boundary>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("chrome-no-data:true")).toBeInTheDocument();
    expect(screen.queryByText("boundary-tripped")).toBeNull();
  });
});

/**
 * Every view query now polls on the same busy-gated interval the chrome queries
 * use. The interval itself is covered where it matters — Incidents.test.tsx
 * watches a new incident appear with the view mounted — but the `busy ? false`
 * half of each of those five branches has no visible symptom, so it is asserted
 * here: a refetch that lands while the operator is typing would overwrite the
 * form under them, which is the whole reason `useBusy` exists.
 */
describe("the view queries' busy gate", () => {
  function Probe() {
    useIncidents();
    const fieldProps = useFieldProps();
    return <input aria-label="field" {...fieldProps} />;
  }

  const fetchCount = () => (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("holds the interval while a field has focus, and resumes it on blur", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ active: [], closed: [] }) })),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <BusyProvider>
          <Probe />
        </BusyProvider>
      </QueryClientProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => screen.getByLabelText("field").focus());
    const held = fetchCount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(fetchCount(), "a poll fired while the operator was typing").toBe(held);

    act(() => screen.getByLabelText("field").blur());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchCount(), "the poll never resumed after the field was released").toBeGreaterThan(held);
  });
});
