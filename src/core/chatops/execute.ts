import { formatUtc, t } from "../i18n/index.ts";
import type { OverallStatus } from "../types.ts";
import type { ChatopsBackend, ChatProvider } from "./backend.interface.ts";
import { parseCommand, type ChatCommand } from "./commands.ts";

/**
 * Turning a parsed command into the words that go back into the chat — roadmap
 * 3.18.
 *
 * The reply is plain text, not the notifier's rich layout: a chatops answer is
 * a reply to a question somebody just asked, not an alert, and it must read the
 * same on Telegram as it would anywhere a second transport is ever added. It
 * borrows the notifier's status emoji, though, because a green dot in a reply
 * and a green dot in an alert must mean the same thing.
 */

const EMOJI: Record<OverallStatus, string> = {
  operational: "🟢",
  degraded: "🟡",
  partial_outage: "🟠",
  major_outage: "🔴",
  unknown: "⚪",
};

const STATUS_KEY: Record<OverallStatus, string> = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};

/** Percent, or a dash: "0.00%" for an unmeasured provider would read as a dead one. */
const uptime = (value: number | null): string => (value === null ? "—" : `${value.toFixed(2)}%`);

function providerLine(locale: string, provider: ChatProvider): string {
  const parts = [`${EMOJI[provider.status]} ${provider.name} — ${t(locale, STATUS_KEY[provider.status])}`];
  if (provider.openIncidents > 0) {
    parts.push(t(locale, "chatops.status.incidents", { count: provider.openIncidents }));
  }
  if (provider.underMaintenance) parts.push(t(locale, "chatops.status.maintenance"));
  if (provider.mutedUntil !== null) {
    parts.push(t(locale, "chatops.status.muted", { until: formatUtc(provider.mutedUntil) }));
  }
  return parts.join(" · ");
}

/**
 * The fleet in one message, worst first.
 *
 * Sorted by severity rather than by name because the first line of a phone
 * notification is all most readers will see, and the thing that is on fire
 * belongs there.
 */
const SEVERITY_ORDER: OverallStatus[] = [
  "major_outage",
  "partial_outage",
  "degraded",
  "unknown",
  "operational",
];

function fleetReply(locale: string, providers: ChatProvider[]): string {
  if (providers.length === 0) return t(locale, "chatops.status.empty");
  const sorted = [...providers].sort(
    (left, right) =>
      SEVERITY_ORDER.indexOf(left.status) - SEVERITY_ORDER.indexOf(right.status) ||
      left.name.localeCompare(right.name),
  );
  const bad = sorted.filter((provider) => provider.status !== "operational").length;
  const heading =
    bad === 0
      ? t(locale, "chatops.status.all-operational", { count: providers.length })
      : t(locale, "chatops.status.heading", { count: bad, total: providers.length });
  return [heading, "", ...sorted.map((provider) => providerLine(locale, provider))].join("\n");
}

/**
 * Matches what somebody typed against a provider: its configured id first, then
 * its display name, both case-insensitively.
 *
 * Both, because the two are different words often enough to matter — the id is
 * what `config.yml` calls it and the name is what the dashboard shows — and a
 * chat reply that says "no such provider" about one the operator can see on
 * screen is the kind of thing that gets a feature abandoned.
 */
function findProvider(providers: ChatProvider[], needle: string): ChatProvider | undefined {
  const wanted = needle.toLowerCase();
  return (
    providers.find((provider) => provider.id.toLowerCase() === wanted) ??
    providers.find((provider) => provider.name.toLowerCase() === wanted)
  );
}

async function run(
  backend: ChatopsBackend,
  locale: string,
  command: ChatCommand,
  now: Date,
): Promise<string> {
  switch (command.kind) {
    case "help":
      return t(locale, "chatops.help");

    case "status": {
      const providers = await backend.listProviders();
      if (command.providerId === undefined) return fleetReply(locale, providers);
      const provider = findProvider(providers, command.providerId);
      if (provider === undefined) {
        return t(locale, "chatops.error.unknown-provider", { provider: command.providerId });
      }
      return [
        providerLine(locale, provider),
        t(locale, "chatops.status.uptime90", { uptime: uptime(provider.uptime90) }),
      ].join("\n");
    }

    case "history": {
      const providers = await backend.listProviders();
      const provider = findProvider(providers, command.providerId);
      if (provider === undefined) {
        return t(locale, "chatops.error.unknown-provider", { provider: command.providerId });
      }
      const history = await backend.history(provider.id, command.days);
      if (history === null || history.measuredDays === 0) {
        return t(locale, "chatops.history.unmeasured", { provider: provider.name, days: command.days });
      }
      const lines = [
        t(locale, "chatops.history.heading", { provider: history.name, days: history.days }),
        t(locale, "chatops.history.uptime", {
          uptime: uptime(history.uptime),
          days: history.measuredDays,
        }),
        t(locale, "chatops.history.incidents", { count: history.incidents }),
      ];
      if (history.worstDay !== null) {
        lines.push(
          t(locale, "chatops.history.worst", {
            day: history.worstDay.day,
            uptime: uptime(history.worstDay.uptime),
          }),
        );
      }
      return lines.join("\n");
    }

    case "mute": {
      const providers = await backend.listProviders();
      const provider = findProvider(providers, command.providerId);
      if (provider === undefined) {
        return t(locale, "chatops.error.unknown-provider", { provider: command.providerId });
      }
      const until = new Date(now.getTime() + command.minutes * 60_000).toISOString();
      await backend.mute(provider.id, until);
      return t(locale, "chatops.mute.done", { provider: provider.name, until: formatUtc(until) });
    }

    case "unmute": {
      const providers = await backend.listProviders();
      const provider = findProvider(providers, command.providerId);
      if (provider === undefined) {
        return t(locale, "chatops.error.unknown-provider", { provider: command.providerId });
      }
      await backend.unmute(provider.id);
      return t(locale, "chatops.unmute.done", { provider: provider.name });
    }
  }
}

/**
 * One message in, one reply out — or `null` for anything that was not addressed
 * to the bot at all, which the transport answers with silence.
 *
 * A backend that throws becomes a sentence rather than an exception: the person
 * who typed the command is waiting, and a transport that logs the failure and
 * says nothing looks exactly like a bot that has stopped working.
 */
export async function handleMessage(options: {
  backend: ChatopsBackend;
  locale: string;
  text: string;
  now?: Date;
}): Promise<string | null> {
  const parsed = parseCommand(options.text);
  if (parsed === null) return null;
  if (!parsed.ok) return t(options.locale, parsed.key, parsed.params ?? {});
  try {
    return await run(options.backend, options.locale, parsed.command, options.now ?? new Date());
  } catch (error) {
    return t(options.locale, "chatops.error.failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
