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

export function useConfig() {
  const busy = useBusy();
  return useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
    refetchInterval: busy ? false : REFRESH_MS,
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
const WRITE_KEYS = [["status"], ["config"], ["history"], ["incidents"], ["notifications"]];

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
