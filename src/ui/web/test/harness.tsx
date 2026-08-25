import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { createHashRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import type { ReactElement } from "react";
import i18n from "@/lib/i18n.ts";
import { createQueryClient } from "@/lib/queryClient.ts";
import { ViewError } from "@/components/ViewError.tsx";
import { BusyProvider } from "@/hooks/useBusy.tsx";
import { RailProvider } from "@/hooks/useRail.tsx";
import { ThemeProvider } from "@/hooks/useTheme.tsx";
import type { ProviderStatus } from "@/lib/types.ts";

type FixtureKey = "status" | "config" | "history" | "incidents" | "incident" | "notifications" | "componentHistory";

export interface Fixtures {
  status?: unknown;
  config?: unknown;
  history?: unknown;
  incidents?: unknown;
  incident?: unknown;
  notifications?: unknown;
  componentHistory?: unknown;
  /**
   * Make one endpoint's fetch fail with this HTTP status instead of
   * returning its fixture body — for exercising the `errorElement` path
   * (routes.tsx's `ViewError`) that a view falls back to on an initial-load
   * failure. Keyed by the same categories as the success fixtures above.
   */
  errors?: Partial<Record<FixtureKey, number>>;
}

/**
 * Routes stubbed fetch by path, so the view under test sees only its own
 * data — or, via `fixtures.errors`, a failed response for one endpoint.
 *
 * This stubs the global `fetch`, so any test that calls `stubApi` directly
 * (or through `renderWithProviders`) must restore it with
 * `afterEach(() => vi.unstubAllGlobals())`, or the stub leaks into the next
 * test file's requests.
 */
export function stubApi(fixtures: Fixtures): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const path = String(input);
      const key: FixtureKey = path.startsWith("/history/components")
        ? "componentHistory"
        : path.startsWith("/history")
          ? "history"
          : path.startsWith("/incidents/")
            ? "incident"
            : path.startsWith("/incidents")
              ? "incidents"
              : path.startsWith("/notifications")
                ? "notifications"
                : path.startsWith("/config")
                  ? "config"
                  : "status";
      const errorStatus = fixtures.errors?.[key];
      if (errorStatus !== undefined) {
        return { ok: false, status: errorStatus, text: async () => "" };
      }
      const body = fixtures[key];
      return { ok: true, status: 200, text: async () => JSON.stringify(body ?? {}) };
    }),
  );
}

/**
 * Mounts `ui` behind the same five providers every real route sits under
 * (i18n, query client, theme, rail, busy), plus a one-route hash router so
 * `useNavigate`/`useParams` work inside the view under test.
 *
 * `createHashRouter` reads the browser's own `window.location.hash` rather
 * than an in-memory history — there is no `initialEntries` option to hand it
 * a starting location (that is a memory-router concept). So the hash is set
 * directly before the router is built, which is what actually puts the
 * router at `route`.
 *
 * A wildcard sibling route catches any `navigate()` the view under test
 * fires (e.g. to an incident or history route this harness never mounts),
 * so the click that triggers it can be asserted on via `window.location.hash`
 * instead of crashing on an unmatched location.
 *
 * The test route carries the same `ViewError` `errorElement` every real view
 * route does (routes.tsx), and `retry: false` so an `errors`-fixture test
 * doesn't sit through retries before that boundary renders.
 */
export function renderWithProviders(ui: ReactElement, fixtures: Fixtures = {}, route = "/") {
  stubApi(fixtures);
  window.location.hash = route;
  const client = createQueryClient({ retry: false });
  const router = createHashRouter([
    { path: route, element: ui, errorElement: <ViewError /> },
    { path: "*", element: null },
  ]);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <RailProvider>
            <BusyProvider>
              <RouterProvider router={router} />
            </BusyProvider>
          </RailProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

export const providerFixture = (over: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id: "github",
  name: "GitHub",
  adapter: "statuspage",
  baseUrl: "https://www.githubstatus.com",
  enabled: true,
  overallStatus: "operational",
  activeIncidents: [],
  components: [],
  componentSelection: [],
  scopeToComponents: false,
  fetchedAt: "2026-08-21T10:00:00Z",
  failureCount: 0,
  uptime90: 99.9,
  ...over,
});
