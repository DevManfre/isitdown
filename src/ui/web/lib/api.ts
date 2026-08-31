import type {
  ComponentHistoryResponse,
  ComponentPreview,
  IncidentDetail,
  IncidentsResponse,
  IncidentState,
  MapResponse,
  OverallStatus,
  Preferences,
  ProviderHistory,
  HistorySummary,
  RuntimeConfigResponse,
  SentRecord,
  StatusResponse,
} from "./types.ts";

/**
 * One thin wrapper per endpoint. Every failure surfaces the server's own
 * `error.message`, so a view can render what actually went wrong instead of
 * "request failed".
 *
 * Paths are absolute (`/status`, not `./status`): the React app serves nested
 * routes like `/incidents/github/xyz`, where a relative `./status` would
 * resolve against the wrong base.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  // A non-JSON body (an empty string, an upstream proxy's HTML error page, a
  // body-size-limit rejection) must not escape as a raw SyntaxError: that
  // would break the promise above. Treat it the same as an empty body —
  // nothing usable to read the server's own message from.
  let payload: unknown;
  if (text !== "") {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = undefined;
    }
  }
  if (!response.ok) {
    const message = (payload as { error?: { message?: string } })?.error?.message;
    throw new Error(message ?? `HTTP ${response.status}`);
  }
  return payload as T;
}

export const getStatus = () => request<StatusResponse>("GET", "/status");
export const pollNow = () =>
  request<{ providers: number; failed: number; changes: number; startedAt: string; finishedAt: string }>(
    "POST",
    "/poll",
  );

/**
 * Returns `HistorySummary` when `provider` is omitted, `ProviderHistory`
 * otherwise. There is no literal tag to switch on; a caller discriminates by
 * shape instead — `providerId` is unique to `ProviderHistory`, `months` and
 * `providers` unique to `HistorySummary`.
 */
export const getHistory = (days: number, provider?: string): Promise<HistorySummary | ProviderHistory> =>
  provider === undefined
    ? request<HistorySummary>("GET", `/history?days=${days}`)
    : request<ProviderHistory>("GET", `/history?days=${days}&provider=${encodeURIComponent(provider)}`);

export const getComponentHistory = (provider: string, days: number) =>
  request<ComponentHistoryResponse>(
    "GET",
    `/history/components?days=${days}&provider=${encodeURIComponent(provider)}`,
  );

export interface IncidentListQuery {
  provider?: string | undefined;
  state?: IncidentState | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

/**
 * An object rather than four positional arguments: the server defaults every
 * one of them, so a call site that only moves the page must not have to restate
 * the rest in the right order.
 */
export const getIncidents = (query: IncidentListQuery = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return request<IncidentsResponse>("GET", `/incidents${search === "" ? "" : `?${search}`}`);
};

export const getIncident = (providerId: string, incidentId: string) =>
  request<IncidentDetail>(
    "GET",
    `/incidents/${encodeURIComponent(providerId)}/${encodeURIComponent(incidentId)}`,
  );

export const getNotifications = (limit = 20) =>
  request<{ notifications: SentRecord[] }>("GET", `/notifications?limit=${limit}`);

export const getConfig = () => request<RuntimeConfigResponse>("GET", "/config");
export const addService = (service: unknown) => request<unknown>("POST", "/config/services", service);
export const previewComponents = (body: unknown) =>
  request<{ supported: boolean; components: ComponentPreview[] }>(
    "POST",
    "/config/services/preview-components",
    body,
  );
export const patchService = (id: string, patch: unknown) =>
  request<unknown>("PATCH", `/config/services/${encodeURIComponent(id)}`, patch);
export const removeService = (id: string) =>
  request<unknown>("DELETE", `/config/services/${encodeURIComponent(id)}`);
export const testService = (id: string) =>
  request<{ ok: boolean; overallStatus?: OverallStatus; error?: string }>(
    "POST",
    `/config/services/${encodeURIComponent(id)}/test`,
  );
export const patchSettings = (patch: unknown) => request<unknown>("PATCH", "/config/settings", patch);
export const patchChannel = (id: string, patch: unknown) =>
  request<unknown>("PATCH", `/config/channels/${encodeURIComponent(id)}`, patch);
export const testChannel = (id: string) =>
  request<{ ok: boolean; error?: string }>("POST", `/config/channels/${encodeURIComponent(id)}/test`);

export const getMap = () => request<MapResponse>("GET", "/map");

export const getPreferences = () => request<Preferences>("GET", "/api/preferences");
export const patchPreferences = (patch: Partial<Preferences>) =>
  request<Preferences>("PATCH", "/api/preferences", patch);
