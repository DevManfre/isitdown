import type { ChannelConfig } from "../core/configSource.interface.ts";
import type { Notifier } from "../core/notifier.interface.ts";
import { createTelegramNotifier } from "./telegram.notifier.ts";
import { createWebhookNotifier } from "./webhook.notifier.ts";

export type NotifierFactory = (settings: Record<string, string>) => Notifier;

const factories: Record<string, NotifierFactory> = {
  telegram: createTelegramNotifier,
  webhook: createWebhookNotifier,
};

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
