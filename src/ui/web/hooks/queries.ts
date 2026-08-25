import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api.ts";
import { useBusy } from "./useBusy.tsx";

/** The dashboard's poll of the server's stored state. */
const REFRESH_MS = 30_000;

export function useStatus() {
  const busy = useBusy();
  return useQuery({
    queryKey: ["status"],
    queryFn: api.getStatus,
    refetchInterval: busy ? false : REFRESH_MS,
  });
}

/**
 * Same cache entry as {@link useStatus} (`["status"]`), but never throws.
 *
 * `Rail`, `Header` and `PollIndicator` render as siblings of the current
 * view's `<Outlet/>` in `App.tsx`, not as its descendants — so a plain
 * `useStatus()` there would throw under the app's global `throwOnError`
 * predicate right alongside the view, and that throw escapes past the
 * nested error boundary meant to catch a failed *view*, taking the whole
 * shell down with it (including the rail, which should stay standing while
 * a view shows its own error). Chrome components read status through this
 * hook instead, so only the view itself can trip that boundary; the chrome
 * degrades to `data === undefined` exactly like a still-loading query,
 * which every chrome consumer already renders gracefully (no badge, no
 * countdown) — see `app.js`'s `badgeFor()` in the vanilla dashboard for the
 * same graceful-degradation contract this mirrors.
 */
export function useStatusChrome() {
  const busy = useBusy();
  return useQuery({
    queryKey: ["status"],
    queryFn: api.getStatus,
    refetchInterval: busy ? false : REFRESH_MS,
    throwOnError: false,
  });
}

export function useConfig() {
  const busy = useBusy();
  return useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
    refetchInterval: busy ? false : REFRESH_MS,
  });
}

/**
 * Same cache entry as {@link useConfig} (`["config"]`), but never throws.
 *
 * Same reason as {@link useStatusChrome}: `Rail` reads config directly for
 * its own chrome (the notifier-channel list), as a sibling of the current
 * view's `<Outlet/>` in `App.tsx`. A throw from `useConfig()` there would
 * escape past the view's error boundary and take the whole shell down.
 * Degrading to `data === undefined` lets `Rail` fall back to its existing
 * `config?.channels ?? []`, matching vanilla's own `state.config?.channels
 * ?? []` — an empty notifier section, not a broken one.
 */
export function useConfigChrome() {
  const busy = useBusy();
  return useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
    refetchInterval: busy ? false : REFRESH_MS,
    throwOnError: false,
  });
}

/**
 * Every query below polls on the same busy-gated interval as `useStatus` and
 * `useConfig`, so the view an operator is actually looking at keeps up with the
 * server's own polling instead of freezing at whatever it loaded with.
 *
 * Vanilla got this for free: its 30s tick re-rendered the current view, which
 * re-fetched that view's data. The React port wired `refetchInterval` onto the
 * status and config queries only, so an operator sitting on Incidents watched
 * the rail badge tick to "1 open incident" while the list beside it stayed
 * empty indefinitely.
 *
 * The interval is per-query rather than an invalidation of these keys whenever
 * `["status"]` moves, for three reasons: it is the one mechanism already in the
 * file, so there is a single rule to reason about; it covers data that changes
 * without the status fingerprint changing at all (a notification row is written
 * by the notifier, and history buckets grow on every poll, whether or not any
 * provider's status moved); and it honours `useBusy`, which a cache
 * invalidation fired from a status change would bypass and refetch out from
 * under an operator mid-edit.
 *
 * TanStack only polls *mounted* queries, and `refetchIntervalInBackground`
 * stays at its default `false`, so this costs nothing for a view nobody is
 * looking at or a tab nobody has in front of them.
 */
export const useHistory = (days: number, provider?: string) => {
  const busy = useBusy();
  return useQuery({
    queryKey: ["history", days, provider ?? null],
    queryFn: () => api.getHistory(days, provider),
    refetchInterval: busy ? false : REFRESH_MS,
  });
};

/**
 * Never throws. Vanilla's own reasoning (`history.js:70-82`): "the provider's
 * own uptime figures already rendered; a missing component breakdown is not
 * worth surfacing as a page-level error." `History`'s per-provider row (and
 * its month columns and export button) must survive a component-history
 * fetch failure for one provider intact — that isolation is a property of
 * this query, not of the one call site that happens to use it today, so it
 * lives here rather than as a `throwOnError` override in `History.tsx`.
 */
export const useComponentHistory = (provider: string, days: number) => {
  const busy = useBusy();
  return useQuery({
    queryKey: ["history", "components", provider, days],
    queryFn: () => api.getComponentHistory(provider, days),
    throwOnError: false,
    refetchInterval: busy ? false : REFRESH_MS,
  });
};

export const useIncidents = (provider?: string) => {
  const busy = useBusy();
  return useQuery({
    queryKey: ["incidents", provider ?? null],
    queryFn: () => api.getIncidents(provider),
    refetchInterval: busy ? false : REFRESH_MS,
  });
};

export const useIncident = (providerId: string, incidentId: string) => {
  const busy = useBusy();
  return useQuery({
    queryKey: ["incident", providerId, incidentId],
    queryFn: () => api.getIncident(providerId, incidentId),
    refetchInterval: busy ? false : REFRESH_MS,
  });
};

export const useNotifications = (limit = 20) => {
  const busy = useBusy();
  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: () => api.getNotifications(limit),
    refetchInterval: busy ? false : REFRESH_MS,
  });
};

/**
 * The stored preferences, read once at startup by `usePreferenceSync` so a
 * fresh browser starts where the operator left off (design spec §7.4).
 *
 * Never throws. `usePreferenceSync` is mounted in the app shell, above every
 * view's error boundary, so under the client's throwing default a server that
 * is not answering yet would take down the whole dashboard rather than one
 * view. Vanilla said the same thing in a comment: "defaults are fine if the
 * server is not answering yet" (app.js's `start()`).
 */
export const usePreferences = () =>
  useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences, throwOnError: false });

/** Everything a write can invalidate. A config write moves the status grid too. */
const WRITE_KEYS = [["status"], ["config"], ["history"], ["incidents"], ["incident"], ["notifications"]];

function useInvalidateAll() {
  const client = useQueryClient();
  return async () => {
    await Promise.all(WRITE_KEYS.map((key) => client.invalidateQueries({ queryKey: key })));
  };
}

export function usePollNow() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.pollNow, onSuccess: invalidate });
}

export function useServiceMutations() {
  const invalidate = useInvalidateAll();
  return {
    add: useMutation({ mutationFn: api.addService, onSuccess: invalidate }),
    patch: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: unknown }) => api.patchService(id, patch),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.removeService, onSuccess: invalidate }),
    test: useMutation({ mutationFn: api.testService }),
  };
}

export function useSettingsMutation() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.patchSettings, onSuccess: invalidate });
}

export function useChannelMutations() {
  const invalidate = useInvalidateAll();
  return {
    patch: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: unknown }) => api.patchChannel(id, patch),
      onSuccess: invalidate,
    }),
    test: useMutation({ mutationFn: api.testChannel }),
  };
}

export function usePreferencesMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.patchPreferences,
    onSuccess: (next) => client.setQueryData(["preferences"], next),
  });
}
