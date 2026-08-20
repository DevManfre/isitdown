/**
 * One thin wrapper per endpoint. Every failure surfaces the server's own
 * `error.message`, so a view can render what actually went wrong instead of
 * "request failed".
 */

async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const payload = text === "" ? undefined : JSON.parse(text);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `HTTP ${response.status}`);
  }
  return payload;
}

export const getStatus = () => request("GET", "./status");
export const pollNow = () => request("POST", "./poll");

export const getHistory = (days, provider) =>
  request(
    "GET",
    `./history?days=${days}${provider === undefined ? "" : `&provider=${encodeURIComponent(provider)}`}`,
  );
export const getComponentHistory = (provider, days) =>
  request("GET", `./history/components?days=${days}&provider=${encodeURIComponent(provider)}`);

export const getIncidents = (provider) =>
  request("GET", `./incidents${provider === undefined ? "" : `?provider=${encodeURIComponent(provider)}`}`);
export const getIncident = (providerId, incidentId) =>
  request("GET", `./incidents/${encodeURIComponent(providerId)}/${encodeURIComponent(incidentId)}`);

export const getNotifications = (limit = 20) => request("GET", `./notifications?limit=${limit}`);

export const getConfig = () => request("GET", "./config");
export const addService = (service) => request("POST", "./config/services", service);
export const previewComponents = (body) => request("POST", "./config/services/preview-components", body);
export const patchService = (id, patch) =>
  request("PATCH", `./config/services/${encodeURIComponent(id)}`, patch);
export const removeService = (id) => request("DELETE", `./config/services/${encodeURIComponent(id)}`);
export const testService = (id) => request("POST", `./config/services/${encodeURIComponent(id)}/test`);
export const patchSettings = (patch) => request("PATCH", "./config/settings", patch);
export const patchChannel = (id, patch) =>
  request("PATCH", `./config/channels/${encodeURIComponent(id)}`, patch);
export const testChannel = (id) => request("POST", `./config/channels/${encodeURIComponent(id)}/test`);

export const getPreferences = () => request("GET", "./api/preferences");
export const patchPreferences = (patch) => request("PATCH", "./api/preferences", patch);
