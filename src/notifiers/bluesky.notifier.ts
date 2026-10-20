import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { httpFailure } from "./errors.ts";
import { fitText, publicParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/** Bluesky counts a post in graphemes — what a reader sees as one character. */
const POST_MAX_GRAPHEMES = 300;

const DEFAULT_SERVICE = "https://bsky.social";

const settingsSchema = z.object({
  /** The account's handle: `status.example.com`. */
  handle: z.string().min(1, "handle is required for the bluesky channel"),
  /** An app password (Settings → App passwords), never the account's own. */
  appPassword: z.string().min(1, "appPassword is required for the bluesky channel"),
  /** The account's PDS; empty means bsky.social. */
  serviceUrl: z
    .string()
    .default("")
    .superRefine((value, context) => {
      if (value === "") return;
      const checked = httpUrlSetting("serviceUrl", "bluesky").safeParse(value);
      if (!checked.success) for (const issue of checked.error.issues) context.addIssue(issue);
    }),
});

/**
 * Bluesky — roadmap 3.9, the other public post beside Mastodon, and like it
 * built from `publicParts`, so the operator's impact and owner notes stay out.
 *
 * Two calls per post: a session from the app password, then the record. The
 * session is not kept — notifiers are rebuilt every poll cycle, and a status
 * change is rare enough that Bluesky's session limit (hundreds a day) is never
 * near. Bluesky has no editing, so there is no `update`: every change is a post.
 *
 * A link in a post is not a link until a facet says so, by byte offset; the
 * status page is the last line, and its facet is computed on the final text.
 */
export function createBlueskyNotifier(settings: Record<string, string>): Notifier {
  const { handle, appPassword, serviceUrl } = settingsSchema.parse(settings);
  const root = `${(serviceUrl === "" ? DEFAULT_SERVICE : serviceUrl).replace(/\/+$/, "")}/xrpc`;

  async function call(method: string, body: unknown, authorization?: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${root}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const reason = [parsed.error, parsed.message].filter((part) => typeof part === "string").join(": ");
      throw httpFailure("bluesky", method === "com.atproto.server.createSession" ? "login failed" : "failed", response.status, reason);
    }
    return parsed;
  }

  return {
    id: "bluesky",

    async send(payload: NotificationPayload): Promise<void> {
      const session = await call("com.atproto.server.createSession", { identifier: handle, password: appPassword });
      const { heading, detail, url } = publicParts(payload);
      const prefix = `${fitText(
        [heading, ...(detail === "" ? [] : [detail])].join("\n\n"),
        // The link counts in full here; Bluesky does not shorten it.
        POST_MAX_GRAPHEMES - [...new Intl.Segmenter().segment(url)].length - 2,
        "graphemes",
      )}\n\n`;
      const byteStart = Buffer.byteLength(prefix, "utf8");

      await call(
        "com.atproto.repo.createRecord",
        {
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text: `${prefix}${url}`,
            createdAt: new Date().toISOString(),
            langs: [payload.locale],
            facets: [
              {
                index: { byteStart, byteEnd: byteStart + Buffer.byteLength(url, "utf8") },
                features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
              },
            ],
          },
        },
        `Bearer ${String(session.accessJwt ?? "")}`,
      );
    },
  };
}
