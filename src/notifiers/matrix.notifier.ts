import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { httpUrlSetting } from "./settings.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const settingsSchema = z.object({
  /** The homeserver's client API root, not a room path: `https://matrix.org`. */
  homeserverUrl: httpUrlSetting("homeserverUrl", "matrix"),
  /**
   * The internal room id (`!abc:example.org`), not an alias. An alias would
   * need a resolving round trip on every send and can be repointed at another
   * room by anyone with the power to, which is not a property an alert channel
   * should have.
   */
  roomId: z
    .string()
    .min(1, "roomId is required for the matrix channel")
    .refine((value) => value.startsWith("!") && value.includes(":"), {
      message: "roomId must be an internal room id like !abc:example.org for the matrix channel",
    }),
  /** An access token for the sending user; the credential. */
  accessToken: z.string().min(1, "accessToken is required for the matrix channel"),
});

/**
 * Matrix — roadmap 3.6. The same message every other channel sends, posted
 * into one room as an `m.room.message` through the client-server API.
 *
 * Two formats travel together, which is what Matrix expects: `body` is the
 * plain text a terminal client shows, `formatted_body` the HTML a graphical
 * one renders, and both are built from the same `renderParts` so they cannot
 * say different things. The status page is a link in the HTML and a trailing
 * line in the plain text, since a Matrix message has no separate link
 * affordance to hang it on.
 *
 * Sends are `PUT`s with a transaction id, the idempotency key Matrix defines:
 * a retry that reuses one is de-duplicated by the homeserver rather than
 * posting the alert twice. One is minted per send here, so a retry inside
 * `fetch` (a redirect, a connection reset the runtime retries) cannot double
 * up while a genuinely new alert always gets its own.
 *
 * Editing is native (roadmap 3.19): an edit is another message carrying an
 * `m.replace` relation to the original event id, which is what `send` returns.
 */
export function createMatrixNotifier(settings: Record<string, string>): Notifier {
  const { homeserverUrl, roomId, accessToken } = settingsSchema.parse(settings);
  const root = `${homeserverUrl.replace(/\/+$/, "")}/_matrix/client/v3/rooms/${encodeURIComponent(
    roomId,
  )}/send/m.room.message`;

  /** Whatever went wrong, in the homeserver's own words and never with the token. */
  async function fail(response: Response, verb: string): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { errcode?: string; error?: string };
    const reason = [body.errcode, body.error].filter((part) => part !== undefined).join(": ");
    throw new Error(
      `matrix notification ${verb}: HTTP ${response.status}${reason === "" ? "" : ` (${reason})`}`,
    );
  }

  /** The message body both a send and an edit are built from. */
  function content(payload: NotificationPayload): { body: string; formatted_body: string } {
    const { heading, detail, url } = renderParts(payload);
    const lines = [heading, detail].filter((part) => part !== "");
    return {
      body: [...lines, url].join("\n\n"),
      formatted_body: [
        `<strong>${escapeHtml(heading)}</strong>`,
        ...(detail === "" ? [] : [escapeHtml(detail).replaceAll("\n", "<br/>")]),
        `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`,
      ].join("<br/><br/>"),
    };
  }

  async function put(event: Record<string, unknown>, verb: string): Promise<Response> {
    const response = await fetch(`${root}/${encodeURIComponent(crypto.randomUUID())}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) await fail(response, verb);
    return response;
  }

  return {
    id: "matrix",

    async send(payload: NotificationPayload): Promise<string | void> {
      const response = await put(
        { msgtype: "m.text", format: "org.matrix.custom.html", ...content(payload) },
        "failed",
      );

      // No event id in the answer is not a failure — the message went out — it
      // only leaves the dispatcher with nothing to edit later.
      const body = (await response.json().catch(() => ({}))) as { event_id?: string };
      return typeof body.event_id === "string" && body.event_id !== "" ? body.event_id : undefined;
    },

    async update(payload: NotificationPayload, ref: string): Promise<void> {
      const next = content(payload);
      await put(
        {
          msgtype: "m.text",
          format: "org.matrix.custom.html",
          // The fallback a client too old to understand the relation shows, by
          // the convention Matrix itself writes: the new text, marked as an
          // edit rather than silently reading as a second alert.
          body: `* ${next.body}`,
          formatted_body: `* ${next.formatted_body}`,
          "m.new_content": { msgtype: "m.text", format: "org.matrix.custom.html", ...next },
          "m.relates_to": { rel_type: "m.replace", event_id: ref },
        },
        "edit failed",
      );
    },
  };
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * A provider's own incident title lands inside `formatted_body`, and Matrix
 * renders that as HTML — so it is escaped here rather than trusted, for the
 * same reason every other external string in this codebase is validated.
 */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
