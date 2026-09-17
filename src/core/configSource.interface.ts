import type { DeliveryConfig } from "./delivery.ts";
import type { RoutingRule } from "./routing.ts";

export interface PollingConfig {
  intervalMinutes: number;
  requestTimeoutSeconds: number;
  maxRetries: number;
  /** Consecutive failures before one "monitoring degraded" warning is sent. */
  failureThreshold: number;
  /**
   * Whether a provider in trouble is polled faster than its own cadence.
   * See `adaptiveIntervalMinutes`.
   */
  adaptivePolling: boolean;
  /**
   * The cadence a provider with an open incident is polled on while
   * `adaptivePolling` is set. The poller takes the shorter of this and the
   * provider's own interval, so it can only ever speed a provider up.
   */
  adaptiveIntervalMinutes: number;
  /**
   * Flap damping: consecutive polls that must agree on a reading before a
   * transition notifies. 1 is off. See `confirmedChanges` in the diff engine.
   */
  confirmSamples: number;
  /**
   * How many providers have to go bad inside `correlationWindowMinutes` before
   * the poller reports one shared failure instead of one alert each (roadmap
   * 2.7). 0 and 1 are off. See `correlatedOutage` in the diff engine.
   */
  correlationThreshold: number;
  /** How wide that window is, in minutes. */
  correlationWindowMinutes: number;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  /** Adapter registry key. */
  adapter: string;
  baseUrl: string;
  enabled: boolean;
  /** The group this provider belongs to, or absent while the fleet is flat (roadmap 2.6). */
  group?: string | undefined;
  /**
   * On a probe: the provider whose status page it is a second opinion on
   * (roadmap 1.10). Absent on everything else, which is every service that is
   * a status page rather than a probe of one.
   */
  crossChecks?: string | undefined;
  /**
   * How often this provider is polled. Absent means the global cadence: a page
   * that publishes every few minutes and one that changes twice a year do not
   * deserve the same one.
   */
  intervalMinutes?: number | undefined;
  options?: Record<string, string> | undefined;
  components: { id: string; name: string }[];
  /** Report only what the selection covers. Meaningless with no selection. */
  scopeToComponents: boolean;
  /**
   * ISO 8601, UTC. While a reading is taken before it, nothing about this
   * provider notifies. Absent means the provider is not muted.
   */
  mutedUntil?: string | undefined;
  /**
   * The monthly uptime target this provider is held to, as a percentage
   * (roadmap 4.13). Absent means nobody promised anything, which is the normal
   * case — and it is what keeps "no target" distinguishable from a target of
   * 100%.
   */
  slaTarget?: number | undefined;
}

/**
 * Channel fields that decide how a message *reads* rather than where it goes —
 * the locale it is written in (roadmap 3.20) and the template it is rendered
 * with (roadmap 3.15).
 *
 * Named once, here, because both editions store them beside the channel's
 * transport settings and both have to keep them out of `settings`: a notifier
 * factory validates what it is handed, and a stray `locale` key in there would
 * be a transport setting nothing knows what to do with.
 */
export const CHANNEL_MESSAGE_KEYS = ["locale", "template"] as const;

export interface ChannelConfig {
  id: string;
  enabled: boolean;
  /**
   * The language this channel's messages are written in, when it asks for one
   * of its own (roadmap 3.20). Absent means the installation's notification
   * locale — which is what every channel did before this existed, and still the
   * normal case. What it buys is a Telegram chat reading Italian while the
   * webhook payload beside it stays English.
   */
  locale?: string | undefined;
  /**
   * This channel's own message template (roadmap 3.15). Absent means the
   * default rendering, byte for byte. See `src/notifiers/template.ts` for what
   * a template may contain and, just as much, what it may not.
   */
  template?: string | undefined;
  /**
   * Channel settings with any secret already resolved from the environment.
   * Never persisted, never logged.
   */
  settings: Record<string, string>;
}

export interface RuntimeConfig {
  polling: PollingConfig;
  /** Locale for notification messages. */
  locale: string;
  services: ServiceDefinition[];
  channels: ChannelConfig[];
  /**
   * Which channels each change reaches, in evaluation order — the first
   * matching rule decides. Never empty: both editions substitute a catch-all
   * when the operator has configured none, so "no rules" can never mean
   * "no notifications".
   */
  rules: RoutingRule[];
  /**
   * How much of what the rules admit actually goes out, and in how many
   * messages: quiet hours, the digest window, the per-provider cap, and
   * whether an incident's updates edit one message instead of adding
   * another. Every field has an "off" default, so an installation that
   * configures none of this behaves exactly as it did before.
   */
  delivery: DeliveryConfig;
}

/**
 * Read once per poll cycle, which is what makes the UI edition's configuration
 * changes take effect without a restart.
 */
export interface ConfigSource {
  load(): Promise<RuntimeConfig>;
}
