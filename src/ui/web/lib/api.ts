import type {
  AdapterDebugResponse,
  AdapterDetection,
  AdapterProbeResult,
  CatalogProvider,
  ComponentHistoryResponse,
  ComponentPreview,
  ConfigImportReport,
  DbRestoreReport,
  IncidentNote,
  DbMaintenanceReport,
  DeliveryLogResponse,
  DeliveryState,
  DescribedChannel,
  IncidentDetail,
  IncidentsResponse,
  IncidentState,
  MaintenancesResponse,
  MapResponse,
  OverallStatus,
  Preferences,
  ProviderCalendar,
  ProviderHistory,
  HistorySummary,
  RoutingResponse,
  RoutingRule,
  RuntimeConfigResponse,
  SentRecord,
  ServiceImpact,
  StatusResponse,
  StorageReport,
} from "./types.ts";
import type { PushSubscriptionBody } from "./push.ts";

/**
 * One thin wrapper per endpoint. Every failure surfaces the server's own
 * `error.message`, so a view can render what actually went wrong instead of
 * "request failed".
 *
 * Paths are absolute (`/status`, not `./status`): the React app serves nested
 * routes like `/incidents/github/xyz`, where a relative `./status` would
 * resolve against the wrong base.
 */
async function request<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : contentType === undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        // The config import sends the file's own bytes (roadmap 4.3), so the
        // body is text and the type says which text it is.
        : { headers: { "content-type": contentType }, body: String(body) }),
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

/** A year of day cells for one provider — roadmap 5.20. The window is the server's. */
export const getProviderCalendar = (provider: string) =>
  request<ProviderCalendar>("GET", `/history/calendar?provider=${encodeURIComponent(provider)}`);

export const getComponentHistory = (provider: string, days: number) =>
  request<ComponentHistoryResponse>(
    "GET",
    `/history/components?days=${days}&provider=${encodeURIComponent(provider)}`,
  );

export interface IncidentListQuery {
  provider?: string | undefined;
  state?: IncidentState | undefined;
  /** Free text over incident names; the server searches, not the browser. */
  q?: string | undefined;
  /** Only incidents that started within this many days. Absent = every one. */
  days?: number | undefined;
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

/**
 * An operator's note on one incident (roadmap 5.3) — the one thing about an
 * incident nothing here can observe.
 */
export const addIncidentNote = (providerId: string, incidentId: string, body: string) =>
  request<IncidentNote>(
    "POST",
    `/incidents/${encodeURIComponent(providerId)}/${encodeURIComponent(incidentId)}/notes`,
    { body },
  );

export const deleteIncidentNote = (providerId: string, incidentId: string, id: number) =>
  request<void>(
    "DELETE",
    `/incidents/${encodeURIComponent(providerId)}/${encodeURIComponent(incidentId)}/notes/${id}`,
  );

export interface MaintenanceListQuery {
  provider?: string | undefined;
  days?: number | undefined;
  limit?: number | undefined;
  includeUpcoming?: boolean | undefined;
}

export const getMaintenances = (query: MaintenanceListQuery = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return request<MaintenancesResponse>("GET", `/maintenances${search === "" ? "" : `?${search}`}`);
};

export const getNotifications = (limit = 20) =>
  request<{ notifications: SentRecord[] }>("GET", `/notifications?limit=${limit}`);

export interface DeliveryLogQuery {
  state?: DeliveryState | undefined;
  channel?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export const getDeliveryLog = (query: DeliveryLogQuery = {}) => {
  const params = new URLSearchParams();
  if (query.state !== undefined && query.state !== "all") params.set("state", query.state);
  if (query.channel !== undefined && query.channel !== "") params.set("channel", query.channel);
  if (query.page !== undefined) params.set("page", String(query.page));
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  const search = params.toString();
  return request<DeliveryLogResponse>("GET", `/notifications/log${search === "" ? "" : `?${search}`}`);
};

export const getConfig = () => request<RuntimeConfigResponse>("GET", "/config");
export const addService = (service: unknown) => request<unknown>("POST", "/config/services", service);
export const previewComponents = (body: unknown) =>
  request<{ supported: boolean; components: ComponentPreview[] }>(
    "POST",
    "/config/services/preview-components",
    body,
  );
/**
 * Reads a `config.yml` back into the dashboard (roadmap 4.3). Sent as text
 * rather than wrapped in JSON: what the operator picked is the file itself.
 */
export const importConfig = (yaml: string) =>
  request<ConfigImportReport>("POST", "/config/import", yaml, "text/yaml");
/**
 * Puts a whole database back (roadmap 4.4). The file's own bytes, as
 * `application/octet-stream` — the validation that matters is the server's, and
 * the browser has no business deciding whether a `.db` is one of ours.
 */
export const restoreBackup = async (file: File): Promise<DbRestoreReport> => {
  const response = await fetch("/config/restore", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: await file.arrayBuffer(),
  });
  const payload = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string } }
    | DbRestoreReport
    | undefined;
  if (!response.ok) {
    throw new Error((payload as { error?: { message?: string } })?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload as DbRestoreReport;
};

/** The bundled provider menu, with the ids already watched marked (roadmap 5.11). */
export const getCatalog = () => request<{ providers: CatalogProvider[] }>("GET", "/config/catalog");
/** Which adapter reads a pasted url, and the base url that adapter wants. */
export const detectAdapter = (url: string) =>
  request<AdapterDetection>("POST", "/config/services/detect", { url });
export const patchService = (id: string, patch: unknown) =>
  request<unknown>("PATCH", `/config/services/${encodeURIComponent(id)}`, patch);
/** Read before the remove, so the confirmation can name what the cascade takes. */
export const getServiceImpact = (id: string) =>
  request<ServiceImpact>("GET", `/config/services/${encodeURIComponent(id)}/impact`);
/** A soft delete: the provider leaves the dashboard, its history waits out the window. */
export const removeService = (id: string) =>
  request<{ removed: string; removedAt: string; restoreUntil: string }>(
    "DELETE",
    `/config/services/${encodeURIComponent(id)}`,
  );
/** Undo, for as long as the window lasts. */
export const restoreService = (id: string) =>
  request<unknown>("POST", `/config/services/${encodeURIComponent(id)}/restore`);
/** The destructive half, on its own path so nothing reaches it by accident. */
export const purgeService = (id: string) =>
  request<unknown>("DELETE", `/config/services/${encodeURIComponent(id)}/permanently`);
export const testService = (id: string) =>
  request<{ ok: boolean; overallStatus?: OverallStatus; error?: string }>(
    "POST",
    `/config/services/${encodeURIComponent(id)}/test`,
  );
export const patchSettings = (patch: unknown) => request<unknown>("PATCH", "/config/settings", patch);
export const getStorage = () => request<StorageReport>("GET", "/config/storage");
/** Integrity check then vacuum, on demand — roadmap 6.13. */
export const runStorageMaintenance = () =>
  request<DbMaintenanceReport>("POST", "/config/storage/maintenance");
/** The adapter debug panel's two halves — roadmap 5.18. */
export const getAdapterDebug = () => request<AdapterDebugResponse>("GET", "/debug/adapters");
/** One read, right now. Records nothing and notifies nothing, like the connection test. */
export const probeAdapter = (id: string) =>
  request<AdapterProbeResult>("POST", `/debug/adapters/${encodeURIComponent(id)}/probe`);
/** Every edit, add, delete and reorder saves the whole ordered list — see RoutingRules.tsx. */
export const putRouting = (rules: RoutingRule[]) =>
  request<RoutingResponse>("PUT", "/config/routing", { rules });
export const patchChannel = (id: string, patch: unknown) =>
  request<unknown>("PATCH", `/config/channels/${encodeURIComponent(id)}`, patch);
/**
 * Write-only, like the route behind it: a credential goes out, and what comes
 * back is the channel's usual name-and-isSet shape, never the value.
 */
export const saveChannelSecrets = (id: string, fields: Record<string, string>) =>
  request<DescribedChannel>("PUT", `/config/channels/${encodeURIComponent(id)}/secrets`, { fields });
export const clearChannelSecret = (id: string, field: string) =>
  request<DescribedChannel>(
    "DELETE",
    `/config/channels/${encodeURIComponent(id)}/secrets/${encodeURIComponent(field)}`,
  );
export const testChannel = (id: string) =>
  request<{ ok: boolean; error?: string }>("POST", `/config/channels/${encodeURIComponent(id)}/test`);

export const getMap = () => request<MapResponse>("GET", "/map");

export const getPreferences = () => request<Preferences>("GET", "/api/preferences");
export const patchPreferences = (patch: Partial<Preferences>) =>
  request<Preferences>("PATCH", "/api/preferences", patch);

export const getPushKey = () => request<{ publicKey: string }>("GET", "/config/push");
export const getPushDevices = () =>
  request<{ devices: { id: string; label: string; createdAt: string }[] }>("GET", "/config/push/subscriptions");
export const addPushDevice = (body: PushSubscriptionBody) =>
  request<unknown>("POST", "/config/push/subscriptions", body);
export const removePushDevice = (id: string) =>
  request<unknown>("DELETE", `/config/push/subscriptions/${encodeURIComponent(id)}`);
