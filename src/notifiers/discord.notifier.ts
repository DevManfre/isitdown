import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  webhookUrl: httpUrlSetting("webhookUrl", "discord"),
});

/**
 * Discord incoming webhook. One embed per change: the heading is the embed
 * title and links to the provider's status page, the severity is its colour,
 * and the words are the shared catalog's — a Discord alert says exactly what
 * the Telegram one says, arranged the way Discord renders best.
 *
 * The webhook URL is the credential, so no error path here includes it: Discord
 * answers a rejected send with its own `message`, which is what gets reported.
 *
 * Discord rate-limits a webhook to ~5 requests per 2 seconds and answers 429
 * with `retry_after`. No throttling is added here on purpose: the diff engine
 * already sends once per transition, and a notifier that swallowed or delayed
 * an alert on its own would be suppressing the thing it exists to deliver.
 */
export function createDiscordNotifier(settings: Record<string, string>): Notifier {
  const { webhookUrl } = settingsSchema.parse(settings);

  /**
   * `?wait=true` makes Discord answer with the message it created instead of a
   * bare 204, which is the only way to learn its id — and the id is what an
   * edit needs (roadmap 3.19). The cost is a request that waits for the message
   * to be stored, which is milliseconds inside a poll cycle.
   */
  const sendUrl = `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}wait=true`;

  /** Whatever went wrong, in Discord's own words and never with the URL. */
  async function fail(response: Response, verb: string): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(
      `discord notification ${verb}: HTTP ${response.status}${
        body.message === undefined ? "" : ` (${body.message})`
      }`,
    );
  }

  /** The one embed both a send and an edit post, so the two cannot drift apart. */
  function embed(payload: NotificationPayload): unknown {
    const { heading, detail, url, color } = renderParts(payload);
    return { embeds: [{ title: heading, url, description: detail, color }] };
  }

  return {
    id: "discord",

    async send(payload: NotificationPayload): Promise<string | void> {
      const response = await fetch(sendUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(embed(payload)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) await fail(response, "failed");

      // No id in the answer is not a failure — the message went out — it only
      // leaves the dispatcher with nothing to edit later.
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return typeof body.id === "string" && body.id !== "" ? body.id : undefined;
    },

    /**
     * Rewrites a message this webhook posted (roadmap 3.19). Discord answers
     * 404 once the message is gone — deleted by hand, or a channel that has
     * been cleared — which arrives here as a rejection, and the dispatcher
     * answers by sending a new one.
     */
    async update(payload: NotificationPayload, ref: string): Promise<void> {
      const response = await fetch(`${webhookUrl}/messages/${encodeURIComponent(ref)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(embed(payload)),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) await fail(response, "edit failed");
    },
  };
}
