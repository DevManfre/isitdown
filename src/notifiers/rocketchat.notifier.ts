import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { ChannelError, httpFailure } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** Rocket.Chat's default `Message_MaxAllowedSize`. */
const MESSAGE_MAX_CHARS = 5000;

const settingsSchema = z.object({
  /** The server: `https://chat.example.com`. */
  serverUrl: httpUrlSetting("serverUrl", "rocketchat"),
  /** The bot user's id, sent beside its token as Rocket.Chat requires. */
  userId: z.string().min(1, "userId is required for the rocketchat channel"),
  /** A personal access token of that user, the credential. */
  token: z.string().min(1, "token is required for the rocketchat channel"),
  /** The room's id, not its `#name`: an edit has to name the room by id. */
  roomId: z.string().min(1, "roomId is required for the rocketchat channel"),
});

/**
 * Rocket.Chat REST API — roadmap 3.9.
 *
 * Through the API rather than an incoming webhook for the same reason as
 * Mattermost: a webhook cannot edit what it posted, and the API can — so an
 * incident's updates rewrite one message (roadmap 3.19).
 *
 * Rocket.Chat reports some refusals as a 200 with `success: false`, so both
 * shapes are failures here.
 */
export function createRocketchatNotifier(settings: Record<string, string>): Notifier {
  const { serverUrl, userId, token, roomId } = settingsSchema.parse(settings);
  const root = `${serverUrl.replace(/\/+$/, "")}/api/v1`;

  async function call(path: string, body: unknown, verb: string): Promise<{ message?: { _id?: string } }> {
    const response = await fetch(`${root}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-auth-token": token, "x-user-id": userId },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      message?: { _id?: string };
    };
    if (!response.ok) throw httpFailure("rocketchat", verb, response.status, parsed.error);
    if (parsed.success === false) {
      throw new ChannelError("rocketchat", `rocketchat notification rejected: ${parsed.error ?? "unknown reason"}`);
    }
    return parsed;
  }

  return {
    id: "rocketchat",

    async send(payload: NotificationPayload): Promise<string | void> {
      const parsed = await call("chat.postMessage", { roomId, text: markdown(payload) }, "failed");
      const id = parsed.message?._id;
      return typeof id === "string" && id !== "" ? id : undefined;
    },

    async update(payload: NotificationPayload, ref: string): Promise<void> {
      await call("chat.update", { roomId, msgId: ref, text: markdown(payload) }, "edit failed");
    },
  };
}

/** The heading in bold, the detail under it, the status page as a link. */
function markdown(payload: NotificationPayload): string {
  const { heading, detail, url } = renderParts(payload);
  const link = `[${payload.service.name}](${url})`;
  const body = [`*${heading}*`, ...(detail === "" ? [] : [detail])].join("\n");
  return `${fitText(body, MESSAGE_MAX_CHARS - link.length - 2)}\n\n${link}`;
}
