import type { DeliveryConfig } from "./delivery.ts";
import type { DispatchContext, DispatcherDeps } from "./dispatcher.interface.ts";
import { attempt, type Attempt, type Sender } from "./dispatchSender.ts";
import type { Logger } from "./logger.ts";
import { effectiveMutedUntil } from "./mute.ts";
import { clearsFloor, severityOf } from "./routing.ts";
import type { NotificationPayload, StatusChange } from "./types.ts";
import { renderMessage } from "../notifiers/formatting.ts";

/** A lookup that logs and falls back instead of throwing — see the dispatcher's `orElse`. */
export type OrElse = <T>(what: string, fallback: T, read: () => Promise<T>, context: Record<string, unknown>) => Promise<T>;

/**
 * Escalation (roadmap 3.2): a change nobody took in charge is said again, on
 * the channel the operator chose, once it has gone unanswered long enough.
 * The dispatcher starts the clock for what it sends (`track`) and asks on
 * every dispatch what has run out (`due`).
 */
export interface Escalations {
  track(change: StatusChange, payload: NotificationPayload, delivery: DeliveryConfig, at: number): void;
  due(ctx: DispatchContext, delivery: DeliveryConfig, at: number): Promise<Attempt[]>;
}

export interface EscalationDeps {
  logger: Logger;
  sender: Pick<Sender, "deliver">;
  orElse: OrElse;
  escalation: DispatcherDeps["escalation"];
}

export function createEscalations(deps: EscalationDeps): Escalations {
  const { logger, orElse } = deps;
  const { deliver } = deps.sender;
  const escalationDeps = deps.escalation;


  /**
   * Changes waiting to see whether anybody answers (roadmap 3.2), one per
   * provider: what was said, when, and whether this stretch of trouble is done
   * with. In memory like the cap and the digest — a restart clears the clocks, so
   * the first alerts after one are never escalated by a timer nobody can see.
   *
   * An entry stays after it has escalated, and goes only when the provider is out
   * of trouble: that is what makes this one escalation per stretch rather than
   * one per later update, which would be the same nag every quarter hour.
   */
  const pendingEscalations = new Map<string, { payload: NotificationPayload; since: number; settled: boolean }>();
  let escalationRefused = false;

  /**
   * Whether this change starts the escalation clock: trouble that is still going
   * and clears the operator's floor. A recovery has nothing to answer, and the
   * kinds that are not about the provider's own state — a maintenance notice, a
   * slow page, our own fetching failing — are not what anyone is being paged for.
   */
  function startsEscalation(change: StatusChange, floor: DeliveryConfig["escalation"]["minSeverity"]): boolean {
    switch (change.kind) {
      case "status_change":
      case "component_status_change":
      case "incident_opened":
      case "incident_updated":
        return (
          change.currentStatus !== "operational" &&
          change.currentStatus !== "unknown" &&
          clearsFloor(severityOf(change), floor)
        );
      default:
        return false;
    }
  }

  /**
   * Starts, or refreshes, the clock for a change that was just sent. Refreshing
   * keeps the original start: the clock measures how long this trouble has gone
   * unanswered, and a worse update ten minutes in does not make anybody's
   * silence shorter.
   */
  function trackEscalation(change: StatusChange, payload: NotificationPayload, delivery: DeliveryConfig, at: number): void {
    const policy = delivery.escalation;
    if (!policy.enabled || !startsEscalation(change, policy.minSeverity)) return;
    if (escalationDeps === undefined || policy.channel === "") {
      // Said once, not per change: the operator asked for something this edition
      // or this configuration cannot do, and a line per alert would bury it.
      if (!escalationRefused) {
        escalationRefused = true;
        logger.warn(
          escalationDeps === undefined
            ? "escalation is on but this edition cannot tell whether anybody took a change in charge, so nothing will be escalated"
            : "escalation is on but no channel is chosen to escalate to, so nothing will be escalated",
        );
      }
      return;
    }
    const existing = pendingEscalations.get(change.providerId);
    pendingEscalations.set(change.providerId, {
      payload,
      since: existing?.since ?? at,
      settled: existing?.settled ?? false,
    });
  }

  /**
   * Says again whatever has gone unanswered for long enough. Asked on every
   * dispatch, including the ones with nothing to dispatch: like a digest window,
   * the wait runs out on the clock, not when the next change happens to arrive.
   * Its resolution is therefore one poll cycle — the dispatcher is only ever
   * asked then — which is why a wait shorter than the cadence is no shorter.
   */
  async function dueEscalations(
    ctx: DispatchContext,
    delivery: DeliveryConfig,
    at: number,
  ): Promise<Attempt[]> {
    const policy = delivery.escalation;
    if (!policy.enabled || escalationDeps === undefined) {
      pendingEscalations.clear();
      return [];
    }
    const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
    const sends: Attempt[] = [];

    for (const [providerId, entry] of [...pendingEscalations]) {
      // Out of trouble, however it ended: forgotten, so the next stretch starts
      // a fresh clock. Judged on the provider's own state rather than on a
      // resolving change, because a mute or a maintenance window swallows that.
      const stillInTrouble = await orElse(
        "checking whether a provider is still in trouble",
        true,
        () => escalationDeps.inTrouble(providerId),
        { providerId },
      );
      if (!stillInTrouble) {
        pendingEscalations.delete(providerId);
        continue;
      }
      if (entry.settled || at - entry.since < policy.afterMinutes * 60_000) continue;

      // From here this stretch of trouble is done with, whatever the answer: it
      // is either escalated, or somebody has it, or the operator said they know.
      entry.settled = true;
      if (await escalationDeps.isAcked(providerId)) continue;
      const service = ctx.services.find((candidate) => candidate.id === providerId);
      if (service === undefined) {
        pendingEscalations.delete(providerId);
        continue;
      }
      if (effectiveMutedUntil(service, new Date(at).toISOString()) !== null) continue;

      const notifier = byChannelId.get(policy.channel);
      if (notifier === undefined) {
        // The escalation target was switched off, or never existed: an alert
        // nobody answered that then goes nowhere is the one outcome this feature
        // exists to prevent, so it is a warning and not a shrug.
        logger.warn("escalation could not be sent because its channel is not enabled", {
          channel: policy.channel,
          providerId,
        });
        continue;
      }

      const message = ctx.channelMessages?.[policy.channel];
      const payload: NotificationPayload = {
        ...entry.payload,
        locale: message?.locale ?? ctx.locale,
        template: message?.template,
        interactive: ctx.interactiveChannels?.includes(policy.channel) === true ? true : undefined,
        escalated: { afterMinutes: policy.afterMinutes },
        suppressedCount: 0,
      };
      logger.warn("a change nobody took in charge is being escalated", {
        providerId,
        channel: policy.channel,
        afterMinutes: policy.afterMinutes,
      });
      sends.push(
        attempt(
          deliver(notifier, payload, renderMessage(payload)),
          payload.change.providerId,
          notifier.id,
          payload.change.kind,
        ),
      );
    }
    return sends;
  }

  return { track: trackEscalation, due: dueEscalations };
}
