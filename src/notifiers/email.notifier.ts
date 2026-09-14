import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { renderParts } from "./formatting.ts";
import { sendMail } from "./smtp.ts";

const REQUEST_TIMEOUT_MS = 20_000;

/** The port that means TLS from the first byte, with no STARTTLS to negotiate. */
const IMPLICIT_TLS_PORT = 465;

/** One address, checked only for the shape an envelope needs: no spaces, one `@`. */
const address = (field: string) =>
  z
    .string()
    .trim()
    .refine((value) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value), {
      message: `${field} must be an email address for the email channel`,
    });

const settingsSchema = z.object({
  host: z.string().min(1, "host is required for the email channel"),
  /** Submission by default; 465 is implicit TLS, 25 a relay on this machine. */
  port: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? 587 : Number(value)))
    .refine((port) => Number.isInteger(port) && port > 0 && port <= 65535, {
      message: "port must be a TCP port number for the email channel",
    }),
  /** "true" for implicit TLS from the first byte; otherwise STARTTLS when offered. */
  secure: z
    .string()
    .optional()
    .transform((value) => (value ?? "").trim().toLowerCase() === "true"),
  allowInsecureAuth: z
    .string()
    .optional()
    .transform((value) => (value ?? "").trim().toLowerCase() === "true"),
  /** "true" accepts a certificate no public CA signed — a self-hosted server's own. */
  allowSelfSigned: z
    .string()
    .optional()
    .transform((value) => (value ?? "").trim().toLowerCase() === "true"),
  username: z.string().optional(),
  password: z.string().optional(),
  from: address("from"),
  /** One address or several, comma-separated: one alert often has two readers. */
  to: z
    .string()
    .min(1, "to is required for the email channel")
    .transform((value) => value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== ""))
    .refine((list) => list.length > 0, { message: "to is required for the email channel" })
    .refine((list) => list.every((entry) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(entry)), {
      message: "to must be one email address, or several separated by commas, for the email channel",
    }),
});

/**
 * Email — roadmap 3.3. The most-asked-for channel in a self-hosted tool, and the
 * one that would have added a runtime dependency: `src/notifiers/smtp.ts` is the
 * submission conversation instead, so this file stays what every other notifier
 * is — a rendering plus a transport.
 *
 * The subject is the heading every other channel puts first ("🔴 GitHub — MAJOR
 * OUTAGE"), so a phone's lock screen shows the same sentence Telegram would. The
 * body is the detail and the provider's own status page, because a mail client
 * has no affordance to attach a link to.
 */
export function createEmailNotifier(settings: Record<string, string>): Notifier {
  const parsed = settingsSchema.parse(settings);

  return {
    id: "email",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail, url } = renderParts(payload);
      // Port 465 is implicit TLS by definition, so an operator who wrote the
      // port and nothing else gets the connection that port means rather than a
      // cleartext one the server will never answer.
      const secure = parsed.secure || parsed.port === IMPLICIT_TLS_PORT;
      const text = [detail, url].filter((part) => part !== "").join("\n\n");

      await sendMail(
        {
          host: parsed.host,
          port: parsed.port,
          secure,
          allowInsecureAuth: parsed.allowInsecureAuth,
          allowSelfSigned: parsed.allowSelfSigned,
          ...(parsed.username === undefined ? {} : { username: parsed.username }),
          ...(parsed.password === undefined ? {} : { password: parsed.password }),
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
        {
          from: parsed.from,
          to: parsed.to,
          subject: heading,
          // A message with nothing under its heading still says the heading:
          // an empty mail body reads as a broken notification.
          text: text === "" ? heading : text,
        },
      );
    },
  };
}
