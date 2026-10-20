import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { httpFailure } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** The public Bark server, for an operator who does not run their own. */
const DEFAULT_SERVER = "https://api.day.app";

const settingsSchema = z.object({
  /** The device key the Bark app shows, the credential. */
  deviceKey: z.string().min(1, "deviceKey is required for the bark channel"),
  /** A self-hosted bark-server; empty means the public one. */
  // Checked only when set, and with the shared URL rule's own words: a union
  // with `""` would report a malformed URL as a bare "invalid input".
  serverUrl: z
    .string()
    .default("")
    .superRefine((value, context) => {
      if (value === "") return;
      const checked = httpUrlSetting("serverUrl", "bark").safeParse(value);
      if (!checked.success) for (const issue of checked.error.issues) context.addIssue(issue);
    }),
});

/**
 * Bark — roadmap 3.9. Push to an iPhone through a Bark server, self-hosted or
 * the public one.
 *
 * What makes it worth a channel of its own rather than an Apprise URL is
 * `level`: `critical` plays its sound through silent mode and Focus, which is
 * the iOS answer to "this one may wake me". Mapped from severity like every
 * other push channel's priority, so only a major outage gets it.
 *
 * APNs caps a whole notification at 4 KB, so title and body are cut to leave
 * room for the rest of it.
 */
export function createBarkNotifier(settings: Record<string, string>): Notifier {
  const { deviceKey, serverUrl } = settingsSchema.parse(settings);
  const endpoint = `${(serverUrl === "" ? DEFAULT_SERVER : serverUrl).replace(/\/+$/, "")}/push`;

  return {
    id: "bark",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          device_key: deviceKey,
          title: fitText(heading, 256, "bytes"),
          body: fitText(detail === "" ? heading : detail, 3000, "bytes"),
          level: LEVEL[payload.change.currentStatus],
          url,
          group: "IsItDown",
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { message?: string };
      throw httpFailure("bark", "failed", response.status, body.message);
    },
  };
}

/**
 * Bark's interruption levels, which are iOS's: `critical` rings through silent
 * mode, `timeSensitive` through Focus, `active` is an ordinary notification and
 * `passive` arrives without lighting the screen.
 */
const LEVEL: Record<OverallStatus, string> = {
  operational: "active",
  degraded: "active",
  partial_outage: "timeSensitive",
  major_outage: "critical",
  unknown: "passive",
};
