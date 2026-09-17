import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z
  .object({
    /** An Apprise API server: `http://apprise:8000`. */
    serverUrl: httpUrlSetting("serverUrl", "apprise"),
    /** A stored configuration's key, when the server keeps the URLs. */
    configKey: z.string().optional(),
    /** Apprise service URLs, comma-separated, when they live here instead. */
    urls: z.string().optional(),
  })
  .refine((value) => (value.configKey ?? "") !== "" || (value.urls ?? "") !== "", {
    message: "either configKey or urls is required for the apprise channel",
    path: ["configKey"],
  });

/**
 * Apprise bridge — roadmap 3.9. One channel that speaks to an Apprise API
 * server, and through it to the ~80 services Apprise already knows how to
 * reach. The pragmatic shortcut the roadmap describes: a channel IsItDown will
 * never write an adapter for (a pager, an SMS gateway, an office chat nobody
 * else asked for) is a URL in Apprise's configuration rather than a file here.
 *
 * The cost is an external service, which is why nothing about it is assumed:
 * the server URL is a setting, not a default, and a server that is down fails
 * the delivery like any other channel rather than losing the alert quietly.
 *
 * Two shapes, because Apprise offers two and operators run both. With a
 * `configKey` the server holds the service URLs and IsItDown never sees them —
 * the better arrangement, since those URLs are credentials. With `urls` they
 * travel on each request instead, for a stateless server. Setting both uses
 * the key: the server's own configuration is the one an operator edits.
 */
export function createAppriseNotifier(settings: Record<string, string>): Notifier {
  const { serverUrl, configKey, urls } = settingsSchema.parse(settings);
  const root = serverUrl.replace(/\/+$/, "");
  const keyed = (configKey ?? "") !== "";
  const endpoint = keyed ? `${root}/notify/${encodeURIComponent(configKey as string)}` : `${root}/notify`;

  return {
    id: "apprise",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: heading,
          // Every downstream service gets the link in the text: Apprise
          // normalises away whatever link affordance each one has, so a line
          // is the only form that survives all of them.
          body: [detail, url].filter((part) => part !== "").join("\n\n"),
          type: TYPE[payload.change.currentStatus],
          format: "text",
          ...(keyed ? {} : { urls }),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        `apprise notification failed: HTTP ${response.status}${
          body.error === undefined ? "" : ` (${body.error})`
        }`,
      );
    },
  };
}

/**
 * Apprise's four notification types. Several of its downstream services colour
 * or prioritise on this, so it is mapped from severity rather than left at the
 * default — the one piece of our severity vocabulary that survives the bridge.
 */
const TYPE: Record<OverallStatus, string> = {
  operational: "success",
  degraded: "warning",
  partial_outage: "warning",
  major_outage: "failure",
  unknown: "info",
};
