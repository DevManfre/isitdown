import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure } from "./errors.ts";
import { fitText, renderMessage } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** Past this Signal turns the text into a long-message attachment. */
const MESSAGE_MAX_CHARS = 2000;

const settingsSchema = z.object({
  /** The signal-cli-rest-api server: `http://signal-api:8080`. */
  serverUrl: httpUrlSetting("serverUrl", "signal"),
  /** The registered number messages are sent from, E.164. */
  number: z.string().min(1, "number is required for the signal channel"),
  /** Who receives it: numbers or `group.…` ids, comma-separated. */
  recipients: z
    .string()
    .transform((value) => value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== ""))
    .refine((list) => list.length > 0, { message: "recipients is required for the signal channel" }),
});

/**
 * Signal, through a signal-cli-rest-api server — roadmap 3.9.
 *
 * Signal has no bot API; the self-hosted REST wrapper around signal-cli is
 * how every self-hosted tool reaches it, and it is the same kind of sidecar as
 * an Apprise server. The server holds the account's keys, so this side holds
 * no credential at all — which is also why the server should not be reachable
 * from anywhere but here.
 */
export function createSignalNotifier(settings: Record<string, string>): Notifier {
  const { serverUrl, number, recipients } = settingsSchema.parse(settings);
  const endpoint = `${serverUrl.replace(/\/+$/, "")}/v2/send`;

  return {
    id: "signal",

    async send(payload: NotificationPayload): Promise<void> {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          number,
          recipients,
          message: fitText(renderMessage(payload), MESSAGE_MAX_CHARS),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw httpFailure("signal", "failed", response.status, body.error);
    },
  };
}
