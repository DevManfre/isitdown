import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure } from "./errors.ts";
import { fitText, publicParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** Mastodon's default post length; an instance can raise it, never below this. */
const STATUS_MAX_CHARS = 500;

const VISIBILITIES = ["public", "unlisted", "private"] as const;

const settingsSchema = z.object({
  /** The instance: `https://mastodon.social`. */
  instanceUrl: httpUrlSetting("instanceUrl", "mastodon"),
  /** An application's access token with `write:statuses`, the credential. */
  accessToken: z.string().min(1, "accessToken is required for the mastodon channel"),
  /** Who sees the post; empty means `public`, the point of posting it. */
  visibility: z
    .string()
    .default("")
    .refine((value) => value === "" || (VISIBILITIES as readonly string[]).includes(value), {
      message: `visibility must be one of ${VISIBILITIES.join(", ")} for the mastodon channel`,
    }),
});

/**
 * Mastodon — roadmap 3.9, a public post. Paired with the public status page,
 * it is the status account a small team never got round to
 * running by hand: "GitHub is having a major outage", posted as it happens.
 *
 * Public means the operator's own notes stay out: impact and owner are
 * handover notes for whoever is on call, not for followers (see
 * `publicParts`). A template is still the operator's explicit choice and is
 * posted as written.
 *
 * Mastodon can edit a status, so an incident's updates rewrite the post that
 * announced it (roadmap 3.19) instead of filling the timeline. Each create
 * carries an `Idempotency-Key`, so a retry is not a second post.
 */
export function createMastodonNotifier(settings: Record<string, string>): Notifier {
  const { instanceUrl, accessToken, visibility } = settingsSchema.parse(settings);
  const root = `${instanceUrl.replace(/\/+$/, "")}/api/v1/statuses`;
  const authorization = `Bearer ${accessToken}`;

  async function fail(response: Response, verb: string): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw httpFailure("mastodon", verb, response.status, body.error);
  }

  return {
    id: "mastodon",

    async send(payload: NotificationPayload): Promise<string | void> {
      const response = await fetch(root, {
        method: "POST",
        headers: { "content-type": "application/json", authorization, "idempotency-key": randomUUID() },
        body: JSON.stringify({ status: statusText(payload), visibility: visibility === "" ? "public" : visibility }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) await fail(response, "failed");

      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return typeof body.id === "string" && body.id !== "" ? body.id : undefined;
    },

    async update(payload: NotificationPayload, ref: string): Promise<void> {
      const response = await fetch(`${root}/${encodeURIComponent(ref)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization },
        body: JSON.stringify({ status: statusText(payload) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) await fail(response, "edit failed");
    },
  };
}

/**
 * The post: heading, detail, link. Mastodon counts any link as 23 characters
 * whatever its length, so the room left for the text is reckoned with that.
 */
function statusText(payload: NotificationPayload): string {
  const { heading, detail, url } = publicParts(payload);
  const text = [heading, ...(detail === "" ? [] : [detail])].join("\n\n");
  return `${fitText(text, STATUS_MAX_CHARS - 23 - 2)}\n\n${url}`;
}
