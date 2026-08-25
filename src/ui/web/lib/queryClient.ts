import { QueryClient } from "@tanstack/react-query";

/**
 * The one QueryClient shape every route mounts under — main.tsx for the real
 * app, test/harness.tsx for every view test — so a fix here (or a test
 * against it) covers both at once.
 *
 * `throwOnError` only fires when there is nothing to show yet — an
 * initial-load failure, `query.state.data === undefined`. A failed
 * *background* refetch keeps the last good data on screen instead, which is
 * what vanilla did too (app.js:273-276 wrapped only the render, not every
 * poll, in try/catch). A thrown query error is caught by the `errorElement`
 * mounted on the view routes in routes.tsx (and by the harness's own route
 * in test/harness.tsx).
 */
export function createQueryClient(overrides: { retry?: number | false } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The server polls providers every few minutes; a refetch on every
        // mount would add nothing but requests.
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        retry: overrides.retry ?? 1,
        throwOnError: (_error, query) => query.state.data === undefined,
      },
    },
  });
}
