export interface PollingConfig {
  intervalMinutes: number;
  requestTimeoutSeconds: number;
  maxRetries: number;
  /** Consecutive failures before one "monitoring degraded" warning is sent. */
  failureThreshold: number;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  /** Adapter registry key. */
  adapter: string;
  baseUrl: string;
  enabled: boolean;
  options?: Record<string, string> | undefined;
  components: { id: string; name: string }[];
  /** Report only what the selection covers. Meaningless with no selection. */
  scopeToComponents: boolean;
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
}

/**
 * Read once per poll cycle, which is what makes the UI edition's configuration
 * changes take effect without a restart.
 */
export interface ConfigSource {
  load(): Promise<RuntimeConfig>;
}
