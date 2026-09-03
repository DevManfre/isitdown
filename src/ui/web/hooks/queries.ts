import { keepPreviousData, useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import * as api from "@/lib/api.ts";
import { msUntilNextPoll, REFRESH_MS, statusRefetchDelay } from "@/lib/statusRefetch.ts";
import type { StatusResponse } from "@/lib/types.ts";
import { useBusy } from "./useBusy.tsx";

/**
 * `["status"]` refetches on the countdown rather than on the flat idle rhythm:
 * it is the one query whose payload says when it will next change, and the
 * header's countdown has nothing to show between the deadline passing and the
 * next read landing. Every other query below keeps the flat interval.
 *
 * It is also the one query the busy gate must not cover. `useBusy` is there so
 * a refetch cannot overwrite a form under the operator — and every form reads
 * `["config"]`. `["status"]` feeds read-only chrome, so holding it protects
 * nothing and strands the countdown at "0s" for as long as a field keeps
 * focus: a dashboard that looks stopped while the server polls on time.
 */
const statusRefetchInterval = (query: Query<StatusResponse>): number =>
  statusRefetchDelay(msUntilNextPoll(query.state.data, query.state.dataUpdatedAt, Date.now()));

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: api.getStatus,
    refetchInterval: statusRefetchInterval,
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
  return useQuery({
    queryKey: ["status"],
    queryFn: api.getStatus,
    refetchInterval: statusRefetchInterval,
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
export const useHistory = (days: number) => {
  const busy = useBusy();
  return useQuery({
    queryKey: ["history", days, null],
    queryFn: () => api.getHistory(days),
    refetchInterval: busy ? false : REFRESH_MS,
  });
};

/**
 * One provider's own history, for the History view's detail drawer. Never
 * throws — and the asymmetry with {@link useHistory} above is the point.
 *
 * Same shape of reasoning as {@link useStatusChrome} and
 * {@link useComponentHistory}, one endpoint up. This query mounts in the same
 * React tree as the summary that drew the page, so under the client's default
 * `throwOnError` (`queryClient.ts`: throw when there is nothing to show yet) a
 * 500 on the *first* open of one drawer throws during render, reaches
 * routes.tsx's `errorElement`, and replaces the trend chart, the month columns
 * and the whole provider list with `ViewError` — a page destroyed by a detail
 * nobody had looked at a moment earlier.
 *
 * `useHistory` must keep throwing: an initial-load failure of the page's own
 * data is exactly what that boundary exists for. A drawer's detail is not the
 * page's data. That distinction is a property of these two queries, not of the
 * call sites that happen to use them today, so it lives here rather than as a
 * `throwOnError` override in `ProviderHistoryDrawer.tsx` — and `provider` is
 * off `useHistory` entirely, so there is no second, throwing way to ask for one
 * provider's history.
 *
 * `enabled` is what makes "no provider, no request" a property of the hook too:
 * the drawer mounts closed, with `provider === null`, and must not fetch for a
 * provider nobody opened.
 */
export const useProviderHistory = (provider: string | null, days: number) => {
  const busy = useBusy();
  return useQuery({
    queryKey: ["history", days, provider],
    queryFn: () => api.getHistory(days, provider ?? undefined),
    throwOnError: false,
    enabled: provider !== null,
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

/**
 * One page of the incident list. `keepPreviousData` is what makes the pager
 * usable: without it, every page change unmounts the rows for the length of a
 * request and the list flashes its empty state between pages.
 */
export const useIncidents = (query: api.IncidentListQuery = {}) => {
  const busy = useBusy();
  return useQuery({
    queryKey: [
      "incidents",
      query.provider ?? null,
      query.state ?? "all",
      query.page ?? 1,
      query.pageSize ?? null,
    ],
    queryFn: () => api.getIncidents(query),
    placeholderData: keepPreviousData,
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

/** Newest first by `startsAt`, scoped to enabled providers server-side. */
export const useMaintenances = (query: api.MaintenanceListQuery = {}) => {
  const busy = useBusy();
  return useQuery({
    queryKey: [
      "maintenances",
      query.provider ?? null,
      query.days ?? null,
      query.limit ?? null,
      query.includeUpcoming ?? null,
    ],
    queryFn: () => api.getMaintenances(query),
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
 * The Overview's geographic card.
 *
 * `enabled` is the stored `mapView` preference being anything but `off`: the
 * card is not merely hidden when the operator has not asked for it, the request
 * is never issued. Never throws, for the same reason the chrome hooks do not —
 * a failed map must show its own error inside the card, not replace the
 * Overview with one.
 */
export function useMap(enabled: boolean) {
  const busy = useBusy();
  return useQuery({
    queryKey: ["map"],
    queryFn: api.getMap,
    enabled,
    refetchInterval: busy ? false : REFRESH_MS,
    throwOnError: false,
  });
}

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
const WRITE_KEYS = [
  ["status"],
  ["config"],
  ["history"],
  ["incidents"],
  ["incident"],
  ["notifications"],
  ["maintenances"],
];

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
    // Two mutations rather than one: the variable *name* lives in the database
    // (patch) and its value in the secrets file (saveSecrets), and a row that
    // renames a reference and sets a credential in the same click has to do
    // the rename first — see ChannelRow's save.
    saveSecrets: useMutation({
      mutationFn: ({ id, fields }: { id: string; fields: Record<string, string> }) =>
        api.saveChannelSecrets(id, fields),
      onSuccess: invalidate,
    }),
    clearSecret: useMutation({
      mutationFn: ({ id, field }: { id: string; field: string }) => api.clearChannelSecret(id, field),
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

export function usePushDevices() {
  return useQuery({ queryKey: ["push-devices"], queryFn: api.getPushDevices });
}

export function usePushMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: ["push-devices"] });
  return {
    add: useMutation({ mutationFn: api.addPushDevice, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: api.removePushDevice, onSuccess: invalidate }),
  };
}
