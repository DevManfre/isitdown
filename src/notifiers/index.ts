import type { ChannelConfig } from "../core/configSource.interface.ts";
import type { Notifier } from "../core/notifier.interface.ts";
import { createAppriseNotifier } from "./apprise.notifier.ts";
import { createBarkNotifier } from "./bark.notifier.ts";
import { createBlueskyNotifier } from "./bluesky.notifier.ts";
import { createDiscordNotifier } from "./discord.notifier.ts";
import { createEmailNotifier } from "./email.notifier.ts";
import { createGoogleChatNotifier } from "./google-chat.notifier.ts";
import { createGotifyNotifier } from "./gotify.notifier.ts";
import { createGrafanaOncallNotifier } from "./grafana-oncall.notifier.ts";
import { createIncidentIoNotifier } from "./incident-io.notifier.ts";
import { createMastodonNotifier } from "./mastodon.notifier.ts";
import { createMatrixNotifier } from "./matrix.notifier.ts";
import { createMattermostNotifier } from "./mattermost.notifier.ts";
import { createMqttNotifier } from "./mqtt.notifier.ts";
import { createNtfyNotifier } from "./ntfy.notifier.ts";
import { createOpsgenieNotifier } from "./opsgenie.notifier.ts";
import { createPagerdutyNotifier } from "./pagerduty.notifier.ts";
import { createPushoverNotifier } from "./pushover.notifier.ts";
import { createRocketchatNotifier } from "./rocketchat.notifier.ts";
import { createSignalNotifier } from "./signal.notifier.ts";
import { createSlackNotifier } from "./slack.notifier.ts";
import { createSplunkOncallNotifier } from "./splunk-oncall.notifier.ts";
import { createSquadcastNotifier } from "./squadcast.notifier.ts";
import { createSyslogNotifier } from "./syslog.notifier.ts";
import { createTeamsNotifier } from "./teams.notifier.ts";
import { createTelegramNotifier } from "./telegram.notifier.ts";
import { createTwilioCallNotifier } from "./twilio-call.notifier.ts";
import { createTwilioSmsNotifier } from "./twilio-sms.notifier.ts";
import { createWebhookNotifier } from "./webhook.notifier.ts";
import { createZendutyNotifier } from "./zenduty.notifier.ts";
import { createZulipNotifier } from "./zulip.notifier.ts";

export type NotifierFactory = (settings: Record<string, string>) => Notifier;

const factories: Record<string, NotifierFactory> = {
  apprise: createAppriseNotifier,
  bark: createBarkNotifier,
  bluesky: createBlueskyNotifier,
  discord: createDiscordNotifier,
  email: createEmailNotifier,
  "google-chat": createGoogleChatNotifier,
  gotify: createGotifyNotifier,
  "grafana-oncall": createGrafanaOncallNotifier,
  "incident-io": createIncidentIoNotifier,
  mastodon: createMastodonNotifier,
  matrix: createMatrixNotifier,
  mattermost: createMattermostNotifier,
  mqtt: createMqttNotifier,
  ntfy: createNtfyNotifier,
  opsgenie: createOpsgenieNotifier,
  pagerduty: createPagerdutyNotifier,
  pushover: createPushoverNotifier,
  rocketchat: createRocketchatNotifier,
  signal: createSignalNotifier,
  slack: createSlackNotifier,
  "splunk-oncall": createSplunkOncallNotifier,
  squadcast: createSquadcastNotifier,
  syslog: createSyslogNotifier,
  teams: createTeamsNotifier,
  telegram: createTelegramNotifier,
  "twilio-call": createTwilioCallNotifier,
  "twilio-sms": createTwilioSmsNotifier,
  webhook: createWebhookNotifier,
  zenduty: createZendutyNotifier,
  zulip: createZulipNotifier,
};

/**
 * Every channel this registry can build, which is what the notifier contract
 * suite (roadmap 3.8) walks: a channel added to `factories` and left out of
 * the suite fails that test rather than shipping unchecked.
 */
export const BUILT_IN_CHANNEL_IDS: readonly string[] = Object.keys(factories);

/**
 * Built fresh from the configuration each poll cycle, so enabling a channel in
 * the UI edition takes effect without a restart. A disabled channel is never
 * constructed, so its settings are never validated.
 *
 * `extra` is how an edition contributes a channel that needs more than settings
 * strings — the UI edition's browser push, which also needs its device list.
 * Passing it stays the caller's job so that nothing in here has to know about an
 * edition.
 */
export function buildNotifiers(
  channels: ChannelConfig[],
  extra: Record<string, NotifierFactory> = {},
): Notifier[] {
  // A collision is refused, not resolved: `extra` exists so an edition can add a
  // channel the shared registry doesn't know, not to replace one that ships
  // here. Letting it silently win would swap a notifier's behavior with no
  // signal at the call site, which is a debugging trap.
  for (const id of Object.keys(extra)) {
    if (id in factories) {
      throw new Error(`extra notification channel collides with a built-in one: ${id}`);
    }
  }
  const known = { ...factories, ...extra };
  return channels
    .filter((channel) => channel.enabled)
    .map((channel) => {
      const factory = known[channel.id];
      if (factory === undefined) {
        throw new Error(
          `unknown notification channel: ${channel.id} (known: ${Object.keys(known).join(", ")})`,
        );
      }
      return factory(channel.settings);
    });
}
