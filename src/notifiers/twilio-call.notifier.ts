import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { fitText, renderParts } from "./formatting.ts";
import { twilioPost, twilioSettingsSchema } from "./twilio.ts";

/**
 * How much is spoken. TwiML passed inline is capped at 4000 characters and the
 * text is said twice, escaped; and nobody woken at 3 a.m. listens to more than
 * this anyway.
 */
const SPOKEN_MAX_CHARS = 1500;

const settingsSchema = twilioSettingsSchema("twilio-call");

/**
 * A voice call through Twilio — roadmap 3.9, for the one provider that
 * justifies waking up. Which provider that is, is the routing rules' decision:
 * this channel calls for everything routed to it, so it belongs behind a rule
 * like `minSeverity: major_outage`.
 *
 * The message is read out by Twilio's text-to-speech in the payload's language,
 * twice with a pause between, the way an automated call is always read: the
 * first time is usually spent finding the phone. Emoji are dropped — a speech
 * engine reads them out by name.
 */
export function createTwilioCallNotifier(settings: Record<string, string>): Notifier {
  const parsed = settingsSchema.parse(settings);

  return {
    id: "twilio-call",

    async send(payload: NotificationPayload): Promise<void> {
      const { heading, detail } = renderParts(payload);
      const spoken = escapeXml(
        fitText(speakable(`${heading}\n${detail}`), SPOKEN_MAX_CHARS),
      );
      const say = `<Say language="${VOICE_LANGUAGE[payload.locale] ?? "en-US"}">${spoken}</Say>`;
      await twilioPost("twilio-call", parsed, "Calls", {
        Twiml: `<Response>${say}<Pause length="1"/>${say}</Response>`,
      });
    },
  };
}

/** The dashboard's languages, as the voices Twilio's `<Say>` has for them. */
const VOICE_LANGUAGE: Record<string, string> = {
  en: "en-US",
  it: "it-IT",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
};

/**
 * Text a speech engine reads well: no emoji, and each line a sentence — ended
 * with a full stop only when it does not already end in one, or the engine
 * pauses twice.
 */
const speakable = (text: string): string =>
  text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .map((line) => (/[.!?:]$/.test(line) ? line : `${line}.`))
    .join(" ");

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** A provider's incident title lands inside TwiML, so it is escaped rather than trusted. */
const escapeXml = (value: string): string => value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);
