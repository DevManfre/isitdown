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

export const useHistory = (days: number, provider?: string) =>
  useQuery({
    queryKey: ["history", days, provider ?? null],
    queryFn: () => api.getHistory(days, provider),
  });

export const useComponentHistory = (provider: string, days: number) =>
  useQuery({
    queryKey: ["history", "components", provider, days],
    queryFn: () => api.getComponentHistory(provider, days),
  });

export const useIncidents = (provider?: string) =>
  useQuery({
    queryKey: ["incidents", provider ?? null],
    queryFn: () => api.getIncidents(provider),
  });

export const useIncident = (providerId: string, incidentId: string) =>
  useQuery({
    queryKey: ["incident", providerId, incidentId],
    queryFn: () => api.getIncident(providerId, incidentId),
  });

export const useNotifications = (limit = 20) =>
  useQuery({ queryKey: ["notifications", limit], queryFn: () => api.getNotifications(limit) });

export const usePreferences = () => useQuery({ queryKey: ["preferences"], queryFn: api.getPreferences });

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
