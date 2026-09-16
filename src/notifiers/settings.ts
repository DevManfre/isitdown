import { z } from "zod";

/**
 * Settings validation shared by the channels whose whole configuration is a
 * URL. Stated once so three channels cannot end up rejecting three different
 * sets of malformed values, and so the error names the field an operator sees
 * in `config.yml` or in the dashboard.
 */
export function httpUrlSetting(field: string, channel: string): z.ZodType<string> {
  return z
    .string()
    .min(1, `${field} is required for the ${channel} channel`)
    .refine(
      (value) => {
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          return false;
        }
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      },
      { message: `${field} must be an http or https URL for the ${channel} channel` },
    );
}

/**
 * Credential fields a channel works perfectly well without, by channel id and
 * by their resolved name (`secret`, not `secretEnv`).
 *
 * The UI edition resolves every `*Env` field a channel row carries and disables
 * the channel for the cycle when one is unset — the right answer for a bot
 * token, and the wrong one for the webhook's optional signing secret: adding
 * that field would otherwise have silenced every existing webhook the moment
 * the migration ran. Listed here rather than in the edition so the two editions
 * cannot disagree about which credentials are load-bearing.
 */
export const OPTIONAL_CHANNEL_SETTINGS: Record<string, readonly string[]> = {
  webhook: ["secret"],
  // A public ntfy topic needs no credential at all; one on a server with
  // access control does. Requiring it would disable the channel for everyone
  // publishing to ntfy.sh, which is the common case.
  ntfy: ["token"],
  // A device name narrows delivery to one phone; unset means every device on
  // the account, which is what most operators want and what Pushover defaults
  // to. The two credentials beside it are not optional.
  pushover: ["device"],
  // The host and the two addresses are the channel; everything else has a
  // working default. A relay on this machine, or one that trusts this network,
  // wants no credentials at all — and a submission server that does will refuse
  // the envelope in words the delivery log can show.
  email: ["port", "secure", "allowInsecureAuth", "allowSelfSigned", "username", "password"],
  // The service region, unset meaning the default US instance — which is the
  // account most operators have, and requiring it would disable the channel
  // for all of them.
  pagerduty: ["region"],
  opsgenie: ["region"],
  // Either of the two is enough, and neither on its own is required: the
  // notifier's schema refuses the pair when both are empty, which is a claim
  // about the pair that a per-field list cannot make.
  apprise: ["configKey", "urls"],
};

/** Whether a channel still works with this credential unset. */
export const isOptionalSetting = (channelId: string, name: string): boolean =>
  (OPTIONAL_CHANNEL_SETTINGS[channelId] ?? []).includes(name);
