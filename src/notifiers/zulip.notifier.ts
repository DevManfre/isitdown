import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure, REQUEST_TIMEOUT_MS } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

/** Zulip's own ceilings for a message and for a topic name. */
const CONTENT_MAX_CHARS = 10_000;
const TOPIC_MAX_CHARS = 60;

const settingsSchema = z.object({
  /** The organisation: `https://example.zulipchat.com`. */
  siteUrl: httpUrlSetting("siteUrl", "zulip"),
  /** The bot's email address, its user name for the API. */
  botEmail: z.string().min(1, "botEmail is required for the zulip channel"),
  /** The bot's API key, the credential. */
  apiKey: z.string().min(1, "apiKey is required for the zulip channel"),
  /** The channel (Zulip's "stream") messages are posted to. */
  stream: z.string().min(1, "stream is required for the zulip channel"),
  /** A fixed topic; empty means one topic per provider. */
  topic: z.string().default(""),
});

/**
 * Zulip REST API — roadmap 3.9.
 *
 * Zulip threads every message under a topic, and the natural topic for a
 * status alert is the provider it is about — so unless the operator names one,
 * each provider gets its own, and GitHub's whole history reads as one thread.
 *
 * A bot can edit its own messages, so an incident's updates rewrite the one it
 * opened (roadmap 3.19). Zulip refuses an edit past the organisation's editing
 * window; that arrives as a failure and the dispatcher posts a new message.
 */
export function createZulipNotifier(settings: Record<string, string>): Notifier {
  const { siteUrl, botEmail, apiKey, stream, topic } = settingsSchema.parse(settings);
  const root = `${siteUrl.replace(/\/+$/, "")}/api/v1/messages`;
  const authorization = `Basic ${Buffer.from(`${botEmail}:${apiKey}`).toString("base64")}`;

  async function call(url: string, method: string, form: URLSearchParams, verb: string): Promise<{ id?: number }> {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/x-www-form-urlencoded", authorization },
      body: form.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = (await response.json().catch(() => ({}))) as { msg?: string; id?: number };
    if (!response.ok) throw httpFailure("zulip", verb, response.status, parsed.msg);
    return parsed;
  }

  return {
    id: "zulip",

    async send(payload: NotificationPayload): Promise<string | void> {
      const form = new URLSearchParams({
        type: "stream",
        to: stream,
        topic: fitText(topic === "" ? payload.service.name : topic, TOPIC_MAX_CHARS),
        content: markdown(payload),
      });
      const parsed = await call(root, "POST", form, "failed");
      return typeof parsed.id === "number" ? String(parsed.id) : undefined;
    },

    async update(payload: NotificationPayload, ref: string): Promise<void> {
      const form = new URLSearchParams({ content: markdown(payload) });
      await call(`${root}/${encodeURIComponent(ref)}`, "PATCH", form, "edit failed");
    },
  };
}

/** The heading in bold, the detail under it, the status page as a link. */
function markdown(payload: NotificationPayload): string {
  const { heading, detail, url } = renderParts(payload);
  const link = `[${payload.service.name}](${url})`;
  const body = [`**${heading}**`, ...(detail === "" ? [] : [detail])].join("\n");
  return `${fitText(body, CONTENT_MAX_CHARS - link.length - 2)}\n\n${link}`;
}
