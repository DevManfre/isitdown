import type { DeliveryConfig } from "./delivery.ts";
import type { DispatchContext, SentRecord } from "./dispatcher.interface.ts";
import { attempt, chainsOf, payloadServiceOf, type Attempt, type Sender } from "./dispatchSender.ts";
import type { Logger } from "./logger.ts";
import { explain } from "./routing.ts";
import type { NotificationPayload, StatusChange } from "./types.ts";
import { renderMessage } from "../notifiers/formatting.ts";

/**
 * Channel health (roadmap 3.4): every delivery result feeds a per-channel run
 * of failures (`noteOutcomes`), and a channel that has refused enough messages
 * in a row is reported on the others (`alerts`).
 */
export interface ChannelHealth {
  noteOutcomes(records: readonly SentRecord[], afterFailures?: number): void;
  alerts(ctx: DispatchContext, delivery: DeliveryConfig, at: number): Promise<SentRecord[]>;
}

export interface ChannelHealthDeps {
  logger: Logger;
  sender: Sender;
}

export function createChannelHealth(deps: ChannelHealthDeps): ChannelHealth {
  const { logger } = deps;
  const { deliver, deliverChain, settleAll } = deps.sender;


  /**
   * The current run of failures per channel (roadmap 3.4): how many messages in
   * a row it refused, since when, about which provider the last one was, and
   * whether the other channels have been told. A success ends the run, so the
   * next broken stretch is told about again. In memory like the cap, for the
   * same reason: a restart is when an operator is watching, and a run carried
   * across one would alert about a channel nobody has seen fail since.
   */
  const channelRuns = new Map<
    string,
    { failures: number; since: string; providerId: string; error?: string | undefined; told: boolean }
  >();

  /** Each channel's run of failures, extended or ended by what just happened to it. */
  function noteOutcomes(records: readonly SentRecord[], afterFailures = 1): void {
    for (const record of records) {
      if (record.ok) {
        channelRuns.delete(record.channel);
        continue;
      }
      const run = channelRuns.get(record.channel);
      // A routine test comes once a week, so waiting for `afterFailures` of
      // them would take a month to say a channel is broken. One failed test is
      // already the proof the others only approach (roadmap 3.16).
      const proof = record.kind === "delivery_test" ? afterFailures : 0;
      channelRuns.set(record.channel, {
        failures: Math.max((run?.failures ?? 0) + 1, proof),
        since: run?.since ?? record.sentAt,
        providerId: record.providerId,
        error: record.error,
        told: run?.told ?? false,
      });
    }
  }

  /**
   * Says so on the other channels when one has refused `afterFailures` messages
   * in a row (roadmap 3.4) — once per run, so a webhook down for a week is one
   * alert and not one per poll.
   *
   * Routed like any monitoring change, through the same rules, so an operator
   * who keeps monitoring off the phone keeps this off it too; then the broken
   * channel is taken out, along with every other channel currently in a run of
   * its own, because telling a channel that is not delivering is telling nobody.
   * Held by quiet hours like anything else, and left untold while held, so it
   * goes out the morning after rather than never.
   */
  async function channelAlerts(ctx: DispatchContext, delivery: DeliveryConfig, at: number): Promise<SentRecord[]> {
    const policy = delivery.channelHealth;
    if (!policy.enabled || channelRuns.size === 0) return [];
    const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
    const broken = (id: string): boolean => (channelRuns.get(id)?.failures ?? 0) >= policy.afterFailures;
    const attempts: Attempt[] = [];

    for (const [channelId, run] of [...channelRuns]) {
      // A channel switched off is no longer expected to deliver anything.
      if (!byChannelId.has(channelId)) {
        channelRuns.delete(channelId);
        continue;
      }
      if (run.told || run.failures < policy.afterFailures) continue;
      // The provider the last lost message was about, or — if it has since been
      // removed — any provider, so the alert still has a subject to hang on.
      const service = ctx.services.find((candidate) => candidate.id === run.providerId) ?? ctx.services[0];
      if (service === undefined) continue;

      const change: StatusChange = {
        kind: "channel_failing",
        providerId: service.id,
        currentStatus: "unknown",
        channel: { id: channelId, failures: run.failures, since: run.since, error: run.error },
        at: new Date(at).toISOString(),
      };
      const routed = explain(change, ctx.rules, [...byChannelId.keys()], {
        quietHours: delivery.quietHours,
        at: new Date(at),
        ...(service.group === undefined ? {} : { providerGroup: service.group }),
        ...(service.tags === undefined ? {} : { providerTags: service.tags }),
      });
      if (routed.quieted) continue;
      const healthy = routed.targets.filter((id) => id !== channelId && !broken(id) && byChannelId.has(id));
      run.told = true;
      if (healthy.length === 0) {
        logger.error("a channel keeps failing and no other channel is routed to say so", {
          channel: channelId,
          failures: run.failures,
          since: run.since,
        });
        continue;
      }
      logger.warn("a channel keeps failing, telling the others", {
        channel: channelId,
        failures: run.failures,
        to: healthy,
      });
      const base: NotificationPayload = { change, service: payloadServiceOf(service), locale: ctx.locale };
      for (const chain of chainsOf(healthy, ctx.recipients)) {
        const notifiers = chain.flatMap((id) => byChannelId.get(id) ?? []);
        attempts.push(
          attempt(
            deliverChain(notifiers, (notifier) => {
              const message = ctx.channelMessages?.[notifier.id];
              const payload: NotificationPayload = {
                ...base,
                locale: message?.locale ?? ctx.locale,
                ...(message?.template === undefined ? {} : { template: message.template }),
              };
              return deliver(notifier, payload, renderMessage(payload));
            }),
            change.providerId,
            notifiers[0]?.id,
            change.kind,
          ),
        );
      }
    }
    return settleAll(attempts);
  }

  return { noteOutcomes, alerts: channelAlerts };
}
