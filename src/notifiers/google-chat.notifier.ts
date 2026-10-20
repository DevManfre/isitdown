import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure, REQUEST_TIMEOUT_MS } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { incidentKey } from "./incidentKey.ts";
import { httpUrlSetting } from "./settings.ts";

/** What a Chat message's `text` accepts. */
const TEXT_MAX_CHARS = 4096;

const settingsSchema = z.object({
  /** The space's incoming webhook URL; its key and token are the credential. */
  webhookUrl: httpUrlSetting("webhookUrl", "google-chat"),
});

/**
 * Google Chat incoming webhook — roadmap 3.9.
 *
 * A webhook cannot edit what it posted, but it can thread: every message about
 * one incident carries the same `threadKey` (`incidentKey`'s), so an incident's
 * updates and its resolution land as replies under the message that opened it
 * instead of scattering across the space. `REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`
 * starts the thread when there is none yet.
 */
export function createGoogleChatNotifier(settings: Record<string, string>): Notifier {
  const { webhookUrl } = settingsSchema.parse(settings);
  const endpoint = `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`;

  return {
    id: "google-chat",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      const link = `<${url}|${payload.service.name}>`;
      const body = [`*${heading}*`, ...(detail === "" ? [] : [detail])].join("\n");

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json; charset=UTF-8" },
        body: JSON.stringify({
          text: `${fitText(body, TEXT_MAX_CHARS - link.length - 2)}\n\n${link}`,
          // A digest is about several things at once and belongs to no thread.
          ...(payload.digest === undefined ? { thread: { threadKey: incidentKey(payload.change) } } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return;

      // The URL carries the credential, so only Google's own words are reported.
      const answer = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw httpFailure("google-chat", "failed", response.status, answer.error?.message);
    },
  };
}
