import type { RuntimeConfig } from "./configSource.interface.ts";

/**
 * "What I use" — roadmap 16.3.
 *
 * IsItDown has no telemetry and will not grow any, so the only way to learn
 * which surfaces are worth their upkeep is to ask. This is the answer an
 * operator can give by hand: counts and identifiers only — which adapters,
 * which channels, which delivery features — never a URL, a provider name, a
 * token or anything else that says *whose* installation it is. The operator
 * reads it, copies it, and pastes it into an issue if they want to; nothing
 * here sends anything anywhere.
 *
 * Edition-agnostic: both editions hand over the same `RuntimeConfig` and add
 * what only they know through `features` and `deprecatedInUse`.
 */
export interface UsageReport {
  edition: "light" | "ui";
  version: string;
  providers: { total: number; enabled: number; byAdapter: Record<string, number> };
  channels: string[];
  delivery: string[];
  routingRules: number;
  recipients: number;
  /** Edition-specific switches, by name: `true` when in use. */
  features: Record<string, boolean>;
  /** Deprecated surfaces this installation has touched since it started. */
  deprecatedInUse: string[];
}

export interface UsageReportInput {
  edition: UsageReport["edition"];
  version: string;
  config: RuntimeConfig;
  /**
   * Every provider, disabled ones included, when the config carries only the
   * enabled ones (the UI edition's does). Absent means `config.services`.
   */
  allServices?: readonly { enabled: boolean }[] | undefined;
  features?: Record<string, boolean> | undefined;
  deprecatedInUse?: readonly string[] | undefined;
}

const sortedCounts = (ids: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const id of [...ids].sort()) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
};

/**
 * A delivery feature is in use when its block says `enabled: true`, or when it
 * is a plain flag set to `true` (`updateInPlace`, `attachChart`).
 */
function deliveryInUse(delivery: RuntimeConfig["delivery"]): string[] {
  return Object.entries(delivery)
    .filter(([, value]) =>
      value === true ||
      (typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === true),
    )
    .map(([key]) => key)
    .sort();
}

export function buildUsageReport(input: UsageReportInput): UsageReport {
  const { config } = input;
  const enabled = config.services.filter((service) => service.enabled);
  return {
    edition: input.edition,
    version: input.version,
    providers: {
      total: (input.allServices ?? config.services).length,
      enabled: enabled.length,
      byAdapter: sortedCounts(enabled.map((service) => service.adapter)),
    },
    channels: config.channels.filter((channel) => channel.enabled).map((channel) => channel.id).sort(),
    delivery: deliveryInUse(config.delivery),
    // A catch-all the edition substituted is not a rule anybody wrote.
    routingRules: config.rules.filter((rule) => !(rule.provider === "*" && rule.channels.includes("*"))).length,
    recipients: config.recipients.length,
    features: Object.fromEntries(Object.entries(input.features ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    deprecatedInUse: [...new Set(input.deprecatedInUse ?? [])].sort(),
  };
}
