import type { ChannelConfig } from "../core/configSource.interface.ts";
import type { Notifier } from "../core/notifier.interface.ts";
import { createTelegramNotifier } from "./telegram.notifier.ts";
import { createWebhookNotifier } from "./webhook.notifier.ts";

type NotifierFactory = (settings: Record<string, string>) => Notifier;

const factories: Record<string, NotifierFactory> = {
  telegram: createTelegramNotifier,
  webhook: createWebhookNotifier,
};

/**
 * Built fresh from the configuration each poll cycle, so enabling a channel in
 * the UI edition takes effect without a restart. A disabled channel is never
 * constructed, so its settings are never validated.
 */
export function buildNotifiers(channels: ChannelConfig[]): Notifier[] {
  return channels
    .filter((channel) => channel.enabled)
    .map((channel) => {
      const factory = factories[channel.id];
      if (factory === undefined) {
        throw new Error(
          `unknown notification channel: ${channel.id} (known: ${Object.keys(factories).join(", ")})`,
        );
      }
      return factory(channel.settings);
    });
}
