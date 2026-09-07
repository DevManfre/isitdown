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
}

export interface ServiceDefinition {
  id: string;
  name: string;
  /** Adapter registry key. */
  adapter: string;
  baseUrl: string;
  enabled: boolean;
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
}

export interface ChannelConfig {
  id: string;
  enabled: boolean;
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
}

/**
 * Read once per poll cycle, which is what makes the UI edition's configuration
 * changes take effect without a restart.
 */
export interface ConfigSource {
  load(): Promise<RuntimeConfig>;
}
