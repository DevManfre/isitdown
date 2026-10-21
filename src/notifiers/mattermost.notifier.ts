import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure, REQUEST_TIMEOUT_MS } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

/** What a Mattermost post accepts. */
const MESSAGE_MAX_CHARS = 16_383;

const settingsSchema = z.object({
  /** The server: `https://chat.example.com`. */
  serverUrl: httpUrlSetting("serverUrl", "mattermost"),
  /** A bot account's access token, the credential. */
  token: z.string().min(1, "token is required for the mattermost channel"),
  /** The channel's id (26 characters), not its display name. */
  channelId: z.string().min(1, "channelId is required for the mattermost channel"),
});

/**
 * Mattermost REST API — roadmap 3.9.
 *
 * Mattermost also takes a Slack-compatible incoming webhook, and the Slack
 * channel already speaks that. This one goes through the API with a bot token
 * instead, for the one thing a webhook cannot do: edit the post it made, so an
 * incident's updates rewrite one message in place (roadmap 3.19) rather than
 * stacking a new one per update.
 */
export function createMattermostNotifier(settings: Record<string, string>): Notifier {
  const { serverUrl, token, channelId } = settingsSchema.parse(settings);
  const root = `${serverUrl.replace(/\/+$/, "")}/api/v4/posts`;
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

  /** Whatever went wrong, in Mattermost's own words and never with the token. */
  async function fail(response: Response, verb: string): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw httpFailure("mattermost", verb, response.status, body.message);
  }

  return {
    id: "mattermost",

    async send(payload: NotificationPayload): Promise<string | void> {
      const response = await fetch(root, {
        method: "POST",
        headers,
        body: JSON.stringify({ channel_id: channelId, message: markdown(payload) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) await fail(response, "failed");

      // No id is not a failure — the post went out — it only leaves nothing to edit.
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return typeof body.id === "string" && body.id !== "" ? body.id : undefined;
    },

    async update(payload: NotificationPayload, ref: string): Promise<void> {
      const response = await fetch(`${root}/${encodeURIComponent(ref)}/patch`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ message: markdown(payload) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) await fail(response, "edit failed");
    },
  };
}

/** The heading in bold, the detail under it, the status page as a link. */
function markdown(payload: NotificationPayload): string {
  const { heading, detail, url } = renderParts(payload);
  const link = `[${payload.service.name}](${url})`;
  const body = [`**${heading}**`, ...(detail === "" ? [] : [detail])].join("\n");
  return `${fitText(body, MESSAGE_MAX_CHARS - link.length - 2)}\n\n${link}`;
}
