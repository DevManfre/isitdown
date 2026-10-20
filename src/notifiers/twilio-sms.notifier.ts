import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload } from "../core/types.ts";
import { fitText, renderMessage } from "./formatting.ts";
import { twilioPost, twilioSettingsSchema } from "./twilio.ts";

/** Twilio refuses a message body past this; it is ten concatenated segments. */
const BODY_MAX_CHARS = 1600;

const settingsSchema = twilioSettingsSchema("twilio-sms");

/**
 * SMS through Twilio — roadmap 3.9. The message every plain-text channel sends,
 * link included, cut to what one SMS conversation carries. The text that works
 * when the phone has no data, which is exactly when a status page cannot be
 * opened anyway.
 */
export function createTwilioSmsNotifier(settings: Record<string, string>): Notifier {
  const parsed = settingsSchema.parse(settings);

  return {
    id: "twilio-sms",

    async send(payload: NotificationPayload): Promise<void> {
      await twilioPost("twilio-sms", parsed, "Messages", {
        Body: fitText(renderMessage(payload), BODY_MAX_CHARS),
      });
    },
  };
}
